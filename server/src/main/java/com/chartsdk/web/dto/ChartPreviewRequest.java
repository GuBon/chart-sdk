package com.chartsdk.web.dto;

import jakarta.validation.constraints.NotNull;

import java.util.Map;

public record ChartPreviewRequest(
        String chartType,
        Map<String, Object> options,
        Map<String, Object> builderConfig,
        @NotNull Map<String, Object> rows
) {
}
