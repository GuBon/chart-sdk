package com.chartsdk.federation;

import com.chartsdk.datasource.DatasourceCredentials;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.query.FederatedCatalog;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SchemaCatalog;
import com.chartsdk.query.SqlIdentifier;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 다중 소스 페더레이션 실행 엔진(설계 §3). per-op 무상태: DuckDB in-memory 연결을 열어 필요한 데이터소스를
 * read-only ATTACH 하고 페더레이션 SQL 을 1회 실행한 뒤 닫는다. 계산 경로(저장/새로고침/미리보기)에서만 호출된다.
 *
 * <p>가드: read-only ATTACH · 쿼리 타임아웃 · 메모리 상한 · (SQL 말미) LIMIT 1000. 자격증명은
 * libpq+SQL 이중 이스케이프로 안전 삽입하고, 로그에는 {@link #maskedAttachSql}(비밀번호 마스킹)만 남긴다(§10).
 */
@Component
public class DuckDbFederation {

    static final int QUERY_TIMEOUT_SECONDS = 30; // 저빈도 계산 — 단일 소스(10s)보다 여유
    static final String MEMORY_LIMIT = "1GB";
    static final int THREADS = 4;

    private final DatasourceService datasources;
    private final QueryExecutor queryExecutor;

    public DuckDbFederation(DatasourceService datasources, QueryExecutor queryExecutor) {
        this.datasources = datasources;
        this.queryExecutor = queryExecutor;
    }

    /** 참조 소스들의 카탈로그를 union 해 식별자 화이트리스트를 만든다(각 소스 mc_·시스템 스키마 제외 유지). */
    public FederatedCatalog catalog(Collection<Long> datasourceIds) {
        Map<Long, SchemaCatalog> bySource = new LinkedHashMap<>();
        for (Long id : datasourceIds) bySource.put(id, queryExecutor.catalog(id));
        return new FederatedCatalog(bySource);
    }

    /** 파라미터 없는 페더레이션 실행(저장된 리터럴 SQL 경로). */
    public QueryRows execute(Collection<Long> datasourceIds, String federatedSql) {
        return execute(datasourceIds, federatedSql, List.of());
    }

    /**
     * 페더레이션 SQL 을 실행해 rows 를 돌려준다. datasourceIds 를 {@code ds{id}} 별칭으로 read-only ATTACH 한 뒤
     * WHERE 바인딩({@code ?})은 PreparedStatement 로 넘긴다(노코드 빌더 경로). ATTACH 는 바인딩 불가라 Statement 로 선행.
     */
    public QueryRows execute(Collection<Long> datasourceIds, String federatedSql, List<Object> params) {
        long start = System.nanoTime();
        try (Connection conn = DriverManager.getConnection("jdbc:duckdb:")) {
            try (Statement st = conn.createStatement()) {
                st.execute("INSTALL postgres"); // 번들 시 로컬 no-op, 미번들 dev 는 최초 1회만 캐시 다운로드
                st.execute("LOAD postgres");
                for (Long id : datasourceIds) {
                    st.execute(attachSql(id, datasources.credentials(id)));
                }
                st.execute("SET memory_limit='" + MEMORY_LIMIT + "'");
                st.execute("SET threads TO " + THREADS);
            }
            try (PreparedStatement ps = conn.prepareStatement(federatedSql)) {
                ps.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
                for (int i = 0; i < params.size(); i++) ps.setObject(i + 1, params.get(i));
                try (ResultSet rs = ps.executeQuery()) {
                    return read(rs, start);
                }
            }
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Federated query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (SQLException e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "FEDERATION_ERROR", firstLine(e.getMessage()));
        }
    }

    // ── ATTACH SQL (자격증명 이스케이프) ──────────────────────
    /** read-only ATTACH SQL. 별칭 규약은 {@link RefRenderer#attachAlias}(ds{id})와 일치한다. */
    static String attachSql(long datasourceId, DatasourceCredentials c) {
        String alias = RefRenderer.attachAlias(datasourceId);
        return "ATTACH " + sqlLiteral(connString(c)) + " AS " + SqlIdentifier.quote(alias) + " (TYPE postgres, READ_ONLY)";
    }

    /** 로깅용 — 비밀번호를 마스킹한 ATTACH SQL(§10). */
    static String maskedAttachSql(long datasourceId, DatasourceCredentials c) {
        DatasourceCredentials masked = new DatasourceCredentials(
                c.host(), c.port(), c.databaseName(), c.dbUser(), "****", c.maxPoolSize());
        return attachSql(datasourceId, masked);
    }

    private static String connString(DatasourceCredentials c) {
        return "dbname=" + libpq(c.databaseName())
                + " host=" + libpq(c.host())
                + " port=" + c.port()
                + " user=" + libpq(c.dbUser())
                + " password=" + libpq(c.dbPassword());
    }

    /** libpq 값 — 단일따옴표로 감싸고 백슬래시·단일따옴표를 이스케이프(공백·특수문자 안전). */
    private static String libpq(String v) {
        String s = v == null ? "" : v;
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    /** DuckDB SQL 문자열 리터럴 — 단일따옴표를 '' 로 이스케이프. */
    private static String sqlLiteral(String s) {
        return "'" + s.replace("'", "''") + "'";
    }

    private QueryRows read(ResultSet rs, long start) throws SQLException {
        List<Map<String, Object>> columns = new ArrayList<>();
        int colCount = rs.getMetaData().getColumnCount();
        for (int i = 1; i <= colCount; i++) {
            columns.add(Map.of(
                    "name", rs.getMetaData().getColumnLabel(i),
                    "type", rs.getMetaData().getColumnTypeName(i)));
        }
        List<List<Object>> rows = new ArrayList<>();
        while (rs.next()) {
            List<Object> row = new ArrayList<>();
            for (int i = 1; i <= colCount; i++) row.add(rs.getObject(i));
            rows.add(row);
        }
        boolean truncated = rows.size() >= QueryExecutor.MAX_ROWS;
        long elapsedMs = Math.max(1, (System.nanoTime() - start) / 1_000_000);
        return new QueryRows(columns, rows, rows.size(), truncated, elapsedMs);
    }

    private static String firstLine(String s) {
        return s == null ? "" : s.split("\n", 2)[0];
    }
}
