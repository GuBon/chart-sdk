package com.chartsdk.token;

/** 검증을 통과한 임베드 키의 서버측 바인딩. chartId 는 키에서만 나온다 — 클라이언트 지정 불가. */
public record EmbedKeyPrincipal(long keyId, long userId, long chartId) {
}
