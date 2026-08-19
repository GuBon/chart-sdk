package com.chartsdk.auth;

import jakarta.validation.constraints.NotNull;

public record SignupRequest(
        @NotNull String username,
        @NotNull String password,
        @NotNull String passwordConfirm
) {
}
