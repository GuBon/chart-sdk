package com.chartsdk.query;

import com.chartsdk.cache.SampleFingerprint;
import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.cache.SamplingQueryRows;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CachedSampleSqlBuilderTest {
    private final CachedSampleExecutor executor = new CachedSampleExecutor();

    @Test
    void aggregatesTheSameCachedRowsWithDifferentFinalAggregates() {
        Map<String, Object> sumConfig = config("sum", "total");
        QueryRows sample = sampleRows();
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(sumConfig)
                .asResultRandom(100, 3);
        BuilderSqlBuilder.Sql source = new BuilderSqlBuilder.Sql(
                "SELECT 'A' AS \"__chartsdk_x\", 10::numeric AS \"__chartsdk_y_0\"",
                List.of(), sampling);

        CachedSampleSqlBuilder.Plan sumPlan = CachedSampleSqlBuilder.build(
                sumConfig, "bar", sample, source);
        SamplingQueryRows.Result sums = SamplingQueryRows.extract(
                executor.execute(sample, sumPlan.aggregate()), sampling);

        assertThat(sums.rows().columns()).extracting(column -> column.get("name"))
                .containsExactly("category", "total");
        assertThat(sums.rows().rows()).hasSize(2);
        assertThat(number(sums.rows().rows().get(0).get(1))).isEqualTo(30.0);
        assertThat(sums.sampling().sampledRowCount()).isEqualTo(3);

        Map<String, Object> averageConfig = config("avg", "average");
        SamplingMetadata averageSampling = SamplingMetadata.fromBuilderConfig(averageConfig)
                .asResultRandom(100, 3);
        CachedSampleSqlBuilder.Plan averagePlan = CachedSampleSqlBuilder.build(
                averageConfig, "bar", sample,
                new BuilderSqlBuilder.Sql(source.text(), source.params(), averageSampling));
        SamplingQueryRows.Result averages = SamplingQueryRows.extract(
                executor.execute(sample, averagePlan.aggregate()), averageSampling);

        assertThat(averages.rows().columns()).extracting(column -> column.get("name"))
                .containsExactly("category", "average");
        assertThat(number(averages.rows().rows().get(0).get(1))).isEqualTo(15.0);
        assertThat(averagePlan.display().text())
                .contains("AS MATERIALIZED")
                .contains("AVG(\"__chartsdk_sample\".\"__chartsdk_y_0\")")
                .doesNotContain("ORDER BY random()", "SELECT *");
    }

    @Test
    void fingerprintReusesRowsAcrossAggregationAndOrderingButNotSeedOrFilter() {
        Map<String, Object> sum = config("sum", "total");
        Map<String, Object> average = new java.util.LinkedHashMap<>(config("avg", "average"));
        average.put("orderBy", Map.of("target", "y0", "direction", "desc"));

        assertThat(SampleFingerprint.of(7, List.of(7L), sum, "bar"))
                .isEqualTo(SampleFingerprint.of(7, List.of(7L), average, "bar"));

        Map<String, Object> otherSeed = new java.util.LinkedHashMap<>(sum);
        otherSeed.put("sample", Map.of("mode", "manual", "size", 1_000, "seed", 88));
        assertThat(SampleFingerprint.of(7, List.of(7L), otherSeed, "bar"))
                .isNotEqualTo(SampleFingerprint.of(7, List.of(7L), sum, "bar"));

        Map<String, Object> filtered = new java.util.LinkedHashMap<>(sum);
        filtered.put("where", List.of(Map.of("column", "amount", "op", "gte", "value", 10)));
        assertThat(SampleFingerprint.of(7, List.of(7L), filtered, "bar"))
                .isNotEqualTo(SampleFingerprint.of(7, List.of(7L), sum, "bar"));
    }

    @Test
    void fingerprintIgnoresRemovedLegacyGeoPointColorColumn() {
        Map<String, Object> legacy = new java.util.LinkedHashMap<>(config("none", "value"));
        legacy.put("geoPoint", Map.of(
                "mode", "columns",
                "valueColumn", "amount",
                "colorColumn", "customer_id"));
        Map<String, Object> current = new java.util.LinkedHashMap<>(legacy);
        current.put("geoPoint", Map.of(
                "mode", "columns",
                "valueColumn", "amount"));

        assertThat(SampleFingerprint.of(7, List.of(7L), legacy, "geoscatter"))
                .isEqualTo(SampleFingerprint.of(7, List.of(7L), current, "geoscatter"));
    }

    private static Map<String, Object> config(String aggregate, String alias) {
        return Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", aggregate, "alias", alias)),
                "orderBy", Map.of("target", "x", "direction", "asc"),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 77)
        );
    }

    private static QueryRows sampleRows() {
        return new QueryRows(
                List.of(
                        Map.of("name", "__chartsdk_x", "type", "text"),
                        Map.of("name", "__chartsdk_y_0", "type", "numeric")
                ),
                List.of(
                        List.of("A", new BigDecimal("10")),
                        List.of("A", new BigDecimal("20")),
                        List.of("B", new BigDecimal("5"))
                ),
                3, false, 1
        );
    }

    private static double number(Object value) {
        return ((Number) value).doubleValue();
    }
}
