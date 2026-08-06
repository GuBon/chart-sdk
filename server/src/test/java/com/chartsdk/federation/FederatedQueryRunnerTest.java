package com.chartsdk.federation;

import com.chartsdk.cache.CachedResultSample;
import com.chartsdk.cache.SampleRowCacheService;
import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.CachedSampleExecutor;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.PointCollectionResult;
import com.chartsdk.query.FederatedCatalog;
import com.chartsdk.query.SamplePlan;
import com.chartsdk.query.SamplingPlanner;
import com.chartsdk.query.SchemaCatalog;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class FederatedQueryRunnerTest {

    private static final QueryRows EMPTY = new QueryRows(List.of(), List.of(), 0, false, 1);

    @Test
    void l1HitAggregatesCachedRowsBeforeTouchingCustomerCatalogOrPlanner() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        SampleRowCacheService cache = mock(SampleRowCacheService.class);
        CachedSampleExecutor executor = mock(CachedSampleExecutor.class);
        Map<String, Object> config = Map.of(
                "table", Map.of("datasourceId", 1L, "schema", "public", "name", "points"),
                "xAxis", "longitude",
                "yAxis", List.of(Map.of("column", "latitude", "agg", "avg")),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 77));
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(config)
                .asResultRandom(100_000, 1_000);
        QueryRows sample = new QueryRows(
                List.of(
                        Map.of("name", "__chartsdk_x", "type", "double precision"),
                        Map.of("name", "__chartsdk_y_0", "type", "double precision")),
                List.of(List.of(127.0, 37.0)), 1, false, 1);
        BuilderSqlBuilder.Sql source = new BuilderSqlBuilder.Sql(
                "SELECT longitude AS \"__chartsdk_x\", latitude AS \"__chartsdk_y_0\" "
                        + "FROM points WHERE random() < ?",
                List.of(0.01), sampling);
        CachedResultSample cached = new CachedResultSample(sample, sampling, source);
        QueryRows finalRows = new QueryRows(
                List.of(
                        Map.of("name", "longitude", "type", "DOUBLE"),
                        Map.of("name", "avg_latitude", "type", "DOUBLE")),
                List.of(List.of(127.0, 37.0)), 1, false, 1);
        when(cache.findCurrent(anyString(), eq(900), eq(1L), any()))
                .thenReturn(Optional.of(cached));
        when(executor.execute(eq(sample), any())).thenReturn(finalRows);

        FederatedQueryRunner.BuiltResult result = new FederatedQueryRunner(
                queries, federation, planner, cache, executor)
                .runBuilder(1L, config, "bar", false, 900);

        assertThat(result.rows()).isSameAs(finalRows);
        assertThat(result.sql().text()).contains("__chartsdk_l1_source").doesNotContain("SELECT *");
        verifyNoInteractions(queries, federation, planner);
    }

    @Test
    void routesOrdinaryBuilderChartsThroughChartExecution() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> config = Map.of(
                "table", Map.of("datasourceId", 1L, "schema", "public", "name", "points"),
                "xAxis", "longitude",
                "yAxis", List.of(Map.of("column", "latitude", "agg", "sum")));
        when(queries.catalog(1L)).thenReturn(singleCatalog());
        when(planner.plan(1L, config, "bar", false)).thenReturn(SamplePlan.none());
        when(queries.executeChart(eq(1L), anyString(), anyList())).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner).runBuilder(1L, config, "bar", false);

        verify(queries).executeChart(eq(1L), anyString(), anyList());
        assertThat(result.sql().text()).doesNotContain("LIMIT 1000");
    }

    @Test
    void autoPointFullScanSwitchesToRuntimeReservoirOnlyWhenActualRowsExceedTarget() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> config = Map.of(
                "table", Map.of("datasourceId", 1L, "schema", "public", "name", "points"),
                "xAxis", "longitude",
                "yAxis", List.of(Map.of("column", "latitude", "agg", "none")),
                "sample", Map.of("mode", "auto", "size", 10_000, "seed", 77));
        QueryRows retained = new QueryRows(
                List.of(Map.of("name", "longitude", "type", "double precision")),
                List.of(List.of(127.0)), 1, false, 1);
        when(queries.catalog(1L)).thenReturn(singleCatalog());
        when(planner.plan(1L, config, "scatter", false)).thenReturn(SamplePlan.fullScan(5_000, 77));
        when(queries.executeAutoPointChart(eq(1L), anyString(), anyList(), eq(10_000), eq(77L)))
                .thenReturn(new PointCollectionResult(retained, 1_000_000));

        FederatedQueryRunner.BuiltResult result = new FederatedQueryRunner(
                queries, federation, planner).runBuilder(1L, config, "scatter", false);

        verify(queries).executeAutoPointChart(eq(1L), anyString(), anyList(), eq(10_000), eq(77L));
        verify(queries, never()).executeChart(eq(1L), anyString(), anyList());
        assertThat(result.sampling().version()).isEqualTo(9);
        assertThat(result.sampling().method()).isEqualTo("RESERVOIR_RANDOM");
        assertThat(result.sampling().populationCount()).isEqualTo(1_000_000);
        assertThat(result.sampling().sampledRowCount()).isEqualTo(1);
    }

    @Test
    void manualPointFullScanPreservesExactExecution() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> config = Map.of(
                "table", Map.of("datasourceId", 1L, "schema", "public", "name", "points"),
                "xAxis", "longitude",
                "yAxis", List.of(Map.of("column", "latitude", "agg", "none")),
                "sample", Map.of("mode", "manual", "rate", 100, "seed", 77));
        when(queries.catalog(1L)).thenReturn(singleCatalog());
        when(planner.plan(1L, config, "scatter", false)).thenReturn(SamplePlan.fullScan(1_000_000, 77));
        when(queries.executeChart(eq(1L), anyString(), anyList())).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result = new FederatedQueryRunner(
                queries, federation, planner).runBuilder(1L, config, "scatter", false);

        verify(queries).executeChart(eq(1L), anyString(), anyList());
        verify(queries, never()).executeAutoPointChart(
                eq(1L), anyString(), anyList(), eq(10_000), eq(77L));
        assertThat(result.sampling().approximate()).isFalse();
        assertThat(result.sampling().method()).isEqualTo("FULL_SCAN");
    }

    @Test
    void keepsRawDataPreviewBounded() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> config = Map.of(
                "table", Map.of("datasourceId", 1L, "schema", "public", "name", "points"));
        when(queries.catalog(1L)).thenReturn(singleCatalog());
        when(planner.plan(1L, config, "bar", true)).thenReturn(SamplePlan.none());
        when(queries.execute(eq(1L), anyString(), anyList())).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner).runBuilder(1L, config, "bar", true);

        verify(queries).execute(eq(1L), anyString(), anyList());
        assertThat(result.sql().text()).endsWith("LIMIT 1000");
    }

    @Test
    void routesStoredChartSqlThroughChartExecution() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        when(queries.executeChart(1L, "SELECT * FROM chart_data", List.of())).thenReturn(EMPTY);
        when(federation.executeChart(Set.of(1L, 2L), "SELECT * FROM joined_chart", List.of())).thenReturn(EMPTY);
        FederatedQueryRunner runner = new FederatedQueryRunner(queries, federation, planner);

        assertThat(runner.runStored(Set.of(1L), 1L, "SELECT * FROM chart_data")).isSameAs(EMPTY);
        assertThat(runner.runStored(Set.of(1L, 2L), 1L, "SELECT * FROM joined_chart")).isSameAs(EMPTY);

        verify(queries).executeChart(1L, "SELECT * FROM chart_data", List.of());
        verify(federation).executeChart(Set.of(1L, 2L), "SELECT * FROM joined_chart", List.of());
    }

    @Test
    void routesSingleSourceGeoScatterThroughChartExecution() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> config = geoConfig(Map.of(
                "datasourceId", 1L, "schema", "public", "name", "points"));
        when(queries.catalog(1L)).thenReturn(singleCatalog());
        when(planner.plan(1L, config, "geoscatter", false)).thenReturn(SamplePlan.none());
        when(queries.executeChart(eq(1L), anyString(), anyList())).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner).runBuilder(1L, config, "geoscatter", false);

        verify(queries).executeChart(eq(1L), anyString(), anyList());
        assertThat(result.sql().text()).doesNotContain("LIMIT 1000");
        assertThat(result.rows().truncated()).isFalse();
    }

    @Test
    void routesCrossSourceGeoScatterThroughFederatedChartExecution() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> base = Map.of(
                "datasourceId", 1L, "schema", "public", "name", "points");
        Map<String, Object> labels = Map.of(
                "datasourceId", 2L, "schema", "public", "name", "labels");
        Map<String, Object> config = Map.of(
                "table", base,
                "joins", List.of(Map.of(
                        "table", labels,
                        "type", "left",
                        "on", Map.of("leftColumn", "points.id", "rightColumn", "labels.point_id"))),
                "xAxis", "points.longitude",
                "yAxis", List.of(Map.of("column", "points.latitude", "agg", "none")));
        FederatedCatalog catalog = new FederatedCatalog(Map.of(
                1L, singleCatalog(),
                2L, new SchemaCatalog(Map.of(
                        new SchemaCatalog.Key("public", "labels"),
                        Map.of("point_id", "bigint", "name", "text")))));
        when(federation.catalog(Set.of(1L, 2L))).thenReturn(catalog);
        when(planner.plan(1L, config, "geoscatter", false)).thenReturn(SamplePlan.none());
        when(federation.executeChart(eq(Set.of(1L, 2L)), anyString(), anyList())).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner).runBuilder(1L, config, "geoscatter", false);

        verify(federation).executeChart(eq(Set.of(1L, 2L)), anyString(), anyList());
        assertThat(result.sql().text()).doesNotContain("LIMIT 1000");
    }

    @Test
    void routesSingleSourceSpatialAreaMapThroughChartExecution() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> table = Map.of(
                "datasourceId", 1L, "schema", "public", "name", "areas");
        Map<String, Object> config = Map.of(
                "table", table,
                "geoArea", Map.of(
                        "mode", "spatial",
                        "spatialColumn", "boundary",
                        "nameColumn", "name",
                        "valueColumn", "score"));
        when(queries.catalog(1L)).thenReturn(areaCatalog());
        when(planner.plan(1L, config, "map", false)).thenReturn(SamplePlan.none());
        when(queries.executeChart(eq(1L), anyString(), anyList())).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner).runBuilder(1L, config, "map", false);

        verify(queries).executeChart(eq(1L), anyString(), anyList());
        assertThat(result.sql().text()).doesNotContain("LIMIT 1000");
        assertThat(result.rows().truncated()).isFalse();
    }

    @Test
    void explainsResultPopulationThenExecutesSeededBernoulli() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> config = Map.of(
                "table", Map.of("datasourceId", 1L, "schema", "public", "name", "points"),
                "xAxis", "longitude",
                "yAxis", List.of(Map.of("column", "latitude", "agg", "avg")),
                "sample", Map.of("mode", "manual", "size", 10_000, "seed", 77));
        when(queries.catalog(1L)).thenReturn(singleCatalog());
        when(planner.plan(1L, config, "bar", false))
                .thenReturn(SamplePlan.resultRandom(0, 10_000, 77, "VIEW_RESULT"));
        when(queries.explainEstimatedRows(eq(1L), anyString(), anyList())).thenReturn(500_000L);
        when(queries.executeBernoulli(eq(1L), anyString(), anyList(), eq(true), eq(77L))).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner).runBuilder(1L, config, "bar", false);

        verify(queries).explainEstimatedRows(eq(1L), anyString(), anyList());
        verify(queries).executeBernoulli(eq(1L), anyString(), anyList(), eq(true), eq(77L));
        assertThat(result.sampling().populationEstimate()).isEqualTo(500_000L);
        assertThat(result.sql().params()).containsExactly(0.02);
        assertThat(result.sql().text()).contains("WHERE random() < ?")
                .doesNotContain("ORDER BY random()", "reservoir(");
    }

    @Test
    void crossSourceResultSamplingPlansAndExecutesOnOneFederationSession() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> config = Map.of(
                "table", Map.of("datasourceId", 1L, "schema", "public", "name", "points"),
                "joins", List.of(Map.of(
                        "table", Map.of("datasourceId", 2L, "schema", "public", "name", "labels"),
                        "type", "left",
                        "on", Map.of("leftColumn", "points.id", "rightColumn", "labels.point_id"))),
                "xAxis", "labels.name",
                "yAxis", List.of(Map.of("column", "points.latitude", "agg", "avg")),
                "sample", Map.of("mode", "manual", "size", 10_000, "seed", 77));
        Set<Long> refs = Set.of(1L, 2L);
        FederatedCatalog catalog = new FederatedCatalog(Map.of(
                1L, singleCatalog(),
                2L, new SchemaCatalog(Map.of(
                        new SchemaCatalog.Key("public", "labels"),
                        Map.of("point_id", "bigint", "name", "text")))));
        when(federation.catalog(refs)).thenReturn(catalog);
        when(planner.plan(1L, config, "bar", false))
                .thenReturn(SamplePlan.resultRandom(0, 10_000, 77, "JOIN_RESULT"));
        when(federation.executePlannedBernoulli(
                eq(refs), anyString(), anyList(), any(), eq(true), eq(77L)))
                .thenAnswer(invocation -> {
                    @SuppressWarnings("unchecked")
                    java.util.function.LongFunction<com.chartsdk.query.BuilderSqlBuilder.Sql> factory =
                            invocation.getArgument(3);
                    com.chartsdk.query.BuilderSqlBuilder.Sql sql = factory.apply(500_000L);
                    return new DuckDbFederation.PlannedBernoulli(EMPTY, sql, 500_000L);
                });

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner)
                        .runBuilder(1L, config, "bar", false);

        verify(federation).executePlannedBernoulli(
                eq(refs), anyString(), anyList(), any(), eq(true), eq(77L));
        assertThat(result.sampling().populationEstimate()).isEqualTo(500_000L);
        assertThat(result.sql().params()).contains(0.02);
    }

    private static Map<String, Object> geoConfig(Map<String, Object> table) {
        return Map.of(
                "table", table,
                "xAxis", "longitude",
                "yAxis", List.of(Map.of("column", "latitude", "agg", "none")));
    }

    private static SchemaCatalog singleCatalog() {
        return new SchemaCatalog(Map.of(
                new SchemaCatalog.Key("public", "points"),
                Map.of("id", "bigint", "longitude", "double precision", "latitude", "double precision")));
    }

    private static SchemaCatalog areaCatalog() {
        return new SchemaCatalog(Map.of(
                new SchemaCatalog.Key("public", "areas"),
                Map.of(
                        "id", "bigint",
                        "name", "text",
                        "score", "numeric",
                        "boundary", "geometry(Polygon,4326)")));
    }
}
