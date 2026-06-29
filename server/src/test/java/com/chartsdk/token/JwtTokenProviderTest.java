package com.chartsdk.token;

import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtTokenProviderTest {
    private final JwtTokenProvider provider = new JwtTokenProvider(new ObjectMapper(), "test-secret");

    @Test
    void validatesTokenCreatedByProvider() {
        String token = provider.create(7, 42, Instant.now(), Instant.now().plusSeconds(60));

        EmbedPrincipal principal = provider.validate(token);

        assertThat(principal.userId()).isEqualTo(7);
        assertThat(principal.tokenId()).isEqualTo(42);
    }

    @Test
    void rejectsExpiredTokenWithSpecificCode() {
        String token = provider.create(7, 42, Instant.now().minusSeconds(120), Instant.now().minusSeconds(60));

        assertThatThrownBy(() -> provider.validate(token))
                .isInstanceOf(ApiException.class)
                .extracting("code")
                .isEqualTo("TOKEN_EXPIRED");
    }

    @Test
    void rejectsTamperedSignature() {
        String token = provider.create(7, 42, Instant.now(), Instant.now().plusSeconds(60));
        String tampered = token.substring(0, token.length() - 2) + "xx";

        assertThatThrownBy(() -> provider.validate(tampered))
                .isInstanceOf(ApiException.class)
                .extracting("code")
                .isEqualTo("TOKEN_INVALID");
    }
}
