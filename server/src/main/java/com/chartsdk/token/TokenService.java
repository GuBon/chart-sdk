package com.chartsdk.token;

import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class TokenService {
    private final JdbcTemplate jdbc;
    private final JwtTokenProvider jwt;

    public TokenService(JdbcTemplate jdbc, JwtTokenProvider jwt) {
        this.jdbc = jdbc;
        this.jwt = jwt;
    }

    public List<Map<String, Object>> listTokens() {
        return jdbc.query("""
                SELECT id, user_id, expires_at, is_active, created_at, token
                  FROM mc_user_token
                 ORDER BY id
                """, (rs, rowNum) -> tokenRow(rs, true));
    }

    @Transactional
    public Map<String, Object> issue(long userId, int days) {
        int expiresInDays = Math.max(1, days);
        jdbc.update("""
                UPDATE mc_user_token
                   SET is_active=false, revoked_at=now(), revoked_reason='ROTATED'
                 WHERE user_id=? AND is_active=true
                """, userId);
        Instant now = Instant.now();
        Instant expiresAt = now.plus(expiresInDays, ChronoUnit.DAYS);
        Long id = jdbc.queryForObject("""
                INSERT INTO mc_user_token(user_id, token, expires_at, is_active)
                VALUES (?, ?, ?, true)
                RETURNING id
                """, Long.class, userId, "__pending__", Timestamp.from(expiresAt));
        String token = jwt.create(userId, id, now, expiresAt);
        jdbc.update("UPDATE mc_user_token SET token=? WHERE id=?", token, id);
        return findToken(id, true);
    }

    public void revoke(long tokenId) {
        int updated = jdbc.update("""
                UPDATE mc_user_token
                   SET is_active=false, revoked_at=now(), revoked_reason='MANUAL'
                 WHERE id=? AND is_active=true
                """, tokenId);
        if (updated == 0) throw new ApiException(HttpStatus.NOT_FOUND, "TOKEN_NOT_FOUND", "Token not found.");
    }

    public EmbedPrincipal validateBearer(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Bearer token is required.");
        }
        String raw = authorization.substring("Bearer ".length()).trim();
        EmbedPrincipal principal = jwt.validate(raw);
        Integer count = jdbc.queryForObject("""
                SELECT count(*)
                  FROM mc_user_token t
                  JOIN mc_user u ON u.id = t.user_id
                 WHERE t.id = ?
                   AND t.user_id = ?
                   AND t.is_active = true
                   AND t.expires_at > now()
                   AND u.is_active = true
                """, Integer.class, principal.tokenId(), principal.userId());
        if (count == null || count == 0) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_REVOKED", "Token has been revoked.");
        }
        return principal;
    }

    private Map<String, Object> findToken(long id, boolean includeToken) {
        return jdbc.query("SELECT id, user_id, expires_at, is_active, created_at, token FROM mc_user_token WHERE id=?", rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "TOKEN_NOT_FOUND", "Token not found.");
            return tokenRow(rs, includeToken);
        }, id);
    }

    private static Map<String, Object> tokenRow(ResultSet rs, boolean includeToken) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("tokenId", rs.getLong("id"));
        row.put("userId", rs.getLong("user_id"));
        row.put("expiresAt", timestampString(rs.getTimestamp("expires_at")));
        row.put("isActive", rs.getBoolean("is_active"));
        row.put("createdAt", timestampString(rs.getTimestamp("created_at")));
        if (includeToken) row.put("token", rs.getString("token"));
        return row;
    }

    private static String timestampString(Timestamp ts) {
        return Instant.ofEpochMilli(ts.getTime()).toString();
    }
}
