package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 원본 DB COMMENT와 ChartSDK 사용자 재정의를 하나의 읽기 모델로 합친다.
 * SQL 식별자는 건드리지 않고 표시 이름만 관리하므로 고객 DB에 쓰기 권한이 필요하지 않다.
 */
@Service
public class DataDisplayNameService {
    private static final int MAX_DISPLAY_NAME_LENGTH = 200;

    private final JdbcTemplate jdbc;

    public DataDisplayNameService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public SchemaCatalog applyOverrides(long datasourceId, SchemaCatalog source) {
        Map<SchemaCatalog.Key, String> relations = new LinkedHashMap<>(source.relationDisplayNames());
        Map<SchemaCatalog.Key, Map<String, String>> columns = deepCopy(source.columnDisplayNames());

        jdbc.query("""
                SELECT schema_name, relation_name, column_name, display_name
                  FROM mc_data_display_name
                 WHERE datasource_id = ?
                """, rs -> {
            SchemaCatalog.Key key = new SchemaCatalog.Key(
                    rs.getString("schema_name"),
                    rs.getString("relation_name")
            );
            String column = rs.getString("column_name");
            if (column.isEmpty()) {
                relations.put(key, rs.getString("display_name"));
            } else {
                columns.computeIfAbsent(key, ignored -> new LinkedHashMap<>())
                        .put(column, rs.getString("display_name"));
            }
        }, datasourceId);

        return new SchemaCatalog(
                source.byTable(),
                source.relationTypes(),
                source.estimatedRowCounts(),
                source.populated(),
                relations,
                columns
        );
    }

    public void update(
            long datasourceId,
            String schema,
            String relation,
            String column,
            String displayName,
            SchemaCatalog catalog
    ) {
        String resolvedSchema = blank(schema) ? SchemaCatalog.DEFAULT_SCHEMA : schema.trim();
        String resolvedRelation = relation == null ? "" : relation.trim();
        String resolvedColumn = column == null ? "" : column.trim();
        if (!catalog.hasTable(resolvedSchema, resolvedRelation)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_IDENTIFIER",
                    "Unknown relation: " + resolvedSchema + "." + resolvedRelation
            );
        }
        if (!resolvedColumn.isEmpty() && !catalog.hasColumn(resolvedSchema, resolvedRelation, resolvedColumn)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_IDENTIFIER",
                    "Unknown column: " + resolvedColumn
            );
        }

        assertDatasourceExists(datasourceId);
        String normalized = displayName == null ? "" : displayName.trim();
        if (normalized.length() > MAX_DISPLAY_NAME_LENGTH) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "DISPLAY_NAME_TOO_LONG",
                    "Display name must be 200 characters or fewer."
            );
        }

        if (normalized.isEmpty()) {
            jdbc.update("""
                    DELETE FROM mc_data_display_name
                     WHERE datasource_id = ?
                       AND schema_name = ?
                       AND relation_name = ?
                       AND column_name = ?
                    """, datasourceId, resolvedSchema, resolvedRelation, resolvedColumn);
            return;
        }

        jdbc.update("""
                INSERT INTO mc_data_display_name(
                    datasource_id, schema_name, relation_name, column_name, display_name
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (datasource_id, schema_name, relation_name, column_name)
                DO UPDATE SET display_name = EXCLUDED.display_name
                """, datasourceId, resolvedSchema, resolvedRelation, resolvedColumn, normalized);
    }

    private void assertDatasourceExists(long datasourceId) {
        Boolean exists = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1
                      FROM mc_datasource
                     WHERE id = ?
                       AND is_active = true
                )
                """, Boolean.class, datasourceId);
        if (!Boolean.TRUE.equals(exists)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "DATASOURCE_NOT_FOUND", "Datasource not found.");
        }
    }

    private static Map<SchemaCatalog.Key, Map<String, String>> deepCopy(
            Map<SchemaCatalog.Key, Map<String, String>> source
    ) {
        Map<SchemaCatalog.Key, Map<String, String>> copy = new LinkedHashMap<>();
        source.forEach((key, value) -> copy.put(key, new LinkedHashMap<>(value)));
        return copy;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
