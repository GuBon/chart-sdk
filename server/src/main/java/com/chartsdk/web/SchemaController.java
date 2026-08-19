package com.chartsdk.web;

import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.query.DataDisplayNameService;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RelationType;
import com.chartsdk.query.SchemaCatalog;
import com.chartsdk.query.SqlIdentifier;
import com.chartsdk.web.dto.DataDisplayNameUpdateRequest;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/schema")
public class SchemaController {
    private final QueryExecutor queries;
    private final DataDisplayNameService displayNames;
    private final DatasourceService datasources;

    public SchemaController(QueryExecutor queries, DataDisplayNameService displayNames) {
        this(queries, displayNames, null);
    }

    @Autowired
    public SchemaController(QueryExecutor queries, DataDisplayNameService displayNames,
                            DatasourceService datasources) {
        this.queries = queries;
        this.displayNames = displayNames;
        this.datasources = datasources;
    }

    /** 단위 테스트와 레거시 직접 생성 호출 호환. */
    public SchemaController(QueryExecutor queries) {
        this(queries, null, null);
    }

    @GetMapping("/tables")
    public Map<String, Object> tables(@RequestParam long datasourceId) {
        requireOwned(datasourceId);
        SchemaCatalog catalog = catalog(datasourceId);
        List<Map<String, Object>> tables = new ArrayList<>();
        catalog.byTable().forEach((key, cols) -> {
            List<Map<String, Object>> columns = new ArrayList<>();
            cols.forEach((name, type) -> {
                Map<String, Object> column = new LinkedHashMap<>();
                column.put("name", name);
                column.put("type", type);
                String displayName = catalog.columnDisplayName(key.schema(), key.table(), name);
                if (displayName != null) column.put("displayName", displayName);
                columns.add(column);
            });
            Map<String, Object> table = new LinkedHashMap<>();
            table.put("schema", key.schema());
            table.put("name", key.table());
            String displayName = catalog.relationDisplayName(key.schema(), key.table());
            if (displayName != null) table.put("displayName", displayName);
            RelationType relationType = catalog.relationType(key.schema(), key.table());
            table.put("relationType", relationType.name());
            Long estimatedRowCount = catalog.estimatedRowCount(key.schema(), key.table());
            if (estimatedRowCount != null) table.put("estimatedRowCount", estimatedRowCount);
            if (relationType == RelationType.MATERIALIZED_VIEW) {
                table.put("populated", catalog.isPopulated(key.schema(), key.table()));
            }
            table.put("columns", columns);
            tables.add(table);
        });
        return Map.of("tables", tables);
    }

    @PutMapping("/display-name")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void updateDisplayName(@Valid @RequestBody DataDisplayNameUpdateRequest input) {
        requireOwned(input.datasourceId());
        SchemaCatalog catalog = queries.catalog(input.datasourceId());
        displayNames.update(
                input.datasourceId(),
                input.schema(),
                input.relation(),
                input.column(),
                input.displayName(),
                catalog
        );
    }

    @GetMapping("/tables/{tableName}/preview")
    public Map<String, Object> preview(@PathVariable String tableName,
                                       @RequestParam(required = false) String schema,
                                       @RequestParam long datasourceId) {
        requireOwned(datasourceId);
        SchemaCatalog catalog = catalog(datasourceId);
        String resolvedSchema = (schema == null || schema.isBlank()) ? SchemaCatalog.DEFAULT_SCHEMA : schema;
        if (!catalog.hasTable(resolvedSchema, tableName)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Unknown table: " + tableName);
        }
        if (!catalog.isQueryable(resolvedSchema, tableName)) {
            throw new ApiException(HttpStatus.CONFLICT, "MATERIALIZED_VIEW_NOT_POPULATED",
                    "Materialized view must be refreshed before it can be queried: " + tableName);
        }
        QueryRows rows = queries.execute(datasourceId,
                "SELECT * FROM " + SqlIdentifier.qualify(resolvedSchema, tableName) + " LIMIT " + QueryExecutor.MAX_ROWS);
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> columns = new ArrayList<>();
        for (Map<String, Object> sourceColumn : rows.columns()) {
            Map<String, Object> column = new LinkedHashMap<>(sourceColumn);
            String columnName = String.valueOf(sourceColumn.get("name"));
            String displayName = catalog.columnDisplayName(resolvedSchema, tableName, columnName);
            if (displayName != null) column.put("displayName", displayName);
            columns.add(column);
        }
        result.put("columns", columns);
        result.put("rows", rows.rows());
        result.put("rowCount", rows.rowCount());
        result.put("truncated", rows.truncated());
        result.put("elapsedMs", rows.elapsedMs());
        return result;
    }

    private SchemaCatalog catalog(long datasourceId) {
        SchemaCatalog source = queries.catalog(datasourceId);
        return displayNames == null ? source : displayNames.applyOverrides(datasourceId, source);
    }

    private void requireOwned(long datasourceId) {
        if (datasources != null) datasources.requireOwned(datasourceId);
    }
}
