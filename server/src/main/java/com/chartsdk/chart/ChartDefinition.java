package com.chartsdk.chart;

import com.chartsdk.cache.SamplingMetadata;

import java.util.Map;

public record ChartDefinition(long id, long datasourceId, String sqlQuery, String chartType,
                              Map<String, Object> options, Map<String, Object> builderConfig,
                              String refreshMode, int version,
                              SamplingMetadata sampling) {
}
