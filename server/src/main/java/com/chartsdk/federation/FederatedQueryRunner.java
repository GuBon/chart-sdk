package com.chartsdk.federation;

import com.chartsdk.cache.CachedResultSample;
import com.chartsdk.cache.SampleFingerprint;
import com.chartsdk.cache.SampleRowCacheService;
import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.cache.SamplingQueryRows;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.CachedSampleExecutor;
import com.chartsdk.query.CachedSampleSqlBuilder;
import com.chartsdk.query.Catalog;
import com.chartsdk.query.GeoHeatmapSamplingWeights;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.PointSamplingPolicy;
import com.chartsdk.query.PointCollectionResult;
import com.chartsdk.query.PointSamplingMetrics;
import com.chartsdk.query.SamplePlan;
import com.chartsdk.query.SamplingPlanner;
import com.chartsdk.query.engine.DistinctCountCompositionPolicy;
import com.chartsdk.query.engine.PostgresQueryEngine;
import com.chartsdk.query.engine.QueryEngine;
import com.chartsdk.query.engine.SourceCompositionPolicy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 빌더 실행의 단일 조율자 — 카탈로그 → 표본 계획 → SQL 생성 → 실행 흐름을 한 벌로 유지하고,
 * 엔진이 갈리는 지점(직접 PostgreSQL vs DuckDB 페더레이션 vs L1 표본 캐시)은
 * {@link QueryEngine} 포트와 {@link SourceCompositionPolicy} 판정 뒤로 모은다(설계 §4.3·§4.4).
 */
@Service
public class FederatedQueryRunner {

    private final QueryEngine single;
    private final QueryEngine federated;
    private final SourceCompositionPolicy policy;
    private final SamplingPlanner planner;
    private final SampleRowCacheService sampleCache;
    private final CachedSampleExecutor sampleExecutor;
    private final PointSamplingMetrics pointMetrics;

    /** Test/legacy constructor. Production injection uses the policy-aware constructor below. */
    public FederatedQueryRunner(QueryExecutor queries, DuckDbFederation federation, SamplingPlanner planner) {
        this(queries, federation, planner, null, null, PointSamplingMetrics.noOp());
    }

    public FederatedQueryRunner(QueryExecutor queries, DuckDbFederation federation, SamplingPlanner planner,
                                SampleRowCacheService sampleCache, CachedSampleExecutor sampleExecutor) {
        this(queries, federation, planner, sampleCache, sampleExecutor, PointSamplingMetrics.noOp());
    }

    public FederatedQueryRunner(QueryExecutor queries, DuckDbFederation federation, SamplingPlanner planner,
                                SampleRowCacheService sampleCache, CachedSampleExecutor sampleExecutor,
                                PointSamplingMetrics pointMetrics) {
        this(queries, federation, planner, sampleCache, sampleExecutor, pointMetrics,
                new DistinctCountCompositionPolicy());
    }

    @Autowired
    public FederatedQueryRunner(QueryExecutor queries, DuckDbFederation federation, SamplingPlanner planner,
                                SampleRowCacheService sampleCache, CachedSampleExecutor sampleExecutor,
                                PointSamplingMetrics pointMetrics, SourceCompositionPolicy policy) {
        this(new PostgresQueryEngine(queries), new DuckDbQueryEngine(federation), policy,
                planner, sampleCache, sampleExecutor, pointMetrics);
    }

    /** 확장 이음매 — 실행 엔진·판정 정책 주입점(새 소스 종류·테스트 fake, 설계 §5 P5). */
    public FederatedQueryRunner(QueryEngine single, QueryEngine federated, SourceCompositionPolicy policy,
                                SamplingPlanner planner, SampleRowCacheService sampleCache,
                                CachedSampleExecutor sampleExecutor, PointSamplingMetrics pointMetrics) {
        this.single = single;
        this.federated = federated;
        this.policy = policy;
        this.planner = planner;
        this.sampleCache = sampleCache;
        this.sampleExecutor = sampleExecutor;
        this.pointMetrics = pointMetrics;
    }

    public record BuiltResult(QueryRows rows, BuilderSqlBuilder.Sql sql, Set<Long> datasourceIds,
                              SamplingMetadata sampling) {
        public BuiltResult(QueryRows rows, BuilderSqlBuilder.Sql sql, Set<Long> datasourceIds) {
            this(rows, sql, datasourceIds, sql == null ? null : sql.sampling());
        }
    }

