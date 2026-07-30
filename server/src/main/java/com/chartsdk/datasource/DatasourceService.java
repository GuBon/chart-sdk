package com.chartsdk.datasource;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import com.chartsdk.web.ApiException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

/**
 * 데이터소스의 저장·수정·삭제·연결 검증과 자격증명 조회를 한 곳에서 관리한다.
 * 웹 컨트롤러는 HTTP 매핑과 커넥션 풀 폐기만 담당하며 비밀번호·SQL 규칙을 알지 않는다.
 */
@Service
public class DatasourceService {
    private final JdbcTemplate jdbc;
    private final DatasourcePasswordCodec passwordCodec;

    public DatasourceService(JdbcTemplate jdbc, DatasourcePasswordCodec passwordCodec) {
        this.jdbc = jdbc;
        this.passwordCodec = passwordCodec;
    }

    public List<DatasourceView> list() {
        return jdbc.query("""
                SELECT id, name, host, port, database_name, db_user, max_pool_size, last_tested_at, last_test_ok
                  FROM mc_datasource
                 WHERE is_active = true
                 ORDER BY id
                """, (rs, rowNum) -> view(rs));
    }

    public DatasourceView create(DatasourceInput input) {
        validate(input, true);
        Long id = jdbc.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc, max_pool_size)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """, Long.class,
                input.name(), input.host(), input.resolvedPort(), input.databaseName(), input.dbUser(),
                encrypt(input.dbPassword()), input.resolvedMaxPoolSize());
        return get(id);
    }

    public DatasourceView update(long id, DatasourceInput input) {
        validate(input, false);
        int updated;
        if (blank(input.dbPassword())) {
            updated = jdbc.update("""
                    UPDATE mc_datasource
                       SET name=?, host=?, port=?, database_name=?, db_user=?, max_pool_size=?
                     WHERE id=? AND is_active=true
                    """, input.name(), input.host(), input.resolvedPort(), input.databaseName(), input.dbUser(),
                    input.resolvedMaxPoolSize(), id);
        } else {
            updated = jdbc.update("""
                    UPDATE mc_datasource
                       SET name=?, host=?, port=?, database_name=?, db_user=?, db_password_enc=?, max_pool_size=?
                     WHERE id=? AND is_active=true
                    """, input.name(), input.host(), input.resolvedPort(), input.databaseName(), input.dbUser(),
                    encrypt(input.dbPassword()), input.resolvedMaxPoolSize(), id);
        }
        if (updated == 0) throw notFound();
        return get(id);
    }

    public void delete(long id) {
        try {
            Integer inUse = jdbc.queryForObject(
                    "SELECT count(DISTINCT chart_id) FROM mc_chart_datasource WHERE datasource_id=?", Integer.class, id);
            if (inUse != null && inUse > 0) {
                throw new ApiException(HttpStatus.CONFLICT, "DATASOURCE_IN_USE", "Datasource is used by " + inUse + " chart(s).");
            }
            int updated = jdbc.update("UPDATE mc_datasource SET is_active=false WHERE id=? AND is_active=true", id);
            if (updated == 0) throw notFound();
        } catch (DataIntegrityViolationException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DATASOURCE_IN_USE", "Datasource is used by a chart.");
        }
    }

    public ConnectionTestResult test(DatasourceTestInput input) {
        DatasourceCredentials credentials = input.id() == null
                ? new DatasourceCredentials(input.host(), input.resolvedPort(), input.databaseName(), input.dbUser(), input.dbPassword(), 1)
                : credentials(input.id());
        boolean ok = false;
        String message;
        long start = System.nanoTime();
        String testUrl = credentials.jdbcUrl() + "?connectTimeout=5&socketTimeout=15&loginTimeout=5";
        try (var connection = DriverManager.getConnection(testUrl, credentials.dbUser(), credentials.dbPassword());
             var statement = connection.createStatement()) {
            statement.execute("SELECT 1");
            long elapsedMs = Math.max(1, (System.nanoTime() - start) / 1_000_000);
            ok = true;
            message = "연결 성공 (" + elapsedMs + "ms)";
        } catch (Exception e) {
            message = "연결 실패: " + e.getMessage();
        }
        if (input.id() != null) {
            jdbc.update("UPDATE mc_datasource SET last_tested_at=now(), last_test_ok=? WHERE id=?", ok, input.id());
        }
        return new ConnectionTestResult(ok, message);
    }

    public DatasourceCredentials credentials(long id) {
        return jdbc.query("""
                SELECT host, port, database_name, db_user, db_password_enc, max_pool_size
                  FROM mc_datasource
                 WHERE id=? AND is_active=true
                """, rs -> {
            if (!rs.next()) throw notFound();
            return new DatasourceCredentials(
                    rs.getString("host"),
                    rs.getInt("port"),
                    rs.getString("database_name"),
                    rs.getString("db_user"),
                    passwordCodec.decrypt(rs.getString("db_password_enc")),
                    rs.getInt("max_pool_size")
            );
        }, id);
    }

    private DatasourceView get(long id) {
        return jdbc.query("""
                SELECT id, name, host, port, database_name, db_user, max_pool_size, last_tested_at, last_test_ok
                  FROM mc_datasource
                 WHERE id = ? AND is_active = true
                """, rs -> {
            if (!rs.next()) throw notFound();
            return view(rs);
        }, id);
    }

    private static DatasourceView view(ResultSet rs) throws SQLException {
        return new DatasourceView(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("host"),
                rs.getInt("port"),
                rs.getString("database_name"),
                rs.getString("db_user"),
                rs.getInt("max_pool_size"),
                timestampString(rs.getTimestamp("last_tested_at")),
                rs.getObject("last_test_ok", Boolean.class)
        );
    }

    private static void validate(DatasourceInput input, boolean requirePassword) {
        if (input == null || blank(input.name()) || blank(input.host()) || blank(input.databaseName()) || blank(input.dbUser())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Required datasource fields are missing.");
        }
        if ("new".equalsIgnoreCase(input.name().trim())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATASOURCE_NAME_RESERVED", "Datasource name 'new' is reserved.");
        }
        if (requirePassword && blank(input.dbPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Password is required.");
        }
    }

    private String encrypt(String password) {
        return passwordCodec.encrypt(password == null ? "" : password);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "DATASOURCE_NOT_FOUND", "Datasource not found.");
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static String timestampString(Timestamp timestamp) {
        return timestamp == null ? null : Instant.ofEpochMilli(timestamp.getTime()).toString();
    }

    public record ConnectionTestResult(boolean ok, String message) {
    }
}
