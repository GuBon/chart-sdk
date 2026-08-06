package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class SamplingPlannerTest {

    private static QueryRows rows(List<List<Object>> data) {
        return new QueryRows(List.of(), data, data.size(), false, 1);
    }

    /** reltuples·PK·MIN/MAX 카탈로그 조사 쿼리를 SQL 내용으로 스텁. */
    private static QueryExecutor stub(long reltuples, List<List<Object>> pk, long min, long max) {
        QueryExecutor qe = mock(QueryExecutor.class);
        when(qe.execute(anyLong(), contains("reltuples"), any())).thenReturn(rows(List.of(List.of("r", reltuples))));
        when(qe.execute(anyLong(), contains("indisprimary"), any())).thenReturn(rows(pk));
        when(qe.execute(anyLong(), contains("MIN("), any())).thenReturn(rows(List.of(List.of(min, max))));
        return qe;
    }

    private static Map<String, Object> autoSample(int seed) {
        return Map.of("table", "sales", "sample", Map.of("mode", "auto", "seed", seed));
    }

    @Test
    void picksIndexRandomWhenSingleIntegerPkAndDenseKeys() {
        QueryExecutor qe = stub(500_000_000L, List.of(List.of("id")), 1L, 500_000_000L);

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, autoSample(48291), false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.INDEX_RANDOM);
        assertThat(plan.pkColumn()).isEqualTo("id");
        assertThat(plan.populationEstimate()).isEqualTo(500_000_000L);
        assertThat(plan.sampleSize()).isEqualTo(SamplingPlanner.DEFAULT_SIZE);
        assertThat(plan.keys()).hasSize(SamplingPlanner.DEFAULT_SIZE); // 밀도 1.0 → 오버샘플 없음
    }

    @Test
    void seedProducesDeterministicKeys() {
        QueryExecutor qe = stub(500_000_000L, List.of(List.of("id")), 1L, 500_000_000L);
        long[] a = new SamplingPlanner(qe).plan(1L, autoSample(777), false).keys();
        long[] b = new SamplingPlanner(qe).plan(1L, autoSample(777), false).keys();
        assertThat(a).containsExactly(b);
    }

    @Test
    void fallsBackToFullScanForSmallTables() {
        QueryExecutor qe = mock(QueryExecutor.class);
        when(qe.execute(anyLong(), contains("reltuples"), any())).thenReturn(rows(List.of(List.of("r", 40_000L))));

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, autoSample(1), false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.FULL_SCAN);
    }

    @Test
    void fallsBackToSystemWhenNoIntegerPk() {
        QueryExecutor qe = mock(QueryExecutor.class);
        when(qe.execute(anyLong(), contains("reltuples"), any())).thenReturn(rows(List.of(List.of("r", 500_000_000L))));
        when(qe.execute(anyLong(), contains("indisprimary"), any())).thenReturn(rows(List.of())); // 정수형 단일 PK 없음

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, autoSample(1), false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.SYSTEM);
        assertThat(plan.fallbackReason()).isEqualTo("NO_INTEGER_PK");
    }

    @Test
    void legacyRateKeepsSystemSamplingContractEvenWhenIntegerPkExists() {
        QueryExecutor qe = mock(QueryExecutor.class);
        when(qe.execute(anyLong(), contains("reltuples"), any()))
                .thenReturn(rows(List.of(List.of("r", 500_000_000L))));
        Map<String, Object> cfg = Map.of(
                "table", "sales",
                "sample", Map.of("mode", "manual", "rate", 10, "seed", 3));

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, cfg, false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.SYSTEM);
        assertThat(plan.blockRate()).isEqualTo(10.0);
        assertThat(plan.fallbackReason()).isEqualTo("SYSTEM_PINNED");
    }

    @Test
    void fallsBackToSystemWhenKeysTooSparse() {
        // 밀도 = 1e6 / (1..1e12 범위) ≈ 0 < 0.5 → 오버샘플 비용 과다로 SYSTEM.
        QueryExecutor qe = stub(1_000_000L, List.of(List.of("id")), 1L, 1_000_000_000_000L);

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, autoSample(1), false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.SYSTEM);
        assertThat(plan.fallbackReason()).isEqualTo("SPARSE_KEYS");
    }

    @Test
    void returnsNoneForRowsModeOrMissingSample() {
        SamplingPlanner planner = new SamplingPlanner(mock(QueryExecutor.class));
        assertThat(planner.plan(1L, Map.of("table", "sales"), false).method()).isEqualTo(SamplePlan.Method.NONE);
        assertThat(planner.plan(1L, autoSample(1), true).method()).isEqualTo(SamplePlan.Method.NONE);
    }

    @Test
    void usesResultRandomForJoinWithoutInspectingAnyBaseTable() {
        QueryExecutor qe = mock(QueryExecutor.class);
        Map<String, Object> cfg = Map.of(
                "table", "sales",
                "joins", List.of(Map.of("table", "customers")),
                "sample", Map.of("mode", "manual", "size", 12_000, "seed", 7));

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, cfg, false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.RESULT_RANDOM);
        assertThat(plan.sampleSize()).isEqualTo(12_000);
        assertThat(plan.fallbackReason()).isEqualTo("JOIN_RESULT");
        verifyNoInteractions(qe);
    }

    @Test
    void usesResultRandomForOrdinaryView() {
        QueryExecutor qe = mock(QueryExecutor.class);
        when(qe.execute(anyLong(), contains("reltuples"), any())).thenReturn(rows(List.of(List.of("v", 0L))));

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, autoSample(9), false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.RESULT_RANDOM);
        assertThat(plan.fallbackReason()).isEqualTo("VIEW_RESULT");
    }

    @Test
    void automaticBarSamplingIsDisabledButManualBarSamplingIsPreserved() {
        QueryExecutor qe = mock(QueryExecutor.class);
        Map<String, Object> automatic = Map.of(
                "table", "sales",
                "sample", Map.of("mode", "auto"),
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum")));

        SamplePlan exact = new SamplingPlanner(qe).plan(1L, automatic, "bar", false);

        assertThat(exact.method()).isEqualTo(SamplePlan.Method.FULL_SCAN);
        verifyNoInteractions(qe);
    }

    @Test
    void filteredAutomaticScatterUsesPostFilterEstimateAndSmallResultsStayExact() {
        QueryExecutor qe = mock(QueryExecutor.class);
        Map<String, Object> config = Map.of(
                "table", "sales",
                "where", List.of(Map.of("column", "amount", "op", "gt", "value", 0)),
                "sample", Map.of("mode", "auto"),
                "yAxis", List.of(Map.of("column", "amount", "agg", "none")));

        SamplePlan planned = new SamplingPlanner(qe).plan(1L, config, "scatter", false);

        assertThat(planned.method()).isEqualTo(SamplePlan.Method.RESULT_RANDOM);
        assertThat(planned.automatic()).isTrue();
        assertThat(planned.withPopulationEstimate(9_000).method()).isEqualTo(SamplePlan.Method.FULL_SCAN);
        assertThat(planned.withPopulationEstimate(50_000).method()).isEqualTo(SamplePlan.Method.RESULT_RANDOM);
        verifyNoInteractions(qe);
    }

    @Test
    void unfilteredAutomaticScatterSamplesAboveThePointTarget() {
        QueryExecutor qe = stub(20_000L, List.of(List.of("id")), 1L, 20_000L);
        Map<String, Object> config = Map.of(
                "table", "sales",
                "sample", Map.of("mode", "auto", "seed", 7),
                "yAxis", List.of(Map.of("column", "amount", "agg", "none")));

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, config, "scatter", false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.INDEX_RANDOM);
        assertThat(plan.sampleSize()).isEqualTo(SamplingPlanner.DEFAULT_SIZE);
    }

    @Test
    void materializedViewKeepsPhysicalSystemSamplingFallback() {
        QueryExecutor qe = mock(QueryExecutor.class);
        when(qe.execute(anyLong(), contains("reltuples"), any())).thenReturn(rows(List.of(List.of("m", 2_000_000L))));
        when(qe.execute(anyLong(), contains("indisprimary"), any())).thenReturn(rows(List.of()));

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, autoSample(9), false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.SYSTEM);
        assertThat(plan.fallbackReason()).isEqualTo("NO_INTEGER_PK");
    }
}
