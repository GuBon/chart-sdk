package com.chartsdk.auth;

import org.springframework.stereotype.Component;

import java.util.OptionalLong;

@Component
public class DevelopmentCurrentUserProvider implements CurrentUserProvider {
    @Override
    public OptionalLong currentUserId() {
        return OptionalLong.empty();
    }
}
