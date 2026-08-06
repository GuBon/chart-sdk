package com.chartsdk.query;

import java.util.Collection;

/**
 * Admission boundary for customer-database work.
 *
 * <p>The default implementation is JVM-local. Keeping callers on this interface allows a
 * distributed lease implementation to be introduced later without changing query engines.
 */
public interface AdmissionController {
    enum Kind {
        PREVIEW("preview"), CHART("chart"), SAMPLE("sample"), EXPLAIN("explain"),
        CATALOG("catalog"), FEDERATION("federation");

        private final String metricValue;

        Kind(String metricValue) {
            this.metricValue = metricValue;
        }

        public String metricValue() {
            return metricValue;
        }
    }

    @FunctionalInterface
    interface CheckedSupplier<T> {
        T get() throws Exception;
    }

    <T> T execute(long datasourceId, Kind kind, CheckedSupplier<T> task) throws Exception;

    <T> T executeFederated(Collection<Long> datasourceIds, CheckedSupplier<T> task) throws Exception;
}
