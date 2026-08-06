package com.chartsdk.datasource;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import com.chartsdk.metrics.DatasourcePasswordMetrics;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DatasourcePasswordResolverTest {
    @Test
    void readsV1WithoutUsingLegacyMetric() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        DatasourcePasswordCodec codec = new DatasourcePasswordCodec("key");
        DatasourcePasswordResolver resolver = new DatasourcePasswordResolver(
                codec, new DatasourcePasswordMetrics(registry), false);

        assertThat(resolver.resolve(codec.encrypt("secret"))).isEqualTo("secret");
        assertThat(registry.counter("chartsdk.datasource.password.legacy_reads").count()).isZero();
    }

    @Test
    void metersTemporaryFallbackAndRejectsItWhenDisabled() {
        SimpleMeterRegistry allowedRegistry = new SimpleMeterRegistry();
        DatasourcePasswordCodec codec = new DatasourcePasswordCodec("key");
        DatasourcePasswordResolver allowed = new DatasourcePasswordResolver(
                codec, new DatasourcePasswordMetrics(allowedRegistry), true);

        assertThat(allowed.resolve("legacy-secret")).isEqualTo("legacy-secret");
        assertThat(allowedRegistry.counter("chartsdk.datasource.password.legacy_reads").count()).isEqualTo(1);

        SimpleMeterRegistry deniedRegistry = new SimpleMeterRegistry();
        DatasourcePasswordResolver denied = new DatasourcePasswordResolver(
                codec, new DatasourcePasswordMetrics(deniedRegistry), false);
        assertThatThrownBy(() -> denied.resolve("legacy-secret"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("migration");
        assertThat(deniedRegistry.counter("chartsdk.datasource.password.legacy_reads").count()).isEqualTo(1);
    }

    @Test
    void neverTreatsAnUnknownCiphertextVersionAsPlaintext() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        DatasourcePasswordResolver resolver = new DatasourcePasswordResolver(
                new DatasourcePasswordCodec("key"), new DatasourcePasswordMetrics(registry), true);

        assertThatThrownBy(() -> resolver.resolve("v2:future-ciphertext"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported");
        assertThat(registry.counter("chartsdk.datasource.password.legacy_reads").count()).isZero();
    }
}
