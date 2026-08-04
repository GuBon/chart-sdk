package com.chartsdk.federation;

import com.chartsdk.cache.CachedResultSample;
import com.chartsdk.cache.SampleFingerprint;
import com.chartsdk.cache.SampleRowCacheService;
import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.cache.SamplingQueryRows;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.CachedSampleExecutor;
import com.chartsdk.query.CachedSampleSqlBuilder;
import com.chartsdk.query.FederatedCatalog;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SamplePlan;
import com.chartsdk.query.SamplingPlanner;
import com.chartsdk.query.SchemaCatalog;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Routes builder queries to direct PostgreSQL, federated DuckDB, or the bounded L1 sample cache. */
@Service
public class FederatedQueryRunner {

    private final QueryExecutor queries;
    private final DuckDbFederation federation;
    private final SamplingPlanner planner;
    private final SampleRowCacheService sampleCache;
    private final CachedSampleExecutor sampleExecutor;

    /** Test/legacy constructor. Production injection uses the L1-aware constructor below. */
    public FederatedQueryRunner(QueryExecutor queries, DuckDbFederation federation, SamplingPlanner planner) {
        this(queries, federation, planner, null, null);
    }

    @Autowired
    public FederatedQueryRunner(QueryExecutor queries, DuckDbFederation federation, SamplingPlanner planner,
                                SampleRowCacheService sampleCache, CachedSampleExecutor sampleExecutor) {
        this.queries = queries;
        this.federation = federation;
        this.planner = planner;
        this.sampleCache = sampleCache;
        this.sampleExecutor = sampleExecutor;
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
        if (sampleCache != null && chartResult && cfg.get("sample") instanceof Map<?, ?>) {
            fingerprint = SampleFingerprint.of(primaryDatasourceId, resolvedRefs, cfg, chartType);
            Optional<CachedResultSample> cached = sampleCache.find(fingerprint, sampleCacheMaxAgeSeconds);
            if (cached.isPresent()) return executeCachedSample(cached.get(), cfg, chartType, resolvedRefs);
        }

        if (refs.size() >= 2) {
            return runFederated(primaryDatasourceId, cfg, chartType, rawMode,
                    chartResult, refs, fingerprint, sampleCacheMaxAgeSeconds);
        }
        long datasourceId = refs.isEmpty() ? primaryDatasourceId : refs.iterator().next();
        return runSingle(primaryDatasourceId, datasourceId, cfg, chartType, rawMode,
                chartResult, fingerprint, sampleCacheMaxAgeSeconds);
    }

    private BuiltResult runFederated(long primaryDatasourceId, Map<String, Object> cfg,
                                     String chartType, boolean rawMode, boolean chartResult,
                                     Set<Long> refs, String fingerprint, int maxAgeSeconds) {
        FederatedCatalog catalog = federation.catalog(refs);
        SamplePlan plan = planner.plan(primaryDatasourceId, cfg, rawMode);
        if (plan.method() == SamplePlan.Method.RESULT_RANDOM) {
            if (sampleCache != null) {
                String cacheKey = fingerprint == null
                        ? SampleFingerprint.of(primaryDatasourceId, refs, cfg, chartType)
                        : fingerprint;
                SamplePlan unestimated = plan;
                CachedResultSample cached = sampleCache.getOrLoad(
                        cacheKey, primaryDatasourceId, refs, maxAgeSeconds, () -> {
                            BuilderSqlBuilder.Sql population = BuilderSqlBuilder.generateSamplingPopulation(
                                    catalog, RefRenderer.FEDERATED, cfg, chartType);
                            DuckDbFederation.PlannedResultSample planned = federation.executePlannedResultSample(
                                    refs,
                                    population.text(),
                                    population.params(),
                                    estimate -> BuilderSqlBuilder.generateResultSampleSource(
                                            catalog, RefRenderer.FEDERATED, cfg, chartType,
                                            unestimated.withPopulationEstimate(estimate)),
                                    unestimated.seed());
                            return new CachedResultSample(
                                    planned.rows(), planned.source().sql().sampling(), planned.source().sql());
                        });
                return executeCachedSample(cached, cfg, chartType, refs);
            }
            return runLegacyFederatedResultRandom(
                    catalog, cfg, chartType, rawMode, chartResult, refs, plan);
        }

        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(
                catalog, RefRenderer.FEDERATED, cfg, chartType, rawMode, plan);
        QueryRows executed = chartResult
                ? federation.executeChart(refs, sql.text(), sql.params())
                : federation.execute(refs, sql.text(), sql.params());
        SamplingQueryRows.Result result = SamplingQueryRows.extract(executed, sql.sampling());
        return new BuiltResult(result.rows(), sql, refs, result.sampling());
    }

