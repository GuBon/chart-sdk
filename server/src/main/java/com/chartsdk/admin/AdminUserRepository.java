package com.chartsdk.admin;

import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class AdminUserRepository {
    private final JdbcTemplate jdbc;

    public AdminUserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> list(String q, String status, String role, Integer page, Integer pageSize) {
        int size = Math.max(1, Math.min(pageSize == null ? 20 : pageSize, 100));
        StringBuilder where = new StringBuilder(" FROM mc_user u WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (q != null && !q.isBlank()) {
            where.append(" AND (u.username ILIKE ? OR COALESCE(u.display_name, '') ILIKE ?)");
            args.add("%" + q.strip() + "%");
            args.add("%" + q.strip() + "%");
        }
        if ("active".equals(status)) where.append(" AND u.is_active=true");
        if ("inactive".equals(status)) where.append(" AND u.is_active=false");
        if (role != null && !role.isBlank()) {
            where.append(" AND u.role=?");
            args.add(role);
        }

        Integer totalValue = jdbc.queryForObject("SELECT count(*)" + where, Integer.class, args.toArray());
        int total = totalValue == null ? 0 : totalValue;
        int totalPages = Math.max(1, (int) Math.ceil((double) total / size));
        int currentPage = Math.max(1, Math.min(page == null ? 1 : page, totalPages));

        String sql = """
                SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.created_at,
                       (SELECT count(*) FROM mc_chart c WHERE c.owner_id=u.id) AS chart_count,
                       (SELECT count(DISTINCT k.chart_id) FROM mc_embed_key k
                         WHERE k.user_id=u.id AND k.is_active=true AND k.expires_at>now()) AS embedded_chart_count,
                       (SELECT count(*) FROM mc_session s
                         WHERE s.principal_name=u.username
                           AND s.expiry_time > (extract(epoch from clock_timestamp()) * 1000)::bigint) AS active_sessions
                """ + where + " ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?";
        List<Object> queryArgs = new ArrayList<>(args);
        queryArgs.add(size);
        queryArgs.add((currentPage - 1) * size);
        List<Map<String, Object>> users = jdbc.query(sql, (rs, rowNum) -> listRow(rs), queryArgs.toArray());

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("users", users);
        response.put("page", currentPage);
        response.put("pageSize", size);
        response.put("total", total);
        response.put("totalPages", totalPages);
        return response;
    }

    public Map<String, Object> detail(long userId) {
        Map<String, Object> user = jdbc.query("""
                SELECT id, username, display_name, role, is_active, created_at
                  FROM mc_user
                 WHERE id=?
                """, rs -> rs.next() ? userRow(rs) : null, userId);
        if (user == null) throw userNotFound();

        Map<String, Object> summary = jdbc.query("""
                SELECT
                    (SELECT count(*) FROM mc_session s
                      WHERE s.principal_name=u.username
                        AND s.expiry_time > (extract(epoch from clock_timestamp()) * 1000)::bigint) AS active_sessions,
                    (SELECT count(*) FROM mc_chart c WHERE c.owner_id=u.id) AS chart_count,
                    (SELECT count(DISTINCT k.chart_id) FROM mc_embed_key k
                      WHERE k.user_id=u.id AND k.is_active=true AND k.expires_at>now()) AS embedded_chart_count,
                    (SELECT count(*) FROM mc_embed_key k
                      WHERE k.user_id=u.id AND k.is_active=true AND k.expires_at>now()) AS active_key_count,
                    (SELECT count(*) FROM mc_embed_key k
                      WHERE k.user_id=u.id AND k.is_active=true AND k.expires_at<=now()) AS expired_key_count,
                    (SELECT count(*) FROM mc_embed_key k
                      WHERE k.user_id=u.id AND k.is_active=false) AS revoked_key_count,
                    (SELECT max(k.created_at) FROM mc_embed_key k WHERE k.user_id=u.id) AS last_key_issued_at
                  FROM mc_user u
                 WHERE u.id=?
                """, rs -> {
            rs.next();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("activeSessions", rs.getInt("active_sessions"));
            row.put("chartCount", rs.getInt("chart_count"));
            row.put("embeddedChartCount", rs.getInt("embedded_chart_count"));
            row.put("activeEmbedKeyCount", rs.getInt("active_key_count"));
            row.put("expiredEmbedKeyCount", rs.getInt("expired_key_count"));
            row.put("revokedEmbedKeyCount", rs.getInt("revoked_key_count"));
            row.put("lastEmbedKeyIssuedAt", instant(rs.getTimestamp("last_key_issued_at")));
            return row;
        }, userId);

        List<Map<String, Object>> embedKeys = jdbc.query("""
                SELECT k.id, k.chart_id, c.name AS chart_name, k.expires_at, k.created_at,
                       k.revoked_at, k.revoked_reason,
                       CASE
                           WHEN k.is_active=false THEN 'REVOKED'
                           WHEN k.expires_at<=now() THEN 'EXPIRED'
                           ELSE 'ACTIVE'
                       END AS status
                  FROM mc_embed_key k
                  JOIN mc_chart c ON c.id=k.chart_id
                 WHERE k.user_id=?
                 ORDER BY k.created_at DESC, k.id DESC
                """, (rs, rowNum) -> embedKeyRow(rs), userId);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("user", user);
        response.put("summary", summary);
        response.put("embedKeys", embedKeys);
        return response;
    }

    public List<Long> lockActiveAdminIds() {
        return jdbc.queryForList("""
                SELECT id
                  FROM mc_user
                 WHERE role='admin' AND is_active=true
                 ORDER BY id
                 FOR UPDATE
                """, Long.class);
    }

    public UserState lockUser(long userId) {
        UserState state = jdbc.query("""
                SELECT id, username, role, is_active
                  FROM mc_user
                 WHERE id=?
                 FOR UPDATE
                """, rs -> rs.next()
                ? new UserState(rs.getLong("id"), rs.getString("username"),
                        rs.getString("role"), rs.getBoolean("is_active"))
                : null, userId);
        if (state == null) throw userNotFound();
        return state;
    }

    public void updateStatus(long userId, boolean active) {
        jdbc.update("UPDATE mc_user SET is_active=?, auth_version=auth_version+1 WHERE id=?", active, userId);
    }

    public void updateRole(long userId, String role) {
        jdbc.update("UPDATE mc_user SET role=?, auth_version=auth_version+1 WHERE id=?", role, userId);
    }

    public void deleteSessions(String username) {
        jdbc.update("DELETE FROM mc_session WHERE principal_name=?", username);
    }

    public void revokeEmbedKeys(long userId) {
        jdbc.update("""
                UPDATE mc_embed_key
                   SET is_active=false, revoked_at=now(), revoked_reason='USER_DISABLED'
                 WHERE user_id=? AND is_active=true
                """, userId);
    }

    public void revokeLegacyTokens(long userId) {
        jdbc.update("""
                UPDATE mc_user_token
                   SET is_active=false, revoked_at=now(), revoked_reason='USER_DISABLED'
                 WHERE user_id=? AND is_active=true
                """, userId);
    }

    private static Map<String, Object> listRow(ResultSet rs) throws SQLException {
        Map<String, Object> row = userRow(rs);
        row.put("chartCount", rs.getInt("chart_count"));
        row.put("embeddedChartCount", rs.getInt("embedded_chart_count"));
        row.put("activeSessions", rs.getInt("active_sessions"));
        return row;
    }

    private static Map<String, Object> userRow(ResultSet rs) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", rs.getLong("id"));
        row.put("username", rs.getString("username"));
        row.put("displayName", rs.getString("display_name"));
        row.put("role", rs.getString("role"));
        row.put("active", rs.getBoolean("is_active"));
        row.put("createdAt", instant(rs.getTimestamp("created_at")));
        return row;
    }

    private static Map<String, Object> embedKeyRow(ResultSet rs) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", rs.getLong("id"));
        row.put("chartId", rs.getLong("chart_id"));
        row.put("chartName", rs.getString("chart_name"));
        row.put("status", rs.getString("status"));
        row.put("expiresAt", instant(rs.getTimestamp("expires_at")));
        row.put("createdAt", instant(rs.getTimestamp("created_at")));
        row.put("revokedAt", instant(rs.getTimestamp("revoked_at")));
        row.put("revokedReason", rs.getString("revoked_reason"));
        return row;
    }

    private static String instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    private static ApiException userNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.");
    }

    public record UserState(long id, String username, String role, boolean active) {
    }
}
