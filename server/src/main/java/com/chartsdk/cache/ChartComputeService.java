package com.chartsdk.cache;

import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 차트 결과 재계산 + 캐시 시드의 단일 진입점. 저장 시드(S2 [저장])·수동 갱신(S2 [지금 갱신])·임베드 재계산이 공유한다.
 * builder 차트는 저장된 builderConfig를 현재 SQL 생성기로 다시 실행하고, raw SQL 차트만 저장 SQL을 직접 실행한다.
 */
@Service
public class ChartComputeService {
    private final JdbcTemplate jdbc;
    private final FederatedQueryRunner runner;
    private final ChartCacheService cache;
    private final ObjectMapper mapper;

    public ChartComputeService(JdbcTemplate jdbc, FederatedQueryRunner runner, ChartCacheService cache, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.runner = runner;
        this.cache = cache;
        this.mapper = mapper;
    }

    /** 차트를 즉시 재계산해 캐시에 반영. 차트 없으면 404. */
    public CachedChartRows recompute(long chartId) {
        Chart chart = definition(chartId);
        Computed computed = execute(chartId, chart);
        return cache.upsert(chartId, computed.rows(), chart.version(), computed.sampling());
    }

    /**
     * 임베드 핫패스의 단일 비행(single-flight) 재계산 — 캐시 미스/만료 시 호출.
     * pg_try_advisory_xact_lock 으로 동시 재계산을 한 요청으로 합치고, 경쟁에서 진 요청은
     * allowStale 이면 기존 stale 캐시를 즉시 반환한다. advisory lock은 트랜잭션 종료 시 자동 해제된다.
     */
    @Transactional
    public CachedChartRows refreshSingleFlight(long chartId, boolean allowStale, SamplingMetadata sampling) {
        Boolean won = jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(?)", Boolean.class, chartId);
        if (Boolean.TRUE.equals(won)) {
            Chart chart = definition(chartId);
            Computed computed = execute(chartId, chart);
            return cache.upsert(chartId, computed.rows(), chart.version(), computed.sampling());
        }
        if (allowStale) {
            Optional<CachedChartRows> stale = matchingSampling(cache.find(chartId), sampling);
            if (stale.isPresent()) return stale.get();
        }
        jdbc.query("SELECT pg_advisory_xact_lock(?)", rs -> null, chartId);
        return matchingSampling(cache.find(chartId), sampling).orElseGet(() -> {
            Chart chart = definition(chartId);
            Computed computed = execute(chartId, chart);
            return cache.upsert(chartId, computed.rows(), chart.version(), computed.sampling());
        });
    }

    /**
     * 서빙 경로의 단일 진입점. 다중 소스 차트는 캐시 스냅샷만 반환하고,
     * 단일 소스는 캐시 미스/만료 시 단일 비행으로 재계산한다.
     */
    public CachedChartRows serve(long chartId, String refreshMode, int cacheTtlSeconds,
                                 int definitionVersion, SamplingMetadata sampling) {
        if (isMultiSource(chartId)) {
            return matchingSampling(cache.find(chartId), sampling)
                    .orElseThrow(() -> new ApiException(
                            HttpStatus.SERVICE_UNAVAILABLE, "SNAPSHOT_NOT_READY",
                            "Multi-source chart snapshot is not ready; refresh the chart to compute it."));
        }
        return matchingSampling(cache.findUsable(chartId, refreshMode, cacheTtlSeconds, definitionVersion), sampling)
                .orElseGet(() -> refreshSingleFlight(chartId, !"live".equals(refreshMode), sampling));
    }

    /** 차트가 2개 이상 데이터소스를 참조하는가 — 임베드 캐시-온리 판정의 단일 진실원. */
    public boolean isMultiSource(long chartId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM mc_chart_datasource WHERE chart_id=?", Integer.class, chartId);
        return n != null && n >= 2;
    }

    /** 저장 직후 캐시 시드(베스트 에포트). 데이터소스 장애로 실패해도 저장은 유지한다. */
    public void seedQuietly(long chartId) {
        try {
            recompute(chartId);
        } catch (RuntimeException ignored) {
            // 시드는 self-heal로 대체 가능 — 저장 트랜잭션을 깨지 않는다.
        }
    }

    /** 기존 builder 차트도 현재 생성 규칙(sampling v6의 결과 표본·표본 SUM/COUNT 포함)을 즉시 사용한다. */
    private Computed execute(long chartId, Chart chart) {
        if ("builder".equals(chart.defineMode()) && !chart.builderConfig().isEmpty()) {
            FederatedQueryRunner.BuiltResult built =
                    runner.runBuilder(chart.datasourceId(), chart.builderConfig(), chart.chartType(), false);
            return new Computed(built.rows(), built.sampling());
        }
        return new Computed(runner.runStored(datasources(chartId), chart.datasourceId(), chart.sqlQuery()), null);
    }

    Chart definition(long chartId) {
        return jdbc.query("""
                SELECT datasource_id, define_mode, sql_query, builder_config::text, chart_type, version
                  FROM mc_chart
                 WHERE id=?
                """, rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
            Map<String, Object> builderConfig = readJson(rs.getString("builder_config"));
            return new Chart(
                    rs.getLong("datasource_id"),
                    rs.getString("define_mode"),
                    rs.getString("sql_query"),
                    builderConfig,
                    rs.getString("chart_type"),
                    rs.getInt("version"),
                    SamplingMetadata.fromBuilderConfig(builderConfig)
            );
        }, chartId);
    }

    private Map<String, Object> readJson(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return mapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    /** 구 1,000행 절단 캐시와 sampling 계약이 없는 구 표본 캐시는 미스로 처리해 현재 실행 계약으로 재계산한다. */
    private Optional<CachedChartRows> matchingSampling(Optional<CachedChartRows> cached, SamplingMetadata sampling) {
        cached = cached.filter(rows -> !rows.rows().truncated());
        if (sampling == null) return cached.filter(rows -> rows.sampling() == null);
        return cached.filter(rows -> rows.sampling() != null && rows.sampling().matchesDefinition(sampling));
    }

    private Set<Long> datasources(long chartId) {
        return new LinkedHashSet<>(
                jdbc.queryForList("SELECT datasource_id FROM mc_chart_datasource WHERE chart_id=?", Long.class, chartId));
    }

    record Chart(long datasourceId, String defineMode, String sqlQuery, Map<String, Object> builderConfig,
                 String chartType, int version, SamplingMetadata sampling) {
    }

    record Computed(QueryRows rows, SamplingMetadata sampling) {
    }
}