    private BuiltResult runLegacyFederatedResultRandom(
            FederatedCatalog catalog, Map<String, Object> cfg, String chartType,
            boolean rawMode, boolean chartResult, Set<Long> refs, SamplePlan plan) {
        BuilderSqlBuilder.Sql population = BuilderSqlBuilder.generateSamplingPopulation(
                catalog, RefRenderer.FEDERATED, cfg, chartType);
        SamplePlan unestimated = plan;
        DuckDbFederation.PlannedBernoulli planned = federation.executePlannedBernoulli(
                refs,
                population.text(),
                population.params(),
                estimate -> BuilderSqlBuilder.generate(
                        catalog, RefRenderer.FEDERATED, cfg, chartType, rawMode,
                        unestimated.withPopulationEstimate(estimate)),
                chartResult,
                plan.seed());
        SamplingQueryRows.Result result = SamplingQueryRows.extract(
                planned.rows(), planned.sql().sampling());
        return new BuiltResult(result.rows(), planned.sql(), refs, result.sampling());
    }

    private BuiltResult runSingle(long primaryDatasourceId, long datasourceId,
                                  Map<String, Object> cfg, String chartType,
                                  boolean rawMode, boolean chartResult,
                                  String fingerprint, int maxAgeSeconds) {
        SchemaCatalog catalog = queries.catalog(datasourceId);
        SamplePlan plan = planner.plan(datasourceId, cfg, rawMode);
        if (plan.method() == SamplePlan.Method.RESULT_RANDOM) {
            BuilderSqlBuilder.Sql population = BuilderSqlBuilder.generateSamplingPopulation(
                    catalog, cfg, chartType);
            if (sampleCache != null) {
                String cacheKey = fingerprint == null
                        ? SampleFingerprint.of(primaryDatasourceId, Set.of(datasourceId), cfg, chartType)
                        : fingerprint;
                SamplePlan unestimated = plan;
                CachedResultSample cached = sampleCache.getOrLoad(
                        cacheKey, datasourceId, Set.of(datasourceId), maxAgeSeconds, () -> {
                            long estimate = queries.explainEstimatedRows(
                                    datasourceId, population.text(), population.params());
                            BuilderSqlBuilder.ResultSampleSource source =
                                    BuilderSqlBuilder.generateResultSampleSource(
                                            catalog, cfg, chartType,
                                            unestimated.withPopulationEstimate(estimate));
                            QueryRows rows = queries.executeCachedSample(
                                    datasourceId, source.sql().text(), source.sql().params(), unestimated.seed());
                            return new CachedResultSample(rows, source.sql().sampling(), source.sql());
                        });
                return executeCachedSample(cached, cfg, chartType, Set.of(datasourceId));
            }
            plan = plan.withPopulationEstimate(queries.explainEstimatedRows(
                    datasourceId, population.text(), population.params()));
        }

        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, cfg, chartType, rawMode, plan);
        QueryRows executed = plan.method() == SamplePlan.Method.RESULT_RANDOM
                ? queries.executeBernoulli(datasourceId, sql.text(), sql.params(), chartResult, plan.seed())
                : chartResult
                        ? queries.executeChart(datasourceId, sql.text(), sql.params())
                        : queries.execute(datasourceId, sql.text(), sql.params());
        SamplingQueryRows.Result result = SamplingQueryRows.extract(executed, sql.sampling());
        return new BuiltResult(result.rows(), sql, Set.of(datasourceId), result.sampling());
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
        SamplingQueryRows.Result result = SamplingQueryRows.extract(aggregated, current);
        return new BuiltResult(result.rows(), finalPlan.display(), datasourceIds, result.sampling());
    }

    public QueryRows runStored(Set<Long> datasourceIds, long primaryDatasourceId, String storedSql) {
        if (datasourceIds != null && datasourceIds.size() >= 2) {
            return federation.executeChart(datasourceIds, storedSql, List.of());
        }
        return queries.executeChart(primaryDatasourceId, storedSql, List.of());
    }
}
