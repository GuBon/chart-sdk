package com.chartsdk.web;

import com.chartsdk.token.TokenService;
import com.chartsdk.web.dto.IssueTokenRequest;
import com.chartsdk.web.dto.UserCreateRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class UserTokenController {
    private final JdbcTemplate jdbc;
    private final TokenService tokens;

    public UserTokenController(JdbcTemplate jdbc, TokenService tokens) {
        this.jdbc = jdbc;
        this.tokens = tokens;
    }

    @GetMapping("/users")
    public Map<String, Object> users() {
        List<Map<String, Object>> users = jdbc.query("""
                SELECT id, username, display_name
                  FROM mc_user
                 WHERE is_active = true
                 ORDER BY id
                """, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getLong("id"));
            row.put("username", rs.getString("username"));
            row.put("displayName", rs.getString("display_name"));
            return row;
        });
        return Map.of("users", users);
    }

    @PostMapping("/users")
    public Map<String, Object> createUser(@Valid @RequestBody UserCreateRequest input) {
        Long id = jdbc.queryForObject("""
                INSERT INTO mc_user(username, display_name, role)
                VALUES (?, ?, 'member')
                RETURNING id
                """, Long.class, input.username(), input.displayName());
        return jdbc.query("SELECT id, username, display_name FROM mc_user WHERE id=?", rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "User not found.");
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getLong("id"));
            row.put("username", rs.getString("username"));
            row.put("displayName", rs.getString("display_name"));
            return row;
        }, id);
    }

    @GetMapping("/tokens")
    public Map<String, Object> tokens() {
        return Map.of("tokens", tokens.listTokens());
    }

    @PostMapping("/users/{userId}/tokens")
    public Map<String, Object> issue(@PathVariable long userId, @RequestBody(required = false) IssueTokenRequest body) {
        int days = body != null && body.expiresInDays() != null ? body.expiresInDays() : 365;
        return tokens.issue(userId, days);
    }

    @DeleteMapping("/tokens/{tokenId}")
    public void revoke(@PathVariable long tokenId) {
        tokens.revoke(tokenId);
    }
}
