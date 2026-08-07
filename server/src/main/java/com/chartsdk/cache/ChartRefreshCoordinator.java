package com.chartsdk.cache;

import com.chartsdk.web.ApiException;
import com.chartsdk.metrics.CapacityMetrics;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;

/**
 * Deduplicates chart refreshes without keeping a metadata transaction open while a customer query
 * runs. Local callers share a future; multiple instances coordinate through a short, expiring lease.
 */
@Service
public class ChartRefreshCoordinator {
    private final ChartCacheService cache;
    private final ChartRefreshLeaseRepository leases;
    private final int leaseSeconds;
    private final int waitSeconds;
    private final long pollMillis;
    private final ConcurrentHashMap<RefreshKey, CompletableFuture<CachedChartRows>> inFlight =
            new ConcurrentHashMap<>();
    private final CapacityMetrics metrics;

    public ChartRefreshCoordinator(
            ChartCacheService cache,
            ChartRefreshLeaseRepository leases,
            @Value("${chartsdk.refresh.lease-seconds:45}") int leaseSeconds,
            @Value("${chartsdk.refresh.wait-seconds:35}") int waitSeconds,
            @Value("${chartsdk.refresh.poll-millis:100}") long pollMillis
    ) {
        this(cache, leases, leaseSeconds, waitSeconds, pollMillis, CapacityMetrics.noOp());
    }

    @Autowired
    public ChartRefreshCoordinator(
            ChartCacheService cache,
            ChartRefreshLeaseRepository leases,
            @Value("${chartsdk.refresh.lease-seconds:45}") int leaseSeconds,
            @Value("${chartsdk.refresh.wait-seconds:35}") int waitSeconds,
            @Value("${chartsdk.refresh.poll-millis:100}") long pollMillis,
            CapacityMetrics metrics
    ) {
        this.cache = cache;
        this.leases = leases;
        this.leaseSeconds = Math.max(5, leaseSeconds);
        this.waitSeconds = Math.max(1, waitSeconds);
        this.pollMillis = Math.max(25, pollMillis);
        this.metrics = metrics;
    }

    public CachedChartRows refreshSingleFlight(long chartId, int definitionVersion, boolean reuseCompatibleSnapshot,
                                               SamplingMetadata sampling,
                                               Supplier<CachedChartRows> refresh) {
        RefreshKey key = new RefreshKey(chartId, definitionVersion);
        CompletableFuture<CachedChartRows> mine = new CompletableFuture<>();
        CompletableFuture<CachedChartRows> existing = inFlight.putIfAbsent(key, mine);
        if (existing != null) {
            Optional<CachedChartRows> snapshot = cache.findCompatible(chartId, definitionVersion, sampling);
            if (reuseCompatibleSnapshot && snapshot.isPresent()) return snapshot.get();
            return awaitLocal(existing);
        }

        try {
            CachedChartRows rows = refreshWithLease(
                    chartId, definitionVersion, reuseCompatibleSnapshot, sampling, refresh);
            mine.complete(rows);
            return rows;
        } catch (RuntimeException failure) {
            mine.completeExceptionally(failure);
            throw failure;
        } finally {
            inFlight.remove(key, mine);
        }
    }

    private CachedChartRows refreshWithLease(long chartId, int definitionVersion, boolean reuseCompatibleSnapshot,
                                             SamplingMetadata sampling,
                                             Supplier<CachedChartRows> refresh) {
        Optional<String> token = leases.tryAcquire(chartId, definitionVersion, leaseSeconds);
        if (token.isPresent()) return runLeaseOwner(chartId, token.get(), refresh);

        Optional<CachedChartRows> snapshot = cache.findCompatible(chartId, definitionVersion, sampling);
        if (reuseCompatibleSnapshot && snapshot.isPresent()) return snapshot.get();
        CachedChartRows previous = snapshot.orElse(null);

        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(waitSeconds);
        while (System.nanoTime() < deadline) {
            Optional<CachedChartRows> compatible = cache.findCompatible(chartId, definitionVersion, sampling);
            if (compatible.isPresent() && (previous == null
                    || !compatible.get().computedAt().equals(previous.computedAt()))) {
                return compatible.get();
            }
            token = leases.tryAcquire(chartId, definitionVersion, leaseSeconds);
            if (token.isPresent()) return runLeaseOwner(chartId, token.get(), refresh);
            pause();
        }
        metrics.rejected("refresh", "lease_wait_timeout");
        throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "REFRESH_IN_PROGRESS",
                "The chart is still being refreshed. Retry shortly.");
    }

    private CachedChartRows runLeaseOwner(long chartId, String token,
                                          Supplier<CachedChartRows> refresh) {
        try {
            return refresh.get();
        } finally {
            try {
                leases.release(chartId, token);
            } catch (RuntimeException ignored) {
                // The lease expires automatically; a release failure must not hide the query result.
            }
        }
    }

    private CachedChartRows awaitLocal(CompletableFuture<CachedChartRows> future) {
        try {
            return future.get(waitSeconds, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            metrics.rejected("refresh", "local_wait_timeout");
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "REFRESH_IN_PROGRESS",
                    "The chart is still being refreshed. Retry shortly.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            metrics.rejected("refresh", "interrupted");
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "REFRESH_INTERRUPTED",
                    "Chart refresh wait was interrupted.");
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException runtime) throw runtime;
            throw new CompletionException(cause);
        }
    }

    private void pause() {
        try {
            Thread.sleep(pollMillis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            metrics.rejected("refresh", "interrupted");
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "REFRESH_INTERRUPTED",
                    "Chart refresh wait was interrupted.");
        }
    }

    private record RefreshKey(long chartId, int definitionVersion) {
    }
}
