package com.chartsdk.query;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** Semantic gate for system-controlled automatic sampling. Manual sampling remains unrestricted. */
public final class PointSamplingPolicy {
    private static final Set<String> POINT_TYPES = Set.of("scatter", "geoscatter");

    private PointSamplingPolicy() {
    }

    public static boolean shouldApply(String chartType, Map<String, Object> config) {
        if (config == null || !(config.get("sample") instanceof Map<?, ?> sample)) return false;
        return !"auto".equals(String.valueOf(sample.get("mode")))
                || supportsAutomaticSampling(chartType, config);
    }

    public static boolean supportsAutomaticSampling(String chartType, Map<String, Object> config) {
        if (chartType == null || config == null) return false;
        boolean pointType = POINT_TYPES.contains(chartType)
                || ("map".equals(chartType) && "heatmap".equals(String.valueOf(config.get("geoSeriesType"))));
        if (!pointType) return false;
        if (config.get("geoPoint") instanceof Map<?, ?> geoPoint
                && "spatial".equals(String.valueOf(geoPoint.get("mode")))) {
            return true;
        }
        Object rawYAxis = config.get("yAxis");
        if (!(rawYAxis instanceof List<?> yAxis) || yAxis.isEmpty()) return false;
        return yAxis.stream().allMatch(item -> item instanceof Map<?, ?> field
                && "none".equals(String.valueOf(field.get("agg"))));
    }

    public static boolean hasResultShapingFilters(Map<String, Object> config) {
        return nonEmptyList(config.get("joins")) || nonEmptyList(config.get("where"));
    }

    private static boolean nonEmptyList(Object value) {
        return value instanceof List<?> list && !list.isEmpty();
    }
}
