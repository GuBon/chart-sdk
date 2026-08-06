package com.chartsdk.datasource;

import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Function;
import java.util.function.Supplier;

/** Local generation fence preventing pre-change query work from repopulating caches. */
@Component
public class DatasourceRuntimeVersions {
    private final ConcurrentHashMap<Long, AtomicLong> versions = new ConcurrentHashMap<>();
    private final Set<Long> blockedCacheDatasources = ConcurrentHashMap.newKeySet();
    private final ReentrantReadWriteLock cacheFence = new ReentrantReadWriteLock(true);

    public Map<Long, Long> snapshot(Collection<Long> datasourceIds) {
        Map<Long, Long> snapshot = new LinkedHashMap<>();
        if (datasourceIds != null) {
            datasourceIds.stream().distinct().sorted()
                    .forEach(id -> snapshot.put(id, current(id)));
        }
        return Map.copyOf(snapshot);
    }

    public boolean isCurrent(Map<Long, Long> snapshot) {
        return snapshot.entrySet().stream().allMatch(entry -> current(entry.getKey()) == entry.getValue());
    }

    public void requireCurrent(Map<Long, Long> snapshot) {
        if (!isCurrent(snapshot)) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DATASOURCE_CHANGED_DURING_QUERY",
                    "Datasource settings changed while the query was running. Retry the query.");
        }
    }

    /** Executes a cache read or write only while captured datasource generations remain current. */
    public <T> T whileCurrent(Map<Long, Long> snapshot, Supplier<T> operation) {
        cacheFence.readLock().lock();
        try {
            requireCurrent(snapshot);
            return operation.get();
        } finally {
            cacheFence.readLock().unlock();
        }
    }

    /** Returns a cache miss instead of touching storage while any referenced datasource is blocked. */
    public <T> Optional<T> readCache(Map<Long, Long> snapshot, Collection<Long> datasourceIds,
                                     Supplier<Optional<T>> operation) {
        cacheFence.readLock().lock();
        try {
            requireCurrent(snapshot);
            if (containsBlocked(datasourceIds)) return Optional.empty();
            return operation.get();
        } finally {
            cacheFence.readLock().unlock();
        }
    }

    /** Skips a cache write while invalidation is incomplete and reports whether it was written. */
    public boolean writeCache(Map<Long, Long> snapshot, Collection<Long> datasourceIds, Runnable operation) {
        cacheFence.readLock().lock();
        try {
            requireCurrent(snapshot);
            if (containsBlocked(datasourceIds)) return false;
            operation.run();
            return true;
        } finally {
            cacheFence.readLock().unlock();
        }
    }

    public boolean isCacheBlocked(Collection<Long> datasourceIds) {
        cacheFence.readLock().lock();
        try {
            return containsBlocked(datasourceIds);
        } finally {
            cacheFence.readLock().unlock();
        }
    }

    /** Gives cache repositories a stable blocked-ID snapshot while invalidation state cannot change. */
    public <T> T withBlockedCacheDatasources(Function<Set<Long>, T> operation) {
        cacheFence.readLock().lock();
        try {
            return operation.apply(Set.copyOf(blockedCacheDatasources));
        } finally {
            cacheFence.readLock().unlock();
        }
    }

    /** Starts a fail-closed cache invalidation and fences all pre-change query work. */
    public void beginCacheInvalidation(long datasourceId) {
        cacheFence.writeLock().lock();
        try {
            versions.computeIfAbsent(datasourceId, ignored -> new AtomicLong()).incrementAndGet();
            blockedCacheDatasources.add(datasourceId);
        } finally {
            cacheFence.writeLock().unlock();
        }
    }

    /** Re-enables cache access only after every required cache cleanup has succeeded. */
    public void completeCacheInvalidation(long datasourceId) {
        cacheFence.writeLock().lock();
        try {
            blockedCacheDatasources.remove(datasourceId);
        } finally {
            cacheFence.writeLock().unlock();
        }
    }

    private long current(long datasourceId) {
        AtomicLong version = versions.get(datasourceId);
        return version == null ? 0 : version.get();
    }

    private boolean containsBlocked(Collection<Long> datasourceIds) {
        return datasourceIds != null && datasourceIds.stream().anyMatch(blockedCacheDatasources::contains);
    }
}
