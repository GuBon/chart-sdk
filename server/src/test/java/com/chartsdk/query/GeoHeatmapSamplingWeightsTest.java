package com.chartsdk.query;

import com.chartsdk.cache.SamplingMetadata;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class GeoHeatmapSamplingWeightsTest {
    @Test
    void addsInverseProbabilityWeightWhenNoValueColumnWasSelected() {
        QueryRows rows = new QueryRows(
                List.of(Map.of("name", "longitude", "type", "numeric")),
                List.of(List.of(127.0)), 1, false, 1);
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(Map.of(
                        "sample", Map.of("mode", "auto"),
                        "yAxis", List.of(Map.of("column", "latitude", "agg", "none"))))
                .asResultRandom(100_000, 10_000);

        QueryRows weighted = GeoHeatmapSamplingWeights.apply(
                rows, "map", Map.of("geoSeriesType", "heatmap"), sampling);

        assertThat(weighted.columns()).extracting(column -> column.get("name"))
                .contains("__chartsdk_point_value");
        assertThat(weighted.rows().get(0).get(1)).isEqualTo(10.0);
    }

    @Test
    void leavesScatterPointsUnchanged() {
        QueryRows rows = new QueryRows(List.of(), List.of(List.of(1, 2)), 1, false, 1);
        SamplingMetadata sampling = SamplingMetadata.system(10);

        assertThat(GeoHeatmapSamplingWeights.apply(rows, "scatter", Map.of(), sampling)).isSameAs(rows);
    }

    @Test
    void reservoirWeightUsesTheActualPopulationInsteadOfThePlannerEstimate() {
        QueryRows rows = new QueryRows(
                List.of(Map.of("name", "longitude", "type", "numeric")),
                List.of(List.of(127.0)), 1, false, 1);
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(Map.of(
                        "sample", Map.of("mode", "auto", "size", 10_000),
                        "yAxis", List.of(Map.of("column", "latitude", "agg", "none"))))
                .asReservoir(1_000_000, 10_000);

        QueryRows weighted = GeoHeatmapSamplingWeights.apply(
                rows, "map", Map.of("geoSeriesType", "heatmap"), sampling);

        assertThat(weighted.rows().get(0).get(1)).isEqualTo(100.0);
    }
}
