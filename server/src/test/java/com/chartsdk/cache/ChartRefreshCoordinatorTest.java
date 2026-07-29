package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SuppressWarnings("unchecked")
class ChartRefreshCoordinatorTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ChartCacheService cache = mock(ChartCacheService.class);
    private final ChartRefreshCoordinator coordinator = new ChartRefreshCoordinator(jdbc, cache);

    private static CachedChartRows snapshot(Instant computedAt) {
        return new CachedChartRows(new QueryRows(List.of(), List.of(), 0, false, 1), computedAt);
    }

    @Test
    void transactionBoundaryLivesOnSeparatelyProxiedCoordinator() throws Exception {
        assertThat(ChartRefreshCoordinator.class
                .getMethod("refreshSingleFlight", long.class, int.class, boolean.class,
                        SamplingMetadata.class, java.util.function.Supplier.class)
                .getAnnotation(Transactional.class)).isNotNull();
    }

    @Test
    void lockWinnerIsTheOnlyRequestThatRunsRefreshCallback() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq(9L))).thenReturn(true);
        AtomicInteger calls = new AtomicInteger();
        CachedChartRows fresh = snapshot(Instant.now());

        CachedChartRows result = coordinator.refreshSingleFlight(
                9L, 3, true, null, () -> {
                    calls.incrementAndGet();
                    return fresh;
                });

        assertThat(result).isSameAs(fresh);
        assertThat(calls).hasValue(1);
        verify(cache, never()).findCompatible(anyLong(), anyInt(), any());
    }

    @Test
    void lockLoserMayReturnOnlyVersionCompatibleStaleData() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq(9L))).thenReturn(false);
        CachedChartRows stale = snapshot(Instant.parse("2026-07-20T00:00:00Z"));
        when(cache.findCompatible(9L, 3, null)).thenReturn(Optional.of(stale));

        CachedChartRows result = coordinator.refreshSingleFlight(
                9L, 3, true, null, () -> {
                    throw new AssertionError("stale loser must not recompute");
                });

        assertThat(result).isSameAs(stale);
    }

    @Test
    void liveLoserDoesNotReturnCacheOlderThanItsRequestAfterWinnerFailure() {
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq(9L))).thenReturn(false);
        CachedChartRows old = snapshot(Instant.parse("2026-07-20T00:00:00Z"));
        when(cache.findCompatible(9L, 3, null)).thenReturn(Optional.of(old), Optional.of(old));
        CachedChartRows recovered = snapshot(Instant.now());

        CachedChartRows result = coordinator.refreshSingleFlight(
                9L, 3, false, null, () -> recovered);

        assertThat(result).isSameAs(recovered);
    }
}
