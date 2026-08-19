package com.chartsdk.auth;

import java.text.Normalizer;
import java.util.Locale;

/**
 * 회원가입·로그인·관리자·마이그레이션이 공유하는 아이디 정규화 규칙.
 *
 * <p>두 형태를 구분한다. {@link #canonical}은 저장·표시용(NFKC + 양끝 공백 제거, 대소문자 보존)이고
 * {@link #normalize}는 조회 키용(canonical + ROOT 소문자)이다. 저장 형태를 canonical 로 고정해야
 * 전각·호환 문자·NBSP 가 그대로 남아 "보이는 아이디"와 "조회 키"의 길이·문자가 어긋나지 않는다.
 */
public final class UsernameNormalizer {
    public static final int MAX_CODE_POINTS = 100;

    private UsernameNormalizer() {
    }

    /** 저장·표시용 정규형. NFKC 는 공백류(NBSP·전각 공백)도 일반 공백으로 접으므로 그 뒤에 strip 한다. */
    public static String canonical(String username) {
        if (username == null) return "";
        return Normalizer.normalize(username, Normalizer.Form.NFKC).strip();
    }

    /** 조회 키(유일성·로그인 매칭). canonical 에 로케일 무관 소문자만 더한다. */
    public static String normalize(String username) {
        return canonical(username).toLowerCase(Locale.ROOT);
    }

    public static boolean hasValidLength(String value) {
        int length = value.codePointCount(0, value.length());
        return length >= 1 && length <= MAX_CODE_POINTS;
    }

    /** 제어·서식 문자(ZWSP·ZWJ·BOM 등)는 보이지 않아 동명 아이디 혼동을 만들므로 거부한다. */
    public static boolean hasInvisibleCharacter(String value) {
        return value.codePoints().anyMatch(cp -> {
            int type = Character.getType(cp);
            return type == Character.CONTROL || type == Character.FORMAT;
        });
    }
}
