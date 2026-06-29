package com.chartsdk.chart;

import java.util.Map;

record ChartDefinition(long id, long datasourceId, String sqlQuery, String chartType,
                       Map<String, Object> options, String refreshMode, int cacheTtlSeconds, int version) {
}
