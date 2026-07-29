package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SamplingQueryRowsTest {
    @Test
    void rawRowSampleUsesVisibleResultSizeAsActualSampleCount() {
        QueryRows source = new QueryRows(
                List.of(column("category", "text"), column("amount", "numeric")),
                List.of(List.of("A", 10), List.of("B", 20), List.of("C", 30)),
                3, false, 2);
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(Map.of(
                        "sample", Map.of("mode", "manual", "size", 10_000, "seed", 77),
                        "yAxis", List.of(Map.of("column", "amount", "agg", "none"))))
                .asIndexRandom(1_000_000, 10_000);

        SamplingQueryRows.Result result = SamplingQueryRows.extract(source, sampling);

        assertThat(result.rows()).isSameAs(source);
        assertThat(result.sampling().sampledRowCount()).isEqualTo(3);
        assertThat(result.sampling().groups()).isEmpty();
        assertThat(result.sampling().estimates().get(0).treatment()).isEqualTo("ROW_SAMPLE");
    }

    @Test
    void movesHiddenCountsIntoMetadataAndRemovesThemFromChartRows() {
        QueryRows source = new QueryRows(
                List.of(
                        column("category", "text"),
                        column("sum_amount", "numeric"),
                        column(SamplingMetadata.HIDDEN_GROUP_COUNT, "bigint"),
                        column(SamplingMetadata.HIDDEN_TOTAL_COUNT, "numeric")
                ),
                List.of(
                        List.of("A", 1200, 12L, 35L),
                        List.of("B", 2300, 23L, 35L)
                ),
                2, false, 8);
        SamplingMetadata definition = SamplingMetadata.system(10);

        SamplingQueryRows.Result result = SamplingQueryRows.extract(source, definition);

        assertThat(result.rows().columns()).containsExactly(
                column("category", "text"), column("sum_amount", "numeric"));
        assertThat(result.rows().rows()).containsExactly(
                List.of("A", 1200), List.of("B", 2300));
        assertThat(result.sampling().sampledRowCount()).isEqualTo(35L);
        assertThat(result.sampling().groups()).containsExactly(
                new SamplingMetadata.GroupSampleCount("A", 12),
                new SamplingMetadata.GroupSampleCount("B", 23));
    }

    @Test
    void emptySampleReportsZeroActualRows() {
        QueryRows source = new QueryRows(
                List.of(
                        column("category", "text"),
                        column(SamplingMetadata.HIDDEN_GROUP_COUNT, "bigint"),
                        column(SamplingMetadata.HIDDEN_TOTAL_COUNT, "numeric")
                ), List.of(), 0, false, 2);

        SamplingQueryRows.Result result = SamplingQueryRows.extract(source, SamplingMetadata.system(0.1));

        assertThat(result.rows().columns()).containsExactly(column("category", "text"));
        assertThat(result.sampling().sampledRowCount()).isZero();
        assertThat(result.sampling().groups()).isEmpty();
    }

    @Test
    void exactExecutionIsLeftUntouched() {
        QueryRows rows = new QueryRows(List.of(column("category", "text")), List.of(List.of("A")), 1, false, 1);
        SamplingMetadata exact = SamplingMetadata.fromBuilderConfig(
                Map.of("sample", Map.of("mode", "manual", "rate", 100), "yAxis", List.of()));

        SamplingQueryRows.Result result = SamplingQueryRows.extract(rows, exact);

        assertThat(result.rows()).isSameAs(rows);
        assertThat(result.sampling()).isSameAs(exact);
    }

    @Test
    void extractsPerSeriesCountAndDispersionIntervalFromHiddenColumns() {
        QueryRows source = new QueryRows(
                List.of(
                        column("category", "text"),
                        column("stddev_amount", "numeric"),
                        column(SamplingMetadata.HIDDEN_GROUP_COUNT, "bigint"),
                        column(SamplingMetadata.HIDDEN_TOTAL_COUNT, "bigint"),
                        column(SamplingMetadata.HIDDEN_SERIES_COUNT_PREFIX + "0", "bigint"),
                        column(SamplingMetadata.HIDDEN_MEAN_PREFIX + "0", "numeric"),
                        column(SamplingMetadata.HIDDEN_SD_PREFIX + "0", "numeric")
                ),
                List.of(List.of("A", 10.0, 120L, 120L, 100L, 50.0, 10.0)),
                1, false, 4);
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(Map.of(
                        "sample", Map.of("mode", "auto", "size", 10_000),
                        "yAxis", List.of(Map.of("column", "amount", "agg", "stddev"))))
                .asIndexRandom(1_000_000, 10_000);

        SamplingQueryRows.Result result = SamplingQueryRows.extract(source, sampling);

        assertThat(result.rows().columns()).containsExactly(
                column("category", "text"), column("stddev_amount", "numeric"));
        assertThat(result.sampling().estimates().get(0).intervals()).hasSize(1);
        assertThat(result.sampling().estimates().get(0).intervals().get(0).sampleCount()).isEqualTo(100);
        assertThat(result.sampling().warnings()).contains("STDDEV_CI_NORMALITY_ASSUMED");
    }

    @Test
    void resultRandomUsesTheSameUniformSampleConfidencePipeline() {
        QueryRows source = new QueryRows(
                List.of(
                        column("category", "text"),
                        column("variance_amount", "numeric"),
                        column(SamplingMetadata.HIDDEN_GROUP_COUNT, "bigint"),
                        column(SamplingMetadata.HIDDEN_TOTAL_COUNT, "bigint"),
                        column(SamplingMetadata.HIDDEN_SERIES_COUNT_PREFIX + "0", "bigint"),
                        column(SamplingMetadata.HIDDEN_MEAN_PREFIX + "0", "numeric"),
                        column(SamplingMetadata.HIDDEN_SD_PREFIX + "0", "numeric")
                ),
                List.of(List.of("A", 100.0, 120L, 120L, 100L, 50.0, 10.0)),
                1, false, 4);
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(Map.of(
                        "sample", Map.of("mode", "manual", "size", 10_000),
                        "yAxis", List.of(Map.of("column", "amount", "agg", "variance"))))
                .asResultRandom(0, 10_000);

        SamplingQueryRows.Result result = SamplingQueryRows.extract(source, sampling);

        assertThat(result.sampling().method()).isEqualTo("RESULT_RANDOM");
        assertThat(result.sampling().estimates().get(0).intervals()).hasSize(1);
        assertThat(result.sampling().warnings())
                .contains("RESULT_RANDOM_SAMPLE", "STDDEV_CI_NORMALITY_ASSUMED");
    }

    private static Map<String, Object> column(String name, String type) {
        return Map.of("name", name, "type", type);
    }
}
