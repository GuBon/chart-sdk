package com.chartsdk.chart;

import com.chartsdk.web.ApiException;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Observe-first rollout policy for optimistic chart updates. */
@Component
public class ChartVersionPolicy {
    private final boolean required;
    private final Counter missing;

    public ChartVersionPolicy(
            MeterRegistry metrics,
            @Value("${chartsdk.chart.require-update-version:false}") boolean required
    ) {
        this.required = required;
        this.missing = Counter.builder("chartsdk.chart.update.version_missing").register(metrics);
    }

    public void validate(Integer version) {
        if (version != null) return;
        missing.increment();
        if (required) {
            throw new ApiException(HttpStatus.PRECONDITION_REQUIRED, "CHART_VERSION_REQUIRED",
                    "Reload the chart before saving it.");
        }
    }
}
