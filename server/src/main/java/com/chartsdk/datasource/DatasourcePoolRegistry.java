package com.chartsdk.datasource;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Comparator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Bounded registry of lazily created customer-database pools.
 *
 * <p>The cap is soft: an in-use pool is never closed or rejected merely to meet the cap. Idle
 * pools are retired by LRU and TTL, and a retired pool closes after its final borrowed connection
 * is returned.
 */
@Component
public class DatasourcePoolRegistry {
    public static final int DEFAULT_MAX_ENTRIES = 128;
    public static final long DEFAULT_IDLE_TTL_SECONDS = 30 * 60;
    public static final long DEFAULT_CLEANUP_INTERVAL_SECONDS = 60;

    private final DatasourcePoolFactory factory;
    private final Map<Long, DatasourcePoolHandle> pools = new ConcurrentHashMap<>();
    private final Set<DatasourcePoolHandle> retiringPools = ConcurrentHashMap.newKeySet();
    private final Object creationLock = new Object();
    private final int maxEntries;
    private final long idleTtlNanos;
    private final ScheduledExecutorService cleaner;

    /** Compatibility constructor for focused tests and integration fixtures. */
    public DatasourcePoolRegistry(DatasourceService datasources) {
        this(new DatasourcePoolFactory(datasources), new SimpleMeterRegistry(),
                DEFAULT_MAX_ENTRIES, DEFAULT_IDLE_TTL_SECONDS, DEFAULT_CLEANUP_INTERVAL_SECONDS);
    }

    @Autowired
    public DatasourcePoolRegistry(
            DatasourcePoolFactory factory,
            MeterRegistry metrics,
            @Value("${chartsdk.datasource.pool-registry.max-entries:128}") int maxEntries,
            @Value("${chartsdk.datasource.pool-registry.idle-ttl-seconds:1800}") long idleTtlSeconds,
            @Value("${chartsdk.datasource.pool-registry.cleanup-interval-seconds:60}") long cleanupIntervalSeconds
    ) {
        this.factory = factory;
        this.maxEntries = Math.max(1, maxEntries);
        this.idleTtlNanos = Duration.ofSeconds(Math.max(1, idleTtlSeconds)).toNanos();
        this.cleaner = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "datasource-pool-registry-cleaner");
            thread.setDaemon(true);
            return thread;
        });
        long interval = Math.max(1, cleanupIntervalSeconds);
        cleaner.scheduleWithFixedDelay(this::evictIdlePoolsSafely, interval, interval, TimeUnit.SECONDS);
        registerMetrics(metrics);
    }

    /** Borrows a read-only connection whose close operation also releases the pool handle. */
    public Connection connection(long datasourceId) throws SQLException {
        while (true) {
            DatasourcePoolHandle handle = pool(datasourceId);
            Connection connection = handle.borrow();
            if (connection != null) return connection;
            pools.remove(datasourceId, handle);
        }
    }

    /** Retires the current generation without disrupting borrowers that are still using it. */
    public void evict(long datasourceId) {
        DatasourcePoolHandle handle;
        synchronized (creationLock) {
            // A metadata change must not miss a pool that is still being constructed.
            handle = pools.remove(datasourceId);
        }
        if (handle != null) retire(handle);
    }

    private DatasourcePoolHandle pool(long datasourceId) {
        DatasourcePoolHandle existing = pools.get(datasourceId);
        if (existing != null) return existing;
        synchronized (creationLock) {
            existing = pools.get(datasourceId);
            if (existing != null) return existing;
            evictOldestIdleWhenAtCapacity();
            DatasourcePoolHandle created = new DatasourcePoolHandle(
                    datasourceId, factory.create(datasourceId), () -> onRetiredPoolClosed(datasourceId));
            pools.put(datasourceId, created);
            return created;
        }
    }

    private void evictOldestIdleWhenAtCapacity() {
        while (pools.size() >= maxEntries) {
            DatasourcePoolHandle oldest = oldestIdlePool();
            if (oldest == null || !pools.remove(oldest.datasourceId(), oldest)) return;
            retire(oldest);
        }
    }

    void evictIdlePools() {
        long now = System.nanoTime();
        pools.values().stream()
                .filter(handle -> handle.idleForAtLeast(now, idleTtlNanos))
                .toList()
                .forEach(handle -> {
                    if (pools.remove(handle.datasourceId(), handle)) retire(handle);
                });
        while (pools.size() > maxEntries) {
            DatasourcePoolHandle oldest = oldestIdlePool();
            if (oldest == null || !pools.remove(oldest.datasourceId(), oldest)) return;
            retire(oldest);
        }
    }

    private DatasourcePoolHandle oldestIdlePool() {
        return pools.values().stream()
                .filter(DatasourcePoolHandle::isIdle)
                .min(Comparator.comparingLong(DatasourcePoolHandle::lastUsedNanos))
                .orElse(null);
    }

    private void retire(DatasourcePoolHandle handle) {
        retiringPools.add(handle);
        handle.retire();
    }

    private void onRetiredPoolClosed(long ignoredDatasourceId) {
        retiringPools.removeIf(DatasourcePoolHandle::isClosed);
    }

    private void evictIdlePoolsSafely() {
        try {
            evictIdlePools();
        } catch (RuntimeException ignored) {
            // Cleanup is best-effort; query paths and the next cleanup cycle remain available.
        }
    }

    private void registerMetrics(MeterRegistry metrics) {
        Gauge.builder("chartsdk.datasource_pool.registry_size", pools, Map::size).register(metrics);
        Gauge.builder("chartsdk.datasource_pool.retiring", retiringPools, Set::size).register(metrics);
        Gauge.builder("chartsdk.datasource_pool.borrowers", this, DatasourcePoolRegistry::borrowerCount)
                .register(metrics);
        Gauge.builder("chartsdk.datasource_pool.idle", this, DatasourcePoolRegistry::idleCount)
                .register(metrics);
        Gauge.builder("chartsdk.datasource_pool.pending", this, DatasourcePoolRegistry::pendingCount)
                .register(metrics);
    }

    private double borrowerCount() {
        return pools.values().stream().mapToInt(DatasourcePoolHandle::borrowerCount).sum()
                + retiringPools.stream().mapToInt(DatasourcePoolHandle::borrowerCount).sum();
    }

    private double idleCount() {
        return pools.values().stream().filter(DatasourcePoolHandle::isIdle).count();
    }

    private double pendingCount() {
        return pools.values().stream().mapToInt(DatasourcePoolHandle::pendingThreads).sum();
    }

    @PreDestroy
    void closeAll() {
        cleaner.shutdownNow();
        pools.values().forEach(this::retire);
        pools.clear();
    }
}
