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
        if (acquired == null) return Optional.empty();
        sweepExpired();
        return Optional.of(acquired);
    }

    /**
     * 빌드 도중 프로세스가 죽으면 release 가 실행되지 않아 만료된 리스 행이 영구 잔존한다
     * (fingerprint 단위라 상한이 없다). 고아 행은 같은 fingerprint 의 재획득을 막지 않으므로
     * 급하지 않다 — 어차피 무거운 빌드를 시작하는 획득 성공 시점에만 기회적으로 쓸어낸다.
     * 방금 획득한 리스와 다른 인스턴스가 보유 중인 리스는 만료 시각이 미래라 대상이 아니다.
     */
    private void sweepExpired() {
        jdbc.update("DELETE FROM mc_sample_cache_build_lease WHERE expires_at <= now()");
    }

    public void release(String fingerprint, String token) {
        jdbc.update("DELETE FROM mc_sample_cache_build_lease WHERE fingerprint=? AND lease_token=?::uuid",
                fingerprint, token);
    }
}
