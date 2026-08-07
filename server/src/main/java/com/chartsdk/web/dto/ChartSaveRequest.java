package com.chartsdk.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import java.util.Map;

public record ChartSaveRequest(
        @NotBlank String name,
        String description,
        @NotNull Long datasourceId,
        String defineMode,
        String sqlQuery,
        Map<String, Object> builderConfig,
        String chartType,
        Map<String, Object> options,
        @Pattern(regexp = "live|manual") String refreshMode,
        Integer version
) {
}
