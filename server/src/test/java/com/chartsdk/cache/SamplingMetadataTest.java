package com.chartsdk.cache;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SamplingMetadataTest {
    @Test
    void derivesSystemSamplingFromBuilderConfig() {
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(
                Map.of(
                        "sample", Map.of("mode", "auto", "rate", 10, "seed", 77),
                        "yAxis", List.of(
                                Map.of("column", "amount", "agg", "sum", "alias", "total"),
                                Map.of("column", "customer_id", "agg", "count_distinct")
                        )));

        assertThat(sampling.version()).isEqualTo(5);
        assertThat(sampling.approximate()).isTrue();
        assertThat(sampling.method()).isEqualTo("SYSTEM");
        assertThat(sampling.mode()).isEqualTo("auto");
        assertThat(sampling.rate()).isEqualTo(10.0);
        assertThat(sampling.seed()).isEqualTo(77L);
        assertThat(sampling.valueMode()).isEqualTo("sample");
        assertThat(sampling.estimates()).containsExactly(
                new SamplingMetadata.Estimate("total", "sum", "SAMPLE_AGGREGATE", "SAMPLE_AGGREGATE_ONLY"),
                new SamplingMetadata.Estimate("count_distinct_customer_id", "count_distinct",
                        "OBSERVED_DISTINCT", "DISTINCT_COUNT_NOT_EXTRAPOLATED"));
        assertThat(sampling.warnings()).containsExactly(
                "BLOCK_SAMPLE_CLUSTERING", "SAMPLE_AGGREGATE_ONLY", "DISTINCT_COUNT_NOT_EXTRAPOLATED");
    }

    @Test
    void writesNestedContractAndBackwardCompatibleAliases() {
        Map<String, Object> response = new LinkedHashMap<>();
        SamplingMetadata.system(25).putInto(response);

        assertThat(response.get("sampling")).isEqualTo(Map.of(
                "version", 5,
                "mode", "manual",
                "requestedMethod", "system",
                "rate", 25.0,
                "seed", 48_291L,
                "approximate", true,
                "method", "SYSTEM",
                "valueMode", "sample",
                "warnings", List.of("BLOCK_SAMPLE_CLUSTERING")));
        assertThat(response.get("approximate")).isEqualTo(true);
        assertThat(response.get("sampleRate")).isEqualTo(25.0);
    }

    @Test
    void rateHundredIsAnExactFullScanNotAnApproximation() {
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(Map.of(
                "sample", Map.of("mode", "manual", "rate", 100, "seed", 99),
                "yAxis", List.of(Map.of("column", "amount", "agg", "variance"))));

        assertThat(sampling.approximate()).isFalse();
        assertThat(sampling.method()).isEqualTo("FULL_SCAN");
        assertThat(sampling.seed()).isNull();
        assertThat(sampling.valueMode()).isEqualTo("exact");
        assertThat(sampling.estimates()).containsExactly(
                new SamplingMetadata.Estimate("variance_amount", "variance", "EXACT", null));
        assertThat(sampling.warnings()).isEmpty();
    }

    @Test
    void cacheDefinitionMatchingIgnoresRuntimeCountsButIncludesSeedAndVersion() {
        SamplingMetadata definition = SamplingMetadata.fromBuilderConfig(
                Map.of("sample", Map.of("mode", "manual", "rate", 0.5, "seed", 7)));
        SamplingMetadata executed = definition.withExecution(123,
                List.of(new SamplingMetadata.GroupSampleCount("A", 123)), definition.estimates(), List.of());

        assertThat(executed.matchesDefinition(definition)).isTrue();
        assertThat(executed.matchesDefinition(SamplingMetadata.fromBuilderConfig(
                Map.of("sample", Map.of("mode", "manual", "rate", 0.5, "seed", 8))))).isFalse();
        SamplingMetadata oldVersion = SamplingMetadata.fromMap(Map.of(
                "version", 1, "approximate", true, "method", "SYSTEM", "mode", "manual", "rate", 0.5, "seed", 7));
        assertThat(oldVersion.matchesDefinition(definition)).isFalse();
    }

    @Test
    void invalidOrAbsentSamplingDoesNotCreateMetadata() {
        assertThat(SamplingMetadata.fromBuilderConfig(Map.of())).isNull();
        assertThat(SamplingMetadata.fromBuilderConfig(Map.of("sample", Map.of("rate", 0)))).isNull();
        assertThat(SamplingMetadata.fromMap(Map.of("approximate", false, "method", "SYSTEM", "rate", 10))).isNull();
    }

    @Test
    void confidenceIntervalsSurviveCacheSerializationRoundTrip() {
        SamplingMetadata definition = SamplingMetadata.fromBuilderConfig(Map.of(
                "sample", Map.of("mode", "auto", "size", 10_000),
                "yAxis", List.of(Map.of("column", "amount", "agg", "stddev"))));
        SamplingMetadata.Estimate estimate = definition.estimates().get(0).withConfidence(
                1.62, 16.2,
                List.of(new SamplingMetadata.ConfidenceInterval("A", 100, 10.0, 8.78, 11.62, 16.2)));
        SamplingMetadata executed = definition.asIndexRandom(1_000_000, 10_000)
                .withExecution(9_998, List.of(new SamplingMetadata.GroupSampleCount("A", 100)),
                        List.of(estimate), List.of("STDDEV_CI_NORMALITY_ASSUMED"));

        SamplingMetadata restored = SamplingMetadata.fromMap(executed.toMap());

        assertThat(restored).isEqualTo(executed);
        assertThat(restored.estimates().get(0).intervals()).containsExactly(
                new SamplingMetadata.ConfidenceInterval("A", 100, 10.0, 8.78, 11.62, 16.2));
    }
}
