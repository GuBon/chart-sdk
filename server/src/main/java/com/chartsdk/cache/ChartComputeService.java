package com.chartsdk.cache;

import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.datasource.DatasourceRuntimeVersions;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.engine.DistinctCountCompositionPolicy;
import com.chartsdk.query.engine.SourceCompositionPolicy;
import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * 차트 결과 재계산 + 캐시 시드의 단일 진입점. 저장 시드(S2 [저장])·수동 갱신(S2 [지금 갱신])·임베드 재계산이 공유한다.
 * builder 차트는 저장된 builderConfig를 현재 SQL 생성기로 다시 실행하고, raw SQL 차트만 저장 SQL을 직접 실행한다.
 */
@Service
public class ChartComputeService {
    /** manual 차트 실행 시 표본 행 캐시 재사용 허용 시간. 저장 검증(ChartService)과 재계산이 같은 값을 쓴다. */
    public static final int MANUAL_SAMPLE_CACHE_MAX_AGE_SECONDS = 3_600;
    private final JdbcTemplate jdbc;
    private final FederatedQueryRunner runner;
    private final ChartCacheService cache;
    private final ChartRefreshCoordinator refreshes;
    private final ObjectMapper mapper;
    private final DatasourceRuntimeVersions runtimeVersions;
    private final SourceCompositionPolicy composition;

    public ChartComputeService(JdbcTemplate jdbc, FederatedQueryRunner runner, ChartCacheService cache,
                               ChartRefreshCoordinator refreshes, ObjectMapper mapper) {
        this(jdbc, runner, cache, refreshes, mapper, new DatasourceRuntimeVersions());
    }

    public ChartComputeService(JdbcTemplate jdbc, FederatedQueryRunner runner, ChartCacheService cache,
                               ChartRefreshCoordinator refreshes, ObjectMapper mapper,
                               DatasourceRuntimeVersions runtimeVersions) {
        this(jdbc, runner, cache, refreshes, mapper, runtimeVersions,
                new DistinctCountCompositionPolicy());
    }

    @Autowired
    public ChartComputeService(JdbcTemplate jdbc, FederatedQueryRunner runner, ChartCacheService cache,
                               ChartRefreshCoordinator refreshes, ObjectMapper mapper,
                               DatasourceRuntimeVersions runtimeVersions,
                               SourceCompositionPolicy composition) {
        this.jdbc = jdbc;
        this.runner = runner;
        this.cache = cache;
        this.refreshes = refreshes;
        this.mapper = mapper;
        this.runtimeVersions = runtimeVersions;
        this.composition = composition;
    }

    /** 차트를 즉시 재계산해 캐시에 반영. 차트 없으면 404. */
    public CachedChartRows recompute(long chartId) {
        return recompute(chartId, null);
    }

    private CachedChartRows recompute(long chartId, Integer expectedVersion) {
        Chart chart = definition(chartId);
        if (expectedVersion != null && chart.version() != expectedVersion) {
            throw new StaleChartDefinitionException(chartId, expectedVersion, chart.version());
        }
        try {
            Set<Long> datasourceIds = datasources(chartId);
            datasourceIds.add(chart.datasourceId());
            Map<Long, Long> sourceVersions = runtimeVersions.snapshot(datasourceIds);
            Computed computed = execute(chart, datasourceIds);
            return runtimeVersions.whileCurrent(sourceVersions,
                    () -> cache.upsert(chartId, computed.rows(), chart.version(), computed.sampling()));
        } catch (StaleChartDefinitionException stale) {
            throw stale;
        } catch (RuntimeException failure) {
            if (!(failure instanceof ApiException api
                    && "DATASOURCE_CHANGED_DURING_QUERY".equals(api.code()))) {
                recordFailureQuietly(chartId, chart.version(), failure);
            }
            throw failure;
        }
    }

    /**
     * 임베드 핫패스의 단일 비행(single-flight) 재계산.
     * 실제 트랜잭션·advisory lock 소유는 별도 프록시 빈 ChartRefreshCoordinator가 담당한다.
     */
    public CachedChartRows refreshSingleFlight(long chartId, int definitionVersion,
                                               boolean reuseCompatibleSnapshot, SamplingMetadata sampling) {
        return refreshes.refreshSingleFlight(
                chartId, definitionVersion, reuseCompatibleSnapshot, sampling,
                () -> recompute(chartId, definitionVersion));
    }

