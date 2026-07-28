package com.chartsdk.chart;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChartServiceTest {
    private final ChartRepository charts = mock(ChartRepository.class);
    private final CurrentUserProvider currentUser = mock(CurrentUserProvider.class);
    private final QueryExecutor queries = mock(QueryExecutor.class);
    private final ChartComputeService compute = mock(ChartComputeService.class);
    private final ChartOptionConverter converter = mock(ChartOptionConverter.class);
    private final FederatedQueryRunner runner = mock(FederatedQueryRunner.class);
    private final ChartService service = new ChartService(charts, currentUser, queries, compute, converter, runner);

    private final QueryRows queryRows = new QueryRows(
            List.of(Map.of("name", "category", "type", "text"), Map.of("name", "total", "type", "numeric")),
            List.of(List.of("A", 10), List.of("B", 20)),
            2,
            false,
            7
    );

    @BeforeEach
    void setUp() {
        when(currentUser.currentUserId()).thenReturn(OptionalLong.empty());
        when(charts.previewDefinition(null, 12L)).thenReturn(new ChartDefinition(
                12L, 1L, "SELECT category, SUM(amount) AS total FROM sales GROUP BY category", "bar",
                Map.of(), Map.of(), "manual", 3600, 3, null
        ));
        when(compute.serve(12L, "manual", 3600, 3, null))
                .thenReturn(new CachedChartRows(queryRows, Instant.parse("2026-07-20T00:00:00Z")));
        when(converter.convert(queryRows, "bar", Map.of())).thenReturn(Map.of("series", List.of()));
    }

    @Test
    void singlePreviewIncludesCachedRowsForEditorRestore() {
        Map<String, Object> preview = service.preview(12L);

        assertThat(preview)
                .containsEntry("columns", queryRows.columns())
                .containsEntry("rows", queryRows.rows())
                .containsEntry("rowCount", 2)
                .containsEntry("elapsedMs", 7L)
                .containsKey("option");
    }

    @Test
    @SuppressWarnings("unchecked")
    void batchPreviewOmitsRowsToKeepCardPayloadSmall() {
        Map<String, Object> response = service.previews("12");
        Map<String, Object> previews = (Map<String, Object>) response.get("previews");
        Map<String, Object> preview = (Map<String, Object>) previews.get("12");

        assertThat(preview).containsKey("option");
        assertThat(preview).doesNotContainKeys("columns", "rows", "elapsedMs");
    }

    @Test
    void refreshChecksOwnerScopeBeforeRecomputing() {
        when(currentUser.currentUserId()).thenReturn(OptionalLong.of(42L));
        when(charts.previewDefinition(42L, 12L)).thenThrow(
                new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found."));

        assertThatThrownBy(() -> service.refresh(12L))
                .isInstanceOf(ApiException.class)
                .hasMessage("Chart not found.");

        verify(charts).previewDefinition(42L, 12L);
        verify(compute, never()).recompute(anyLong());
    }
}
