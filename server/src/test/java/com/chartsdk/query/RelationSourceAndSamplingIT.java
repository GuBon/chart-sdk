package com.chartsdk.query;

import com.chartsdk.datasource.DatasourceCredentials;
import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.federation.DuckDbFederation;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.web.ApiException;
import com.chartsdk.web.SchemaController;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** PostgreSQL 5433이 켜져 있을 때 관계 카탈로그와 단일 소스 결과 표본 SQL을 실제 DB로 관통 검증한다. */
class RelationSourceAndSamplingIT {
    private static final long DATASOURCE_ID = 991L;
    private static final String SCHEMA = "chartsdk_relation_it";
    private static DatasourcePoolRegistry pools;
    private static QueryExecutor queries;
    private static FederatedQueryRunner runner;

    @BeforeAll
    static void setup() throws Exception {
        assumeTrue(reachable("localhost", 5433), "PostgreSQL(5433) 미가동 — skip");
        try (Connection connection = adminConnection(); Statement statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
            statement.execute("CREATE SCHEMA " + SCHEMA);
            statement.execute("CREATE TABLE " + SCHEMA + ".sales(id BIGINT PRIMARY KEY, category TEXT, amount NUMERIC, region_id BIGINT)");
            statement.execute("INSERT INTO " + SCHEMA + ".sales SELECT i, CASE WHEN i % 2 = 0 THEN 'A' ELSE 'B' END, i % 100, i % 10 FROM generate_series(1, 10000) i");
            statement.execute("CREATE TABLE " + SCHEMA + ".regions(id BIGINT PRIMARY KEY, name TEXT)");
            statement.execute("INSERT INTO " + SCHEMA + ".regions SELECT i, 'R' || i FROM generate_series(0, 9) i");
            statement.execute("CREATE VIEW " + SCHEMA + ".sales_view AS SELECT id, category, amount, region_id FROM " + SCHEMA + ".sales");
            statement.execute("CREATE MATERIALIZED VIEW " + SCHEMA + ".sales_mv AS SELECT id, category, amount FROM " + SCHEMA + ".sales");
            statement.execute("CREATE MATERIALIZED VIEW " + SCHEMA + ".stale_mv AS SELECT id, category FROM " + SCHEMA + ".sales WITH NO DATA");
            statement.execute("ANALYZE " + SCHEMA + ".sales");
            statement.execute("ANALYZE " + SCHEMA + ".sales_mv");
        }

        DatasourceService datasources = mock(DatasourceService.class);
        when(datasources.credentials(DATASOURCE_ID)).thenReturn(
                new DatasourceCredentials("localhost", 5433, "chartsol", "postgres", "0218", 2));
        pools = new DatasourcePoolRegistry(datasources);
        queries = new QueryExecutor(pools);
        runner = new FederatedQueryRunner(queries, new DuckDbFederation(datasources, queries), new SamplingPlanner(queries));
    }

    @AfterAll
    static void cleanup() throws Exception {
        if (pools != null) pools.evict(DATASOURCE_ID);
        if (!reachable("localhost", 5433)) return;
        try (Connection connection = adminConnection(); Statement statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
        }
    }

    @Test
    void catalogAndSchemaApiExposeAllSupportedRelationKinds() {
        SchemaCatalog catalog = queries.catalog(DATASOURCE_ID);

        assertThat(catalog.relationType(SCHEMA, "sales")).isEqualTo(RelationType.TABLE);
        assertThat(catalog.relationType(SCHEMA, "sales_view")).isEqualTo(RelationType.VIEW);
        assertThat(catalog.relationType(SCHEMA, "sales_mv")).isEqualTo(RelationType.MATERIALIZED_VIEW);
        assertThat(catalog.isPopulated(SCHEMA, "sales_mv")).isTrue();
        assertThat(catalog.isPopulated(SCHEMA, "stale_mv")).isFalse();
        assertThat(catalog.estimatedRowCount(SCHEMA, "sales_view")).isNull();
        assertThat(catalog.estimatedRowCount(SCHEMA, "sales_mv")).isPositive();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> apiRelations = (List<Map<String, Object>>)
                new SchemaController(queries).tables(DATASOURCE_ID).get("tables");
        assertThat(apiRelations).anySatisfy(relation -> assertThat(relation)
                .containsEntry("name", "sales_view").containsEntry("relationType", "VIEW"));
        assertThat(apiRelations).anySatisfy(relation -> assertThat(relation)
                .containsEntry("name", "sales_mv").containsEntry("relationType", "MATERIALIZED_VIEW")
                .containsEntry("populated", true));
    }

