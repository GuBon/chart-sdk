package com.chartsdk.web;

import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.SchemaCatalog;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class QueryController {
    private final QueryExecutor queries;
    private final ChartOptionConverter converter;

    public QueryController(QueryExecutor queries, ChartOptionConverter converter) {
        this.queries = queries;
        this.converter = converter;
    }

    /** raw SQL 실행 (S2 SQL 탭). SELECT 검증 → 읽기전용·타임아웃·행제한 실행 (QueryExecutor 공유). */
    @PostMapping("/query/run")
    public Map<String, Object> run(@RequestBody Map<String, Object> body) {
        long datasourceId = number(body.get("datasourceId"));
        String sql = String.valueOf(body.getOrDefault("sql", "")).trim();
        assertSelectOnly(sql);
        QueryRows rows = queries.execute(datasourceId, sql);
        Map<String, Object> result = rowsResult(rows);
        String chartType = str(body.get("chartType"));
        if (chartType != null) {
            result.put("option", converter.convert(rows, chartType, options(body)));
        }
        return result;
    }

    /** 노코드 미리보기 실행 (S2 [실행]/[원본 데이터]). builderConfig 검증 → SQL 생성 → 실행. */
    @PostMapping("/query/run-builder")
    public Map<String, Object> runBuilder(@RequestBody Map<String, Object> body) {
        long datasourceId = number(body.get("datasourceId"));
        String chartType = String.valueOf(body.getOrDefault("chartType", "bar"));
        String mode = String.valueOf(body.getOrDefault("mode", "aggregate"));
        boolean rawMode = "rows".equals(mode);
        @SuppressWarnings("unchecked")
        Map<String, Object> cfg = (Map<String, Object>) body.get("builderConfig");
        if (cfg == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "builderConfig is required.");
        }
        SchemaCatalog catalog = queries.catalog(datasourceId);
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, cfg, chartType, rawMode);
        QueryRows rows = queries.execute(datasourceId, sql.text(), sql.params());

        Map<String, Object> result = rowsResult(rows);
        if (!rawMode) {
            result.put("generatedSql", sql.text());
            result.put("option", converter.convert(rows, chartType, options(body)));
            if (cfg.get("sample") instanceof Map<?, ?> sample) {
                result.put("approximate", true);
                result.put("sampleRate", sample.get("rate"));
            }
        }
        return result;
    }

    /** 옵션만 재조립 (SQL 미실행, S2 옵션 변경). */
    @PostMapping("/charts/preview")
    public Map<String, Object> preview(@RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        Map<String, Object> rows = (Map<String, Object>) body.get("rows");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> columns = (List<Map<String, Object>>) rows.get("columns");
        @SuppressWarnings("unchecked")
        List<List<Object>> data = (List<List<Object>>) rows.get("rows");
        QueryRows qr = new QueryRows(columns, data, data.size(), false, 0);
        return Map.of("option", converter.convert(qr, String.valueOf(body.getOrDefault("chartType", "bar")), options(body)));
    }

    private static Map<String, Object> rowsResult(QueryRows rows) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("columns", rows.columns());
        result.put("rows", rows.rows());
        result.put("rowCount", rows.rowCount());
        result.put("truncated", rows.truncated());
        result.put("elapsedMs", rows.elapsedMs());
        return result;
    }

    private static void assertSelectOnly(String sql) {
        String lower = sql.toLowerCase(Locale.ROOT).strip();
        if (lower.isEmpty() || !(lower.startsWith("select") || lower.startsWith("with"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SQL_NOT_SELECT", "Only SELECT statements are allowed.");
        }
        // 다중 문장 차단 (끝의 세미콜론 1개는 허용)
        String body = lower.endsWith(";") ? lower.substring(0, lower.length() - 1) : lower;
        if (body.contains(";")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SQL_NOT_SELECT", "Multiple statements are not allowed.");
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> options(Map<String, Object> body) {
        Object o = body.getOrDefault("options", Map.of());
        return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }

    private static long number(Object value) {
        if (value instanceof Number n) return n.longValue();
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "datasourceId is required.");
    }

    private static String str(Object value) {
        if (value == null) return null;
        String s = String.valueOf(value);
        return s.isBlank() ? null : s;
    }
}
