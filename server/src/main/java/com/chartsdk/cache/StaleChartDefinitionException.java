package com.chartsdk.cache;

import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;

/** Raised when a query finishes after the chart definition used to start it has changed. */
public class StaleChartDefinitionException extends ApiException {
    public StaleChartDefinitionException(long chartId, int executedVersion, int currentVersion) {
        super(HttpStatus.CONFLICT, "CHART_DEFINITION_CHANGED",
                "Chart " + chartId + " changed while it was being computed (executed version "
                + executedVersion + ", current version " + currentVersion + ").");
    }
}
