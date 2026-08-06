package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Bounded admission for all customer-database work. Metrics deliberately omit datasource IDs. */
@Service
public class QueryExecutionCoordinator implements AdmissionController {
    private final Semaphore global;
    private final Semaphore federation;
    private final ConcurrentHashMap<Long, Semaphore> perDatasource = new ConcurrentHashMap<>();
    private final int perDatasourceLimit;
    private final long waitMillis;
    private final MeterRegistry metrics;
    private final Map<Kind, AtomicInteger> queued = new EnumMap<>(Kind.class);
    private final Map<Kind, AtomicInteger> running = new EnumMap<>(Kind.class);

    public QueryExecutionCoordinator(
            MeterRegistry metrics,
            @Value("${chartsdk.query.max-concurrent:24}") int maxConcurrent,
            @Value("${chartsdk.query.max-concurrent-per-datasource:4}") int perDatasourceLimit,
            @Value("${chartsdk.query.max-concurrent-federated:2}") int maxFederated,
            @Value("${chartsdk.query.admission-wait-millis:2000}") long waitMillis
    ) {
        this.metrics = metrics;
        this.global = new Semaphore(Math.max(1, maxConcurrent), true);
        this.federation = new Semaphore(Math.max(1, maxFederated), true);
        this.perDatasourceLimit = Math.max(1, perDatasourceLimit);
        this.waitMillis = Math.max(1, waitMillis);
        for (Kind kind : Kind.values()) {
            AtomicInteger queuedCount = new AtomicInteger();
            AtomicInteger runningCount = new AtomicInteger();
            queued.put(kind, queuedCount);
            running.put(kind, runningCount);
            Gauge.builder("chartsdk.customer_query.queued", queuedCount, AtomicInteger::get)
                    .tag("kind", kind.metricValue()).register(metrics);
            Gauge.builder("chartsdk.customer_query.running", runningCount, AtomicInteger::get)
                    .tag("kind", kind.metricValue()).register(metrics);
        }
    }

    @Override
    public <T> T execute(long datasourceId, Kind kind, CheckedSupplier<T> task) throws Exception {
        return execute(List.of(datasourceId), kind, false, task);
    }

    @Override
    public <T> T executeFederated(Collection<Long> datasourceIds, CheckedSupplier<T> task) throws Exception {
        return execute(datasourceIds, Kind.FEDERATION, true, task);
    }

    private <T> T execute(Collection<Long> datasourceIds, Kind kind, boolean federated,
                          CheckedSupplier<T> task) throws Exception {
        List<Long> ids = datasourceIds == null ? List.of() : datasourceIds.stream()
                .distinct().sorted(Comparator.naturalOrder()).toList();
        List<Semaphore> acquiredSources = new ArrayList<>();
        boolean globalAcquired = false;
        boolean federationAcquired = false;
        long waitStarted = System.nanoTime();
        long deadline = waitStarted + TimeUnit.MILLISECONDS.toNanos(waitMillis);
        AtomicInteger queuedCount = queued.get(kind);
        AtomicInteger runningCount = running.get(kind);
        queuedCount.incrementAndGet();
        try {
            for (Long id : ids) {
                Semaphore source = perDatasource.computeIfAbsent(
                        id, ignored -> new Semaphore(perDatasourceLimit, true));
                if (!tryAcquire(source, deadline)) throw busy();
                acquiredSources.add(source);
            }
            if (federated) {
                if (!tryAcquire(federation, deadline)) throw busy();
                federationAcquired = true;
            }
            if (!tryAcquire(global, deadline)) throw busy();
            globalAcquired = true;
            queuedCount.decrementAndGet();
            runningCount.incrementAndGet();
            Timer.builder("chartsdk.customer_query.wait")
                    .tag("kind", kind.metricValue())
                    .publishPercentileHistogram()
                    .register(metrics)
                    .record(System.nanoTime() - waitStarted, TimeUnit.NANOSECONDS);

            long executionStarted = System.nanoTime();
            try {
                T result = task.get();
                recordExecution(kind, "success", executionStarted, result);
                return result;
            } catch (Exception | Error failure) {
                recordExecution(kind, "error", executionStarted, null);
                recordFailure(kind, failure);
                throw failure;
            }
        } finally {
            if (globalAcquired) runningCount.decrementAndGet();
            else queuedCount.decrementAndGet();
            if (globalAcquired) global.release();
            if (federationAcquired) federation.release();
            for (int i = acquiredSources.size() - 1; i >= 0; i--) acquiredSources.get(i).release();
        }
    }

    private boolean tryAcquire(Semaphore semaphore, long deadlineNanos) {
        long remaining = deadlineNanos - System.nanoTime();
        if (remaining <= 0) return false;
        try {
            return semaphore.tryAcquire(remaining, TimeUnit.NANOSECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "QUERY_INTERRUPTED",
                    "Query admission was interrupted.");
        }
    }

    private ApiException busy() {
        Counter.builder("chartsdk.customer_query.rejected")
                .tag("reason", "admission_timeout")
                .register(metrics)
                .increment();
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "QUERY_BUSY",
                "Too many data queries are running. Retry shortly.");
    }

    private void recordExecution(Kind kind, String outcome, long startedNanos, Object result) {
        Timer.builder("chartsdk.customer_query.duration")
                .tag("kind", kind.metricValue())
                .tag("outcome", outcome)
                .publishPercentileHistogram()
                .register(metrics)
                .record(System.nanoTime() - startedNanos, TimeUnit.NANOSECONDS);
        if (result instanceof QueryRows rows) {
            DistributionSummary.builder("chartsdk.customer_query.rows")
                    .tag("kind", kind.metricValue())
                    .register(metrics)
                    .record(rows.rowCount());
        } else if (result instanceof PointCollectionResult points) {
            DistributionSummary.builder("chartsdk.customer_query.rows")
                    .tag("kind", kind.metricValue())
                    .register(metrics)
                    .record(points.rows().rowCount());
        }
    }

    private void recordFailure(Kind kind, Throwable failure) {
        String reason = "other";
        if (failure instanceof ApiException api) {
            reason = switch (api.code()) {
                case "QUERY_TIMEOUT" -> "timeout";
                case "SQL_ERROR", "FEDERATION_ERROR", "DATASOURCE_QUERY_FAILED" -> "query_error";
                case "QUERY_INTERRUPTED" -> "interrupted";
                default -> "application_error";
            };
        }
        Counter.builder("chartsdk.customer_query.failures")
                .tag("kind", kind.metricValue())
                .tag("reason", reason)
                .register(metrics).increment();
    }
}
