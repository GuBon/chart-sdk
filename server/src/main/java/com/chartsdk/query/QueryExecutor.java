package com.chartsdk.query;

import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLTimeoutException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 모든 고객 DB 조회의 단일 실행 경로. 읽기 전용·타임아웃·행 제한 정책·에러코드 매핑을 한 곳에서 강제한다
 * (노코드 빌더·raw SQL·스키마 미리보기가 공유 — 별도 실행 경로를 만들지 않는다, 노코드 SQL생성규칙 §1.1).
 * 데이터 미리보기·검증 조회는 기본 1,000행으로 제한한다. 실제 차트 계산은 전체 결과가 렌더 계약이므로
 * 차트 계산은 {@link #executeChart(long, String, List)}의 별도 안전 상한을 사용한다.
 */
@Service
public class QueryExecutor {
    private static final int QUERY_TIMEOUT_SECONDS = 10;
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final int MAX_ROWS = 1000;
    /** Hard safety ceiling for complete chart datasets kept in the application heap. */
    public static final int MAX_CHART_ROWS = 50_000;
    private static final long CATALOG_TTL_NANOS = TimeUnit.SECONDS.toNanos(30);

    private final DatasourcePoolRegistry pools;
    private final ConcurrentHashMap<Long, CachedCatalog> catalogs = new ConcurrentHashMap<>();

    private record CachedCatalog(SchemaCatalog value, long expiresAtNanos) {
        boolean valid(long now) {
            return now < expiresAtNanos;
        }
    }

    public QueryExecutor(DatasourcePoolRegistry pools) {
        this.pools = pools;
    }

    public QueryRows execute(long datasourceId, String sql) {
        return execute(datasourceId, sql, List.of());
    }

    /** PreparedStatement 바인딩 실행(노코드 빌더 경로). params 가 비면 정적 실행과 동일. */
    public QueryRows execute(long datasourceId, String sql, List<Object> params) {
        return execute(datasourceId, sql, params, MAX_ROWS, null);
    }

    /**
     * Executes a chart query with one sentinel row beyond the supported result size. This keeps
     * normal chart results complete while rejecting accidental full-table payloads before they
     * can consume unbounded heap in conversion, caching, and JSON serialization.
     */
    public QueryRows executeChart(long datasourceId, String sql, List<Object> params) {
        return enforceChartResultLimit(
                execute(datasourceId, sql, params, MAX_CHART_ROWS + 1, null));
    }

    /** 동일 연결에서 seed를 먼저 설정한 뒤 Bernoulli 표본 SQL을 실행한다. */
    public QueryRows executeBernoulli(long datasourceId, String sql, List<Object> params,
                                      boolean chartResult, long seed) {
        QueryRows rows = execute(datasourceId, sql, params,
                chartResult ? MAX_CHART_ROWS + 1 : MAX_ROWS, seed);
        return chartResult ? enforceChartResultLimit(rows) : rows;
    }

    public static QueryRows enforceChartResultLimit(QueryRows rows) {
        if (rows.rowCount() <= MAX_CHART_ROWS) return rows;
        throw new ApiException(
                HttpStatus.PAYLOAD_TOO_LARGE,
                "RESULT_TOO_LARGE",
                "Chart result exceeds " + MAX_CHART_ROWS
                        + " rows. Aggregate the data, enable sampling, or add a LIMIT."
        );
    }

    /** EXPLAIN JSON 최상위 Plan Rows. 쿼리를 실행하지 않고 JOIN+WHERE 결과 행 수를 추정한다. */
    public long explainEstimatedRows(long datasourceId, String sql, List<Object> params) {
        QueryRows explained = execute(datasourceId, "EXPLAIN (FORMAT JSON) " + sql, params, MAX_ROWS, null);
        if (explained.rows().isEmpty() || explained.rows().get(0).isEmpty()) return 0;
        try {
            JsonNode root = JSON.readTree(String.valueOf(explained.rows().get(0).get(0)));
            return Math.max(0, root.path(0).path("Plan").path("Plan Rows").asLong(0));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private QueryRows execute(long datasourceId, String sql, List<Object> params, int maxRows, Long bernoulliSeed) {
        long start = System.nanoTime();
        try (Connection conn = pools.connection(datasourceId)) {
            if (bernoulliSeed != null) setRandomSeed(conn, bernoulliSeed);
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
                ps.setMaxRows(maxRows);
                for (int i = 0; i < params.size(); i++) {
                    Object p = params.get(i);
                    if (p instanceof long[] keys) {
                        // 인덱스 표본 좌표 배열 — unnest(?) 로 바인딩(setObject 미지원, §표본추출).
                        Long[] boxed = new Long[keys.length];
                        for (int k = 0; k < keys.length; k++) boxed[k] = keys[k];
                        ps.setArray(i + 1, conn.createArrayOf("bigint", boxed));
                    } else {
                        ps.setObject(i + 1, p);
                    }
                }
                try (ResultSet rs = ps.executeQuery()) {
                    return QueryRows.from(rs, start, maxRows);
                }
            }
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "SQL_ERROR", e.getMessage());
        }
    }

    private static void setRandomSeed(Connection connection, long seed) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("SELECT setseed(?)")) {
            statement.setDouble(1, SamplingSeed.unit(seed));
            statement.execute();
        }
    }

    /**
     * 데이터소스 카탈로그 로딩 — 식별자 화이트리스트 검증용. 시스템 스키마와 mc_ 내부 테이블은 제외한다
     * (노코드 SQL생성규칙 §9). 고객 DB가 public 외 사용자 스키마(예: tandanji)에 업무 테이블을 두어도
     * 모두 노출한다 — search_path 가정 없이 스키마를 식별자로 한정한다(§1.2).
     */
    public SchemaCatalog catalog(long datasourceId) {
        long now = System.nanoTime();
        CachedCatalog cached = catalogs.get(datasourceId);
        if (cached != null && cached.valid(now)) return cached.value();
        return catalogs.compute(datasourceId, (id, current) -> {
            long checkedAt = System.nanoTime();
            if (current != null && current.valid(checkedAt)) return current;
            return new CachedCatalog(loadCatalog(id), checkedAt + CATALOG_TTL_NANOS);
        }).value();
    }

    /** Allows datasource-management flows to make metadata changes visible immediately. */
    public void invalidateCatalog(long datasourceId) {
        catalogs.remove(datasourceId);
    }

    private SchemaCatalog loadCatalog(long datasourceId) {
        Map<SchemaCatalog.Key, Map<String, String>> tables = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, RelationType> relationTypes = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, Long> estimates = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, Boolean> populated = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, String> relationDisplayNames = new LinkedHashMap<>();
        Map<SchemaCatalog.Key, Map<String, String>> columnDisplayNames = new LinkedHashMap<>();
        try (Connection conn = pools.connection(datasourceId);
             PreparedStatement ps = conn.prepareStatement("""
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
                     """);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                SchemaCatalog.Key key = new SchemaCatalog.Key(rs.getString("table_schema"), rs.getString("table_name"));
                tables.computeIfAbsent(key, k -> new LinkedHashMap<>())
                        .put(rs.getString("column_name"), rs.getString("data_type"));
                relationTypes.putIfAbsent(key, RelationType.fromRelkind(rs.getString("relkind")));
                Object estimatedRows = rs.getObject("estimated_rows");
                if (estimatedRows instanceof Number n) estimates.putIfAbsent(key, n.longValue());
                populated.putIfAbsent(key, rs.getBoolean("relispopulated"));
                String relationDisplayName = rs.getString("relation_display_name");
                if (relationDisplayName != null) relationDisplayNames.putIfAbsent(key, relationDisplayName);
                String columnDisplayName = rs.getString("column_display_name");
                if (columnDisplayName != null) {
                    columnDisplayNames.computeIfAbsent(key, ignored -> new LinkedHashMap<>())
                            .put(rs.getString("column_name"), columnDisplayName);
                }
            }
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATASOURCE_QUERY_FAILED", e.getMessage());
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

    /**
     * PostgreSQL planner 통계(pg_class.reltuples) 기반 테이블 행 수 추정치.
     * 정확한 COUNT(*)를 실행하지 않아 스키마 탐색·표본 계획·UI 안내가 대용량 테이블을 다시 스캔하지 않는다.
     */
    public Map<SchemaCatalog.Key, Long> estimatedRowCounts(long datasourceId) {
        return catalog(datasourceId).estimatedRowCounts();
    }
}
