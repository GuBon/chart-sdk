package com.chartsdk.query.engine;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/** 소스 구성 판정 규칙(distinct 2개 이상)의 단일 소유지 — 경계값을 고정한다(설계 §4.4). */
class DistinctCountCompositionPolicyTest {

    private final DistinctCountCompositionPolicy policy = new DistinctCountCompositionPolicy();

    @Test
    void federationStartsAtTwoDistinctSources() {
        assertThat(policy.requiresFederation(Set.of())).isFalse();
        assertThat(policy.requiresFederation(Set.of(1L))).isFalse();
        assertThat(policy.requiresFederation(Set.of(1L, 2L))).isTrue();
        assertThat(policy.requiresFederation(null)).isFalse();
    }

    @Test
    void snapshotServingMirrorsTheSameThreshold() {
        assertThat(policy.requiresSnapshot(0)).isFalse();
        assertThat(policy.requiresSnapshot(1)).isFalse();
        assertThat(policy.requiresSnapshot(2)).isTrue();
        assertThat(policy.requiresSnapshot(Set.of(1L, 2L, 3L))).isTrue();
    }

    @Test
    void refreshModeIsPinnedToManualOnlyForSnapshotCompositions() {
        assertThat(policy.normalizeRefreshMode(Set.of(1L), "live")).isEqualTo("live");
        assertThat(policy.normalizeRefreshMode(Set.of(1L), "manual")).isEqualTo("manual");
        assertThat(policy.normalizeRefreshMode(Set.of(1L, 2L), "live")).isEqualTo("manual");
    }
}
