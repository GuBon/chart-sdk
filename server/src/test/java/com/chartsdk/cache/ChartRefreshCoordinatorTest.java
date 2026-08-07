package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChartRefreshCoordinatorTest {
    private final ChartCacheService cache = mock(ChartCacheService.class);
    private final ChartRefreshLeaseRepository leases = mock(ChartRefreshLeaseRepository.class);
    private final ChartRefreshCoordinator coordinator =
            new ChartRefreshCoordinator(cache, leases, 5, 1, 25);

    private static CachedChartRows snapshot(Instant computedAt) {
        return new CachedChartRows(new QueryRows(List.of(), List.of(), 0, false, 1), computedAt);
    }

    @Test
    void leaseWinnerRunsRefreshOutsideAnyTransactionalCoordinatorMethod() throws Exception {
        assertThat(ChartRefreshCoordinator.class
                .getMethod("refreshSingleFlight", long.class, int.class, boolean.class,
                        SamplingMetadata.class, java.util.function.Supplier.class)
                .getAnnotationsByType(org.springframework.transaction.annotation.Transactional.class))
                .isEmpty();
        when(leases.tryAcquire(9L, 3, 5)).thenReturn(Optional.of("token"));
        AtomicInteger calls = new AtomicInteger();
        CachedChartRows fresh = snapshot(Instant.now());

        CachedChartRows result = coordinator.refreshSingleFlight(9L, 3, true, null, () -> {
            calls.incrementAndGet();
            return fresh;
        });

        assertThat(result).isSameAs(fresh);
        assertThat(calls).hasValue(1);
        verify(leases).release(9L, "token");
        verify(cache, never()).findCompatible(anyLong(), anyInt(), any());
    }

    @Test
    void leaseLoserMayReuseOnlyAVersionCompatibleSnapshot() {
        when(leases.tryAcquire(9L, 3, 5)).thenReturn(Optional.empty());
        CachedChartRows compatible = snapshot(Instant.parse("2026-07-20T00:00:00Z"));
        when(cache.findCompatible(9L, 3, null)).thenReturn(Optional.of(compatible));

        CachedChartRows result = coordinator.refreshSingleFlight(9L, 3, true, null, () -> {
            throw new AssertionError("compatible snapshot loser must not recompute");
        });

        assertThat(result).isSameAs(compatible);
    }

    @Test
    void liveLoserRetriesAfterTheRemoteLeaseIsReleased() {
        when(leases.tryAcquire(9L, 3, 5))
                .thenReturn(Optional.empty(), Optional.of("recovery"));
        CachedChartRows old = snapshot(Instant.parse("2026-07-20T00:00:00Z"));
        when(cache.findCompatible(9L, 3, null)).thenReturn(Optional.of(old));
        CachedChartRows recovered = snapshot(Instant.now());

        CachedChartRows result = coordinator.refreshSingleFlight(
                9L, 3, false, null, () -> recovered);

        assertThat(result).isSameAs(recovered);
        verify(leases).release(9L, "recovery");
    }
}
