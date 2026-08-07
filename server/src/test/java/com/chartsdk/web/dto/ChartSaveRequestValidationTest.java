package com.chartsdk.web.dto;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ChartSaveRequestValidationTest {
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void acceptsOnlyManualOrLiveRefreshMode() {
        assertThat(refreshModeViolations(request("manual"))).isZero();
        assertThat(refreshModeViolations(request("live"))).isZero();
        assertThat(refreshModeViolations(request("ttl"))).isOne();
    }

    @Test
    void acceptsAbsentRefreshModeWhichRepositoryDefaultsToManual() {
        // @Pattern 은 null 을 통과시킨다 — 생략 시 ChartRepository.valueOrDefault 가 'manual' 을 넣는 계약.
        assertThat(refreshModeViolations(request(null))).isZero();
    }

    private long refreshModeViolations(ChartSaveRequest request) {
        return validator.validate(request).stream()
                .filter(violation -> "refreshMode".equals(violation.getPropertyPath().toString()))
                .count();
    }

    private ChartSaveRequest request(String refreshMode) {
        return new ChartSaveRequest(
                "chart", null, 1L, "builder", null, Map.of("table", "sales"),
                "bar", Map.of(), refreshMode, null);
    }
}
