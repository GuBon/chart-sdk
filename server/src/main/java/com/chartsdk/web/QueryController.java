package com.chartsdk.web;

import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.SqlLiterals;
import com.chartsdk.web.dto.BuilderQueryRequest;
import com.chartsdk.web.dto.ChartPreviewRequest;
import com.chartsdk.web.dto.QueryRunRequest;
import jakarta.validation.Valid;
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
    private final FederatedQueryRunner runner;

    public QueryController(QueryExecutor queries, ChartOptionConverter converter, FederatedQueryRunner runner) {
        this.queries = queries;
        this.converter = converter;
        this.runner = runner;
    }

    @PostMapping("/query/run")
    public Map<String, Object> run(@Valid @RequestBody QueryRunRequest body) {
        String sql = body.sql().trim();
        assertSelectOnly(sql);
        QueryRows rows = queries.execute(body.datasourceId(), sql);
        Map<String, Object> result = rowsResult(rows);
        String chartType = str(body.chartType());
        if (chartType != null) {
            result.put("option", converter.convert(rows, chartType, options(body)));
        }
        return result;
    }

    @PostMapping("/query/run-builder")
    public Map<String, Object> runBuilder(@Valid @RequestBody BuilderQueryRequest body) {
        String chartType = body.chartType() == null ? "bar" : body.chartType();
        String mode = body.mode() == null ? "aggregate" : body.mode();
        boolean rawMode = "rows".equals(mode);
        Map<String, Object> cfg = body.builderConfig();
        FederatedQueryRunner.BuiltResult built = runner.runBuilder(body.datasourceId(), cfg, chartType, rawMode);
        QueryRows rows = built.rows();

        Map<String, Object> result = rowsResult(rows);
        if (!rawMode) {
            result.put("generatedSql", SqlLiterals.inline(built.sql().text(), built.sql().params()));
            result.put("option", converter.convert(rows, chartType, options(body)));
            if (cfg.get("sample") instanceof Map<?, ?> sample) {
                result.put("approximate", true);
                result.put("sampleRate", sample.get("rate"));
            }
        }
        return result;
    }

    @PostMapping("/charts/preview")
    public Map<String, Object> preview(@Valid @RequestBody ChartPreviewRequest body) {
        Map<String, Object> rows = body.rows();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> columns = (List<Map<String, Object>>) rows.get("columns");
        @SuppressWarnings("unchecked")
        List<List<Object>> data = (List<List<Object>>) rows.get("rows");
        QueryRows qr = new QueryRows(columns, data, data.size(), false, 0);
        String chartType = body.chartType() == null ? "bar" : body.chartType();
        return Map.of("option", converter.convert(qr, chartType, options(body)));
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
        String body = lower.endsWith(";") ? lower.substring(0, lower.length() - 1) : lower;
        if (body.contains(";")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SQL_NOT_SELECT", "Multiple statements are not allowed.");
        }
    }

    private static Map<String, Object> options(QueryRunRequest body) {
        return body.options() == null ? Map.of() : body.options();
    }

    private static Map<String, Object> options(BuilderQueryRequest body) {
        return body.options() == null ? Map.of() : body.options();
    }

    private static Map<String, Object> options(ChartPreviewRequest body) {
        return body.options() == null ? Map.of() : body.options();
    }

    private static String str(Object value) {
        if (value == null) return null;
        String s = String.valueOf(value);
        return s.isBlank() ? null : s;
    }
}
