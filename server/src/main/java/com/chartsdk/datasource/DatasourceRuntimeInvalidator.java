package com.chartsdk.datasource;

import com.chartsdk.cache.SampleRowCacheService;
import com.chartsdk.query.QueryExecutor;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/** Applies datasource runtime changes only after the metadata transaction has committed. */
@Component
public class DatasourceRuntimeInvalidator {
    private static final Logger log = LoggerFactory.getLogger(DatasourceRuntimeInvalidator.class);

    private final DatasourcePoolRegistry pools;
    private final QueryExecutor queries;
    private final SampleRowCacheService sampleCache;
    private final DatasourceRuntimeVersions versions;
    private final JdbcTemplate jdbc;
    private final MeterRegistry metrics;
    private final ConcurrentHashMap<Long, DatasourceChangedEvent> pendingCacheInvalidations =
            new ConcurrentHashMap<>();

    public DatasourceRuntimeInvalidator(DatasourcePoolRegistry pools, QueryExecutor queries,
                                        SampleRowCacheService sampleCache,
                                        DatasourceRuntimeVersions versions,
                                        JdbcTemplate jdbc, MeterRegistry metrics) {
        this.pools = pools;
        this.queries = queries;
        this.sampleCache = sampleCache;
        this.versions = versions;
        this.jdbc = jdbc;
        this.metrics = metrics;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onDatasourceChanged(DatasourceChangedEvent event) {
        if (event.impact() == DatasourceChangedEvent.Impact.POOL_CONFIGURATION) {
            attempt(event, "pool", () -> pools.evict(event.datasourceId()));
            return;
        }
        pendingCacheInvalidations.compute(event.datasourceId(), (datasourceId, ignored) -> {
            versions.beginCacheInvalidation(datasourceId);
            attempt(event, "pool", () -> pools.evict(event.datasourceId()));
            attempt(event, "catalog", () -> queries.invalidateCatalog(event.datasourceId()));
            return retryOrComplete(event);
        });
    }

    @Scheduled(fixedDelayString = "${chartsdk.datasource-runtime.invalidation-retry-ms:30000}")
    void retryPendingCacheInvalidations() {
        for (Long datasourceId : List.copyOf(pendingCacheInvalidations.keySet())) {
            pendingCacheInvalidations.computeIfPresent(
                    datasourceId, (id, event) -> retryOrComplete(event));
        }
    }

    private DatasourceChangedEvent retryOrComplete(DatasourceChangedEvent event) {
        if (!clearCaches(event)) return event;
        versions.completeCacheInvalidation(event.datasourceId());
        return null;
    }

    private boolean clearCaches(DatasourceChangedEvent event) {
        boolean sampleCleared = attempt(
                event, "sample_cache", () -> sampleCache.invalidateDatasource(event.datasourceId()));
        boolean chartsCleared = attempt(
                event, "chart_cache", () -> invalidateChartCaches(event.datasourceId()));
        return sampleCleared && chartsCleared;
    }

    private void invalidateChartCaches(long datasourceId) {
        jdbc.update("""
                DELETE FROM mc_chart_cache cache
                 USING mc_chart_datasource relation
                 WHERE cache.chart_id=relation.chart_id
                   AND relation.datasource_id=?
                """, datasourceId);
    }

    private boolean attempt(DatasourceChangedEvent event, String component, Runnable operation) {
        try {
            operation.run();
            Counter.builder("chartsdk.datasource_runtime.invalidations")
                    .tag("component", component)
                    .tag("outcome", "success")
                    .register(metrics).increment();
            return true;
        } catch (RuntimeException failure) {
            Counter.builder("chartsdk.datasource_runtime.invalidations")
                    .tag("component", component)
                    .tag("outcome", "error")
                    .register(metrics).increment();
            log.warn("Datasource runtime invalidation failed: datasourceId={}, impact={}, component={}",
                    event.datasourceId(), event.impact(), component, failure);
            return false;
        }
    }
}
