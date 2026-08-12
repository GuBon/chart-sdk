package com.chartsdk.query.engine;

import com.chartsdk.cache.CachedResultSample;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.Catalog;
import com.chartsdk.query.PointCollectionResult;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SamplePlan;

import java.util.Set;
import java.util.function.LongFunction;

/**
 * 단일 PostgreSQL 소스 직접 실행 엔진 — 기존 {@link QueryExecutor} 경로를 포트 뒤로 감싼다.
 * 위임만 하므로 단일 소스 차트의 SQL·성능·행 제한 동작은 기존과 동일하다(설계 §0 회귀 0).
 */
public final class PostgresQueryEngine implements QueryEngine {

    private final QueryExecutor queries;

    public PostgresQueryEngine(QueryExecutor queries) {
        this.queries = queries;
    }

    private static long only(Set<Long> datasourceIds) {
        return datasourceIds.iterator().next();
    }

    @Override
    public RefRenderer renderer() {
        return RefRenderer.SINGLE;
    }

    @Override
    public Catalog catalog(Set<Long> datasourceIds) {
        return queries.catalog(only(datasourceIds));
    }

    @Override
    public QueryRows executeChart(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        return queries.executeChart(only(datasourceIds), sql.text(), sql.params());
    }

    @Override
    public QueryRows executePreview(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        return queries.execute(only(datasourceIds), sql.text(), sql.params());
    }

    @Override
    public PointCollectionResult executeAutoPoints(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql,
                                                   int targetSize, long seed) {
        return queries.executeAutoPointChart(only(datasourceIds), sql.text(), sql.params(), targetSize, seed);
    }

    @Override
    public long explainEstimatedRows(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        return queries.explainEstimatedRows(only(datasourceIds), sql.text(), sql.params());
    }

    @Override
    public CachedResultSample loadResultSample(Set<Long> datasourceIds, BuilderSqlBuilder.Sql population,
                                               LongFunction<BuilderSqlBuilder.ResultSampleSource> sourceFactory,
                                               SamplePlan plan) {
        long datasourceId = only(datasourceIds);
        long estimate = plan.populationEstimate() > 0
                ? plan.populationEstimate()
                : queries.explainEstimatedRows(datasourceId, population.text(), population.params());
        BuilderSqlBuilder.ResultSampleSource source = sourceFactory.apply(estimate);
        QueryRows rows = queries.executeCachedSample(
                datasourceId, source.sql().text(), source.sql().params(), plan.seed());
        return new CachedResultSample(rows, source.sql().sampling(), source.sql());
    }

    @Override
    public Planned executeResultRandom(Set<Long> datasourceIds, BuilderSqlBuilder.Sql population,
                                       LongFunction<BuilderSqlBuilder.Sql> sqlFactory,
                                       boolean chartResult, long seed) {
        long datasourceId = only(datasourceIds);
        long estimate = queries.explainEstimatedRows(datasourceId, population.text(), population.params());
        BuilderSqlBuilder.Sql sql = sqlFactory.apply(estimate);
        QueryRows rows = queries.executeBernoulli(datasourceId, sql.text(), sql.params(), chartResult, seed);
        return new Planned(rows, sql);
    }
}
