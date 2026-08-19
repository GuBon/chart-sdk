package com.chartsdk.chart;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartCacheExpectation;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import com.chartsdk.web.dto.ChartSaveRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChartServiceTest {
    private final ChartRepository charts = mock(ChartRepository.class);
    private final CurrentUserProvider currentUser = mock(CurrentUserProvider.class);
    private final QueryExecutor queries = mock(QueryExecutor.class);
    private final ChartComputeService compute = mock(ChartComputeService.class);
    private final ChartOptionConverter converter = mock(ChartOptionConverter.class);
    private final FederatedQueryRunner runner = mock(FederatedQueryRunner.class);
    private final ChartService service = new ChartService(
            charts, currentUser, queries, compute, converter, runner,
            new ChartDefinitionWriter(charts), null);

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
        ChartDefinition definition = new ChartDefinition(
                12L, 1L, "SELECT category, SUM(amount) AS total FROM sales GROUP BY category", "bar",
                Map.of(), Map.of(), "manual", 3, null
        );
        CachedChartRows cached = new CachedChartRows(
                queryRows, Instant.parse("2026-07-20T00:00:00Z"));
        when(charts.previewDefinition(null, 12L)).thenReturn(definition);
        when(charts.previewDefinitions(null, List.of(12L))).thenReturn(Map.of(12L, definition));
        when(compute.serve(12L, "manual", 3, null))
                .thenReturn(cached);
        when(compute.cachedCompatible(Map.of(12L, new ChartCacheExpectation(3, null))))
                .thenReturn(Map.of(12L, cached));
        when(converter.convert(queryRows, "bar", Map.of(), Map.of(), "manual"))
                .thenReturn(Map.of("series", List.of()));
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
        verify(charts).previewDefinitions(null, List.of(12L));
        verify(compute).cachedCompatible(Map.of(12L, new ChartCacheExpectation(3, null)));
        verify(compute, never()).serve(anyLong(), any(), anyInt(), any());
        verify(compute, never()).recompute(anyLong());
    }

    @Test
    @SuppressWarnings("unchecked")
    void batchPreviewReportsMissingSnapshotsWithoutStartingRecomputation() {
        ChartDefinition second = new ChartDefinition(
                13L, 1L, "SELECT category FROM sales", "bar",
                Map.of(), Map.of(), "manual", 2, null);
        ChartDefinition first = charts.previewDefinition(null, 12L);
        Map<Long, ChartDefinition> definitions = Map.of(12L, first, 13L, second);
        Map<Long, ChartCacheExpectation> expectations = Map.of(
                12L, new ChartCacheExpectation(3, null),
                13L, new ChartCacheExpectation(2, null));
        CachedChartRows firstRows = new CachedChartRows(
                queryRows, Instant.parse("2026-07-20T00:00:00Z"));
        when(charts.previewDefinitions(null, List.of(12L, 13L))).thenReturn(definitions);
        when(compute.cachedCompatible(expectations)).thenReturn(Map.of(12L, firstRows));

        Map<String, Object> response = service.previews("12,13");
        Map<String, Object> errors = (Map<String, Object>) response.get("errors");

        assertThat(errors).containsEntry("13", "Preview snapshot is not ready.");
        verify(compute, never()).serve(anyLong(), any(), anyInt(), any());
        verify(compute, never()).recompute(anyLong());
    }

    @Test
    @SuppressWarnings("unchecked")
    void batchPreviewRecomputesLiveChartsWithoutFetchingTheirSnapshots() {
        ChartDefinition manual = charts.previewDefinition(null, 12L);
        ChartDefinition live = new ChartDefinition(
                24L, 1L, "SELECT category FROM sales", "bar",
                Map.of(), Map.of(), "live", 5, null);
        CachedChartRows fresh = new CachedChartRows(
                queryRows, Instant.parse("2026-08-07T06:00:00Z"));
        when(charts.previewDefinitions(null, List.of(12L, 24L)))
                .thenReturn(Map.of(12L, manual, 24L, live));
        when(compute.serve(24L, "live", 5, null)).thenReturn(fresh);
        when(converter.convert(queryRows, "bar", Map.of(), Map.of(), "live"))
                .thenReturn(Map.of("series", List.of(), "__chartsdkShowComputedAt", false));

        Map<String, Object> response = service.previews("12,24");
        Map<String, Object> previews = (Map<String, Object>) response.get("previews");

        assertThat(previews).containsKeys("12", "24");
        // live 카드는 재계산 결과만 쓰므로 대형 JSONB 스냅샷을 배치 조회에서 읽지 않는다.
        verify(compute).cachedCompatible(Map.of(12L, new ChartCacheExpectation(3, null)));
        assertThat((Map<String, Object>) previews.get("24"))
                .containsEntry("computedAt", "2026-08-07T06:00:00Z");
        verify(compute).serve(24L, "live", 5, null);
    }

    @Test
    void adminListsAllOwnersButOtherOwnersLiveCardsUseStoredSnapshotsOnly() {
        // 관리자(42)의 목록: 12 는 본인 차트(manual), 24 는 타인의 live 차트.
        when(currentUser.currentUserId()).thenReturn(OptionalLong.of(42L));
        when(currentUser.isAdmin()).thenReturn(true);
        ChartDefinition mine = charts.previewDefinition(null, 12L);
        ChartDefinition othersLive = new ChartDefinition(
                24L, 1L, "SELECT category FROM sales", "bar",
                Map.of(), Map.of(), "live", 5, null);
        when(charts.previewDefinitions(null, List.of(12L, 24L)))
                .thenReturn(Map.of(12L, mine, 24L, othersLive));
        when(charts.previewDefinitions(42L, List.of(12L, 24L))).thenReturn(Map.of(12L, mine));
        Map<Long, ChartCacheExpectation> expectations = Map.of(
                12L, new ChartCacheExpectation(3, null),
                24L, new ChartCacheExpectation(5, null));
        when(compute.cachedCompatible(expectations)).thenReturn(Map.of());

        service.list(new ChartListQuery(null, null, null, null, null, null, null, null));
        service.previews("12,24");

        // 목록은 소유자 조건 없이(전체), 타인의 live 카드는 재계산 대신 저장 스냅샷만 조회한다.
        verify(charts).list(isNull(), any());
        verify(compute).cachedCompatible(expectations);
        verify(compute, never()).serve(anyLong(), any(), anyInt(), any());
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

    @Test
    void createReusesBuilderValidationResultForCacheSeedWithoutSecondSourceQuery() {
        Map<String, Object> builder = Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum"))
        );
        SamplingMetadata sampling = SamplingMetadata.system(10);
        FederatedQueryRunner.BuiltResult built = new FederatedQueryRunner.BuiltResult(
                queryRows,
                new BuilderSqlBuilder.Sql("SELECT category, SUM(amount) FROM sales GROUP BY category", List.of(), sampling),
                Set.of(1L),
                sampling
        );
        when(runner.runBuilder(1L, builder, "bar", false, 3600)).thenReturn(built);
        when(charts.create(eq(null), any(ChartSaveRequest.class))).thenReturn(21L);
        when(charts.get(null, 21L)).thenReturn(Map.of("id", 21L));
        ChartSaveRequest request = new ChartSaveRequest(
                "매출", null, 1L, "builder", null, builder, "bar", Map.of(), "manual", null);

        assertThat(service.create(request)).containsEntry("id", 21L);

        verify(runner, times(1)).runBuilder(1L, builder, "bar", false, 3600);
        verify(compute).seedPreparedQuietly(eq(21L), eq(queryRows), eq(0), eq(sampling), anyMap());
        verify(compute, never()).recompute(anyLong());
    }

    @Test
    void liveBuilderSaveBypassesTheL1SampleCache() {
        Map<String, Object> builder = Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum")),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 77));
        FederatedQueryRunner.BuiltResult built = new FederatedQueryRunner.BuiltResult(
                queryRows,
                new BuilderSqlBuilder.Sql("SELECT category, SUM(amount) FROM sales GROUP BY category", List.of()),
                Set.of(1L));
        when(runner.runBuilder(1L, builder, "bar", false, 0)).thenReturn(built);
        when(charts.create(eq(null), any(ChartSaveRequest.class))).thenReturn(23L);
        when(charts.get(null, 23L)).thenReturn(Map.of("id", 23L));
        ChartSaveRequest request = new ChartSaveRequest(
                "live", null, 1L, "builder", null, builder, "bar", Map.of(), "live", null);

        service.create(request);

        verify(runner).runBuilder(1L, builder, "bar", false, 0);
    }

    @Test
    void rawSqlSaveRunsUnboundedQueryOnceAndSeedsThatExactResult() {
        String sql = "SELECT category, amount FROM sales";
        when(queries.executeChart(1L, sql, List.of())).thenReturn(queryRows);
        when(charts.create(eq(null), any(ChartSaveRequest.class))).thenReturn(22L);
        when(charts.get(null, 22L)).thenReturn(Map.of("id", 22L));
        ChartSaveRequest request = new ChartSaveRequest(
                "원시 SQL", null, 1L, "raw", sql, Map.of("table", "sales"), "bar", Map.of(), "manual", null);

        service.create(request);

        verify(queries, times(1)).executeChart(1L, sql, List.of());
        verify(compute).seedPreparedQuietly(eq(22L), eq(queryRows), eq(0), isNull(), anyMap());
        verify(compute, never()).recompute(anyLong());
    }

    @Test
    void saveRejectsChartWithoutPrimaryTableContext() {
        ChartSaveRequest request = new ChartSaveRequest(
                "원시 SQL", null, 1L, "raw", "SELECT 1", null, "bar", Map.of(), "manual", null);

        assertThatThrownBy(() -> service.create(request))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("MAIN_TABLE_REQUIRED");

        verify(queries, never()).executeChart(anyLong(), any(), any());
        verify(charts, never()).create(any(), any());
    }

    @Test
    void updateSeedsPreparedResultWithRepositoryReturnedVersion() {
        Map<String, Object> builder = Map.of("table", "sales");
        when(runner.runBuilder(1L, builder, "bar", false, 3600)).thenReturn(
                new FederatedQueryRunner.BuiltResult(
                        queryRows,
                        new BuilderSqlBuilder.Sql("SELECT * FROM sales", List.of()),
                        Set.of(1L)
                ));
        when(charts.update(eq(null), eq(12L), any(ChartSaveRequest.class))).thenReturn(4);
        when(charts.get(null, 12L)).thenReturn(Map.of("id", 12L, "version", 4));
        ChartSaveRequest request = new ChartSaveRequest(
                "수정", null, 1L, "builder", null, builder, "bar", Map.of(), "manual", 3);

        service.update(12L, request);

        verify(compute).seedPreparedQuietly(eq(12L), eq(queryRows), eq(4), isNull(), anyMap());
    }
}
