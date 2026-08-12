package com.chartsdk.datasource.postgres;

import com.chartsdk.datasource.DatasourceCredentials;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.datasource.spi.DuckDbBinding;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SqlIdentifier;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * PostgreSQL 소스의 DuckDB ATTACH 규약 — libpq 접속 문자열·postgres 확장·자격증명 이스케이프는
 * 이 클래스에만 존재한다. 자격증명은 libpq+SQL 이중 이스케이프로 안전 삽입하고, 로깅에는
 * 비밀번호를 마스킹한 문장만 제공한다(연합조회 설계 §10).
 */
@Component
public class PostgresDuckDbBinding implements DuckDbBinding {

    private final DatasourceService datasources;

    public PostgresDuckDbBinding(DatasourceService datasources) {
        this.datasources = datasources;
    }

    @Override
    public List<String> sessionInitSql() {
        // INSTALL 은 번들 시 로컬 no-op, 미번들 dev 는 최초 1회만 캐시 다운로드.
        return List.of("INSTALL postgres", "LOAD postgres");
    }

    @Override
    public AttachStatement attach(long datasourceId) {
        DatasourceCredentials credentials = datasources.credentials(datasourceId);
        return new AttachStatement(
                attachSql(datasourceId, credentials),
                maskedAttachSql(datasourceId, credentials));
    }

    /** read-only ATTACH SQL. 별칭 규약은 {@link RefRenderer#attachAlias}(ds{id})와 일치한다. */
    public static String attachSql(long datasourceId, DatasourceCredentials c) {
        String alias = RefRenderer.attachAlias(datasourceId);
        return "ATTACH " + sqlLiteral(connString(c)) + " AS " + SqlIdentifier.quote(alias) + " (TYPE postgres, READ_ONLY)";
    }

    /** 로깅용 — 비밀번호를 마스킹한 ATTACH SQL(§10). */
    public static String maskedAttachSql(long datasourceId, DatasourceCredentials c) {
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
}
