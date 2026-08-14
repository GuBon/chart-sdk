package com.chartsdk.web.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

/**
 * 임베드 키 발급 입력. 만료 기간 정책은 사용자 토큰(IssueTokenRequest)과 동일 —
 * null 은 기본값(365일), 값이 오면 1~3650일의 정직한 400 검증(설계 L1).
 */
public record EmbedKeyIssueRequest(
        @NotNull(message = "userId는 필수입니다.")
        Long userId,
        @Min(value = 1, message = "1~3650일 범위여야 합니다.")
        @Max(value = 3650, message = "1~3650일 범위여야 합니다.")
        Integer expiresInDays
) {
}