    @Test
    void samplesViewAndResolvedJoinResultButUsesFullDataWhenSamplingIsOff() {
        Map<String, Object> view = Map.of(
                "table", ref("sales_view"),
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "avg", "alias", "average")),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 77));
        FederatedQueryRunner.BuiltResult sampledView = runner.runBuilder(DATASOURCE_ID, view, "bar", false);
        FederatedQueryRunner.BuiltResult sampledViewAgain = runner.runBuilder(DATASOURCE_ID, view, "bar", false);
        assertThat(sampledView.sampling().method()).isEqualTo("RESULT_RANDOM");
        assertThat(sampledView.sampling().sampledRowCount()).isBetween(850L, 1_150L);
        assertThat(sampledView.sampling().populationEstimate()).isPositive();
        assertThat(sampledView.rows().rows()).isEqualTo(sampledViewAgain.rows().rows());
        assertThat(sampledView.sql().text())
                .contains("\"__chartsdk_population\"")
                .contains("WHERE random() < ?")
                .doesNotContain("ORDER BY random()", "reservoir(");

        Map<String, Object> joined = Map.of(
                "table", ref("sales"),
                "joins", List.of(Map.of(
                        "table", ref("regions"), "type", "inner",
                        "on", Map.of("leftColumn", "sales.region_id", "rightColumn", "regions.id"))),
                "xAxis", "regions.name",
                "yAxis", List.of(Map.of("column", "sales.amount", "agg", "avg", "alias", "average")),
                "where", List.of(Map.of("column", "sales.amount", "op", "gt", "value", 0)),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 77));
        FederatedQueryRunner.BuiltResult sampledJoin = runner.runBuilder(DATASOURCE_ID, joined, "bar", false);
        assertThat(sampledJoin.sampling().method()).isEqualTo("RESULT_RANDOM");
        assertThat(sampledJoin.sampling().sampledRowCount()).isBetween(850L, 1_150L);
        assertThat(sampledJoin.sampling().populationEstimate()).isPositive();
        assertThat(sampledJoin.sql().text())
                .contains("INNER JOIN \"" + SCHEMA + "\".\"regions\"")
                .contains("WHERE \"" + SCHEMA + "\".\"sales\".\"amount\" > ? OFFSET 0)")
                .contains("WHERE random() < ?")
                .doesNotContain("ORDER BY random()", "reservoir(");

        Map<String, Object> exactView = Map.of(
                "table", ref("sales_view"),
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "total")));
        FederatedQueryRunner.BuiltResult exact = runner.runBuilder(DATASOURCE_ID, exactView, "bar", false);
        assertThat(exact.sampling()).isNull();
        assertThat(exact.sql().text()).doesNotContain("__chartsdk_sample").doesNotContain("TABLESAMPLE");
        assertThat(exact.rows().rowCount()).isEqualTo(2);
    }

    @Test
    void geoScatterReturnsEveryCoordinateMatchingTheFilterBeyondDefaultLimit() {
        Map<String, Object> points = Map.of(
                "table", ref("sales"),
                "xAxis", "amount",
                "yAxis", List.of(Map.of("column", "id", "agg", "none")),
                "where", List.of(Map.of("column", "id", "op", "lte", "value", 1_205)));

        FederatedQueryRunner.BuiltResult result =
                runner.runBuilder(DATASOURCE_ID, points, "geoscatter", false);

        assertThat(result.sql().text()).doesNotContain("LIMIT 1000");
        assertThat(result.rows().rowCount()).isEqualTo(1_205);
        assertThat(result.rows().truncated()).isFalse();
    }

    @Test
    void materializedViewSupportsPhysicalSystemSamplingAndRejectsUnpopulatedPreview() {
        Map<String, Object> sampledMv = Map.of(
                "table", ref("sales_mv"),
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "sample_total")),
                "sample", Map.of("mode", "manual", "method", "system", "rate", 10, "seed", 12));

        FederatedQueryRunner.BuiltResult result = runner.runBuilder(DATASOURCE_ID, sampledMv, "bar", false);
        assertThat(result.sampling().method()).isEqualTo("SYSTEM");
        assertThat(result.sql().text()).contains("TABLESAMPLE SYSTEM (10) REPEATABLE (12)");

        SchemaController controller = new SchemaController(queries);
        assertThatThrownBy(() -> controller.preview("stale_mv", SCHEMA, DATASOURCE_ID))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.code()).isEqualTo("MATERIALIZED_VIEW_NOT_POPULATED"));

        Map<String, Object> staleMv = Map.of(
                "table", ref("stale_mv"),
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "total")));
        assertThatThrownBy(() -> runner.runBuilder(DATASOURCE_ID, staleMv, "bar", false))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.code()).isEqualTo("MATERIALIZED_VIEW_NOT_POPULATED"));
    }

    private static Map<String, Object> ref(String name) {
        return Map.of("datasourceId", DATASOURCE_ID, "schema", SCHEMA, "name", name);
    }

    private static Connection adminConnection() throws Exception {
        return DriverManager.getConnection("jdbc:postgresql://localhost:5433/chartsol", "postgres", "0218");
    }

    private static boolean reachable(String host, int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 1_000);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
