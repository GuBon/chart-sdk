package com.chartsdk.auth;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.io.Serial;
import java.io.Serializable;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/** JDBC 세션에 직렬화되는 최소 로그인 주체. 비밀번호 해시는 세션에 넣지 않는다. */
public final class SessionPrincipal implements UserDetails, Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final long id;
    private final String username;
    private final String displayName;
    private final String role;
    private final long authVersion;
    private final String passwordHash;
    private final boolean enabled;

    public SessionPrincipal(long id, String username, String displayName, String role,
                            long authVersion, String passwordHash, boolean enabled) {
        this.id = id;
        this.username = username;
        this.displayName = displayName == null ? username : displayName;
        this.role = role;
        this.authVersion = authVersion;
        this.passwordHash = passwordHash;
        this.enabled = enabled;
    }

    /** 인증 성공 후 세션에 비밀번호 해시가 남지 않도록 만드는 사본. */
    public SessionPrincipal withoutPassword() {
        return new SessionPrincipal(id, username, displayName, role, authVersion, null, enabled);
    }

    public long id() { return id; }
    public String displayName() { return displayName; }
    public String role() { return role; }
    public long authVersion() { return authVersion; }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase(Locale.ROOT)));
    }

    @Override
    public String getPassword() { return passwordHash; }

    @Override
    public String getUsername() { return username; }

    @Override
    public boolean isEnabled() { return enabled; }
}
