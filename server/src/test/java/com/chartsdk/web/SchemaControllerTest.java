package com.chartsdk.web;

import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.RelationType;
import com.chartsdk.query.SchemaCatalog;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SchemaControllerTest {

    @Test
    void exposesTableViewAndMaterializedViewMetadataInOneCatalogResponse() {
        QueryExecutor queries = mock(QueryExecutor.class);
        SchemaCatalog.Key table = new SchemaCatalog.Key("public", "sales");
        SchemaCatalog.Key view = new SchemaCatalog.Key("analytics", "sales_view");
        SchemaCatalog.Key materialized = new SchemaCatalog.Key("analytics", "sales_mv");
        Map<SchemaCatalog.Key, Map<String, String>> columns = new LinkedHashMap<>();
        columns.put(table, Map.of("id", "bigint"));
        columns.put(view, Map.of("category", "text"));
        columns.put(materialized, Map.of("month", "date"));
        SchemaCatalog catalog = new SchemaCatalog(
                columns,
                Map.of(table, RelationType.TABLE, view, RelationType.VIEW,
                        materialized, RelationType.MATERIALIZED_VIEW),
                Map.of(table, 5_000_000L, materialized, 24L),
                Map.of(materialized, true));
        when(queries.catalog(7L)).thenReturn(catalog);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> relations = (List<Map<String, Object>>)
                new SchemaController(queries).tables(7L).get("tables");

        assertThat(relations).extracting(row -> row.get("relationType"))
                .containsExactly("TABLE", "VIEW", "MATERIALIZED_VIEW");
        assertThat(relations.get(0)).containsEntry("estimatedRowCount", 5_000_000L);
        assertThat(relations.get(1)).doesNotContainKey("estimatedRowCount").doesNotContainKey("populated");
        assertThat(relations.get(2)).containsEntry("estimatedRowCount", 24L).containsEntry("populated", true);
    }

    @Test
    void rejectsPreviewOfUnpopulatedMaterializedViewBeforeExecutingSql() {
        QueryExecutor queries = mock(QueryExecutor.class);
        SchemaCatalog.Key stale = new SchemaCatalog.Key("analytics", "stale_mv");
        when(queries.catalog(7L)).thenReturn(new SchemaCatalog(
                Map.of(stale, Map.of("id", "bigint")),
                Map.of(stale, RelationType.MATERIALIZED_VIEW),
                Map.of(),
                Map.of(stale, false)));
        SchemaController controller = new SchemaController(queries);

        assertThatThrownBy(() -> controller.preview("stale_mv", "analytics", 7L))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.code()).isEqualTo("MATERIALIZED_VIEW_NOT_POPULATED");
                    assertThat(error.status().value()).isEqualTo(409);
                });
    }
}
