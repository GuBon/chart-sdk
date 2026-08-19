package com.chartsdk.admin;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record AdminUserRoleRequest(
        @NotBlank @Pattern(regexp = "member|admin") String role
) {
}
