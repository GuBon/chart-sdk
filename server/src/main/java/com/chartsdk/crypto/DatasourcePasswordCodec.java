package com.chartsdk.crypto;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

/**
 * 데이터소스 DB 비밀번호 AES-GCM 코덱.
 * 저장 형식: base64(IV(12B) || ciphertext || GCM tag(16B)) — mc_datasource.db_password_enc.
 * 키는 .env(DATASOURCE_ENC_KEY)에서 주입한 문자열을 SHA-256 으로 32바이트 AES 키로 파생한다(키 길이·인코딩 의존 제거).
 * 복호화 실패 시(레거시 평문 등)에는 원문을 그대로 반환해 기존 데이터와의 호환을 유지한다.
 */
@Component
public class DatasourcePasswordCodec {
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    // 키 버전 마커. 마커가 있으면 우리 암호문 → 복호화 실패는 명시적 오류(평문 폴백 금지).
    // 마커가 없으면 레거시 평문으로 취급. 키 회전 시 v2: 등으로 확장(읽기는 마커로 키 선택).
    private static final String PREFIX = "v1:";

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public DatasourcePasswordCodec(@Value("${chartsdk.datasource.enc-key}") String encKey) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(encKey.getBytes(StandardCharsets.UTF_8));
            this.key = new SecretKeySpec(digest, "AES");
        } catch (Exception e) {
            throw new IllegalStateException("Failed to initialize datasource password key", e);
        }
    }

    /** 평문 → "v1:" + base64(IV || ciphertext+tag). */
    public String encrypt(String plaintext) {
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return PREFIX + Base64.getEncoder().encodeToString(out);
        } catch (Exception e) {
            throw new IllegalStateException("Datasource password encryption failed", e);
        }
    }

    /**
     * 저장값 → 평문.
     * - 마커("v1:") 있음 = 우리 암호문 → 복호화. 실패(키 불일치·손상)는 평문 폴백 금지하고 명시적 오류(G6).
     * - 마커 없음 = 레거시 평문 → 그대로 반환(마이그레이션 없이 호환).
     */
    public String decrypt(String stored) {
        if (stored == null || stored.isEmpty()) return stored;
        if (!stored.startsWith(PREFIX)) return stored; // 레거시 평문(마커 없음)
        try {
            byte[] all = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            byte[] iv = Arrays.copyOfRange(all, 0, IV_BYTES);
            byte[] ct = Arrays.copyOfRange(all, IV_BYTES, all.length);
            Cipher cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
        } catch (Exception e) {
            // 마커가 있는데 복호화 실패 = 키 회전 누락/손상 → 쓰레기 비밀번호로 조용히 접속 시도 금지
            throw new IllegalStateException("Datasource password decryption failed (key mismatch or corrupted ciphertext)", e);
        }
    }
}
