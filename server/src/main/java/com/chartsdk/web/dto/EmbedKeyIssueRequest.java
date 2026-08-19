package com.chartsdk.web.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * 임베드 키 발급 입력. null 은 기본값(365일),
 * 값이 오면 1~3650일의 정직한 400 검증(설계 L1).
 */
public record EmbedKeyIssueRequest(
        @Min(value = 1, message = "1~3650일 범위여야 합니다.")
        @Max(value = 3650, message = "1~3650일 범위여야 합니다.")
        Integer expiresInDays
) {
}
