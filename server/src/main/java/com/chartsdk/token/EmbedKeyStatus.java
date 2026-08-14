package com.chartsdk.token;

/** 관리 API에서 사용하는 임베드 키의 현재 상태. 원문 키와 독립된 안전한 메타데이터다. */
public enum EmbedKeyStatus {
    ACTIVE,
    EXPIRED,
    REVOKED
}
