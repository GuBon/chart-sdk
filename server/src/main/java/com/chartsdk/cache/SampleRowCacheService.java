package com.chartsdk.cache;

import com.chartsdk.web.ApiException;
import com.chartsdk.datasource.DatasourceRuntimeVersions;
import com.chartsdk.metrics.CapacityMetrics;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/** Disk-backed, bounded L1 cache for post-JOIN Bernoulli rows. */
@Service
public class SampleRowCacheService {
    private static final Logger log = LoggerFactory.getLogger(SampleRowCacheService.class);
    private static final long QUOTA_ADVISORY_KEY = 0x4348415254534c31L; // "CHARTSL1"

    private final JdbcTemplate jdbc;
    private final SampleCacheBuildLeaseRepository buildLeases;
    private final SampleCachePayloadCodec codec;
    private final TransactionTemplate transactions;
    private final int defaultMaxAgeSeconds;
    private final int hardTtlSeconds;
    private final long maxEntryBytes;
    private final long maxDatasourceBytes;
    private final long maxTotalBytes;
    private final Semaphore globalBuilds;
    private final ConcurrentHashMap<Long, Semaphore> datasourceBuilds = new ConcurrentHashMap<>();
    private final ObjectMapper mapper;
    private final int buildWaitSeconds;
    private final long buildPollMillis;
    private final DatasourceRuntimeVersions runtimeVersions;
    private final CapacityMetrics capacityMetrics;

    public SampleRowCacheService(
            JdbcTemplate jdbc,
            SampleCacheBuildLeaseRepository buildLeases,
            ObjectMapper mapper,
            PlatformTransactionManager transactionManager,
            @Value("${chartsdk.sampling-cache.default-max-age-seconds:900}") int defaultMaxAgeSeconds,
            @Value("${chartsdk.sampling-cache.hard-ttl-seconds:86400}") int hardTtlSeconds,
            @Value("${chartsdk.sampling-cache.max-entry-bytes:67108864}") long maxEntryBytes,
            @Value("${chartsdk.sampling-cache.max-datasource-bytes:134217728}") long maxDatasourceBytes,
            @Value("${chartsdk.sampling-cache.max-total-bytes:536870912}") long maxTotalBytes,
            @Value("${chartsdk.sampling-cache.max-concurrent-builds:2}") int maxConcurrentBuilds,
            @Value("${chartsdk.sampling-cache.build-wait-seconds:35}") int buildWaitSeconds,
            @Value("${chartsdk.sampling-cache.build-poll-millis:100}") long buildPollMillis,
            DatasourceRuntimeVersions runtimeVersions,
            CapacityMetrics capacityMetrics
    ) {
        this.jdbc = jdbc;
        this.buildLeases = buildLeases;
        this.mapper = mapper;
        this.codec = new SampleCachePayloadCodec(mapper);
        this.transactions = new TransactionTemplate(transactionManager);
        this.defaultMaxAgeSeconds = Math.max(1, defaultMaxAgeSeconds);
        this.hardTtlSeconds = Math.max(this.defaultMaxAgeSeconds, hardTtlSeconds);
        this.maxEntryBytes = Math.max(1, maxEntryBytes);
        this.maxDatasourceBytes = Math.max(this.maxEntryBytes, maxDatasourceBytes);
        this.maxTotalBytes = Math.max(this.maxDatasourceBytes, maxTotalBytes);
        this.globalBuilds = new Semaphore(Math.max(1, maxConcurrentBuilds), true);
        this.buildWaitSeconds = Math.max(1, buildWaitSeconds);
        this.buildPollMillis = Math.max(25, buildPollMillis);
        this.runtimeVersions = runtimeVersions;
        this.capacityMetrics = capacityMetrics;
    }

    public int defaultMaxAgeSeconds() {
        return defaultMaxAgeSeconds;
    }

    public Optional<CachedResultSample> find(String fingerprint, int maxAgeSeconds) {
        if (maxAgeSeconds <= 0) return Optional.empty();
        int boundedAge = Math.min(maxAgeSeconds, hardTtlSeconds);
        Optional<CachedResultSample> found = jdbc.query("""
                SELECT payload::text
                  FROM mc_sample_row_cache
                 WHERE fingerprint=?
                   AND created_at >= now() - (? * INTERVAL '1 second')
                """, rs -> {
            if (!rs.next()) return Optional.empty();
            return Optional.ofNullable(codec.read(rs.getString("payload")));
        }, fingerprint, boundedAge);
        if (found.isPresent()) {
            jdbc.update("""
                    UPDATE mc_sample_row_cache
                       SET last_accessed_at=now()
                     WHERE fingerprint=? AND last_accessed_at < now() - INTERVAL '1 minute'
                    """, fingerprint);
        }
        return found;
    }

