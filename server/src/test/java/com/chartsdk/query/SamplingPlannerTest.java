package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SamplingPlannerTest {

    private static QueryRows rows(List<List<Object>> data) {
        return new QueryRows(List.of(), data, data.size(), false, 1);
    }

    /** reltuples·PK·MIN/MAX 카탈로그 조사 쿼리를 SQL 내용으로 스텁. */
    private static QueryExecutor stub(long reltuples, List<List<Object>> pk, long min, long max) {
        QueryExecutor qe = mock(QueryExecutor.class);
        when(qe.execute(anyLong(), contains("reltuples"), any())).thenReturn(rows(List.of(List.of(reltuples))));
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
        when(qe.execute(anyLong(), contains("reltuples"), any())).thenReturn(rows(List.of(List.of(40_000L))));

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, autoSample(1), false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.FULL_SCAN);
    }

    @Test
    void fallsBackToSystemWhenNoIntegerPk() {
        QueryExecutor qe = mock(QueryExecutor.class);
        when(qe.execute(anyLong(), contains("reltuples"), any())).thenReturn(rows(List.of(List.of(500_000_000L))));
        when(qe.execute(anyLong(), contains("indisprimary"), any())).thenReturn(rows(List.of())); // 정수형 단일 PK 없음

        SamplePlan plan = new SamplingPlanner(qe).plan(1L, autoSample(1), false);

        assertThat(plan.method()).isEqualTo(SamplePlan.Method.SYSTEM);
        assertThat(plan.fallbackReason()).isEqualTo("NO_INTEGER_PK");
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
}
