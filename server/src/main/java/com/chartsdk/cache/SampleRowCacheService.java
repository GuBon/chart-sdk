package com.chartsdk.cache;

import com.chartsdk.web.ApiException;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;

/** Disk-backed, bounded L1 cache for post-JOIN Bernoulli rows. */
@Service
public class SampleRowCacheService {
    private static final Logger log = LoggerFactory.getLogger(SampleRowCacheService.class);
    private static final long QUOTA_ADVISORY_KEY = 0x4348415254534c31L; // "CHARTSL1"

    private final JdbcTemplate jdbc;
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

    public SampleRowCacheService(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            PlatformTransactionManager transactionManager,
            @Value("${chartsdk.sampling-cache.default-max-age-seconds:900}") int defaultMaxAgeSeconds,
            @Value("${chartsdk.sampling-cache.hard-ttl-seconds:86400}") int hardTtlSeconds,
            @Value("${chartsdk.sampling-cache.max-entry-bytes:67108864}") long maxEntryBytes,
            @Value("${chartsdk.sampling-cache.max-datasource-bytes:134217728}") long maxDatasourceBytes,
            @Value("${chartsdk.sampling-cache.max-total-bytes:536870912}") long maxTotalBytes,
            @Value("${chartsdk.sampling-cache.max-concurrent-builds:2}") int maxConcurrentBuilds
    ) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.codec = new SampleCachePayloadCodec(mapper);
        this.transactions = new TransactionTemplate(transactionManager);
        this.defaultMaxAgeSeconds = Math.max(1, defaultMaxAgeSeconds);
        this.hardTtlSeconds = Math.max(this.defaultMaxAgeSeconds, hardTtlSeconds);
        this.maxEntryBytes = Math.max(1, maxEntryBytes);
        this.maxDatasourceBytes = Math.max(this.maxEntryBytes, maxDatasourceBytes);
        this.maxTotalBytes = Math.max(this.maxDatasourceBytes, maxTotalBytes);
        this.globalBuilds = new Semaphore(Math.max(1, maxConcurrentBuilds), true);
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

    public CachedResultSample getOrLoad(String fingerprint, long primaryDatasourceId,
                                        Collection<Long> datasourceIds, int maxAgeSeconds,
                                        Supplier<CachedResultSample> loader) {
        if (maxAgeSeconds <= 0) return loader.get();
        Optional<CachedResultSample> cached = find(fingerprint, maxAgeSeconds);
        if (cached.isPresent()) return cached.get();

        List<Long> ids = normalizedDatasourceIds(primaryDatasourceId, datasourceIds);
        acquireBuildPermits(ids);
        try {
            CachedResultSample result = transactions.execute(status -> {
                jdbc.query("SELECT pg_advisory_xact_lock(?)", rs -> null, advisoryKey(fingerprint));
                Optional<CachedResultSample> raced = find(fingerprint, maxAgeSeconds);
                if (raced.isPresent()) return raced.get();
                CachedResultSample loaded = loader.get();
                writeIfWithinQuota(fingerprint, primaryDatasourceId, ids, loaded);
                return loaded;
            });
            if (result == null) throw new IllegalStateException("L1 sample transaction returned no value.");
            return result;
        } finally {
            releaseBuildPermits(ids);
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

    private static long advisoryKey(String fingerprint) {
        String prefix = fingerprint == null ? "0" : fingerprint.substring(0, Math.min(16, fingerprint.length()));
        return Long.parseUnsignedLong(prefix, 16);
    }
}
