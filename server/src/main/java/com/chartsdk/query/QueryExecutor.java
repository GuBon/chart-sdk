package com.chartsdk.query;

import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLTimeoutException;
import java.util.ArrayList;
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
            for (int i = 0; i < params.size(); i++) ps.setObject(i + 1, params.get(i));
            try (ResultSet rs = ps.executeQuery()) {
                return read(rs, start);
            }
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "SQL_ERROR", e.getMessage());
        }
    }

    /** 데이터소스 public 스키마 카탈로그 로딩(mc_ 테이블 제외) — 식별자 화이트리스트 검증용. */
    public SchemaCatalog catalog(long datasourceId) {
        Map<String, Map<String, String>> tables = new LinkedHashMap<>();
        try (Connection conn = pools.connection(datasourceId);
             PreparedStatement ps = conn.prepareStatement("""
                     SELECT table_name, column_name, data_type
                       FROM information_schema.columns
                      WHERE table_schema = 'public'
                        AND table_name NOT LIKE 'mc\\_%' ESCAPE '\\'
                      ORDER BY table_name, ordinal_position
                     """);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                tables.computeIfAbsent(rs.getString("table_name"), k -> new LinkedHashMap<>())
                        .put(rs.getString("column_name"), rs.getString("data_type"));
            }
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DATASOURCE_QUERY_FAILED", e.getMessage());
        }
        return new SchemaCatalog(tables);
    }

    private QueryRows read(ResultSet rs, long start) throws Exception {
        List<Map<String, Object>> columns = new ArrayList<>();
        int colCount = rs.getMetaData().getColumnCount();
        for (int i = 1; i <= colCount; i++) {
            columns.add(Map.of(
                    "name", rs.getMetaData().getColumnLabel(i),
                    "type", rs.getMetaData().getColumnTypeName(i)
            ));
        }
        List<List<Object>> rows = new ArrayList<>();
        while (rs.next()) {
            List<Object> row = new ArrayList<>();
            for (int i = 1; i <= colCount; i++) row.add(rs.getObject(i));
            rows.add(row);
        }
        // setMaxRows(MAX_ROWS)로 잘리면 정확히 MAX_ROWS 행 → 절단 가능성으로 표기.
        boolean truncated = rows.size() >= MAX_ROWS;
        long elapsedMs = Math.max(1, (System.nanoTime() - start) / 1_000_000);
        return new QueryRows(columns, rows, rows.size(), truncated, elapsedMs);
    }
}
