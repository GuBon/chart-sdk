package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ResultSampleSourceTest {
    @Test
    void projectsOnlyRequiredColumnsAndSamplesAfterJoinAndWhere() {
        SchemaCatalog catalog = new SchemaCatalog(Map.of(
                new SchemaCatalog.Key("public", "sales"), Map.of(
                        "id", "bigint", "customer_id", "bigint", "category", "text", "amount", "numeric"),
                new SchemaCatalog.Key("public", "customers"), Map.of(
                        "id", "bigint", "region", "text")
        ));
        Map<String, Object> cfg = Map.of(
                "table", "sales",
                "joins", List.of(Map.of(
                        "table", "customers",
                        "type", "left",
                        "on", Map.of("leftColumn", "sales.customer_id", "rightColumn", "customers.id"))),
                "xAxis", "customers.region",
                "yAxis", List.of(Map.of("column", "sales.amount", "agg", "avg")),
                "where", List.of(Map.of("column", "sales.amount", "op", "gte", "value", 10)),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 77)
        );

        BuilderSqlBuilder.ResultSampleSource source = BuilderSqlBuilder.generateResultSampleSource(
                catalog, cfg, "bar", SamplePlan.resultRandom(100_000, 1_000, 77, "JOIN_RESULT"));

        assertThat(source.sql().text())
                .contains("LEFT JOIN \"public\".\"customers\"")
                .contains("WHERE \"public\".\"sales\".\"amount\" >= ? OFFSET 0)")
                .contains("WHERE random() < ?")
                .contains("\"__chartsdk_x\"", "\"__chartsdk_y_0\"")
                .doesNotContain("SELECT *", ".*", "GROUP BY", "ORDER BY random()");
        assertThat(source.sql().params()).containsExactly(10, 0.01);
    }
}
