package com.chartsdk.web.dto;

import jakarta.validation.constraints.NotNull;

import java.util.Map;

public record BuilderQueryRequest(
        @NotNull Long datasourceId,
        @NotNull Map<String, Object> builderConfig,
        String chartType,
        Map<String, Object> options,
        String mode
) {
}
