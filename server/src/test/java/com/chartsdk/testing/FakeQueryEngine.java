package com.chartsdk.testing;

import com.chartsdk.cache.CachedResultSample;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.Catalog;
import com.chartsdk.query.PointCollectionResult;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SamplePlan;
import com.chartsdk.query.engine.QueryEngine;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.LongFunction;

/**
 * {@link QueryEngine}의 세 번째 구현(테스트 전용) — 실행 엔진 포트가 진짜 이음매인지
 * (새 엔진이 runner 무변경으로 꽂히는지) 증명한다(설계 §5 P5). 받은 SQL 을 기록하고
 * 준비된 rows 를 돌려준다.
 */
public final class FakeQueryEngine implements QueryEngine {

    private final RefRenderer renderer;
    private final Catalog catalog;
    private final QueryRows rows;

    /** runner 가 이 엔진으로 실행한 SQL 텍스트(호출 순서 보존). */
    public final List<String> executedSql = new ArrayList<>();

    public FakeQueryEngine(RefRenderer renderer, Catalog catalog, QueryRows rows) {
        this.renderer = renderer;
        this.catalog = catalog;
        this.rows = rows;
    }

    @Override
    public RefRenderer renderer() {
        return renderer;
    }

    @Override
    public Catalog catalog(Set<Long> datasourceIds) {
        return catalog;
    }

    @Override
    public QueryRows executeChart(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        executedSql.add(sql.text());
        return rows;
    }

    @Override
    public QueryRows executePreview(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        executedSql.add(sql.text());
        return rows;
    }

    @Override
    public PointCollectionResult executeAutoPoints(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql,
                                                   int targetSize, long seed) {
        executedSql.add(sql.text());
        return new PointCollectionResult(rows, rows.rowCount());
    }

    @Override
    public long explainEstimatedRows(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql) {
        return rows.rowCount();
    }

    @Override
    public CachedResultSample loadResultSample(Set<Long> datasourceIds, BuilderSqlBuilder.Sql population,
                                               LongFunction<BuilderSqlBuilder.ResultSampleSource> sourceFactory,
                                               SamplePlan plan) {
        BuilderSqlBuilder.ResultSampleSource source = sourceFactory.apply(rows.rowCount());
        executedSql.add(source.sql().text());
        return new CachedResultSample(rows, source.sql().sampling(), source.sql());
    }

    @Override
    public Planned executeResultRandom(Set<Long> datasourceIds, BuilderSqlBuilder.Sql population,
                                       LongFunction<BuilderSqlBuilder.Sql> sqlFactory,
                                       boolean chartResult, long seed) {
        BuilderSqlBuilder.Sql sql = sqlFactory.apply(rows.rowCount());
        executedSql.add(sql.text());
        return new Planned(rows, sql);
    }
}
