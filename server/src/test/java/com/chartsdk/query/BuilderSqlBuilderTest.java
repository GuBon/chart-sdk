package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BuilderSqlBuilderTest {
    private final SchemaCatalog catalog = new SchemaCatalog(Map.of(
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
                SELECT "sales"."category", SUM("sales"."amount") AS "total" FROM "sales" WHERE "sales"."category" ILIKE ? AND "sales"."amount" >= ? GROUP BY "sales"."category" ORDER BY 2 DESC LIMIT 1000\
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

        assertThat(sql.text()).isEqualTo("SELECT * FROM \"sales\" WHERE \"sales\".\"amount\" < ? LIMIT 1000");
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
                SELECT "sales"."ordered_at", "sales"."amount" AS "amount" FROM "sales" ORDER BY 1 ASC LIMIT 1000\
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
                SELECT "sales"."category", "sales"."amount" AS "amount" FROM "sales" LIMIT 1000\
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
}
