package com.chartsdk.auth;

import java.text.Normalizer;
import java.util.Locale;

/** 회원가입·로그인·관리자·마이그레이션이 공유하는 아이디 정규화 규칙. */
public final class UsernameNormalizer {
    public static final int MAX_CODE_POINTS = 100;

    private UsernameNormalizer() {
    }

    public static String normalize(String username) {
        if (username == null) return "";
        return Normalizer.normalize(username, Normalizer.Form.NFKC)
                .strip()
                .toLowerCase(Locale.ROOT);
    }

    public static boolean hasValidLength(String normalized) {
        int length = normalized.codePointCount(0, normalized.length());
        return length >= 1 && length <= MAX_CODE_POINTS;
    }
}
