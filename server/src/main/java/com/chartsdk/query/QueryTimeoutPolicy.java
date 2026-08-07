package com.chartsdk.query;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.Map;

/** Central timeout policy for customer-database work, grouped by execution purpose. */
@Component
public final class QueryTimeoutPolicy {
    private static final int DEFAULT_QUICK_SECONDS = 10;
    private static final int DEFAULT_LONG_SECONDS = 30;

    private final Map<AdmissionController.Kind, Integer> seconds;

    public QueryTimeoutPolicy(
            @Value("${chartsdk.query.timeout.preview-seconds:10}") int previewSeconds,
            @Value("${chartsdk.query.timeout.catalog-seconds:10}") int catalogSeconds,
            @Value("${chartsdk.query.timeout.explain-seconds:10}") int explainSeconds,
            @Value("${chartsdk.query.timeout.chart-seconds:30}") int chartSeconds,
            @Value("${chartsdk.query.timeout.sample-seconds:30}") int sampleSeconds,
            @Value("${chartsdk.query.timeout.federation-seconds:30}") int federationSeconds
    ) {
        EnumMap<AdmissionController.Kind, Integer> configured =
                new EnumMap<>(AdmissionController.Kind.class);
        configured.put(AdmissionController.Kind.PREVIEW, positive(previewSeconds));
        configured.put(AdmissionController.Kind.CATALOG, positive(catalogSeconds));
        configured.put(AdmissionController.Kind.EXPLAIN, positive(explainSeconds));
        configured.put(AdmissionController.Kind.CHART, positive(chartSeconds));
        configured.put(AdmissionController.Kind.SAMPLE, positive(sampleSeconds));
        configured.put(AdmissionController.Kind.FEDERATION, positive(federationSeconds));
        this.seconds = Map.copyOf(configured);
    }

    public int seconds(AdmissionController.Kind kind) {
        Integer timeout = seconds.get(kind);
        if (timeout == null) throw new IllegalArgumentException("Unsupported query kind: " + kind);
        return timeout;
    }

    public static QueryTimeoutPolicy defaults() {
        return new QueryTimeoutPolicy(
                DEFAULT_QUICK_SECONDS,
                DEFAULT_QUICK_SECONDS,
                DEFAULT_QUICK_SECONDS,
                DEFAULT_LONG_SECONDS,
                DEFAULT_LONG_SECONDS,
                DEFAULT_LONG_SECONDS);
    }

    private static int positive(int value) {
        if (value < 1) throw new IllegalArgumentException("Query timeout must be at least one second");
        return value;
    }
}
