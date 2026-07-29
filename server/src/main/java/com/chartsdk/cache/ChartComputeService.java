package com.chartsdk.cache;

import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.Map;
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
    private final ChartRefreshCoordinator refreshes;
    private final ObjectMapper mapper;

    public ChartComputeService(JdbcTemplate jdbc, FederatedQueryRunner runner, ChartCacheService cache,
                               ChartRefreshCoordinator refreshes, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.runner = runner;
        this.cache = cache;
        this.refreshes = refreshes;
        this.mapper = mapper;
    }

    /** 차트를 즉시 재계산해 캐시에 반영. 차트 없으면 404. */
    public CachedChartRows recompute(long chartId) {
        Chart chart = definition(chartId);
        try {
            Computed computed = execute(chartId, chart);
            return cache.upsert(chartId, computed.rows(), chart.version(), computed.sampling());
        } catch (RuntimeException failure) {
            recordFailureQuietly(chartId, failure);
            throw failure;
        }
    }

    /**
     * 임베드 핫패스의 단일 비행(single-flight) 재계산.
     * 실제 트랜잭션·advisory lock 소유는 별도 프록시 빈 ChartRefreshCoordinator가 담당한다.
     */
    public CachedChartRows refreshSingleFlight(long chartId, int definitionVersion,
                                               boolean allowStale, SamplingMetadata sampling) {
        return refreshes.refreshSingleFlight(
                chartId, definitionVersion, allowStale, sampling, () -> recompute(chartId));
    }

    /**
     * 서빙 경로의 단일 진입점. 다중 소스 차트는 캐시 스냅샷만 반환하고,
     * 단일 소스는 캐시 미스/만료 시 단일 비행으로 재계산한다.
     */
    public CachedChartRows serve(long chartId, String refreshMode, int cacheTtlSeconds,
                                 int definitionVersion, SamplingMetadata sampling) {
        if (isMultiSource(chartId)) {
            return cache.findCompatible(chartId, definitionVersion, sampling)
                    .orElseThrow(() -> new ApiException(
                            HttpStatus.SERVICE_UNAVAILABLE, "SNAPSHOT_NOT_READY",
                            "Multi-source chart snapshot is not ready; refresh the chart to compute it."));
        }
        return cache.findUsable(chartId, refreshMode, cacheTtlSeconds, definitionVersion, sampling)
                .orElseGet(() -> refreshSingleFlight(
                        chartId, definitionVersion, !"live".equals(refreshMode), sampling));
    }

    /** 차트가 2개 이상 데이터소스를 참조하는가 — 임베드 캐시-온리 판정의 단일 진실원. */
    public boolean isMultiSource(long chartId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM mc_chart_datasource WHERE chart_id=?", Integer.class, chartId);
        return n != null && n >= 2;
    }

    /** 저장 검증에서 이미 계산한 결과를 재조회 없이 현재 정의 버전의 캐시로 시드한다. */
    public void seedPreparedQuietly(long chartId, QueryRows rows, int definitionVersion,
                                    SamplingMetadata sampling) {
        try {
            cache.upsert(chartId, rows, definitionVersion, sampling);
        } catch (RuntimeException failure) {
            recordFailureQuietly(chartId, failure);
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

    private Set<Long> datasources(long chartId) {
        return new LinkedHashSet<>(
                jdbc.queryForList("SELECT datasource_id FROM mc_chart_datasource WHERE chart_id=?", Long.class, chartId));
    }

    private void recordFailureQuietly(long chartId, RuntimeException failure) {
        try {
            cache.recordFailure(chartId, failure);
        } catch (RuntimeException ignored) {
            // 메타 DB 자체 장애가 원인이면 실패 상태 기록도 불가능하다. 원래 계산 예외를 보존한다.
        }
    }

    record Chart(long datasourceId, String defineMode, String sqlQuery, Map<String, Object> builderConfig,
                 String chartType, int version, SamplingMetadata sampling) {
    }

    record Computed(QueryRows rows, SamplingMetadata sampling) {
    }
}
