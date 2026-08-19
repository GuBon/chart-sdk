package com.chartsdk.auth;

public record AuthUserResponse(long id, String username, String displayName, String role) {
    public static AuthUserResponse from(SessionPrincipal principal) {
        return new AuthUserResponse(
                principal.id(), principal.getUsername(), principal.displayName(), principal.role());
    }
}
