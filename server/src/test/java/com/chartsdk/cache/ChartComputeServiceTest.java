package com.chartsdk.cache;

import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import com.chartsdk.datasource.DatasourceRuntimeVersions;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 서빙 경로 불변식(설계 §8) — {@link ChartComputeService#serve} 단일 진입점(임베드·목록/미리보기 공유).
 * 다중 소스 차트는 페더레이션(재계산)을 절대 호출하지 않고 캐시 스냅샷만 반환하고,
 * 단일 소스는 캐시 미스/만료 시 단일 비행 재계산을 유지한다.
 */
class ChartComputeServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final FederatedQueryRunner runner = mock(FederatedQueryRunner.class);
    private final ChartCacheService cache = mock(ChartCacheService.class);
    private final ChartRefreshCoordinator refreshes = mock(ChartRefreshCoordinator.class);
    private final ChartComputeService compute =
            spy(new ChartComputeService(jdbc, runner, cache, refreshes, new ObjectMapper()));

    private static CachedChartRows snapshot() {
        return new CachedChartRows(new QueryRows(List.of(), List.of(), 0, false, 1), Instant.now());
    }

    private static CachedChartRows truncatedSnapshot() {
        return new CachedChartRows(new QueryRows(List.of(), List.of(), 1_000, true, 1), Instant.now());
    }

    @Test
    void preparedRowsCannotRepopulateCacheAfterDatasourceGenerationChanges() {
        DatasourceRuntimeVersions versions = new DatasourceRuntimeVersions();
        ChartCacheService fencedCache = mock(ChartCacheService.class);
        ChartComputeService fenced = new ChartComputeService(
                jdbc, runner, fencedCache, refreshes, new ObjectMapper(), versions);
        Map<Long, Long> before = versions.snapshot(Set.of(7L));
        versions.beginCacheInvalidation(7L);
        versions.completeCacheInvalidation(7L);

        fenced.seedPreparedQuietly(1L, snapshot().rows(), 3, null, before);

        verify(fencedCache, never()).upsert(anyLong(), any(), anyInt(), nullable(SamplingMetadata.class));
    }

    @Test
    void multiSourceServesCacheSnapshotWithoutFederating() {
        doReturn(true).when(compute).isMultiSource(1L);
        when(cache.findCompatible(1L, 0, null)).thenReturn(Optional.of(snapshot()));

        assertThat(compute.serve(1L, "manual", 3600, 0, null)).isNotNull();

        // 핵심 불변식: 다중 소스 서빙은 재계산(페더레이션)을 절대 호출하지 않는다.
        verify(compute, never()).refreshSingleFlight(
                anyLong(), org.mockito.ArgumentMatchers.anyInt(), anyBoolean(), nullable(SamplingMetadata.class));
    }

    @Test
    void multiSourceWithoutSnapshotThrowsInsteadOfFederating() {
        doReturn(true).when(compute).isMultiSource(1L);
        when(cache.findCompatible(1L, 0, null)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> compute.serve(1L, "manual", 3600, 0, null))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("snapshot is not ready");

        verify(compute, never()).refreshSingleFlight(
                anyLong(), org.mockito.ArgumentMatchers.anyInt(), anyBoolean(), nullable(SamplingMetadata.class));
    }

    @Test
    void singleSourceRecomputesOnCacheMiss() {
        doReturn(false).when(compute).isMultiSource(1L);
        when(cache.findUsable(1L, "ttl", 3600, 0, null)).thenReturn(Optional.empty());
        doReturn(snapshot()).when(compute).refreshSingleFlight(1L, 0, true, null);

        assertThat(compute.serve(1L, "ttl", 3600, 0, null)).isNotNull();

        verify(compute, times(1)).refreshSingleFlight(1L, 0, true, null);
    }

    @Test
    void legacyThousandRowTruncatedCacheIsRecomputed() {
        doReturn(false).when(compute).isMultiSource(1L);
        when(cache.findUsable(1L, "manual", 3600, 0, null)).thenReturn(Optional.empty());
        doReturn(snapshot()).when(compute).refreshSingleFlight(1L, 0, true, null);

        assertThat(compute.serve(1L, "manual", 3600, 0, null).rows().truncated()).isFalse();

        verify(compute).refreshSingleFlight(1L, 0, true, null);
    }

    @Test
    void legacySampleCacheWithoutMetadataIsRecomputed() {
        doReturn(false).when(compute).isMultiSource(1L);
        when(cache.findUsable(1L, "manual", 3600, 0, SamplingMetadata.system(10))).thenReturn(Optional.empty());
        SamplingMetadata executed = SamplingMetadata.system(10).withExecution(
                25, List.of(new SamplingMetadata.GroupSampleCount("A", 25)), List.of(), List.of());
        CachedChartRows refreshed = new CachedChartRows(snapshot().rows(), Instant.now(), executed);
        doReturn(refreshed).when(compute).refreshSingleFlight(1L, 0, true, SamplingMetadata.system(10));

        CachedChartRows rows = compute.serve(1L, "manual", 3600, 0, SamplingMetadata.system(10));

        assertThat(rows.sampling()).isEqualTo(executed);
        verify(compute).refreshSingleFlight(1L, 0, true, SamplingMetadata.system(10));
    }

    @Test
    void matchingCachePreservesRuntimeSampleCountsInsteadOfOverwritingThem() {
        doReturn(false).when(compute).isMultiSource(1L);
        SamplingMetadata definition = SamplingMetadata.system(10);
        SamplingMetadata executed = definition.withExecution(
                42, List.of(new SamplingMetadata.GroupSampleCount("A", 42)), definition.estimates(), List.of());
        CachedChartRows cached = new CachedChartRows(snapshot().rows(), Instant.now(), executed);
        when(cache.findUsable(1L, "manual", 3600, 0, definition)).thenReturn(Optional.of(cached));

        CachedChartRows served = compute.serve(1L, "manual", 3600, 0, definition);

        assertThat(served).isSameAs(cached);
        assertThat(served.sampling().sampledRowCount()).isEqualTo(42L);
        verify(compute, never()).refreshSingleFlight(
                anyLong(), org.mockito.ArgumentMatchers.anyInt(), anyBoolean(), nullable(SamplingMetadata.class));
    }

    @Test
    void recomputeRegeneratesBuilderSqlSoExistingChartsUseCurrentSamplingRules() {
        Map<String, Object> builderConfig = Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum")),
                "sample", Map.of("rate", 10)
        );
        SamplingMetadata sampling = SamplingMetadata.system(10);
        SamplingMetadata executed = sampling.withExecution(
                17, List.of(new SamplingMetadata.GroupSampleCount("A", 17)), sampling.estimates(), List.of());
        ChartComputeService.Chart definition = new ChartComputeService.Chart(
                2L, "builder", "SELECT old_unscaled_sum", builderConfig, "bar", 3, sampling);
        QueryRows freshRows = new QueryRows(List.of(), List.of(), 0, false, 2);
        doReturn(definition).when(compute).definition(1L);
        when(runner.runBuilder(2L, builderConfig, "bar", false, 3600)).thenReturn(
                new FederatedQueryRunner.BuiltResult(
                        freshRows,
                        new BuilderSqlBuilder.Sql("SELECT current_scaled_sum", List.of(), sampling),
                        Set.of(2L), executed));
        CachedChartRows cached = new CachedChartRows(freshRows, Instant.now(), executed);
        when(cache.upsert(1L, freshRows, 3, executed)).thenReturn(cached);

        assertThat(compute.recompute(1L)).isEqualTo(cached);

        verify(runner).runBuilder(2L, builderConfig, "bar", false, 3600);
        verify(runner, never()).runStored(any(), anyLong(), anyString());
    }

    @Test
    void recomputeRecordsFailureWithoutReplacingLastSuccessfulCache() {
        ChartComputeService.Chart definition = new ChartComputeService.Chart(
                2L, "raw", "SELECT broken", Map.of(), "bar", 4, null);
        RuntimeException failure = new RuntimeException("source unavailable");
        doReturn(definition).when(compute).definition(1L);
        when(runner.runStored(any(), eq(2L), eq("SELECT broken"))).thenThrow(failure);

        assertThatThrownBy(() -> compute.recompute(1L)).isSameAs(failure);

        verify(cache).recordFailure(1L, 4, failure);
        verify(cache, never()).upsert(eq(1L), any(), eq(4), nullable(SamplingMetadata.class));
    }

    @Test
    void isMultiSourceCountsJunctionRows() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(2);
        assertThat(compute.isMultiSource(1L)).isTrue();

        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(1);
        assertThat(compute.isMultiSource(1L)).isFalse();

        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(null);
        assertThat(compute.isMultiSource(1L)).isFalse();
    }
}
