package com.chartsdk.web;

import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.dto.QueryRunRequest;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
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
}
