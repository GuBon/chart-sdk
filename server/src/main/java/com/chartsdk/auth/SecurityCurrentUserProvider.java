package com.chartsdk.auth;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;

import java.util.OptionalLong;

@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityCurrentUserProvider implements CurrentUserProvider {
    @Override
    public OptionalLong currentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) return OptionalLong.empty();
        if (authentication.getPrincipal() instanceof SessionPrincipal principal) {
            return OptionalLong.of(principal.id());
        }
        return OptionalLong.empty();
    }
}
