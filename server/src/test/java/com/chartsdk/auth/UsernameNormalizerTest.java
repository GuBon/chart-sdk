package com.chartsdk.auth;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UsernameNormalizerTest {
    @Test
    void appliesNfkcUnicodeStripAndRootLowercase() {
        assertThat(UsernameNormalizer.normalize("\u2003ＡdＭiＮ\u2003")).isEqualTo("admin");
    }

    @Test
    void validatesUnicodeCodePointsRatherThanUtf16Units() {
        String oneHundred = "😀".repeat(100);
        assertThat(UsernameNormalizer.hasValidLength(oneHundred)).isTrue();
        assertThat(UsernameNormalizer.hasValidLength(oneHundred + "a")).isFalse();
        assertThat(UsernameNormalizer.hasValidLength("")).isFalse();
    }
}
