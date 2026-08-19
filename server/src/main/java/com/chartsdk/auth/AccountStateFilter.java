package com.chartsdk.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/** 계정 비활성화·권한/비밀번호 버전 변경을 이미 발급된 세션에도 즉시 반영한다. */
final class AccountStateFilter extends OncePerRequestFilter {
    private final JdbcTemplate jdbc;
    private final SecurityErrorWriter errors;

    AccountStateFilter(JdbcTemplate jdbc, SecurityErrorWriter errors) {
        this.jdbc = jdbc;
        this.errors = errors;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof SessionPrincipal principal)) {
            filterChain.doFilter(request, response);
            return;
        }

        AccountState state = jdbc.query("""
                SELECT is_active, auth_version
                  FROM mc_user
                 WHERE id=?
                """, rs -> rs.next() ? new AccountState(rs.getBoolean(1), rs.getLong(2)) : null, principal.id());
        if (state != null && state.active() && state.authVersion() == principal.authVersion()) {
            filterChain.doFilter(request, response);
            return;
        }

        if (request.getSession(false) != null) request.getSession(false).invalidate();
        SecurityContextHolder.clearContext();
        if (state != null && !state.active()) {
            errors.write(response, 401, "USER_DISABLED", "비활성화된 계정입니다.");
        } else {
            errors.write(response, 401, "SESSION_EXPIRED", "계정 정보가 변경되었습니다. 다시 로그인해 주세요.");
        }
    }

    private record AccountState(boolean active, long authVersion) {
    }
}