    public BuiltResult runBuilder(long primaryDatasourceId, Map<String, Object> cfg,
                                  String chartType, boolean rawMode) {
        int maxAge = sampleCache == null ? 0 : sampleCache.defaultMaxAgeSeconds();
        return runBuilder(primaryDatasourceId, cfg, chartType, rawMode, maxAge);
    }

    /** A max age of zero bypasses L1 and therefore preserves live-refresh semantics. */
    public BuiltResult runBuilder(long primaryDatasourceId, Map<String, Object> cfg,
                                  String chartType, boolean rawMode,
                                  int sampleCacheMaxAgeSeconds) {
        boolean chartResult = !rawMode;
        Set<Long> refs = BuilderSqlBuilder.referencedDatasources(cfg);
        Set<Long> resolvedRefs = refs.isEmpty() ? Set.of(primaryDatasourceId) : refs;

        String fingerprint = null;
        if (sampleCache != null && chartResult && PointSamplingPolicy.shouldApply(chartType, cfg)) {
            fingerprint = SampleFingerprint.of(primaryDatasourceId, resolvedRefs, cfg, chartType);
            Optional<CachedResultSample> cached = sampleCache.findCurrent(
                    fingerprint, sampleCacheMaxAgeSeconds, primaryDatasourceId, resolvedRefs);
            if (cached.isPresent()) return executeCachedSample(cached.get(), cfg, chartType, resolvedRefs);
        }

        QueryEngine engine = policy.requiresFederation(resolvedRefs) ? federated : single;
        return run(engine, resolvedRefs, primaryDatasourceId, cfg, chartType, rawMode,
                chartResult, fingerprint, sampleCacheMaxAgeSeconds);
    }

    /**
     * 엔진 무관 실행 골격. 단일 소스의 표본 lease·planner 대상은 그 소스 자신이고,
     * 페더레이션은 primary 를 사용한다(기존 동작 보존).
     */
    private BuiltResult run(QueryEngine engine, Set<Long> ids, long primaryDatasourceId,
                            Map<String, Object> cfg, String chartType, boolean rawMode,
                            boolean chartResult, String fingerprint, int maxAgeSeconds) {
        long soleOrPrimary = ids.size() == 1 ? ids.iterator().next() : primaryDatasourceId;
        Catalog catalog = engine.catalog(ids);
        SamplePlan plan = planner.plan(soleOrPrimary, cfg, chartType, rawMode);

        if (plan.method() == SamplePlan.Method.RESULT_RANDOM) {
            BuilderSqlBuilder.Sql population = BuilderSqlBuilder.generateSamplingPopulation(
                    catalog, engine.renderer(), cfg, chartType);
            if (plan.automatic()) {
                plan = plan.withPopulationEstimate(engine.explainEstimatedRows(ids, population));
                if (plan.method() == SamplePlan.Method.FULL_SCAN) {
                    BuilderSqlBuilder.Sql exact = BuilderSqlBuilder.generate(
                            catalog, engine.renderer(), cfg, chartType, rawMode, plan);
                    return execute(engine, exact, ids, cfg, chartType, chartResult, plan);
                }
            }
            if (sampleCache != null) {
                String cacheKey = fingerprint == null
                        ? SampleFingerprint.of(primaryDatasourceId, ids, cfg, chartType)
                        : fingerprint;
                SamplePlan unestimated = plan;
                CachedResultSample cached = sampleCache.getOrLoad(
                        cacheKey, soleOrPrimary, ids, maxAgeSeconds,
                        () -> engine.loadResultSample(ids, population,
                                estimate -> BuilderSqlBuilder.generateResultSampleSource(
                                        catalog, engine.renderer(), cfg, chartType,
                                        unestimated.withPopulationEstimate(estimate)),
                                unestimated));
                return executeCachedSample(cached, cfg, chartType, ids);
            }
            SamplePlan unestimated = plan;
            QueryEngine.Planned planned = engine.executeResultRandom(ids, population,
                    estimate -> BuilderSqlBuilder.generate(
                            catalog, engine.renderer(), cfg, chartType, rawMode,
                            unestimated.withPopulationEstimate(estimate)),
                    chartResult, plan.seed());
            return complete(planned.rows(), planned.sql(), ids, cfg, chartType);
        }

        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(
                catalog, engine.renderer(), cfg, chartType, rawMode, plan);
        return execute(engine, sql, ids, cfg, chartType, chartResult, plan);
    }

