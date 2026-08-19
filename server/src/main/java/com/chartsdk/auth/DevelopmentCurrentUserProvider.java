package com.chartsdk.auth;

import org.springframework.boot.autoconfigure.condition.ConditionalOnNotWebApplication;
import org.springframework.stereotype.Component;

import java.util.OptionalLong;

/** HTTP가 없는 배치·통합 테스트 컨텍스트용 구현. 서블릿 런타임에는 등록되지 않는다. */
@Component
@ConditionalOnNotWebApplication
public class DevelopmentCurrentUserProvider implements CurrentUserProvider {
    @Override
    public OptionalLong currentUserId() {
        return OptionalLong.empty();
    }
}
