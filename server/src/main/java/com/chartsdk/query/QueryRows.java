package com.chartsdk.query;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public record QueryRows(
        List<Map<String, Object>> columns,
        List<List<Object>> rows,
        int rowCount,
        boolean truncated,
        long elapsedMs
) {
    /**
     * ResultSet 을 QueryRows 로 변환하는 단일 경로 — 모든 실행 엔진이 공유한다
     * (PG 직접 {@link QueryExecutor}·DuckDB 페더레이션 {@code DuckDbFederation}).
     * 행 수가 {@link QueryExecutor#MAX_ROWS} 이상이면 절단 가능성으로 표기하고 경과시간(ms)을 함께 계산한다.
     */
    public static QueryRows from(ResultSet rs, long startNanos) throws SQLException {
        ResultSetMetaData meta = rs.getMetaData();
        int colCount = meta.getColumnCount();
        List<Map<String, Object>> columns = new ArrayList<>();
        for (int i = 1; i <= colCount; i++) {
            columns.add(Map.of("name", meta.getColumnLabel(i), "type", meta.getColumnTypeName(i)));
        }
        List<List<Object>> rows = new ArrayList<>();
        while (rs.next()) {
            List<Object> row = new ArrayList<>();
            for (int i = 1; i <= colCount; i++) row.add(rs.getObject(i));
            rows.add(row);
        }
        boolean truncated = rows.size() >= QueryExecutor.MAX_ROWS;
        long elapsedMs = Math.max(1, (System.nanoTime() - startNanos) / 1_000_000);
        return new QueryRows(columns, rows, rows.size(), truncated, elapsedMs);
    }
}
