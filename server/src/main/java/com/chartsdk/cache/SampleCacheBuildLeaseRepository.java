package com.chartsdk.cache;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/** Short metadata-DB operations for coordinating a sample-cache build across instances. */
@Repository
public class SampleCacheBuildLeaseRepository {
    private final JdbcTemplate jdbc;
    private final int leaseSeconds;

    public SampleCacheBuildLeaseRepository(
            JdbcTemplate jdbc,
            @Value("${chartsdk.sampling-cache.build-lease-seconds:45}") int leaseSeconds
    ) {
        this.jdbc = jdbc;
        this.leaseSeconds = Math.max(5, leaseSeconds);
    }

    public Optional<String> tryAcquire(String fingerprint) {
        String token = UUID.randomUUID().toString();
        String acquired = jdbc.query("""
                INSERT INTO mc_sample_cache_build_lease(fingerprint, lease_token, expires_at)
                VALUES (?, ?::uuid, now() + (? * INTERVAL '1 second'))
                ON CONFLICT (fingerprint) DO UPDATE
                    SET lease_token=EXCLUDED.lease_token,
                        expires_at=EXCLUDED.expires_at
                  WHERE mc_sample_cache_build_lease.expires_at <= now()
                RETURNING lease_token::text
                """, rs -> rs.next() ? rs.getString(1) : null,
                fingerprint, token, leaseSeconds);
        return Optional.ofNullable(acquired);
    }

    public void release(String fingerprint, String token) {
        jdbc.update("DELETE FROM mc_sample_cache_build_lease WHERE fingerprint=? AND lease_token=?::uuid",
                fingerprint, token);
    }
}
