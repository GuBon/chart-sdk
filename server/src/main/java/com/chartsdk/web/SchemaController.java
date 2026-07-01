package com.chartsdk.web;

import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.SchemaCatalog;
import com.chartsdk.query.SqlIdentifier;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/schema")
public class SchemaController {
    private final QueryExecutor queries;

    public SchemaController(QueryExecutor queries) {
        this.queries = queries;
    }

    @GetMapping("/tables")
    public Map<String, Object> tables(@RequestParam long datasourceId) {
        SchemaCatalog catalog = queries.catalog(datasourceId);
        List<Map<String, Object>> tables = new ArrayList<>();
        catalog.byTable().forEach((key, cols) -> {
            List<Map<String, Object>> columns = new ArrayList<>();
            cols.forEach((name, type) -> columns.add(Map.of("name", name, "type", type)));
            tables.add(Map.of("schema", key.schema(), "name", key.table(), "columns", columns));
        });
        return Map.of("tables", tables);
    }

    @GetMapping("/tables/{tableName}/preview")
    public Map<String, Object> preview(@PathVariable String tableName,
                                       @RequestParam(required = false) String schema,
                                       @RequestParam long datasourceId) {
        SchemaCatalog catalog = queries.catalog(datasourceId);
        String resolvedSchema = (schema == null || schema.isBlank()) ? SchemaCatalog.DEFAULT_SCHEMA : schema;
        if (!catalog.hasTable(resolvedSchema, tableName)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Unknown table: " + tableName);
        }
        QueryRows rows = queries.execute(datasourceId,
                "SELECT * FROM " + SqlIdentifier.qualify(resolvedSchema, tableName) + " LIMIT " + QueryExecutor.MAX_ROWS);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("columns", rows.columns());
        result.put("rows", rows.rows());
        result.put("rowCount", rows.rowCount());
        result.put("truncated", rows.truncated());
        result.put("elapsedMs", rows.elapsedMs());
        return result;
    }
}
