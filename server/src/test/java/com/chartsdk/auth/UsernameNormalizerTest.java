package com.chartsdk.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UsernameNormalizerTest {
    /** 조합형 자모 \u1112+\u1161+\u11AB(3 code point) — NFKC 로 완성형 '한'(1 code point)이 된다. */
    private static final String DECOMPOSED_HAN = "\u1112\u1161\u11AB";

    @Test
    void canonicalAppliesNfkcAndStripButKeepsCase() {
        // 전각·EM SPACE·NBSP 는 NFKC 로 접힌 뒤 strip 되고, 대소문자는 저장·표시용이라 보존한다.
        assertThat(UsernameNormalizer.canonical("\u2003ＡdＭiＮ\u00A0")).isEqualTo("AdMiN");
        assertThat(UsernameNormalizer.canonical(null)).isEmpty();
    }

    @Test
    void normalizeAppliesNfkcUnicodeStripAndRootLowercase() {
        assertThat(UsernameNormalizer.normalize("\u2003ＡdＭiＮ\u2003")).isEqualTo("admin");
        assertThat(UsernameNormalizer.normalize(UsernameNormalizer.canonical("ＡdＭiＮ")))
                .as("canonical 을 다시 normalize 해도 같은 조회 키")
                .isEqualTo(UsernameNormalizer.normalize("ＡdＭiＮ"));
    }

    @Test
    void validatesUnicodeCodePointsRatherThanUtf16Units() {
        String oneHundred = "😀".repeat(100);
        assertThat(UsernameNormalizer.hasValidLength(oneHundred)).isTrue();
        assertThat(UsernameNormalizer.hasValidLength(oneHundred + "a")).isFalse();
        assertThat(UsernameNormalizer.hasValidLength("")).isFalse();
    }

    @Test
    void nfkcCanShrinkOrGrowSoBothFormsMustBeMeasured() {
        // 원문 300 code point 가 canonical 100 자로 줄어든다 — 원문만 재면 통과, canonical 로 재야 한다.
        String decomposed = DECOMPOSED_HAN.repeat(100);
        assertThat(UsernameNormalizer.hasValidLength(decomposed)).isFalse();
        assertThat(UsernameNormalizer.hasValidLength(UsernameNormalizer.canonical(decomposed))).isTrue();
        // 터키어 대문자 İ(U+0130) 는 ROOT 소문자화로 2 code point 가 되어 조회 키만 길어진다.
        String dottedI = "İ".repeat(100);
        assertThat(UsernameNormalizer.hasValidLength(UsernameNormalizer.canonical(dottedI))).isTrue();
        assertThat(UsernameNormalizer.hasValidLength(UsernameNormalizer.normalize(dottedI))).isFalse();
    }

    @Test
    void rejectsInvisibleControlAndFormatCharacters() {
        assertThat(UsernameNormalizer.hasInvisibleCharacter("kim\u200Bgy")).as("ZWSP").isTrue();
        assertThat(UsernameNormalizer.hasInvisibleCharacter("kim\u0007gy")).as("BEL").isTrue();
        assertThat(UsernameNormalizer.hasInvisibleCharacter("kim gy 😀")).isFalse();
    }
}
