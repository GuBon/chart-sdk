package com.chartsdk.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record DataDisplayNameUpdateRequest(
        @NotNull Long datasourceId,
        String schema,
        @NotBlank String relation,
        String column,
        String displayName
) {
}
