package com.chartsdk.auth;

import com.chartsdk.web.ApiException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

@Service
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class AuthService {
    public static final int MIN_PASSWORD_CODE_POINTS = 15;

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;

    public AuthService(JdbcTemplate jdbc, PasswordEncoder passwords) {
        this.jdbc = jdbc;
        this.passwords = passwords;
    }

    @Transactional
    public AuthUserResponse signup(SignupRequest input) {
        String username = input.username() == null ? "" : input.username().strip();
        String normalized = UsernameNormalizer.normalize(username);
        if (!UsernameNormalizer.hasValidLength(normalized)) {
            throw validation("username", "아이디는 1~100자여야 합니다.");
        }
        if (input.password() == null
                || input.password().codePointCount(0, input.password().length()) < MIN_PASSWORD_CODE_POINTS) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_TOO_SHORT",
                    "비밀번호는 최소 " + MIN_PASSWORD_CODE_POINTS + "자여야 합니다.",
                    Map.of("password", "최소 " + MIN_PASSWORD_CODE_POINTS + "자여야 합니다."));
        }
        if (!input.password().equals(input.passwordConfirm())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_CONFIRMATION_MISMATCH",
                    "비밀번호 확인이 일치하지 않습니다.",
                    Map.of("passwordConfirm", "비밀번호와 같아야 합니다."));
        }

        try {
            Long id = jdbc.queryForObject("""
                    INSERT INTO mc_user(username, username_normalized, password_hash, display_name, role)
                    VALUES (?, ?, ?, ?, 'member')
                    RETURNING id
                    """, Long.class, username, normalized, passwords.encode(input.password()), username);
            return new AuthUserResponse(id, username, username, "member");
        } catch (DataIntegrityViolationException e) {
            throw new ApiException(HttpStatus.CONFLICT, "USERNAME_TAKEN",
                    "이미 사용 중인 아이디입니다.", Map.of("username", "이미 사용 중입니다."), e);
        }
    }

    private static ApiException validation(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, Map.of(field, message));
    }
}
