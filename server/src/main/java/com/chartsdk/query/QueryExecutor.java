package com.chartsdk.query;

import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLTimeoutException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 모든 고객 DB 조회의 단일 실행 경로. 읽기 전용·타임아웃·행 제한·에러코드 매핑을 한 곳에서 강제한다
 * (노코드 빌더·raw SQL·스키마 미리보기가 공유 — 별도 실행 경로를 만들지 않는다, 노코드 SQL생성규칙 §1.1).
 */
@Service
public class QueryExecutor {
    private static final int QUERY_TIMEOUT_SECONDS = 10;
    public static final int MAX_ROWS = 1000;

    private final DatasourcePoolRegistry pools;

    public QueryExecutor(DatasourcePoolRegistry pools) {
        this.pools = pools;
    }

    public QueryRows execute(long datasourceId, String sql) {
        return execute(datasourceId, sql, List.of());
    }

    /** PreparedStatement 바인딩 실행(노코드 빌더 경로). params 가 비면 정적 실행과 동일. */
    public QueryRows execute(long datasourceId, String sql, List<Object> params) {
        long start = System.nanoTime();
        try (Connection conn = pools.connection(datasourceId);
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
            ps.setMaxRows(MAX_ROWS);
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
                return QueryRows.from(rs, start);
            }
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "SQL_ERROR", e.getMessage());
        }
    }

    /**
     * 데이터소스 카탈로그 로딩 — 식별자 화이트리스트 검증용. 시스템 스키마와 mc_ 내부 테이블은 제외한다
     * (노코드 SQL생성규칙 §9). 고객 DB가 public 외 사용자 스키마(예: tandanji)에 업무 테이블을 두어도
     * 모두 노출한다 — search_path 가정 없이 스키마를 식별자로 한정한다(§1.2).
     */
    public SchemaCatalog catalog(long datasourceId) {
        Map<SchemaCatalog.Key, Map<String, String>> tables = new LinkedHashMap<>();
        try (Connection conn = pools.connection(datasourceId);
             PreparedStatement ps = conn.prepareStatement("""
                     SELECT table_schema, table_name, column_name, data_type
                       FROM information_schema.columns
                      WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                        AND table_schema NOT LIKE 'pg_temp%'
                        AND table_schema NOT LIKE 'pg_toast_temp%'
                        AND table_name NOT LIKE 'mc\\_%' ESCAPE '\\'
                      ORDER BY table_schema, table_name, ordinal_position
                     """);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                SchemaCatalog.Key key = new SchemaCatalog.Key(rs.getString("table_schema"), rs.getString("table_name"));
                tables.computeIfAbsent(key, k -> new LinkedHashMap<>())
                        .put(rs.getString("column_name"), rs.getString("data_type"));
            }
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATASOURCE_QUERY_FAILED", e.getMessage());
        }
        return new SchemaCatalog(tables);
    }

    /**
     * PostgreSQL planner 통계(pg_class.reltuples) 기반 테이블 행 수 추정치.
     * 정확한 COUNT(*)를 실행하지 않아 스키마 탐색·표본 계획·UI 안내가 대용량 테이블을 다시 스캔하지 않는다.
     */
    public Map<SchemaCatalog.Key, Long> estimatedRowCounts(long datasourceId) {
        Map<SchemaCatalog.Key, Long> estimates = new LinkedHashMap<>();
        try (Connection conn = pools.connection(datasourceId);
             PreparedStatement ps = conn.prepareStatement("""
                     SELECT n.nspname AS table_schema,
                            c.relname AS table_name,
                            GREATEST(c.reltuples, 0)::bigint AS estimated_rows
                       FROM pg_catalog.pg_class c
                       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                      WHERE c.relkind IN ('r', 'p', 'm')
                        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                        AND n.nspname NOT LIKE 'pg_temp%'
                        AND n.nspname NOT LIKE 'pg_toast_temp%'
                        AND c.relname NOT LIKE 'mc\\_%' ESCAPE '\\'
                     """);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                estimates.put(new SchemaCatalog.Key(rs.getString("table_schema"), rs.getString("table_name")),
                        rs.getLong("estimated_rows"));
            }
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATASOURCE_QUERY_FAILED", e.getMessage());
        }
        return estimates;
    }
}
