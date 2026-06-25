package com.chartsdk.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * 요청마다 요청 ID 를 MDC 에 심어 모든 로그에 상관관계(correlation)를 부여하고, 액세스 로그 1줄을 남긴다.
 * X-Request-Id 가 들어오면 그대로 전파(게이트웨이/프록시 추적 연계), 없으면 생성. 응답 헤더로도 회신한다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger("access");
    private static final String HEADER = "X-Request-Id";
    private static final String MDC_KEY = "requestId";

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String id = req.getHeader(HEADER);
        if (id == null || id.isBlank()) id = UUID.randomUUID().toString().substring(0, 8);
        MDC.put(MDC_KEY, id);
        res.setHeader(HEADER, id);
        long start = System.currentTimeMillis();
        try {
            chain.doFilter(req, res);
        } finally {
            // 액추에이터 프로브는 노이즈라 제외
            if (!req.getRequestURI().startsWith("/actuator")) {
                log.info("{} {} -> {} ({}ms)", req.getMethod(), req.getRequestURI(), res.getStatus(),
                        System.currentTimeMillis() - start);
            }
            MDC.remove(MDC_KEY);
        }
    }
}
