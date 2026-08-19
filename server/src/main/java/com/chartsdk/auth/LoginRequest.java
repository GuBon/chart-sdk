package com.chartsdk.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record LoginRequest(@NotBlank String username, @NotNull String password) {
}
