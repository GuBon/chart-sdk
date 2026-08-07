package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class QueryTimeoutPolicyTest {
    @Test
    void defaultsKeepMetadataFastAndAllowLongerChartWork() {
        QueryTimeoutPolicy policy = QueryTimeoutPolicy.defaults();

        assertThat(policy.seconds(AdmissionController.Kind.PREVIEW)).isEqualTo(10);
        assertThat(policy.seconds(AdmissionController.Kind.CATALOG)).isEqualTo(10);
        assertThat(policy.seconds(AdmissionController.Kind.EXPLAIN)).isEqualTo(10);
        assertThat(policy.seconds(AdmissionController.Kind.CHART)).isEqualTo(30);
        assertThat(policy.seconds(AdmissionController.Kind.SAMPLE)).isEqualTo(30);
        assertThat(policy.seconds(AdmissionController.Kind.FEDERATION)).isEqualTo(30);
    }

    @Test
    void invalidConfigurationFailsFastInsteadOfDisablingTheDeadline() {
        assertThatThrownBy(() -> new QueryTimeoutPolicy(0, 10, 10, 30, 30, 30))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at least one second");
    }
}
