package com.chartsdk.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/** Low-cardinality metrics for the temporary legacy datasource-password path. */
@Component
public class DatasourcePasswordMetrics {
    private final Counter legacyReads;

    public DatasourcePasswordMetrics(MeterRegistry registry) {
        this.legacyReads = Counter.builder("chartsdk.datasource.password.legacy_reads")
                .description("Datasource password reads that used the legacy plaintext fallback")
                .register(registry);
    }

    public void legacyRead() {
        legacyReads.increment();
    }
}