    /**
     * 서빙 경로의 단일 진입점. 다중 소스 차트는 캐시 스냅샷만 반환하고,
     * 단일 소스는 수동 스냅샷을 반환하고, live는 매 요청 단일 비행으로 재계산한다.
     */
    public CachedChartRows serve(long chartId, String refreshMode, int definitionVersion,
                                 SamplingMetadata sampling) {
        if (isMultiSource(chartId)) {
            return cache.findCompatible(chartId, definitionVersion, sampling)
                    .orElseThrow(() -> new ApiException(
                            HttpStatus.SERVICE_UNAVAILABLE, "SNAPSHOT_NOT_READY",
                            "Multi-source chart snapshot is not ready; refresh the chart to compute it."));
        }
        return cache.findUsable(chartId, refreshMode, definitionVersion, sampling)
                .orElseGet(() -> refreshSingleFlight(
                        chartId, definitionVersion, !"live".equals(refreshMode), sampling));
    }

    /** Cache-only batch path for list cards; never starts customer-datasource recomputation. */
    public Map<Long, CachedChartRows> cachedCompatible(Map<Long, ChartCacheExpectation> expectations) {
        return cache.findCompatible(expectations);
    }

    /**
     * 이 차트가 스냅샷-온리 서빙 대상인가 — 차트 단위 판정 진입점. distinct 소스 수는 여기서 세고,
     * 임계 규칙 자체는 {@link SourceCompositionPolicy#requiresSnapshot(int)}가 단일 소유한다(설계 §4.4).
     */
    public boolean isMultiSource(long chartId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM mc_chart_datasource WHERE chart_id=?", Integer.class, chartId);
        return composition.requiresSnapshot(n == null ? 0 : n);
    }

    /** 저장 검증에서 이미 계산한 결과를 재조회 없이 현재 정의 버전의 캐시로 시드한다. */
    public void seedPreparedQuietly(long chartId, QueryRows rows, int definitionVersion,
                                    SamplingMetadata sampling) {
        seedPreparedQuietly(chartId, rows, definitionVersion, sampling, Map.of());
    }

    /** Seeds only if no referenced datasource changed after the prepared query began. */
    public void seedPreparedQuietly(long chartId, QueryRows rows, int definitionVersion,
                                    SamplingMetadata sampling, Map<Long, Long> datasourceVersions) {
        try {
            runtimeVersions.whileCurrent(datasourceVersions, () ->
                    cache.upsert(chartId, rows, definitionVersion, sampling));
        } catch (StaleChartDefinitionException ignored) {
            // Saving a newer chart definition won the race. The prepared rows belong to the old version.
        } catch (ApiException changed) {
            if (!"DATASOURCE_CHANGED_DURING_QUERY".equals(changed.code())) {
                recordFailureQuietly(chartId, definitionVersion, changed);
            }
        } catch (RuntimeException failure) {
            recordFailureQuietly(chartId, definitionVersion, failure);
        }
    }

    /** 기존 builder 차트도 현재 생성 규칙(sampling v9)을 즉시 사용한다. */
    private Computed execute(Chart chart, Set<Long> datasourceIds) {
        if ("builder".equals(chart.defineMode()) && !chart.builderConfig().isEmpty()) {
            int sampleCacheMaxAge = "live".equals(chart.refreshMode())
                    ? 0 : MANUAL_SAMPLE_CACHE_MAX_AGE_SECONDS;
            FederatedQueryRunner.BuiltResult built =
                    runner.runBuilder(chart.datasourceId(), chart.builderConfig(), chart.chartType(), false,
                            sampleCacheMaxAge);
            return new Computed(built.rows(), built.sampling());
        }
        return new Computed(runner.runStored(datasourceIds, chart.datasourceId(), chart.sqlQuery()), null);
    }

    Chart definition(long chartId) {
        return jdbc.query("""
                SELECT datasource_id, define_mode, sql_query, builder_config::text, chart_type, version,
                       refresh_mode
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
                    SamplingMetadata.fromBuilderConfig(builderConfig),
                    rs.getString("refresh_mode")
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

    private void recordFailureQuietly(long chartId, int definitionVersion, RuntimeException failure) {
        try {
            cache.recordFailure(chartId, definitionVersion, failure);
        } catch (RuntimeException ignored) {
            // 메타 DB 자체 장애가 원인이면 실패 상태 기록도 불가능하다. 원래 계산 예외를 보존한다.
        }
    }

    record Chart(long datasourceId, String defineMode, String sqlQuery, Map<String, Object> builderConfig,
                 String chartType, int version, SamplingMetadata sampling,
                 String refreshMode) {
        Chart(long datasourceId, String defineMode, String sqlQuery, Map<String, Object> builderConfig,
              String chartType, int version, SamplingMetadata sampling) {
            this(datasourceId, defineMode, sqlQuery, builderConfig, chartType, version, sampling, "manual");
        }
    }

    record Computed(QueryRows rows, SamplingMetadata sampling) {
    }
}