    private BuiltResult execute(QueryEngine engine, BuilderSqlBuilder.Sql sql, Set<Long> ids,
                                Map<String, Object> cfg, String chartType,
                                boolean chartResult, SamplePlan plan) {
        if (useAdaptiveCollector(chartResult, plan, cfg, chartType)) {
            int target = pointTarget(cfg);
            PointCollectionResult points = engine.executeAutoPoints(ids, sql, target, plan.seed());
            return completeAdaptive(points, sql, ids, cfg, chartType);
        }
        QueryRows rows = chartResult ? engine.executeChart(ids, sql) : engine.executePreview(ids, sql);
        return complete(rows, sql, ids, cfg, chartType);
    }

    private BuiltResult executeCachedSample(CachedResultSample cached, Map<String, Object> cfg,
                                            String chartType, Set<Long> datasourceIds) {
        SamplingMetadata definition = SamplingMetadata.fromBuilderConfig(cfg);
        SamplingMetadata stored = cached.sampling();
        int sampleSize = stored.sampleSize() != null ? stored.sampleSize()
                : stored.sizeTarget() != null ? stored.sizeTarget() : SamplingPlanner.DEFAULT_SIZE;
        long population = stored.populationEstimate() == null ? 0 : stored.populationEstimate();
        SamplingMetadata current = definition == null
                ? stored
                : definition.asResultRandom(population, sampleSize);
        BuilderSqlBuilder.Sql source = new BuilderSqlBuilder.Sql(
                cached.sourceSql().text(), cached.sourceSql().params(), current);
        CachedSampleSqlBuilder.Plan finalPlan = CachedSampleSqlBuilder.build(
                cfg, chartType, cached.rows(), source);
        QueryRows aggregated = sampleExecutor.execute(cached.rows(), finalPlan.aggregate());
        return complete(aggregated, finalPlan.display(), datasourceIds, cfg, chartType);
    }

    private BuiltResult complete(QueryRows rows, BuilderSqlBuilder.Sql sql, Set<Long> datasourceIds,
                                 Map<String, Object> cfg, String chartType) {
        SamplingQueryRows.Result result = SamplingQueryRows.extract(rows, sql.sampling());
        QueryRows displayRows = GeoHeatmapSamplingWeights.apply(
                result.rows(), chartType, cfg, result.sampling());
        return new BuiltResult(displayRows, sql, datasourceIds, result.sampling());
    }

    private BuiltResult completeAdaptive(PointCollectionResult points, BuilderSqlBuilder.Sql sql,
                                         Set<Long> datasourceIds, Map<String, Object> cfg,
                                         String chartType) {
        pointMetrics.record(chartType, points);
        if (!points.sampled()) return complete(points.rows(), sql, datasourceIds, cfg, chartType);
        SamplingMetadata definition = SamplingMetadata.fromBuilderConfig(cfg);
        if (definition == null) return complete(points.rows(), sql, datasourceIds, cfg, chartType);
        SamplingMetadata runtime = definition.asReservoir(
                points.populationCount(), points.rows().rowCount());
        BuilderSqlBuilder.Sql sampledSql = new BuilderSqlBuilder.Sql(sql.text(), sql.params(), runtime);
        return complete(points.rows(), sampledSql, datasourceIds, cfg, chartType);
    }

    private static boolean useAdaptiveCollector(boolean chartResult, SamplePlan plan,
                                                Map<String, Object> cfg, String chartType) {
        if (!chartResult || plan.method() != SamplePlan.Method.FULL_SCAN
                || !PointSamplingPolicy.supportsAutomaticSampling(chartType, cfg)) return false;
        return cfg.get("sample") instanceof Map<?, ?> sample
                && "auto".equals(String.valueOf(sample.get("mode")));
    }

    private static int pointTarget(Map<String, Object> cfg) {
        if (cfg.get("sample") instanceof Map<?, ?> sample
                && sample.get("size") instanceof Number size) {
            return Math.max(SamplingMetadata.MIN_SIZE,
                    Math.min(SamplingMetadata.MAX_SIZE, size.intValue()));
        }
        return SamplingPlanner.DEFAULT_SIZE;
    }

    public QueryRows runStored(Set<Long> datasourceIds, long primaryDatasourceId, String storedSql) {
        BuilderSqlBuilder.Sql sql = new BuilderSqlBuilder.Sql(storedSql, List.of());
        if (datasourceIds != null && policy.requiresFederation(datasourceIds)) {
            return federated.executeChart(datasourceIds, sql);
        }
        return single.executeChart(Set.of(primaryDatasourceId), sql);
    }
}
