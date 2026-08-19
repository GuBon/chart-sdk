package com.chartsdk.token;

import com.chartsdk.web.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * 임베드 키 문자열 `cek1_<id>_<sig>` 의 파생·검증.
 *
 * sig = base64url(HMAC-SHA256(key-secret, "chartsdk:embed-key:v1:" + id)) — 키 원문/해시를 DB 에
 * 저장하지 않고 id 에서 언제든 재파생한다. 도메인 접두사로 다른 HMAC 용도와 입력 공간을 분리한다.
 * 검증은 DB 를 거치지 않으므로 위조 키는 조회 비용을 만들지 않는다.
 */
@Component
public class EmbedKeyCodec {
    private static final String PREFIX = "cek1";
    private static final String DOMAIN = "chartsdk:embed-key:v1:";

    private final byte[] secret;

    public EmbedKeyCodec(@Value("${chartsdk.embed.key-secret}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    public String encode(long keyId) {
        return PREFIX + "_" + keyId + "_" + sign(keyId);
    }

    /** 구문·서명이 유효하면 keyId 를 반환하고, 아니면 401 TOKEN_INVALID. 상태(회수·만료)는 DB 조회 몫이다. */
    public long decode(String rawKey) {
        try {
            // base64url 알파벳에는 '_' 가 포함된다 — limit 3 으로 서명부를 통째로 보존해야 한다.
            String[] parts = rawKey.split("_", 3);
            if (parts.length != 3 || !PREFIX.equals(parts[0])) throw invalid();
            long keyId = Long.parseLong(parts[1]);
            if (keyId <= 0 || !constantTimeEquals(sign(keyId), parts[2])) throw invalid();
            return keyId;
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw invalid();
        }
    }

    private String sign(long keyId) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] digest = mac.doFinal((DOMAIN + keyId).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ApiException invalid() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Embed key is invalid.");
    }

    private static boolean constantTimeEquals(String a, String b) {
        byte[] aa = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        if (aa.length != bb.length) return false;
        int result = 0;
        for (int i = 0; i < aa.length; i++) result |= aa[i] ^ bb[i];
        return result == 0;
    }
}
