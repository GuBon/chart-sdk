package com.chartsdk.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 서버 계산 캐시와 브라우저 HTTP 캐시의 책임을 분리한다.
 * API 응답은 PostgreSQL 캐시 정책을 우회하지 않게 브라우저 저장을 금지하고,
 * 버전 쿼리가 붙은 정적 지도만 장기 캐시한다.
 */
@Component
public class HttpCachePolicyFilter extends OncePerRequestFilter {
    private static final String NO_STORE = "no-store";
    private static final String IMMUTABLE = "public, max-age=31536000, immutable";
    private static final String REVALIDATE = "public, max-age=3600, must-revalidate";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String path = request.getRequestURI();
        if (path.startsWith("/api/")) {
            response.setHeader("Cache-Control", NO_STORE);
        } else if (path.startsWith("/maps/")) {
            response.setHeader(
                    "Cache-Control",
                    request.getParameter("v") == null ? REVALIDATE : IMMUTABLE
            );
        }
        filterChain.doFilter(request, response);
    }
}
