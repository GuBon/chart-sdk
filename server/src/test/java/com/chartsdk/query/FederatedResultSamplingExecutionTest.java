package com.chartsdk.query;

import com.chartsdk.cache.SamplingQueryRows;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 생성 문자열 단언을 넘어 DuckDB가 RESULT_RANDOM 페더레이션 SQL을 실제 파싱·실행하는지 검증한다. */
class FederatedResultSamplingExecutionTest {

    @Test
    void executesRepeatableBernoulliAfterCrossSourceJoinAndBeforeAggregation() throws Exception {
        FederatedCatalog catalog = new FederatedCatalog(Map.of(
                2L, new SchemaCatalog(Map.of(
                        new SchemaCatalog.Key("sales", "orders"),
                        Map.of("id", "bigint", "user_id", "bigint", "amount", "double"))),
                5L, new SchemaCatalog(Map.of(
                        new SchemaCatalog.Key("public", "customers"),
                        Map.of("id", "bigint", "region", "text")))));
        Map<String, Object> cfg = Map.of(
                "table", ref(2, "sales", "orders"),
                "joins", List.of(Map.of(
                        "table", ref(5, "public", "customers"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "orders.user_id", "rightColumn", "customers.id"))),
                "xAxis", "customers.region",
                "yAxis", List.of(Map.of("column", "orders.amount", "agg", "avg", "alias", "average")),
                "where", List.of(Map.of("column", "orders.amount", "op", "gt", "value", 0)),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 123));
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(
                catalog, RefRenderer.FEDERATED, cfg, "bar", false,
                SamplePlan.resultRandom(5_000, 1_000, 123, "JOIN_RESULT"));

        try (Connection connection = DriverManager.getConnection("jdbc:duckdb:")) {
            try (Statement statement = connection.createStatement()) {
                statement.execute("ATTACH ':memory:' AS ds2");
                statement.execute("ATTACH ':memory:' AS ds5");
                statement.execute("CREATE SCHEMA ds2.sales");
                statement.execute("CREATE SCHEMA ds5.public");
                statement.execute("CREATE TABLE ds2.sales.orders(id BIGINT, user_id BIGINT, amount DOUBLE)");
                statement.execute("CREATE TABLE ds5.public.customers(id BIGINT, region VARCHAR)");
                statement.execute("INSERT INTO ds2.sales.orders SELECT i, i, (i % 100) + 1 FROM range(1, 5001) t(i)");
                statement.execute("INSERT INTO ds5.public.customers SELECT i, 'R' || (i % 5) FROM range(1, 5001) t(i)");
                statement.execute("SET threads TO 1");
            }

            SamplingQueryRows.Result first = execute(connection, sql);
            SamplingQueryRows.Result second = execute(connection, sql);

            assertThat(first.rows().rows()).isEqualTo(second.rows().rows());
            assertThat(first.rows().rowCount()).isEqualTo(5);
            assertThat(first.sampling().method()).isEqualTo("RESULT_RANDOM");
            assertThat(first.sampling().sampledRowCount()).isBetween(850L, 1_150L);
            assertThat(first.sampling().groups()).allSatisfy(group -> assertThat(group.sampleCount()).isPositive());
            assertThat(first.sampling().estimates().get(0).marginOfError()).isPositive();
            assertThat(first.sampling().estimates().get(0).relativeErrorPct()).isPositive();
        }
    }

    @Test
    void oneToManyJoinSamplesJoinedRowsIndependentlyInsteadOfSamplingTheBaseSide() throws Exception {
        FederatedCatalog catalog = new FederatedCatalog(Map.of(
                2L, new SchemaCatalog(Map.of(
                        new SchemaCatalog.Key("sales", "orders"),
                        Map.of("id", "bigint", "user_id", "bigint"))),
                5L, new SchemaCatalog(Map.of(
                        new SchemaCatalog.Key("public", "customers"),
                        Map.of("id", "bigint", "region", "text")))));
        Map<String, Object> cfg = Map.of(
                "table", ref(2, "sales", "orders"),
                "joins", List.of(Map.of(
                        "table", ref(5, "public", "customers"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "orders.user_id", "rightColumn", "customers.id"))),
                "xAxis", "orders.id",
                "yAxis", List.of(Map.of("column", "customers.region", "agg", "none")),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 456));
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(
                catalog, RefRenderer.FEDERATED, cfg, "bar", false,
                SamplePlan.resultRandom(4_000, 1_000, 456, "JOIN_RESULT"));

        try (Connection connection = DriverManager.getConnection("jdbc:duckdb:")) {
            try (Statement statement = connection.createStatement()) {
                statement.execute("ATTACH ':memory:' AS ds2");
                statement.execute("ATTACH ':memory:' AS ds5");
                statement.execute("CREATE SCHEMA ds2.sales");
                statement.execute("CREATE SCHEMA ds5.public");
                statement.execute("CREATE TABLE ds2.sales.orders(id BIGINT, user_id BIGINT)");
                statement.execute("CREATE TABLE ds5.public.customers(id BIGINT, region VARCHAR)");
                statement.execute("INSERT INTO ds2.sales.orders SELECT i, i FROM range(1, 2001) t(i)");
                statement.execute("INSERT INTO ds5.public.customers SELECT i, 'R0' FROM range(1, 2001) t(i)");
                statement.execute("INSERT INTO ds5.public.customers SELECT i, 'R1' FROM range(1, 2001) t(i)");
                statement.execute("SET threads TO 1");
            }

            SamplingQueryRows.Result result = execute(connection, sql);
            Map<Long, Integer> childrenPerOrder = new HashMap<>();
            for (List<Object> row : result.rows().rows()) {
                childrenPerOrder.merge(((Number) row.get(0)).longValue(), 1, Integer::sum);
            }

            assertThat(result.sampling().sampledRowCount()).isBetween(850L, 1_150L);
            assertThat(childrenPerOrder.values()).contains(1);
            assertThat(sql.text()).contains("OFFSET 0)").contains("WHERE random() < ?")
                    .doesNotContain("ORDER BY random()", "reservoir(");
        }
    }

    private static SamplingQueryRows.Result execute(Connection connection, BuilderSqlBuilder.Sql sql) throws Exception {
        try (PreparedStatement seed = connection.prepareStatement("SELECT setseed(?)")) {
            seed.setDouble(1, SamplingSeed.unit(sql.sampling().seed()));
            seed.execute();
        }
        try (PreparedStatement statement = connection.prepareStatement(sql.text())) {
            for (int i = 0; i < sql.params().size(); i++) statement.setObject(i + 1, sql.params().get(i));
            try (ResultSet resultSet = statement.executeQuery()) {
                QueryRows rows = QueryRows.from(resultSet, System.nanoTime());
                return SamplingQueryRows.extract(rows, sql.sampling());
            }
        }
    }

    private static Map<String, Object> ref(long datasourceId, String schema, String name) {
        return Map.of("datasourceId", datasourceId, "schema", schema, "name", name);
    }
}
