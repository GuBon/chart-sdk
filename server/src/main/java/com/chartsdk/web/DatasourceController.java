package com.chartsdk.web;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/datasources")
public class DatasourceController {
    private final JdbcTemplate jdbc;
    private final DatasourcePasswordCodec passwordCodec;

    public DatasourceController(JdbcTemplate jdbc, DatasourcePasswordCodec passwordCodec) {
        this.jdbc = jdbc;
        this.passwordCodec = passwordCodec;
    }

    @GetMapping
    public Map<String, Object> list() {
        List<Map<String, Object>> datasources = jdbc.query("""
                SELECT id, name, host, port, database_name, db_user, max_pool_size, last_tested_at, last_test_ok
                  FROM mc_datasource
                 WHERE is_active = true
                 ORDER BY id
                """, (rs, rowNum) -> datasourceRow(rs));
        return Map.of("datasources", datasources);
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody DatasourceInput input) {
        validate(input, true);
        Long id = jdbc.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc, max_pool_size)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """, Long.class, input.name(), input.host(), port(input), input.databaseName(), input.dbUser(), password(input), pool(input));
        return getOne(id);
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable long id, @RequestBody DatasourceInput input) {
        validate(input, false);
        if (input.dbPassword() == null || input.dbPassword().isBlank()) {
            jdbc.update("""
                    UPDATE mc_datasource
                       SET name=?, host=?, port=?, database_name=?, db_user=?, max_pool_size=?
                     WHERE id=? AND is_active=true
                    """, input.name(), input.host(), port(input), input.databaseName(), input.dbUser(), pool(input), id);
        } else {
            jdbc.update("""
                    UPDATE mc_datasource
                       SET name=?, host=?, port=?, database_name=?, db_user=?, db_password_enc=?, max_pool_size=?
                     WHERE id=? AND is_active=true
                    """, input.name(), input.host(), port(input), input.databaseName(), input.dbUser(), password(input), pool(input), id);
        }
        return getOne(id);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        try {
            Integer inUse = jdbc.queryForObject("SELECT count(*) FROM mc_chart WHERE datasource_id=?", Integer.class, id);
            if (inUse != null && inUse > 0) {
                throw new ApiException(HttpStatus.CONFLICT, "DATASOURCE_IN_USE", "Datasource is used by " + inUse + " chart(s).");
            }
            int updated = jdbc.update("UPDATE mc_datasource SET is_active=false WHERE id=? AND is_active=true", id);
            if (updated == 0) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Datasource not found.");
        } catch (DataIntegrityViolationException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DATASOURCE_IN_USE", "Datasource is used by a chart.");
        }
    }

    @PostMapping("/test")
    public Map<String, Object> test(@RequestBody DatasourceTestInput input) {
        Credentials c = input.id() == null ? new Credentials(input.host(), port(input.port()), input.databaseName(), input.dbUser(), input.dbPassword())
                : credentials(input.id());
        boolean ok = false;
        String message;
        long start = System.nanoTime();
        try (var conn = DriverManager.getConnection(url(c.host(), c.port(), c.databaseName()), c.dbUser(), c.dbPassword());
             var stmt = conn.createStatement()) {
            stmt.execute("SELECT 1");
            long elapsedMs = Math.max(1, (System.nanoTime() - start) / 1_000_000);
            ok = true;
            message = "Connection succeeded (" + elapsedMs + "ms)";
        } catch (Exception e) {
            message = "Connection failed: " + e.getMessage();
        }
        if (input.id() != null) {
            jdbc.update("UPDATE mc_datasource SET last_tested_at=now(), last_test_ok=? WHERE id=?", ok, input.id());
        }
        return Map.of("ok", ok, "message", message);
    }

    Map<String, Object> getOne(long id) {
        return jdbc.query("""
                SELECT id, name, host, port, database_name, db_user, max_pool_size, last_tested_at, last_test_ok
                  FROM mc_datasource
                 WHERE id = ? AND is_active = true
                """, rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Datasource not found.");
            return datasourceRow(rs);
        }, id);
    }

    private static Map<String, Object> datasourceRow(ResultSet rs) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", rs.getLong("id"));
        row.put("name", rs.getString("name"));
        row.put("host", rs.getString("host"));
        row.put("port", rs.getInt("port"));
        row.put("databaseName", rs.getString("database_name"));
        row.put("dbUser", rs.getString("db_user"));
        row.put("maxPoolSize", rs.getInt("max_pool_size"));
        row.put("lastTestedAt", timestampString(rs.getTimestamp("last_tested_at")));
        row.put("lastTestOk", nullableBoolean(rs.getObject("last_test_ok")));
        return row;
    }

    Credentials credentials(long id) {
        return jdbc.query("""
                SELECT host, port, database_name, db_user, db_password_enc
                  FROM mc_datasource
                 WHERE id=? AND is_active=true
                """, rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Datasource not found.");
            return new Credentials(
                    rs.getString("host"),
                    rs.getInt("port"),
                    rs.getString("database_name"),
                    rs.getString("db_user"),
                    passwordCodec.decrypt(rs.getString("db_password_enc"))
            );
        }, id);
    }

    private static void validate(DatasourceInput input, boolean requirePassword) {
        if (blank(input.name()) || blank(input.host()) || blank(input.databaseName()) || blank(input.dbUser())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Required datasource fields are missing.");
        }
        if (requirePassword && blank(input.dbPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Password is required.");
        }
    }

    static String url(String host, int port, String databaseName) {
        return "jdbc:postgresql://" + host + ":" + port + "/" + databaseName;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static int port(DatasourceInput input) {
        return port(input.port());
    }

    private static int port(Integer port) {
        return port == null ? 5432 : port;
    }

    private static int pool(DatasourceInput input) {
        return input.maxPoolSize() == null ? 5 : input.maxPoolSize();
    }

    private String password(DatasourceInput input) {
        return passwordCodec.encrypt(input.dbPassword() == null ? "" : input.dbPassword());
    }

    private static Object nullableBoolean(Object value) {
        return value == null ? null : value;
    }

    private static Object timestampString(Timestamp ts) {
        return ts == null ? null : Instant.ofEpochMilli(ts.getTime()).toString();
    }

    public record DatasourceInput(String name, String host, Integer port, String databaseName, String dbUser,
                                  String dbPassword, Integer maxPoolSize) {
    }

    public record DatasourceTestInput(Long id, String host, Integer port, String databaseName, String dbUser,
                                      String dbPassword) {
    }

    record Credentials(String host, int port, String databaseName, String dbUser, String dbPassword) {
    }
}
