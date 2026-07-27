package com.chartsdk.chart;

import com.chartsdk.cache.SamplingMetadata;

import java.util.Map;

record ChartDefinition(long id, long datasourceId, String sqlQuery, String chartType,
                       Map<String, Object> options, Map<String, Object> builderConfig,
                       String refreshMode, int cacheTtlSeconds, int version,
                       SamplingMetadata sampling) {
}
