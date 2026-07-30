package com.chartsdk.web;

import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.dto.BuilderQueryRequest;
import com.chartsdk.web.dto.ChartPreviewRequest;
import com.chartsdk.web.dto.QueryRunRequest;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class QueryControllerTest {

    private static final QueryRows EMPTY = new QueryRows(List.of(), List.of(), 0, false, 1);

    @Test
    void rawSqlChartExecutionReturnsAllRows() {
        QueryExecutor queries = mock(QueryExecutor.class);
        ChartOptionConverter converter = mock(ChartOptionConverter.class);
        FederatedQueryRunner runner = mock(FederatedQueryRunner.class);
        when(queries.executeUnbounded(7L, "SELECT * FROM sales", List.of())).thenReturn(EMPTY);
        when(converter.convert(EMPTY, "bar", Map.of())).thenReturn(Map.of("series", List.of()));

        Map<String, Object> result = new QueryController(queries, converter, runner).run(
                new QueryRunRequest(7L, "SELECT * FROM sales", "bar", Map.of()));

        verify(queries).executeUnbounded(7L, "SELECT * FROM sales", List.of());
        assertThat(result).containsEntry("truncated", false).containsKey("option");
    }

    @Test
    void rawSqlDataInspectionKeepsThePreviewLimit() {
        QueryExecutor queries = mock(QueryExecutor.class);
        ChartOptionConverter converter = mock(ChartOptionConverter.class);
        FederatedQueryRunner runner = mock(FederatedQueryRunner.class);
        when(queries.execute(7L, "SELECT * FROM sales")).thenReturn(EMPTY);

        Map<String, Object> result = new QueryController(queries, converter, runner).run(
                new QueryRunRequest(7L, "SELECT * FROM sales", null, Map.of()));

        verify(queries).execute(7L, "SELECT * FROM sales");
        assertThat(result).containsEntry("truncated", false).doesNotContainKey("option");
    }

    @Test
    void axislessBuilderRowsReturnGeneratedSqlWithoutChartOption() {
        QueryExecutor queries = mock(QueryExecutor.class);
        ChartOptionConverter converter = mock(ChartOptionConverter.class);
        FederatedQueryRunner runner = mock(FederatedQueryRunner.class);
        Map<String, Object> cfg = Map.of(
                "table", Map.of("datasourceId", 7L, "schema", "public", "name", "sales"),
                "xAxis", "",
                "yAxis", List.of(),
                "where", List.of(),
                "orderBy", Map.of("target", "column:amount", "direction", "desc")
        );
        BuilderSqlBuilder.Sql sql = new BuilderSqlBuilder.Sql(
                "SELECT * FROM \"public\".\"sales\" ORDER BY \"amount\" DESC LIMIT 1000", List.of());
        when(runner.runBuilder(7L, cfg, "bar", true))
                .thenReturn(new FederatedQueryRunner.BuiltResult(EMPTY, sql, Set.of(7L)));

        Map<String, Object> result = new QueryController(queries, converter, runner).runBuilder(
                new BuilderQueryRequest(7L, cfg, "bar", Map.of(), "rows"));

        assertThat(result)
                .containsEntry("generatedSql", "SELECT * FROM \"public\".\"sales\" ORDER BY \"amount\" DESC LIMIT 1000")
                .doesNotContainKey("option");
    }

    @Test
    void builderExecutionAndOptionOnlyPreviewKeepBuilderFieldMetadata() {
        QueryExecutor queries = mock(QueryExecutor.class);
        ChartOptionConverter converter = mock(ChartOptionConverter.class);
        FederatedQueryRunner runner = mock(FederatedQueryRunner.class);
        Map<String, Object> cfg = Map.of(
                "xAxis", "sales.region",
                "yAxis", List.of(Map.of("column", "sales.amount", "agg", "sum", "alias", "월 매출"))
        );
        BuilderSqlBuilder.Sql sql = new BuilderSqlBuilder.Sql("SELECT region, SUM(amount) FROM sales", List.of());
        when(runner.runBuilder(7L, cfg, "bar", false))
                .thenReturn(new FederatedQueryRunner.BuiltResult(EMPTY, sql, Set.of(7L)));
        when(converter.convert(
                any(QueryRows.class),
                eq("bar"),
                eq(Map.of()),
                eq(cfg)
        ))
                .thenReturn(Map.of("series", List.of()));

        Map<String, Object> runResult = new QueryController(queries, converter, runner).runBuilder(
                new BuilderQueryRequest(7L, cfg, "bar", Map.of(), "aggregate"));
        Map<String, Object> previewResult = new QueryController(queries, converter, runner).preview(
                new ChartPreviewRequest(
                        "bar",
                        Map.of(),
                        cfg,
                        Map.of("columns", List.of(), "rows", List.of())
                ));

        assertThat(runResult).containsKey("option");
        assertThat(previewResult).containsKey("option");
        verify(converter, times(2)).convert(
                any(QueryRows.class),
                eq("bar"),
                eq(Map.of()),
                eq(cfg)
        );
    }
}
