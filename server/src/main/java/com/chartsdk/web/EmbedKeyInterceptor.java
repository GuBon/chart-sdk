package com.chartsdk.web;

import com.chartsdk.token.EmbedKeyPrincipal;
import com.chartsdk.token.EmbedKeyService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/** 임베드 데이터 요청의 Bearer 임베드 키 검증 — 검증 지점을 한 곳으로 한정한다(계약 6.1). */
@Component
public class EmbedKeyInterceptor implements HandlerInterceptor {
    public static final String PRINCIPAL_ATTRIBUTE = "chartsdk.embedPrincipal";

    private final EmbedKeyService embedKeys;

    public EmbedKeyInterceptor(EmbedKeyService embedKeys) {
        this.embedKeys = embedKeys;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String authorization = request.getHeader("Authorization");
        EmbedKeyPrincipal principal = embedKeys.validateBearer(authorization);
        request.setAttribute(PRINCIPAL_ATTRIBUTE, principal);
        return true;
    }
}
