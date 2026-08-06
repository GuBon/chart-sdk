package com.chartsdk.datasource;

import com.chartsdk.cache.SampleRowCacheService;
import com.chartsdk.query.QueryExecutor;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

class DatasourceRuntimeInvalidatorTest {
    private final DatasourcePoolRegistry pools = mock(DatasourcePoolRegistry.class);
    private final QueryExecutor queries = mock(QueryExecutor.class);
    private final SampleRowCacheService sampleCache = mock(SampleRowCacheService.class);
    private final DatasourceRuntimeVersions versions = new DatasourceRuntimeVersions();
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final DatasourceRuntimeInvalidator invalidator = new DatasourceRuntimeInvalidator(
            pools, queries, sampleCache, versions, jdbc, new SimpleMeterRegistry());

    @Test
    void sourceIdentityChangeFencesInFlightWritesAndInvalidatesEveryDerivedResource() {
        Map<Long, Long> before = versions.snapshot(java.util.List.of(7L));

        invalidator.onDatasourceChanged(new DatasourceChangedEvent(
                7L, DatasourceChangedEvent.Impact.SOURCE_IDENTITY));

        assertThat(versions.isCurrent(before)).isFalse();
        assertThat(versions.isCacheBlocked(java.util.List.of(7L))).isFalse();
        verify(pools).evict(7L);
        verify(queries).invalidateCatalog(7L);
        verify(sampleCache).invalidateDatasource(7L);
        verify(jdbc).update(anyString(), eq(7L));
    }

    @Test
    void poolOnlyChangeDoesNotDiscardValidQueryCaches() {
        Map<Long, Long> before = versions.snapshot(java.util.List.of(7L));

        invalidator.onDatasourceChanged(new DatasourceChangedEvent(
                7L, DatasourceChangedEvent.Impact.POOL_CONFIGURATION));

        assertThat(versions.isCurrent(before)).isTrue();
        verify(pools).evict(7L);
        verify(queries, never()).invalidateCatalog(7L);
        verify(sampleCache, never()).invalidateDatasource(7L);
        verify(jdbc, never()).update(anyString(), eq(7L));
    }

    @Test
    void cacheFailureBlocksOnlyTheAffectedDatasourceUntilRetrySucceeds() {
        doThrow(new IllegalStateException("metadata database unavailable"))
                .doNothing()
                .when(sampleCache).invalidateDatasource(7L);

        invalidator.onDatasourceChanged(new DatasourceChangedEvent(
                7L, DatasourceChangedEvent.Impact.SOURCE_IDENTITY));

        assertThat(versions.isCacheBlocked(java.util.List.of(7L))).isTrue();
        assertThat(versions.isCacheBlocked(java.util.List.of(8L))).isFalse();

        invalidator.retryPendingCacheInvalidations();

        assertThat(versions.isCacheBlocked(java.util.List.of(7L))).isFalse();
        verify(sampleCache, times(2)).invalidateDatasource(7L);
        verify(jdbc, times(2)).update(anyString(), eq(7L));
        verify(pools).evict(7L);
        verify(queries).invalidateCatalog(7L);
    }
}
