package com.chartsdk.web.dto;

import jakarta.validation.constraints.NotBlank;

public record UserCreateRequest(
        @NotBlank String username,
        String displayName
) {
}
