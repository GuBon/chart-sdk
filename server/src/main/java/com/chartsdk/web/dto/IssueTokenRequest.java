package com.chartsdk.web.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * 토큰 발급 만료 기간. null이면 서비스가 기본값(365일)을 쓴다. 값이 오면 1~3650일(약 10년)로 제한한다 —
 * 음수의 조용한 클램프나 서기 4764년 같은 터무니없는 값을 정직한 400으로 거부한다(설계 L1).
 */
public record IssueTokenRequest(
        @Min(value = 1, message = "1~3650일 범위여야 합니다.")
        @Max(value = 3650, message = "1~3650일 범위여야 합니다.")
        Integer expiresInDays
) {
}
