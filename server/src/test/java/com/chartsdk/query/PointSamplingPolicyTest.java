package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class PointSamplingPolicyTest {
    private static Map<String, Object> config(String geoSeriesType, String aggregate) {
        java.util.Map<String, Object> config = new java.util.LinkedHashMap<>();
        config.put("sample", Map.of("mode", "auto"));
        config.put("yAxis", List.of(Map.of("column", "value", "agg", aggregate)));
        if (geoSeriesType != null) config.put("geoSeriesType", geoSeriesType);
        return config;
    }

    @Test
    void automaticSamplingIsLimitedToRawPointRenderers() {
        assertThat(PointSamplingPolicy.supportsAutomaticSampling("scatter", config(null, "none"))).isTrue();
        assertThat(PointSamplingPolicy.supportsAutomaticSampling("geoscatter", config(null, "none"))).isTrue();
        assertThat(PointSamplingPolicy.supportsAutomaticSampling("map", config("heatmap", "none"))).isTrue();

        assertThat(PointSamplingPolicy.supportsAutomaticSampling("bar", config(null, "none"))).isFalse();
        assertThat(PointSamplingPolicy.supportsAutomaticSampling("line", config(null, "none"))).isFalse();
        assertThat(PointSamplingPolicy.supportsAutomaticSampling("heatmap", config(null, "none"))).isFalse();
        assertThat(PointSamplingPolicy.supportsAutomaticSampling("map", config("map", "none"))).isFalse();
        assertThat(PointSamplingPolicy.supportsAutomaticSampling("scatter", config(null, "sum"))).isFalse();

        Map<String, Object> spatialPoint = new java.util.LinkedHashMap<>(config(null, "none"));
        spatialPoint.put("yAxis", List.of());
        spatialPoint.put("geoPoint", Map.of("mode", "spatial", "spatialColumn", "location"));
        assertThat(PointSamplingPolicy.supportsAutomaticSampling("geoscatter", spatialPoint)).isTrue();
    }

    @Test
    void manualSamplingRemainsAvailableForExistingChartTypes() {
        Map<String, Object> manualBar = Map.of(
                "sample", Map.of("mode", "manual", "size", 10_000),
                "yAxis", List.of(Map.of("column", "value", "agg", "sum")));

        assertThat(PointSamplingPolicy.shouldApply("bar", manualBar)).isTrue();
    }
}