    /** Reads an entry only while all referenced datasource generations remain current. */
    public Optional<CachedResultSample> findCurrent(String fingerprint, int maxAgeSeconds,
                                                    long primaryDatasourceId,
                                                    Collection<Long> datasourceIds) {
        List<Long> ids = normalizedDatasourceIds(primaryDatasourceId, datasourceIds);
        Map<Long, Long> snapshot = runtimeVersions.snapshot(ids);
        return runtimeVersions.readCache(snapshot, ids, () -> find(fingerprint, maxAgeSeconds));
    }

    public CachedResultSample getOrLoad(String fingerprint, long primaryDatasourceId,
                                        Collection<Long> datasourceIds, int maxAgeSeconds,
                                        Supplier<CachedResultSample> loader) {
        if (maxAgeSeconds <= 0) return loader.get();
        List<Long> ids = normalizedDatasourceIds(primaryDatasourceId, datasourceIds);
        Map<Long, Long> initialVersions = runtimeVersions.snapshot(ids);
        Optional<CachedResultSample> cached = runtimeVersions.readCache(
                initialVersions, ids, () -> find(fingerprint, maxAgeSeconds));
        if (cached.isPresent()) {
            return cached.get();
        }
        if (runtimeVersions.isCacheBlocked(ids)) return loadUncached(initialVersions, loader);

        acquireBuildPermits(ids);
        try {
            Map<Long, Long> buildVersions = runtimeVersions.snapshot(ids);
            Optional<CachedResultSample> raced = runtimeVersions.readCache(
                    buildVersions, ids, () -> find(fingerprint, maxAgeSeconds));
            if (raced.isPresent()) {
                return raced.get();
            }
            if (runtimeVersions.isCacheBlocked(ids)) return loadUncached(buildVersions, loader);

            Optional<String> token = buildLeases.tryAcquire(fingerprint);
            if (token.isEmpty()) {
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(buildWaitSeconds);
                while (System.nanoTime() < deadline) {
                    Optional<CachedResultSample> completed = runtimeVersions.readCache(
                            buildVersions, ids, () -> find(fingerprint, maxAgeSeconds));
                    if (completed.isPresent()) return completed.get();
                    if (runtimeVersions.isCacheBlocked(ids)) {
                        return loadUncached(buildVersions, loader);
                    }
                    token = buildLeases.tryAcquire(fingerprint);
                    if (token.isPresent()) break;
                    pauseForBuild();
                }
            }
            if (token.isEmpty()) {
                capacityMetrics.rejected("sample_cache", "build_lease_timeout");
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SAMPLE_CACHE_BUSY",
                        "The sample is still being prepared. Retry shortly.");
            }
            try {
                CachedResultSample loaded = loader.get();
                runtimeVersions.writeCache(buildVersions, ids,
                        () -> writeIfWithinQuota(fingerprint, primaryDatasourceId, ids, loaded));
                return loaded;
            } finally {
                releaseBuildLeaseQuietly(fingerprint, token.get());
            }
        } finally {
            releaseBuildPermits(ids);
        }
    }

    private CachedResultSample loadUncached(Map<Long, Long> versions,
                                            Supplier<CachedResultSample> loader) {
        CachedResultSample loaded = loader.get();
        runtimeVersions.requireCurrent(versions);
        return loaded;
    }

    /** Removes every L1 entry whose primary or federated datasource set contains the ID. */
    public void invalidateDatasource(long datasourceId) {
        try {
            String containedId = mapper.writeValueAsString(List.of(datasourceId));
            jdbc.update("""
                    DELETE FROM mc_sample_row_cache
                     WHERE primary_datasource_id=?
                        OR datasource_ids @> ?::jsonb
                    """, datasourceId, containedId);
        } catch (Exception failure) {
            throw new IllegalStateException("Cannot invalidate datasource sample cache.", failure);
        }
    }

    private void writeIfWithinQuota(String fingerprint, long primaryDatasourceId,
                                    List<Long> datasourceIds, CachedResultSample sample) {
        String payload = codec.write(sample);
        long bytes = payload.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > maxEntryBytes) {
            log.warn("L1 sample cache entry skipped: fingerprint={}, bytes={}, max={}",
                    fingerprint, bytes, maxEntryBytes);
            return;
        }
        transactions.executeWithoutResult(status -> writeWithinQuotaTransaction(
                fingerprint, primaryDatasourceId, datasourceIds, sample, payload, bytes));
    }

    private void writeWithinQuotaTransaction(String fingerprint, long primaryDatasourceId,
                                             List<Long> datasourceIds, CachedResultSample sample,
                                             String payload, long bytes) {
        try {
            // Different fingerprints can finish concurrently. Serialize the short write/eviction
            // section so the configured global and per-datasource byte ceilings remain hard bounds.
            jdbc.query("SELECT pg_advisory_xact_lock(?)", rs -> null, QUOTA_ADVISORY_KEY);
            String idsJson = mapper.writeValueAsString(datasourceIds);
            Instant now = Instant.now();
            jdbc.update("""
                    INSERT INTO mc_sample_row_cache(
                        fingerprint, primary_datasource_id, datasource_ids, payload,
                        row_count, payload_bytes, created_at, last_accessed_at)
                    VALUES (?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?)
                    ON CONFLICT (fingerprint) DO UPDATE
                        SET primary_datasource_id=EXCLUDED.primary_datasource_id,
                            datasource_ids=EXCLUDED.datasource_ids,
                            payload=EXCLUDED.payload,
                            row_count=EXCLUDED.row_count,
                            payload_bytes=EXCLUDED.payload_bytes,
                            created_at=EXCLUDED.created_at,
                            last_accessed_at=EXCLUDED.last_accessed_at
                    """, fingerprint, primaryDatasourceId, idsJson, payload,
                    sample.rows().rowCount(), bytes, Timestamp.from(now), Timestamp.from(now));
            enforceQuotas();
        } catch (Exception e) {
            throw new IllegalStateException("Cannot persist L1 sample cache entry.", e);
        }
    }

    private void releaseBuildLeaseQuietly(String fingerprint, String token) {
        try {
            buildLeases.release(fingerprint, token);
        } catch (RuntimeException ignored) {
            // The lease expires automatically.
        }
    }

    private void pauseForBuild() {
        try {
            Thread.sleep(buildPollMillis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            capacityMetrics.rejected("sample_cache", "interrupted");
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "SAMPLE_CACHE_BUSY", "Interrupted while waiting for an L1 sample.");
        }
    }

    private void enforceQuotas() {
        jdbc.update("DELETE FROM mc_sample_row_cache WHERE created_at < now() - (? * INTERVAL '1 second')",
                hardTtlSeconds);
        jdbc.update("""
                WITH ranked AS (
                    SELECT fingerprint,
                           SUM(payload_bytes) OVER (
                               PARTITION BY primary_datasource_id
                               ORDER BY last_accessed_at DESC, fingerprint) AS retained_bytes
                      FROM mc_sample_row_cache
                )
                DELETE FROM mc_sample_row_cache cache
                 USING ranked
                 WHERE cache.fingerprint=ranked.fingerprint
                   AND ranked.retained_bytes > ?
                """, maxDatasourceBytes);
        jdbc.update("""
                WITH ranked AS (
                    SELECT fingerprint,
                           SUM(payload_bytes) OVER (
                               ORDER BY last_accessed_at DESC, fingerprint) AS retained_bytes
                      FROM mc_sample_row_cache
                )
                DELETE FROM mc_sample_row_cache cache
                 USING ranked
                 WHERE cache.fingerprint=ranked.fingerprint
                   AND ranked.retained_bytes > ?
                """, maxTotalBytes);
    }

    private void acquireBuildPermits(List<Long> datasourceIds) {
        try {
            globalBuilds.acquire();
            List<Long> acquired = new ArrayList<>();
            try {
                for (Long id : datasourceIds) {
                    datasourceBuilds.computeIfAbsent(id, ignored -> new Semaphore(1, true)).acquire();
                    acquired.add(id);
                }
            } catch (InterruptedException e) {
                for (int i = acquired.size() - 1; i >= 0; i--) datasourceBuilds.get(acquired.get(i)).release();
                globalBuilds.release();
                throw e;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            capacityMetrics.rejected("sample_cache", "interrupted");
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "SAMPLE_CACHE_BUSY", "Interrupted while waiting to build an L1 sample.");
        }
    }

    private void releaseBuildPermits(List<Long> datasourceIds) {
        for (int i = datasourceIds.size() - 1; i >= 0; i--) {
            Semaphore semaphore = datasourceBuilds.get(datasourceIds.get(i));
            if (semaphore != null) semaphore.release();
        }
        globalBuilds.release();
    }

    private static List<Long> normalizedDatasourceIds(long primaryDatasourceId,
                                                       Collection<Long> datasourceIds) {
        Set<Long> unique = new java.util.LinkedHashSet<>();
        unique.add(primaryDatasourceId);
        if (datasourceIds != null) unique.addAll(datasourceIds);
        return unique.stream().sorted(Comparator.naturalOrder()).toList();
    }

}
