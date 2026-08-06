package com.chartsdk.query;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/** Low-cardinality telemetry for the runtime point collector. */
@Component
public class PointSamplingMetrics {
    private final MeterRegistry registry;

    public PointSamplingMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    private PointSamplingMetrics() {
        this.registry = null;
    }

    public static PointSamplingMetrics noOp() {
        return new PointSamplingMetrics();
    }

    public void record(String chartType, PointCollectionResult result) {
        if (registry == null) return;
        String type = switch (chartType == null ? "" : chartType) {
            case "scatter", "geoscatter", "map" -> chartType;
            default -> "other";
        };
        String outcome = result.sampled() ? "sampled" : "exact";
        Counter.builder("chartsdk.point_reservoir.executions")
                .tag("chart_type", type).tag("outcome", outcome)
                .register(registry).increment();
        DistributionSummary.builder("chartsdk.point_reservoir.population")
                .tag("chart_type", type).register(registry).record(result.populationCount());
        DistributionSummary.builder("chartsdk.point_reservoir.retained_rows")
                .tag("chart_type", type).register(registry).record(result.rows().rowCount());
    }
}
