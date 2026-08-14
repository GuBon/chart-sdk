package com.chartsdk.token;

import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EmbedKeyCodecTest {
    private final EmbedKeyCodec codec = new EmbedKeyCodec("test-embed-key-secret");

    @Test
    void encodeProducesStableRedecodableKey() {
        String key = codec.encode(42L);
        assertThat(key).startsWith("cek1_42_");
        assertThat(codec.encode(42L)).isEqualTo(key); // 재파생 가능(S3 재표시) — 랜덤 요소 없음
        assertThat(codec.decode(key)).isEqualTo(42L);
    }

    @Test
    void keyContainsNoChartOrUserIdentifier() {
        // 임베드 코드 노출 표면: 키 문자열에는 keyId 와 서명만 있다 — chartId·userId 는 서버 바인딩에만 존재.
        String key = codec.encode(7L);
        assertThat(key).matches("cek1_7_[A-Za-z0-9_-]{43}"); // HMAC-SHA256 base64url(no padding) = 43자
    }

    @Test
    void signaturesContainingUnderscoresStillRoundTrip() {
        // base64url 알파벳에 '_' 가 포함되므로 구분자와 충돌한다 — 서명부를 통째로 보존해야 한다.
        // (이 secret 에서 keyId=7 의 서명은 실제로 '_' 를 포함한다. 넓은 범위도 함께 회귀 확인.)
        for (long keyId = 1; keyId <= 50; keyId++) {
            assertThat(codec.decode(codec.encode(keyId))).isEqualTo(keyId);
        }
    }

    @Test
    void tamperedIdOrSignatureIsRejected() {
        String key = codec.encode(42L);
        String sig = key.substring("cek1_42_".length());
        // 서명 유지 + id 치환(다른 키로 위장) — 핵심 위협 모델
        assertThatThrownBy(() -> codec.decode("cek1_43_" + sig)).isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code()).isEqualTo("TOKEN_INVALID");
        // 서명 변조
        char flipped = sig.charAt(0) == 'A' ? 'B' : 'A';
        assertThatThrownBy(() -> codec.decode("cek1_42_" + flipped + sig.substring(1)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void differentSecretsProduceIncompatibleKeys() {
        String key = new EmbedKeyCodec("other-secret").encode(42L);
        assertThatThrownBy(() -> codec.decode(key)).isInstanceOf(ApiException.class);
    }

    @Test
    void malformedInputsAreRejectedAsInvalid() {
        for (String raw : new String[]{"", "cek1", "cek1_42", "cek1__sig", "cek1_abc_sig",
                "cek1_-1_sig", "cek2_42_sig", "42_sig", "cek1_42_sig_extra"}) {
            assertThatThrownBy(() -> codec.decode(raw))
                    .as("raw=%s", raw)
                    .isInstanceOf(ApiException.class)
                    .extracting(e -> ((ApiException) e).code()).isEqualTo("TOKEN_INVALID");
        }
    }
}
