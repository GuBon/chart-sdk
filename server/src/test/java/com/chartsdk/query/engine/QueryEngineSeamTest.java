package com.chartsdk.query.engine;

import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.PointSamplingMetrics;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SamplePlan;
import com.chartsdk.query.SamplingPlanner;
import com.chartsdk.query.SchemaCatalog;
import com.chartsdk.testing.FakeQueryEngine;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 확장 이음매 증명(설계 §5 P5·§6.2 확장 리허설) — 실행 엔진과 판정 정책이 진짜 주입점인지
 * {@link FakeQueryEngine}(제3의 엔진 구현)으로 검증한다. runner·SQL 생성기 무변경으로
 * ① 새 엔진이 꽂히고 ② 정책 한 곳만 바꾸면 라우팅이 바뀐다.
 */
class QueryEngineSeamTest {

    private static final QueryRows EMPTY = new QueryRows(List.of(), List.of(), 0, false, 1);

    private static SchemaCatalog catalog() {
        return new SchemaCatalog(Map.of(
                new SchemaCatalog.Key("public", "points"),
                Map.of("id", "bigint", "longitude", "double precision", "latitude", "double precision")));
    }

    private static Map<String, Object> config() {
        return Map.of(
                "table", Map.of("datasourceId", 1L, "schema", "public", "name", "points"),
                "xAxis", "longitude",
                "yAxis", List.of(Map.of("column", "latitude", "agg", "sum")));
    }

    private static SamplingPlanner nonePlanner() {
        SamplingPlanner planner = mock(SamplingPlanner.class);
        when(planner.plan(anyLong(), any(), anyString(), anyBoolean())).thenReturn(SamplePlan.none());
        return planner;
    }

    private static FederatedQueryRunner runner(FakeQueryEngine single, FakeQueryEngine federated,
                                               SourceCompositionPolicy policy) {
        return new FederatedQueryRunner(single, federated, policy, nonePlanner(),
                null, null, PointSamplingMetrics.noOp());
    }

    @Test
    void injectedEngineExecutesSingleSourceChartsWithoutRunnerChanges() {
        FakeQueryEngine single = new FakeQueryEngine(RefRenderer.SINGLE, catalog(), EMPTY);
        FakeQueryEngine federated = new FakeQueryEngine(RefRenderer.FEDERATED, catalog(), EMPTY);

        FederatedQueryRunner.BuiltResult result = runner(single, federated, new DistinctCountCompositionPolicy())
                .runBuilder(1L, config(), "bar", false);

        assertThat(single.executedSql).hasSize(1);
        assertThat(federated.executedSql).isEmpty();
        assertThat(result.sql().text()).contains("\"public\".\"points\""); // 엔진의 렌더러가 SQL 생성에 그대로 흐른다
        assertThat(result.datasourceIds()).containsExactly(1L);
    }

    @Test
    void policyAloneRedirectsExecutionToAnotherEngine() {
        // 확장 리허설: "파일 소스는 항상 페더레이션 엔진" 같은 새 규칙은 정책 한 곳만 바꾸면 된다.
        SourceCompositionPolicy alwaysFederated = new SourceCompositionPolicy() {
            @Override
            public boolean requiresFederation(Set<Long> datasourceIds) {
                return true;
            }

            @Override
            public boolean requiresSnapshot(int distinctSourceCount) {
                return true;
            }
        };
        FakeQueryEngine single = new FakeQueryEngine(RefRenderer.SINGLE, catalog(), EMPTY);
        FakeQueryEngine federated = new FakeQueryEngine(RefRenderer.FEDERATED, catalog(), EMPTY);

        FederatedQueryRunner.BuiltResult result = runner(single, federated, alwaysFederated)
                .runBuilder(1L, config(), "bar", false);

        assertThat(single.executedSql).isEmpty();
        assertThat(federated.executedSql).hasSize(1);
        assertThat(result.sql().text()).contains("\"ds1\".\"public\".\"points\""); // FEDERATED 렌더러 규약
    }

    @Test
    void storedSqlFollowsTheSamePolicyRouting() {
        FakeQueryEngine single = new FakeQueryEngine(RefRenderer.SINGLE, catalog(), EMPTY);
        FakeQueryEngine federated = new FakeQueryEngine(RefRenderer.FEDERATED, catalog(), EMPTY);
        FederatedQueryRunner runner = runner(single, federated, new DistinctCountCompositionPolicy());

        runner.runStored(Set.of(1L), 1L, "SELECT 1");
        runner.runStored(Set.of(1L, 2L), 1L, "SELECT 2");

        assertThat(single.executedSql).containsExactly("SELECT 1");
        assertThat(federated.executedSql).containsExactly("SELECT 2");
    }
}
