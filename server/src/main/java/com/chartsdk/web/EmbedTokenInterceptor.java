package com.chartsdk.web;

import com.chartsdk.token.EmbedPrincipal;
import com.chartsdk.token.TokenService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class EmbedTokenInterceptor implements HandlerInterceptor {
    public static final String PRINCIPAL_ATTRIBUTE = "chartsdk.embedPrincipal";

    private final TokenService tokens;

    public EmbedTokenInterceptor(TokenService tokens) {
        this.tokens = tokens;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String authorization = request.getHeader("Authorization");
        EmbedPrincipal principal = tokens.validateBearer(authorization);
        request.setAttribute(PRINCIPAL_ATTRIBUTE, principal);
        return true;
    }
}
