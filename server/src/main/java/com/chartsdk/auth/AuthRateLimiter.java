package com.chartsdk.auth;

import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

@Service
public class AuthRateLimiter {
    private final JdbcTemplate jdbc;

    public AuthRateLimiter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 현재 요청 한 건을 원자적으로 예약한다. 제한 초과 요청은 비밀번호 검증 전에 거절된다. */
    public void reserve(String action, String key, int limit, int windowSeconds, int blockSeconds) {
        Boolean allowed = jdbc.queryForObject("""
                INSERT INTO mc_auth_rate_limit(
                    key_hash, action, window_started_at, attempts, blocked_until, updated_at)
                VALUES (?, ?, now(), 1, NULL, now())
                ON CONFLICT (key_hash) DO UPDATE SET
                    action = EXCLUDED.action,
                    attempts = CASE
                        WHEN mc_auth_rate_limit.window_started_at <= now() - (? * interval '1 second')
                          OR (mc_auth_rate_limit.blocked_until IS NOT NULL
                              AND mc_auth_rate_limit.blocked_until <= now()) THEN 1
                        WHEN mc_auth_rate_limit.blocked_until > now() THEN mc_auth_rate_limit.attempts
                        ELSE mc_auth_rate_limit.attempts + 1
                    END,
                    window_started_at = CASE
                        WHEN mc_auth_rate_limit.window_started_at <= now() - (? * interval '1 second')
                          OR (mc_auth_rate_limit.blocked_until IS NOT NULL
                              AND mc_auth_rate_limit.blocked_until <= now()) THEN now()
                        ELSE mc_auth_rate_limit.window_started_at
                    END,
                    blocked_until = CASE
                        WHEN mc_auth_rate_limit.blocked_until > now() THEN mc_auth_rate_limit.blocked_until
                        WHEN mc_auth_rate_limit.window_started_at <= now() - (? * interval '1 second')
                          OR (mc_auth_rate_limit.blocked_until IS NOT NULL
                              AND mc_auth_rate_limit.blocked_until <= now()) THEN NULL
                        WHEN mc_auth_rate_limit.attempts + 1 > ?
                            THEN now() + (? * interval '1 second')
                        ELSE NULL
                    END,
                    updated_at = now()
                RETURNING attempts <= ? AND blocked_until IS NULL
                """, Boolean.class, hash(action, key), action,
                windowSeconds, windowSeconds, windowSeconds, limit, blockSeconds, limit);
        if (!Boolean.TRUE.equals(allowed)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "AUTH_RATE_LIMITED",
                    "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
        }
    }

    /** 성공한 로그인 요청이 소비한 reservation 한 건만 되돌린다. 병렬 실패 횟수는 보존한다. */
    public void compensate(String action, String key) {
        jdbc.update("""
                UPDATE mc_auth_rate_limit
                   SET attempts = GREATEST(attempts - 1, 0),
                       blocked_until = NULL,
                       updated_at = now()
                 WHERE key_hash=?
                """, hash(action, key));
    }

    @Scheduled(cron = "${chartsdk.auth.rate-limit.cleanup-cron:0 17 3 * * *}")
    public void removeStaleEntries() {
        jdbc.update("DELETE FROM mc_auth_rate_limit WHERE updated_at < now() - interval '30 days'");
    }

    private static String hash(String action, String key) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(
                    (action + '\0' + (key == null ? "" : key)).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
