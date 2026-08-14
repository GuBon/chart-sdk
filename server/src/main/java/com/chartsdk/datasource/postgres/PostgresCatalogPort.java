package com.chartsdk.datasource.postgres;

import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.datasource.spi.CatalogPort;
import com.chartsdk.query.AdmissionController;
import com.chartsdk.query.QueryTimeoutPolicy;
import com.chartsdk.query.RelationType;
import com.chartsdk.query.SchemaCatalog;
import com.chartsdk.web.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLTimeoutException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * PostgreSQL 카탈로그 로더 — {@code pg_catalog} 질의로 식별자 화이트리스트 재료를 읽는다.
 * PostgreSQL 시스템 카탈로그 규약은 이 클래스(와 아래 프로브 SQL 상수)에만 존재한다.
 *
 * <p>시스템 스키마와 mc_ 내부 테이블은 로딩 단계에서 제외한다(노코드 SQL생성규칙 §9). 고객 DB가
 * public 외 사용자 스키마(예: tandanji)에 업무 테이블을 두어도 모두 노출한다 — search_path 가정
 * 없이 스키마를 식별자로 한정한다(§1.2).
 */
@Component
public class PostgresCatalogPort implements CatalogPort {

    /**
     * 관계 종류·행수 추정 프로브(표본 계획용). {@code SamplingPlanner}가 이 SQL을 단일 실행 경로
     * ({@code QueryExecutor.execute})로 흘린다 — PG 카탈로그 규약 텍스트만 여기로 격리한다.
     */
    public static final String RELATION_STATS_SQL = """
            SELECT c.relkind::text, GREATEST(c.reltuples, 0)::bigint
              FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = ? AND c.relname = ?
            """;

    /** 정수형 단일 PK 프로브(INDEX_RANDOM 표본 계획용). */
    public static final String SINGLE_INTEGER_PK_SQL = """
            SELECT a.attname
              FROM pg_catalog.pg_index i
              JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
              JOIN pg_catalog.pg_type ty ON ty.oid = a.atttypid
             WHERE i.indisprimary AND i.indnkeyatts = 1
               AND n.nspname = ? AND c.relname = ?
               AND ty.typname IN ('int2', 'int4', 'int8')
            """;

    private final DatasourcePoolRegistry pools;
    private final AdmissionController coordinator;
    private final QueryTimeoutPolicy timeouts;

    /** 레거시/테스트 호환 — admission 없이 직접 로딩한다. */
    public PostgresCatalogPort(DatasourcePoolRegistry pools) {
        this(pools, null, QueryTimeoutPolicy.defaults());
    }

    @Autowired
    public PostgresCatalogPort(DatasourcePoolRegistry pools, AdmissionController coordinator,
                               QueryTimeoutPolicy timeouts) {
        this.pools = pools;
        this.coordinator = coordinator;
        this.timeouts = timeouts;
    }

    @Override
    public SchemaCatalog load(long datasourceId) {
        if (coordinator == null) return loadAdmitted(datasourceId);
        try {
            return coordinator.execute(datasourceId, AdmissionController.Kind.CATALOG,
                    () -> loadAdmitted(datasourceId));
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Catalog query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATASOURCE_QUERY_FAILED",
                    "데이터소스 스키마를 조회하지 못했습니다.", e);
        }
    }

    private SchemaCatalog loadAdmitted(long datasourceId) {
        Map<SchemaCatalog.Key, Map<String, String>> tables = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, RelationType> relationTypes = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, Long> estimates = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, Boolean> populated = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, String> relationDisplayNames = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, Map<String, String>> columnDisplayNames = new LinkedHashMap<>();
        try (Connection conn = pools.connection(datasourceId)) {
            try (PreparedStatement ps = conn.prepareStatement("""
                     SELECT n.nspname AS table_schema,
                            c.relname AS table_name,
                            c.relkind::text AS relkind,
                            CASE WHEN c.relkind IN ('r', 'p', 'm')
                                 THEN GREATEST(c.reltuples, 0)::bigint END AS estimated_rows,
                            c.relispopulated,
                            a.attname AS column_name,
                            pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                            NULLIF(btrim(pg_catalog.obj_description(c.oid, 'pg_class')), '') AS relation_display_name,
                            NULLIF(btrim(pg_catalog.col_description(c.oid, a.attnum)), '') AS column_display_name
                       FROM pg_catalog.pg_class c
                       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                       JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
                      WHERE c.relkind IN ('r', 'p', 'v', 'm')
                        AND a.attnum > 0
                        AND NOT a.attisdropped
                        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                        AND n.nspname NOT LIKE 'pg_temp%'
                        AND n.nspname NOT LIKE 'pg_toast_temp%'
                        AND c.relname NOT LIKE 'mc\\_%' ESCAPE '\\'
                        AND (has_table_privilege(c.oid, 'SELECT')
                             OR has_column_privilege(c.oid, a.attname, 'SELECT'))
                      ORDER BY n.nspname, c.relname, a.attnum
                     """)) {
                ps.setQueryTimeout(timeouts.seconds(AdmissionController.Kind.CATALOG));
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        SchemaCatalog.Key key = new SchemaCatalog.Key(
                                rs.getString("table_schema"), rs.getString("table_name"));
                        tables.computeIfAbsent(key, k -> new LinkedHashMap<>())
                                .put(rs.getString("column_name"), rs.getString("data_type"));
                        relationTypes.putIfAbsent(key, RelationType.fromRelkind(rs.getString("relkind")));
                        Object estimatedRows = rs.getObject("estimated_rows");
                        if (estimatedRows instanceof Number n) estimates.putIfAbsent(key, n.longValue());
                        populated.putIfAbsent(key, rs.getBoolean("relispopulated"));
                        String relationDisplayName = rs.getString("relation_display_name");
                        if (relationDisplayName != null) {
                            relationDisplayNames.putIfAbsent(key, relationDisplayName);
                        }
                        String columnDisplayName = rs.getString("column_display_name");
                        if (columnDisplayName != null) {
                            columnDisplayNames.computeIfAbsent(key, ignored -> new LinkedHashMap<>())
                                    .put(rs.getString("column_name"), columnDisplayName);
                        }
                    }
                }
            }
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Catalog query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATASOURCE_QUERY_FAILED",
                    "데이터소스 스키마를 조회하지 못했습니다.", e);
        }
        return new SchemaCatalog(
                tables,
                relationTypes,
                estimates,
                populated,
                relationDisplayNames,
                columnDisplayNames
        );
    }
}
