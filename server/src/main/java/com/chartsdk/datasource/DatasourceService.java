package com.chartsdk.datasource;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.auth.DevelopmentCurrentUserProvider;
import com.chartsdk.web.ApiException;
import com.chartsdk.web.ThrowableCauseWalker;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.OptionalLong;

/**
 * 데이터소스의 저장·수정·삭제·연결 검증과 자격증명 조회를 한 곳에서 관리한다.
 * 웹 컨트롤러는 HTTP 매핑과 커넥션 풀 폐기만 담당하며 비밀번호·SQL 규칙을 알지 않는다.
 */
@Service
public class DatasourceService {
    private static final Logger log = LoggerFactory.getLogger(DatasourceService.class);
    private final JdbcTemplate jdbc;
    private final DatasourcePasswordResolver passwords;
    private final ApplicationEventPublisher events;
    private final CurrentUserProvider currentUser;

    public DatasourceService(JdbcTemplate jdbc, DatasourcePasswordResolver passwords) {
        this(jdbc, passwords, ignored -> { }, null);
    }

    public DatasourceService(JdbcTemplate jdbc, DatasourcePasswordResolver passwords,
                             ApplicationEventPublisher events) {
        this(jdbc, passwords, events, null);
    }

    @Autowired
    public DatasourceService(JdbcTemplate jdbc, DatasourcePasswordResolver passwords,
                             ApplicationEventPublisher events, CurrentUserProvider currentUser) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.events = events;
        this.currentUser = currentUser;
    }

    public List<DatasourceView> list() {
        Long ownerId = ownerId();
        String sql = """
                SELECT id, name, host, port, database_name, db_user, max_pool_size, last_tested_at, last_test_ok
                  FROM mc_datasource
                 WHERE is_active = true
                """ + (ownerId == null ? "" : " AND owner_id = ?") + """
                 ORDER BY id
                """;
        return ownerId == null
                ? jdbc.query(sql, (rs, rowNum) -> view(rs))
                : jdbc.query(sql, (rs, rowNum) -> view(rs), ownerId);
    }

    public DatasourceView create(DatasourceInput input) {
        validate(input, true);
        Long id = jdbc.queryForObject("""
                INSERT INTO mc_datasource(owner_id, name, host, port, database_name, db_user, db_password_enc, max_pool_size)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """, Long.class,
                ownerId(),
                input.name(), input.host(), input.resolvedPort(), input.databaseName(), input.dbUser(),
                encrypt(input.dbPassword()), input.resolvedMaxPoolSize());
        return get(id);
    }

    @Transactional
    public DatasourceView update(long id, DatasourceInput input) {
        validate(input, false);
        requireOwned(id);
        ConnectionSettings before = connectionSettings(id);
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
        DatasourceView result = get(id);
        DatasourceChangedEvent.Impact impact = changeImpact(before, input);
        if (impact != null) events.publishEvent(new DatasourceChangedEvent(id, impact));
        return result;
    }

    @Transactional
    public void delete(long id) {
        try {
            requireOwned(id);
            Integer inUse = jdbc.queryForObject(
                    "SELECT count(DISTINCT chart_id) FROM mc_chart_datasource WHERE datasource_id=?", Integer.class, id);
            if (inUse != null && inUse > 0) {
                throw new ApiException(HttpStatus.CONFLICT, "DATASOURCE_IN_USE", "Datasource is used by " + inUse + " chart(s).");
            }
            int updated = jdbc.update("UPDATE mc_datasource SET is_active=false WHERE id=? AND is_active=true", id);
            if (updated == 0) throw notFound();
            events.publishEvent(new DatasourceChangedEvent(id, DatasourceChangedEvent.Impact.DELETED));
        } catch (DataIntegrityViolationException e) {
            throw new ApiException(HttpStatus.CONFLICT, "DATASOURCE_IN_USE", "Datasource is used by a chart.");
        }
    }

    public ConnectionTestResult test(DatasourceTestInput input) {
        if (input.id() != null) requireOwned(input.id());
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
            // 원문(JDBC/libpq 상세 — 호스트·DB·SQLSTATE)은 로그로만 남기고, 사용자에겐 원인 카테고리만 안내한다.
            log.warn("Datasource connection test failed (id={})", input.id(), e);
            message = friendlyConnectionError(e);
        }
        if (input.id() != null) {
            jdbc.update("UPDATE mc_datasource SET last_tested_at=now(), last_test_ok=? WHERE id=?", ok, input.id());
        }
        return new ConnectionTestResult(ok, message);
    }

    /**
     * 연결 실패 원인을 SQLSTATE 기준으로 안전한 카테고리 문구로 번역한다. 원문(호스트·DB·드라이버 상세)을
     * 그대로 노출하지 않으면서도 관리자가 무엇을 고쳐야 할지 알 수 있게 한다(28=자격증명, 3D000=DB 부재, 08=연결).
     */
    static String friendlyConnectionError(Exception e) {
        String sqlState = ThrowableCauseWalker.firstSqlState(e);
        if (sqlState != null) {
            if (sqlState.startsWith("28")) return "자격 증명(사용자/비밀번호)이 올바르지 않습니다.";
            if (sqlState.equals("3D000")) return "지정한 데이터베이스가 존재하지 않습니다.";
            if (sqlState.startsWith("08")) return "데이터베이스에 연결할 수 없습니다. 호스트·포트·방화벽을 확인하세요.";
        }
        return "연결에 실패했습니다. 호스트·포트·자격 증명을 확인하세요.";
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
                    passwords.resolve(rs.getString("db_password_enc")),
                    rs.getInt("max_pool_size")
            );
        }, id);
    }

    private DatasourceView get(long id) {
        Long ownerId = ownerId();
        String sql = """
                SELECT id, name, host, port, database_name, db_user, max_pool_size, last_tested_at, last_test_ok
                  FROM mc_datasource
                 WHERE id = ? AND is_active = true
                """ + (ownerId == null ? "" : " AND owner_id = ?");
        Object[] params = ownerId == null ? new Object[]{id} : new Object[]{id, ownerId};
        return jdbc.query(sql, rs -> {
            if (!rs.next()) throw notFound();
            return view(rs);
        }, params);
    }

    private ConnectionSettings connectionSettings(long id) {
        Long ownerId = ownerId();
        String sql = """
                SELECT host, port, database_name, db_user, max_pool_size
                  FROM mc_datasource
                 WHERE id=? AND is_active=true
                """ + (ownerId == null ? "" : " AND owner_id=?");
        Object[] params = ownerId == null ? new Object[]{id} : new Object[]{id, ownerId};
        return jdbc.query(sql, rs -> {
            if (!rs.next()) throw notFound();
            return new ConnectionSettings(
                    rs.getString("host"), rs.getInt("port"), rs.getString("database_name"),
                    rs.getString("db_user"), rs.getInt("max_pool_size"));
        }, params);
    }

    /** 관리자 요청에서 사용하는 소유권 가드. 내부 임베드 계산의 credentials(id)에는 적용하지 않는다. */
    public void requireOwned(long id) {
        Long ownerId = ownerId();
        if (ownerId == null) return; // 직접 생성 단위/통합 테스트의 레거시 호출만 허용. HTTP는 Security가 선행한다.
        Boolean owned = jdbc.queryForObject("""
                SELECT EXISTS(
                    SELECT 1 FROM mc_datasource
                     WHERE id=? AND owner_id=? AND is_active=true
                )
                """, Boolean.class, id, ownerId);
        if (!Boolean.TRUE.equals(owned)) throw notFound();
    }

    private Long ownerId() {
        if (currentUser == null || currentUser instanceof DevelopmentCurrentUserProvider) return null;
        OptionalLong id = currentUser.currentUserId();
        if (id.isEmpty()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "로그인이 필요합니다.");
        }
        return id.getAsLong();
    }

    private static DatasourceChangedEvent.Impact changeImpact(ConnectionSettings before, DatasourceInput input) {
        boolean identityChanged = !Objects.equals(before.host(), input.host())
                || before.port() != input.resolvedPort()
                || !Objects.equals(before.databaseName(), input.databaseName())
                || !Objects.equals(before.dbUser(), input.dbUser());
        if (identityChanged) return DatasourceChangedEvent.Impact.SOURCE_IDENTITY;
        if (!blank(input.dbPassword()) || before.maxPoolSize() != input.resolvedMaxPoolSize()) {
            return DatasourceChangedEvent.Impact.POOL_CONFIGURATION;
        }
        return null;
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
        // 포트 범위는 순수 값 검사(경쟁 없음)라 앱에서 먼저 거른다 — DB CHECK 위반의 뭉뚱그린 메시지 대신
        // 구체적 사유를 준다(설계 M1, Tier 1). null 포트는 resolvedPort()가 5432로 해석하므로 통과한다.
        int port = input.resolvedPort();
        if (port < 1 || port > 65535) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PORT_OUT_OF_RANGE", "포트는 1~65535 범위여야 합니다.");
        }
        int maxPoolSize = input.resolvedMaxPoolSize();
        if (maxPoolSize < 1 || maxPoolSize > 50) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MAX_POOL_SIZE_OUT_OF_RANGE",
                    "커넥션 상한은 1~50 범위여야 합니다.");
        }
        if (requirePassword && blank(input.dbPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Password is required.");
        }
    }

    private String encrypt(String password) {
        return passwords.encrypt(password == null ? "" : password);
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

    private record ConnectionSettings(
            String host, int port, String databaseName, String dbUser, int maxPoolSize) {
    }
}
