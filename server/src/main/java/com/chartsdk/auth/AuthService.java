package com.chartsdk.auth;

import com.chartsdk.web.ApiException;
import com.chartsdk.web.ThrowableCauseWalker;
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
    public static final int MIN_PASSWORD_CODE_POINTS = 8;

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;

    public AuthService(JdbcTemplate jdbc, PasswordEncoder passwords) {
        this.jdbc = jdbc;
        this.passwords = passwords;
    }

    @Transactional
    public AuthUserResponse signup(SignupRequest input) {
        // 저장·표시는 canonical(NFKC+strip), 조회는 normalized(+소문자). 두 값 모두 VARCHAR(100)에 들어가므로
        // 길이는 둘 다 검사한다 — NFKC 로 줄어들거나(조합형 자모) 소문자화로 늘어나는(İ→i̇) 경우가 있다.
        String username = UsernameNormalizer.canonical(input.username());
        String normalized = UsernameNormalizer.normalize(username);
        if (!UsernameNormalizer.hasValidLength(username) || !UsernameNormalizer.hasValidLength(normalized)) {
            throw validation("username", "아이디는 1~100자여야 합니다.");
        }
        if (UsernameNormalizer.hasInvisibleCharacter(username)) {
            throw validation("username", "아이디에 보이지 않는 제어 문자는 쓸 수 없습니다.");
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
            // 중복(23505)만 409 로 번역한다. 그 외 제약 위반(길이·CHECK)은 사전검증이 막았어야 하는 버그이므로
            // "이미 사용 중" 으로 위장하지 않고 공통 핸들러(INVALID_REQUEST 400)로 넘긴다.
            if (!SQLSTATE_UNIQUE_VIOLATION.equals(ThrowableCauseWalker.firstSqlState(e))) throw e;
            throw new ApiException(HttpStatus.CONFLICT, "USERNAME_TAKEN",
                    "이미 사용 중인 아이디입니다.", Map.of("username", "이미 사용 중입니다."), e);
        }
    }

    /** PostgreSQL SQLSTATE unique_violation. */
    private static final String SQLSTATE_UNIQUE_VIOLATION = "23505";

    private static ApiException validation(String field, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message, Map.of(field, message));
    }
}
