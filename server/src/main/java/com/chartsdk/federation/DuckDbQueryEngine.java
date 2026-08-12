package com.chartsdk.federation;

import com.chartsdk.cache.CachedResultSample;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.Catalog;
import com.chartsdk.query.PointCollectionResult;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SamplePlan;
import com.chartsdk.query.engine.QueryEngine;

import java.util.Set;
import java.util.function.LongFunction;

/**
 * DuckDB 페더레이션 실행 엔진 — 기존 {@link DuckDbFederation}을 포트 뒤로 감싼다.
 * RESULT_RANDOM 계열은 EXPLAIN 추정과 표본 실행이 같은 ATTACH 세션에서 일어나야 하므로
 * planned 계열 API 로 위임한다(재현성 — 표본추출 계약).
 */
public final class DuckDbQueryEngine implements QueryEngine {

    private final DuckDbFederation federation;

    public DuckDbQueryEngine(DuckDbFederation federation) {
        this.federation = federation;
    }

    @Override
    public RefRenderer renderer() {
        return RefRenderer.FEDERATED;
    }

    @Override
    public Catalog catalog(Set<Long> datasourceIds) {
        return federation.catalog(datasourceIds);
    }

    @Override
    public QueryRows executeChart(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        return federation.executeChart(datasourceIds, sql.text(), sql.params());
    }

    @Override
    public QueryRows executePreview(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        return federation.execute(datasourceIds, sql.text(), sql.params());
    }

    @Override
    public PointCollectionResult executeAutoPoints(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql,
                                                   int targetSize, long seed) {
        return federation.executeAutoPointChart(datasourceIds, sql.text(), sql.params(), targetSize, seed);
    }

    @Override
    public long explainEstimatedRows(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        return federation.explainEstimatedRows(datasourceIds, sql.text(), sql.params());
    }

    @Override
    public CachedResultSample loadResultSample(Set<Long> datasourceIds, BuilderSqlBuilder.Sql population,
                                               LongFunction<BuilderSqlBuilder.ResultSampleSource> sourceFactory,
                                               SamplePlan plan) {
        DuckDbFederation.PlannedResultSample planned = federation.executePlannedResultSample(
                datasourceIds, population.text(), population.params(), sourceFactory, plan.seed());
        return new CachedResultSample(
                planned.rows(), planned.source().sql().sampling(), planned.source().sql());
    }

    @Override
    public Planned executeResultRandom(Set<Long> datasourceIds, BuilderSqlBuilder.Sql population,
                                       LongFunction<BuilderSqlBuilder.Sql> sqlFactory,
                                       boolean chartResult, long seed) {
        DuckDbFederation.PlannedBernoulli planned = federation.executePlannedBernoulli(
                datasourceIds, population.text(), population.params(), sqlFactory, chartResult, seed);
        return new Planned(planned.rows(), planned.sql());
    }
}
