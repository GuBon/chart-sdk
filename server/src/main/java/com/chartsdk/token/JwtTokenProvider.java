package com.chartsdk.token;

import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class JwtTokenProvider {
    private final ObjectMapper mapper;
    private final byte[] secret;

    public JwtTokenProvider(ObjectMapper mapper, @Value("${chartsdk.embed.jwt-secret}") String secret) {
        this.mapper = mapper;
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    public String create(long userId, long tokenId, Instant issuedAt, Instant expiresAt) {
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "HS256");
        header.put("typ", "JWT");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("userId", userId);
        payload.put("jti", tokenId);
        payload.put("iat", issuedAt.getEpochSecond());
        payload.put("exp", expiresAt.getEpochSecond());
        payload.put("v", 1);
        String signingInput = base64Json(header) + "." + base64Json(payload);
        return signingInput + "." + sign(signingInput);
    }

    public EmbedPrincipal validate(String rawToken) {
        try {
            String[] parts = rawToken.split("\\.");
            if (parts.length != 3) throw invalid();
            Map<String, Object> header = read(parts[0]);
            if (!"HS256".equals(header.get("alg"))) throw invalid();
            String expected = sign(parts[0] + "." + parts[1]);
            if (!constantTimeEquals(expected, parts[2])) throw invalid();
            Map<String, Object> payload = read(parts[1]);
            long exp = number(payload.get("exp"));
            if (Instant.now().getEpochSecond() >= exp) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_EXPIRED", "Token has expired.");
            }
            long userId = number(payload.get("userId"));
            long tokenId = number(payload.get("jti"));
            return new EmbedPrincipal(userId, tokenId);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw invalid();
        }
    }

    private String base64Json(Map<String, Object> value) {
        try {
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mapper.writeValueAsBytes(value));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private Map<String, Object> read(String value) throws Exception {
        byte[] json = Base64.getUrlDecoder().decode(value);
        return mapper.readValue(json, new TypeReference<>() {
        });
    }

    private String sign(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static long number(Object value) {
        if (value instanceof Number n) return n.longValue();
        return Long.parseLong(String.valueOf(value));
    }

    private static ApiException invalid() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Token is invalid.");
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
