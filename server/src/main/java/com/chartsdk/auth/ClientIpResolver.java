package com.chartsdk.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/**
 * 인증 제한용 client IP의 단일 진입점.
 * 리버스 프록시에서는 Spring의 forwarded-header 처리를 명시적으로 켜고,
 * 외부가 보낸 Forwarded 헤더를 신뢰 프록시가 제거·재작성해야 한다.
 */
@Component
public class ClientIpResolver {
    public String resolve(HttpServletRequest request) {
        String address = request.getRemoteAddr();
        return address == null || address.isBlank() ? "unknown" : address;
    }
}
