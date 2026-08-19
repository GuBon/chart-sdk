package com.chartsdk.auth;

import java.util.OptionalLong;

public interface CurrentUserProvider {
    OptionalLong currentUserId();

    /** 관리자 역할 여부. 읽기 범위 확장(전체 차트 목록)에만 쓰고, 변경 API 의 소유자 검사는 이 값을 보지 않는다. */
    default boolean isAdmin() {
        return false;
    }
}
