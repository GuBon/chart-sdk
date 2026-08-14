package com.chartsdk.token;

import java.time.Instant;

/** 발급 성공 응답 전용 DTO. embedKey 원문은 이 응답에서만 한 번 전달한다. */
public record IssuedEmbedKey(
        long id,
        long userId,
        long chartId,
        Instant expiresAt,
        EmbedKeyStatus status,
        Instant createdAt,
        String embedKey
) {
}
