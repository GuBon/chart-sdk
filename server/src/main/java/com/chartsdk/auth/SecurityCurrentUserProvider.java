package com.chartsdk.auth;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;

import java.util.Optional;
import java.util.OptionalLong;

@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityCurrentUserProvider implements CurrentUserProvider {
    @Override
    public OptionalLong currentUserId() {
        return principal().map(p -> OptionalLong.of(p.id())).orElse(OptionalLong.empty());
    }

    @Override
    public boolean isAdmin() {
        return principal().map(p -> "admin".equals(p.role())).orElse(false);
    }

    private static Optional<SessionPrincipal> principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) return Optional.empty();
        return authentication.getPrincipal() instanceof SessionPrincipal principal
                ? Optional.of(principal) : Optional.empty();
    }
}
