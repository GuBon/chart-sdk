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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.sql.Statement;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 다중 소스 페더레이션 실행 엔진(설계 §3). per-op 무상태: DuckDB in-memory 연결을 열어 필요한 데이터소스를
 * read-only ATTACH 하고 페더레이션 SQL 을 1회 실행한 뒤 닫는다. 계산 경로(저장/새로고침/미리보기)에서만 호출된다.
 *
 * <p>가드: read-only ATTACH · 쿼리 타임아웃 · 메모리 상한. 미리보기는 행 수를 제한하고 실제 차트는 전체 결과를 반환한다.
 * 지도 포인트 빌더는 WHERE 범위의 좌표를 전량 반환하므로 최종 LIMIT만 적용하지 않는다. 자격증명은
 * libpq+SQL 이중 이스케이프로 안전 삽입하고, 로그에는 {@link #maskedAttachSql}(비밀번호 마스킹)만 남긴다(§10).
 */
@Component
public class DuckDbFederation {

    private static final Logger log = LoggerFactory.getLogger(DuckDbFederation.class);

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
        return execute(datasourceIds, federatedSql, params, QueryExecutor.MAX_ROWS);
    }

    /** 지도 포인트 빌더처럼 SQL 자체에 결과 LIMIT이 없는 페더레이션 실행용. */
    public QueryRows executeUnbounded(Collection<Long> datasourceIds, String federatedSql, List<Object> params) {
        return execute(datasourceIds, federatedSql, params, 0);
    }

    private QueryRows execute(Collection<Long> datasourceIds, String federatedSql, List<Object> params, int maxRows) {
        long start = System.nanoTime();
        boolean repeatableReservoir = federatedSql.contains("USING SAMPLE reservoir(");
        try (Connection conn = DriverManager.getConnection("jdbc:duckdb:")) {
            try (Statement st = conn.createStatement()) {
                st.execute("INSTALL postgres"); // 번들 시 로컬 no-op, 미번들 dev 는 최초 1회만 캐시 다운로드
                st.execute("LOAD postgres");
                for (Long id : datasourceIds) {
                    DatasourceCredentials c = datasources.credentials(id);
                    if (log.isDebugEnabled()) log.debug("federation ATTACH: {}", maskedAttachSql(id, c)); // 비밀번호 마스킹(§10)
                    st.execute(attachSql(id, c));
                }
                st.execute("SET memory_limit='" + MEMORY_LIMIT + "'");
                // DuckDB의 REPEATABLE reservoir는 단일 스레드에서만 같은 seed 재현을 보장한다.
                st.execute("SET threads TO " + (repeatableReservoir ? 1 : THREADS));
            }
            try (PreparedStatement ps = conn.prepareStatement(federatedSql)) {
                ps.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
                for (int i = 0; i < params.size(); i++) ps.setObject(i + 1, params.get(i));
                try (ResultSet rs = ps.executeQuery()) {
                    return QueryRows.from(rs, start, maxRows);
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

    private static String firstLine(String s) {
        return s == null ? "" : s.split("\n", 2)[0];
    }
}
