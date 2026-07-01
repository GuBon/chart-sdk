package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BuilderSqlBuilderTest {
    private final SchemaCatalog catalog = SchemaCatalog.ofPublic(Map.of(
            "sales", Map.of(
                    "id", "bigint",
                    "category", "text",
                    "amount", "numeric",
                    "ordered_at", "timestamp without time zone",
                    "customer_id", "bigint"
            ),
            "customers", Map.of(
                    "id", "bigint",
                    "region", "text"
            )
    ));

    @Test
    void generatesAggregateSqlWithBoundWhereValues() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "total")),
                "where", List.of(
                        Map.of("column", "category", "op", "contains", "value", "foo"),
                        Map.of("column", "amount", "op", "gte", "value", "100")
                ),
                "orderBy", Map.of("target", "y0", "direction", "desc")
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."sales"."category", SUM("public"."sales"."amount") AS "total" FROM "public"."sales" WHERE "public"."sales"."category" ILIKE ? AND "public"."sales"."amount" >= ? GROUP BY "public"."sales"."category" ORDER BY 2 DESC LIMIT 1000\
                """);
        assertThat(sql.params()).containsExactly("%foo%", 100L);
    }

    @Test
    void rowsModeKeepsWhereButSkipsAggregationAndSample() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum")),
                "sample", Map.of("rate", 10),
                "where", List.of(Map.of("column", "amount", "op", "lt", "value", 500))
        ), "bar", true);

        assertThat(sql.text()).isEqualTo("SELECT * FROM \"public\".\"sales\" WHERE \"public\".\"sales\".\"amount\" < ? LIMIT 1000");
        assertThat(sql.params()).containsExactly(500);
    }

    @Test
    void barChartCanUseRawTupleValuesWithoutGrouping() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "ordered_at",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none")),
                "orderBy", Map.of("target", "x", "direction", "asc")
        ), "line", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."sales"."ordered_at", "public"."sales"."amount" AS "amount" FROM "public"."sales" ORDER BY 1 ASC LIMIT 1000\
                """);
        assertThat(sql.params()).isEmpty();
    }

    @Test
    void pieChartCanUseRawNameValueTuplesWithoutGrouping() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none"))
        ), "pie", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."sales"."category", "public"."sales"."amount" AS "amount" FROM "public"."sales" LIMIT 1000\
                """);
        assertThat(sql.params()).isEmpty();
    }

    @Test
    void rawTupleValuesCannotBeMixedWithAggregates() {
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(
                        Map.of("column", "amount", "agg", "none"),
                        Map.of("column", "id", "agg", "count")
                )
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("raw values cannot be mixed");
    }

    @Test
    void joinsRequireQualifiedReferencesAndRejectSample() {
        Map<String, Object> cfg = Map.of(
                "table", "sales",
                "joins", List.of(Map.of(
                        "table", "customers",
                        "type", "left",
                        "on", Map.of("leftColumn", "sales.customer_id", "rightColumn", "customers.id")
                )),
                "xAxis", "customers.region",
                "yAxis", List.of(Map.of("column", "sales.amount", "agg", "sum")),
                "sample", Map.of("rate", 10)
        );

        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, cfg, "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Sample cannot be used with joins");
    }

    @Test
    void validatesBucketColumnTypeBeforeSqlGeneration() {
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "xAxisBucket", "month",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum"))
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Bucket requires a date/timestamp column");
    }

    @Test
    void scatterRequiresNumericXAxisAndNoneAggregation() {
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none"))
        ), "scatter", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("scatter xAxis must be numeric");
    }

    // ── 다중 스키마(§1.2) ────────────────────────────────────
    // public.events 와 tandanji.events 는 동명이나 컬럼 구성이 다르다 — 스키마 해석이 독립적이어야 한다.
    private final SchemaCatalog multiSchema = new SchemaCatalog(Map.of(
            new SchemaCatalog.Key("tandanji", "events"), Map.of(
                    "id", "bigint",
                    "user_id", "bigint",
                    "amount", "numeric",
                    "created_at", "timestamp without time zone"
            ),
            new SchemaCatalog.Key("tandanji", "users"), Map.of(
                    "id", "bigint",
                    "name", "text"
            ),
            new SchemaCatalog.Key("public", "events"), Map.of(
                    "id", "bigint",
                    "label", "text"
            )
    ));

    @Test
    void qualifiesEveryIdentifierWithNonPublicSchema() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "xAxis", "user_id",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "total"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "tandanji"."events"."user_id", SUM("tandanji"."events"."amount") AS "total" FROM "tandanji"."events" GROUP BY "tandanji"."events"."user_id" LIMIT 1000\
                """);
        assertThat(sql.params()).isEmpty();
    }

    @Test
    void unqualifiedTableDefaultsToPublicSchema() {
        // table="events" (스키마 미지정) → public.events 로 해석되어야 한다(동명 tandanji.events 가 아니라).
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "events",
                "xAxis", "label",
                "yAxis", List.of(Map.of("column", "id", "agg", "count", "alias", "cnt"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."events"."label", COUNT("public"."events"."id") AS "cnt" FROM "public"."events" GROUP BY "public"."events"."label" LIMIT 1000\
                """);
    }

    @Test
    void resolvesColumnsAgainstTheResolvedSchemaNotASameNamedTable() {
        // "amount" 는 tandanji.events 에만 있다. public.events 로 잘못 해석하면 INVALID_IDENTIFIER 가 나야 한다.
        BuilderSqlBuilder.Sql ok = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "xAxis", "user_id",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none"))
        ), "line", false);
        assertThat(ok.text()).isEqualTo("""
                SELECT "tandanji"."events"."user_id", "tandanji"."events"."amount" AS "amount" FROM "tandanji"."events" LIMIT 1000\
                """);

        assertThatThrownBy(() -> BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "events",
                "xAxis", "label",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum"))
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Unknown column: amount");
    }

    @Test
    void joinAcrossNonPublicSchemaQualifiesEverySide() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "joins", List.of(Map.of(
                        "table", "tandanji.users",
                        "type", "inner",
                        "on", Map.of("leftColumn", "events.user_id", "rightColumn", "users.id")
                )),
                "xAxis", "users.name",
                "yAxis", List.of(Map.of("column", "events.amount", "agg", "sum", "alias", "total"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "tandanji"."users"."name", SUM("tandanji"."events"."amount") AS "total" FROM "tandanji"."events" INNER JOIN "tandanji"."users" ON "tandanji"."events"."user_id" = "tandanji"."users"."id" GROUP BY "tandanji"."users"."name" LIMIT 1000\
                """);
    }

    @Test
    void dateBucketOnNonPublicTableQualifiesIdentifier() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "xAxis", "created_at",
                "xAxisBucket", "month",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "매출")),
                "orderBy", Map.of("target", "x", "direction", "asc")
        ), "line", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT DATE_TRUNC('month', "tandanji"."events"."created_at") AS "created_at", SUM("tandanji"."events"."amount") AS "매출" FROM "tandanji"."events" GROUP BY 1 ORDER BY 1 ASC LIMIT 1000\
                """);
    }

    @Test
    void rejectsAmbiguousTableNameAcrossSchemasInOneQuery() {
        // base=tandanji.events 와 join=public.events 는 이름이 같아 컬럼 참조가 모호 — 조용한 오선택 대신 거부.
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "joins", List.of(Map.of(
                        "table", "public.events",
                        "type", "inner",
                        "on", Map.of("leftColumn", "events.user_id", "rightColumn", "events.id")
                )),
                "xAxis", "events.label",
                "yAxis", List.of(Map.of("column", "events.amount", "agg", "sum"))
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Ambiguous table name across sources/schemas: events");
    }
}
