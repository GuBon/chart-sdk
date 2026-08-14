package com.chartsdk.token;

import java.time.Instant;

/** 목록 API 전용 DTO. Bearer 자격 증명인 embedKey 원문은 의도적으로 포함하지 않는다. */
public record EmbedKeySummary(
        long id,
        long userId,
        long chartId,
        Instant expiresAt,
        EmbedKeyStatus status,
        Instant createdAt,
        Instant revokedAt,
        String revokedReason
) {
}
