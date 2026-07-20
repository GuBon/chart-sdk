package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SchemaCatalogTest {

    @Test
    void unqualifiedLookupFallsBackToPublic() {
        SchemaCatalog catalog = SchemaCatalog.ofPublic(Map.of(
                "sales", Map.of("amount", "numeric")));

        assertThat(catalog.hasTable("sales")).isTrue();
        assertThat(catalog.hasTable("missing")).isFalse();
        assertThat(catalog.hasColumn("sales", "amount")).isTrue();
        assertThat(catalog.columnType("sales", "amount")).isEqualTo("numeric");
    }

    @Test
    void qualifiedAndUnqualifiedAgreeForPublic() {
        SchemaCatalog catalog = SchemaCatalog.ofPublic(Map.of(
                "sales", Map.of("amount", "numeric")));

        assertThat(catalog.hasTable("public", "sales")).isTrue();
        assertThat(catalog.columnType("public", "sales", "amount")).isEqualTo("numeric");
        assertThat(catalog.columnType("sales", "amount"))
                .isEqualTo(catalog.columnType("public", "sales", "amount"));
    }

    @Test
    void preservesSameTableNameInDifferentSchemas() {
        SchemaCatalog catalog = new SchemaCatalog(Map.of(
                new SchemaCatalog.Key("public", "events"), Map.of("label", "text"),
                new SchemaCatalog.Key("tandanji", "events"), Map.of("amount", "numeric")));

        // 동명 테이블이 키 충돌 없이 둘 다 보존되고, 스키마별 컬럼이 독립적이다.
        assertThat(catalog.hasColumn("public", "events", "label")).isTrue();
        assertThat(catalog.hasColumn("public", "events", "amount")).isFalse();
        assertThat(catalog.hasColumn("tandanji", "events", "amount")).isTrue();
        assertThat(catalog.hasColumn("tandanji", "events", "label")).isFalse();
        // 비한정 조회는 public 을 가리킨다(하위호환 폴백).
        assertThat(catalog.columnType("events", "label")).isEqualTo("text");
        assertThat(catalog.columnType("events", "amount")).isNull();
    }

    @Test
    void keyNormalizesBlankSchemaToPublic() {
        assertThat(new SchemaCatalog.Key(null, "t").schema()).isEqualTo("public");
        assertThat(new SchemaCatalog.Key("", "t").schema()).isEqualTo("public");
        assertThat(new SchemaCatalog.Key("  ", "t").schema()).isEqualTo("public");
        assertThat(new SchemaCatalog.Key("tandanji", "t").schema()).isEqualTo("tandanji");
    }

    @Test
    void preservesRelationTypeEstimateAndMaterializedViewState() {
        SchemaCatalog.Key view = new SchemaCatalog.Key("analytics", "active_users");
        SchemaCatalog.Key materialized = new SchemaCatalog.Key("analytics", "daily_sales");
        SchemaCatalog catalog = new SchemaCatalog(
                Map.of(view, Map.of("id", "bigint"), materialized, Map.of("total", "numeric")),
                Map.of(view, RelationType.VIEW, materialized, RelationType.MATERIALIZED_VIEW),
                Map.of(materialized, 2_000_000L),
                Map.of(materialized, false));

        assertThat(catalog.relationType("analytics", "active_users")).isEqualTo(RelationType.VIEW);
        assertThat(catalog.estimatedRowCount("analytics", "active_users")).isNull();
        assertThat(catalog.relationType("analytics", "daily_sales")).isEqualTo(RelationType.MATERIALIZED_VIEW);
        assertThat(catalog.estimatedRowCount("analytics", "daily_sales")).isEqualTo(2_000_000L);
        assertThat(catalog.isPopulated("analytics", "daily_sales")).isFalse();
        assertThat(catalog.isQueryable("analytics", "active_users")).isTrue();
        assertThat(catalog.isQueryable("analytics", "daily_sales")).isFalse();
    }
}
