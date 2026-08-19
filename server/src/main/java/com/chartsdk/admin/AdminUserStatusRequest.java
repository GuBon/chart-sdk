package com.chartsdk.admin;

import jakarta.validation.constraints.NotNull;

public record AdminUserStatusRequest(@NotNull Boolean active) {
}
