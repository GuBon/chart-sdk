package com.chartsdk.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/** Shared low-cardinality counters for bounded coordination paths. */
@Component
public class CapacityMetrics {
    private final MeterRegistry registry;

    public CapacityMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    private CapacityMetrics() {
        this.registry = null;
    }

    public static CapacityMetrics noOp() {
        return new CapacityMetrics();
    }

    public void rejected(String operation, String reason) {
        if (registry == null) return;
        Counter.builder("chartsdk.capacity.rejected")
                .tag("operation", operation)
                .tag("reason", reason)
                .register(registry).increment();
    }
}
