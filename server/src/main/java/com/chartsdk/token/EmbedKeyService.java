package com.chartsdk.token;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.web.ApiException;
import com.chartsdk.web.ThrowableCauseWalker;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * (사용자, 차트) 쌍에 묶인 임베드 키의 발급·조회·회수·검증.
 *
 * 임베드 스니펫에는 chartId 를 넣지 않는다 — 서빙할 차트는 검증된 키의 바인딩(chart_id)에서만 나온다.
 * 소유자 범위(owner_id) 검증은 발급·목록·회수에 모두 적용하며 로그인 사용자의 ID와 정확히 일치해야 한다.
 */
@Service
public class EmbedKeyService {
    private final JdbcTemplate jdbc;
    private final EmbedKeyCodec codec;
    private final CurrentUserProvider currentUser;

    public EmbedKeyService(JdbcTemplate jdbc, EmbedKeyCodec codec, CurrentUserProvider currentUser) {
        this.jdbc = jdbc;
        this.codec = codec;
        this.currentUser = currentUser;
    }

    /** S3 모달용 차트별 키 목록. Bearer 원문은 재파생하지 않고 상태 메타데이터만 반환한다. */
    public List<EmbedKeySummary> listForChart(long chartId) {
        long userId = currentUserId();
        requireChart(chartId, userId);
        return jdbc.query("""
                SELECT k.id, k.user_id, k.chart_id, k.expires_at, k.is_active, k.created_at,
                       k.revoked_at, k.revoked_reason
                  FROM mc_embed_key k
                  JOIN mc_chart c ON c.id = k.chart_id
                 WHERE k.chart_id=?
                   AND c.owner_id=? AND k.user_id=?
                 ORDER BY k.id
                """, (rs, rowNum) -> summaryRow(rs), chartId, userId, userId);
    }

    @Transactional
    public IssuedEmbedKey issue(long chartId, int days) {
        return issueFor(chartId, currentUserId(), days);
    }

    IssuedEmbedKey issueFor(long chartId, long userId, int days) {
        Integer userExists = jdbc.queryForObject(
                "SELECT count(*) FROM mc_user WHERE id=? AND is_active=true", Integer.class, userId);
        if (userExists == null || userExists == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
        }
        try {
            // 같은 차트의 동시 재발급은 대기시켜 둘 다 성공시키지 않는다. 뒤 요청은 409로 재시도하게 한다.
            Long lockedChartId = jdbc.query("""
                    SELECT id
                      FROM mc_chart
                     WHERE id=? AND owner_id=?
                     FOR UPDATE NOWAIT
                    """, rs -> rs.next() ? rs.getLong("id") : null, chartId, userId);
            if (lockedChartId == null) {
                throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
            }
            jdbc.update("""
                    UPDATE mc_embed_key
                       SET is_active=false, revoked_at=now(), revoked_reason='ROTATED'
                     WHERE chart_id=? AND user_id=? AND is_active=true
                    """, chartId, userId);
            Instant expiresAt = Instant.now().plus(days, ChronoUnit.DAYS);
            Long id = jdbc.queryForObject("""
                    INSERT INTO mc_embed_key(user_id, chart_id, expires_at)
                    VALUES (?, ?, ?)
                    RETURNING id
                    """, Long.class, userId, chartId, Timestamp.from(expiresAt));
            return findIssuedKey(id);
        } catch (DataAccessException e) {
            String sqlState = ThrowableCauseWalker.firstSqlState(e);
            if ("55P03".equals(sqlState) || "23505".equals(sqlState)) {
                throw new ApiException(HttpStatus.CONFLICT, "EMBED_KEY_ISSUE_IN_PROGRESS",
                        "Embed key issuance is already in progress. Please try again.", e);
            }
            throw e;
        }
    }

    @Transactional
    public void revoke(long keyId) {
        long userId = currentUserId();
        int updated = jdbc.update("""
                UPDATE mc_embed_key k
                   SET is_active=false, revoked_at=now(), revoked_reason='MANUAL'
                  FROM mc_chart c
                 WHERE k.id=? AND k.is_active=true
                   AND c.id=k.chart_id
                   AND c.owner_id=? AND k.user_id=?
                """, keyId, userId, userId);
        if (updated == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "EMBED_KEY_NOT_FOUND", "Embed key not found.");
        }
    }

    /**
     * 임베드 데이터 요청의 Bearer 검증. 오류 코드는 기존 임베드 계약(TOKEN_INVALID/EXPIRED/REVOKED)을 유지한다.
     * 서명이 유효한데 행이 없으면 차트/사용자 삭제로 소멸한 키이므로 REVOKED 로 수렴시킨다.
     */
    public EmbedKeyPrincipal validateBearer(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Bearer embed key is required.");
        }
        long keyId = codec.decode(authorization.substring("Bearer ".length()).trim());
        return jdbc.query("""
                SELECT k.user_id, k.chart_id, k.expires_at, k.is_active, u.is_active AS user_active
                  FROM mc_embed_key k
                  JOIN mc_user u ON u.id = k.user_id
                 WHERE k.id = ?
                """, rs -> {
            if (!rs.next() || !rs.getBoolean("is_active") || !rs.getBoolean("user_active")) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_REVOKED", "Embed key has been revoked.");
            }
            if (!rs.getTimestamp("expires_at").toInstant().isAfter(Instant.now())) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_EXPIRED", "Embed key has expired.");
            }
            return new EmbedKeyPrincipal(keyId, rs.getLong("user_id"), rs.getLong("chart_id"));
        }, keyId);
    }

    private void requireChart(long chartId, long userId) {
        Integer exists = jdbc.queryForObject(
                "SELECT count(*) FROM mc_chart WHERE id=? AND owner_id=?", Integer.class, chartId, userId);
        if (exists == null || exists == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
        }
    }

    private long currentUserId() {
        return currentUser.currentUserId().orElseThrow(EmbedKeyService::authRequired);
    }

    private static ApiException authRequired() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "로그인이 필요합니다.");
    }

    private IssuedEmbedKey findIssuedKey(long id) {
        return jdbc.query("SELECT id, user_id, chart_id, expires_at, created_at FROM mc_embed_key WHERE id=?", rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "EMBED_KEY_NOT_FOUND", "Embed key not found.");
            return new IssuedEmbedKey(
                    rs.getLong("id"),
                    rs.getLong("user_id"),
                    rs.getLong("chart_id"),
                    instant(rs.getTimestamp("expires_at")),
                    EmbedKeyStatus.ACTIVE,
                    instant(rs.getTimestamp("created_at")),
                    codec.encode(id));
        }, id);
    }

    private static EmbedKeySummary summaryRow(ResultSet rs) throws SQLException {
        boolean active = rs.getBoolean("is_active");
        Instant expiresAt = instant(rs.getTimestamp("expires_at"));
        EmbedKeyStatus status = !active
                ? EmbedKeyStatus.REVOKED
                : expiresAt.isAfter(Instant.now()) ? EmbedKeyStatus.ACTIVE : EmbedKeyStatus.EXPIRED;
        return new EmbedKeySummary(
                rs.getLong("id"),
                rs.getLong("user_id"),
                rs.getLong("chart_id"),
                expiresAt,
                status,
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("revoked_at")),
                rs.getString("revoked_reason"));
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
