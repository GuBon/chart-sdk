package com.chartsdk.federation;

import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.FederatedCatalog;
import com.chartsdk.query.SamplePlan;
import com.chartsdk.query.SamplingPlanner;
import com.chartsdk.query.SchemaCatalog;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class FederatedQueryRunnerTest {

    private static final QueryRows EMPTY = new QueryRows(List.of(), List.of(), 0, false, 1);

    @Test
    void routesSingleSourceGeoScatterThroughUnboundedExecution() {
        QueryExecutor queries = mock(QueryExecutor.class);
        DuckDbFederation federation = mock(DuckDbFederation.class);
        SamplingPlanner planner = mock(SamplingPlanner.class);
        Map<String, Object> config = geoConfig(Map.of(
                "datasourceId", 1L, "schema", "public", "name", "points"));
        when(queries.catalog(1L)).thenReturn(singleCatalog());
        when(planner.plan(1L, config, false)).thenReturn(SamplePlan.none());
        when(queries.executeUnbounded(eq(1L), anyString(), anyList())).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner).runBuilder(1L, config, "geoscatter", false);

        verify(queries).executeUnbounded(eq(1L), anyString(), anyList());
        assertThat(result.sql().text()).doesNotContain("LIMIT 1000");
        assertThat(result.rows().truncated()).isFalse();
    }

    @Test
    void routesCrossSourceGeoScatterThroughUnboundedFederationExecution() {
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
        when(planner.plan(1L, config, false)).thenReturn(SamplePlan.none());
        when(federation.executeUnbounded(eq(Set.of(1L, 2L)), anyString(), anyList())).thenReturn(EMPTY);

        FederatedQueryRunner.BuiltResult result =
                new FederatedQueryRunner(queries, federation, planner).runBuilder(1L, config, "geoscatter", false);

        verify(federation).executeUnbounded(eq(Set.of(1L, 2L)), anyString(), anyList());
        assertThat(result.sql().text()).doesNotContain("LIMIT 1000");
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
}
