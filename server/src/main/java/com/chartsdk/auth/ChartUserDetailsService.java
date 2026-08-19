package com.chartsdk.auth;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class ChartUserDetailsService implements UserDetailsService {
    private final JdbcTemplate jdbc;

    public ChartUserDetailsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        String normalized = UsernameNormalizer.normalize(username);
        return jdbc.query("""
                SELECT id, username, display_name, role, auth_version, password_hash, is_active
                  FROM mc_user
                 WHERE username_normalized=?
                """, rs -> {
            if (!rs.next() || rs.getString("password_hash") == null) {
                throw new UsernameNotFoundException("User not found");
            }
            return new SessionPrincipal(
                    rs.getLong("id"),
                    rs.getString("username"),
                    rs.getString("display_name"),
                    rs.getString("role"),
                    rs.getLong("auth_version"),
                    rs.getString("password_hash"),
                    rs.getBoolean("is_active")
            );
        }, normalized);
    }
}
