package com.chartsdk.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.Map;

public record QueryRunRequest(
        @NotNull Long datasourceId,
        @NotBlank String sql,
        String chartType,
        Map<String, Object> options
) {
}
