package com.chartsdk.admin;

import com.chartsdk.auth.SessionPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class AdminApiIT {
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:postgresql://localhost:5433/chartsol");
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "0218");
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    private final List<Long> userIds = new ArrayList<>();

    @AfterEach
    void cleanup() {
        for (Long id : userIds) {
            jdbc.update("DELETE FROM mc_admin_audit_log WHERE actor_user_id=? OR (target_type='USER' AND target_id=?)", id, id);
            jdbc.update("DELETE FROM mc_chart WHERE owner_id=?", id);
            jdbc.update("DELETE FROM mc_datasource WHERE owner_id=?", id);
            jdbc.update("DELETE FROM mc_user WHERE id=?", id);
        }
    }

    @Test
    void adminCanReadAllChartsAndDisableUserWithoutReceivingEmbedSecret() throws Exception {
        long adminId = insertUser("admin", true);
        long memberId = insertUser("member", true);
        long chartId = insertChart(memberId);
        long keyId = jdbc.queryForObject("""
                INSERT INTO mc_embed_key(user_id, chart_id, expires_at)
                VALUES (?, ?, ?) RETURNING id
                """, Long.class, memberId, chartId, Timestamp.from(Instant.now().plusSeconds(86_400)));

        mvc.perform(get("/api/v1/admin/users").with(user(principal(memberId, "member"))))
                .andExpect(status().isForbidden());

        mvc.perform(get("/api/v1/admin/charts")
                        .param("ownerId", String.valueOf(memberId))
                        .with(user(principal(adminId, "admin"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.charts.length()").value(1))
                .andExpect(jsonPath("$.charts[0].id").value(chartId));

        mvc.perform(patch("/api/v1/admin/users/{id}/status", memberId)
                        .with(user(principal(adminId, "admin")))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"active\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.active").value(false))
                .andExpect(jsonPath("$.embedKeys[0].embedKey").doesNotExist());

        assertThat(jdbc.queryForObject("SELECT is_active FROM mc_embed_key WHERE id=?", Boolean.class, keyId)).isFalse();
        assertThat(jdbc.queryForObject("SELECT revoked_reason FROM mc_embed_key WHERE id=?", String.class, keyId))
                .isEqualTo("USER_DISABLED");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM mc_admin_audit_log WHERE actor_user_id=? AND action='USER_DISABLED'",
                Integer.class, adminId)).isEqualTo(1);
    }

    private long insertUser(String suffix, boolean active) {
        String username = "admin-it-" + suffix + "-" + UUID.randomUUID().toString().substring(0, 8);
        Long id = jdbc.queryForObject("""
                INSERT INTO mc_user(username, username_normalized, password_hash, display_name, role, is_active)
                VALUES (?, ?, '{noop}unused', ?, ?, ?) RETURNING id
                """, Long.class, username, username, username,
                suffix.contains("admin") ? "admin" : "member", active);
        userIds.add(id);
        return id;
    }

    private long insertChart(long ownerId) {
        Long datasourceId = jdbc.queryForObject("""
                INSERT INTO mc_datasource(owner_id, name, host, port, database_name, db_user, db_password_enc)
                VALUES (?, ?, 'localhost', 5432, 'test', 'reader', 'encrypted-for-test') RETURNING id
                """, Long.class, ownerId, "admin-it-ds-" + UUID.randomUUID());
        return jdbc.queryForObject("""
                INSERT INTO mc_chart(owner_id, name, datasource_id, define_mode, sql_query,
                                     builder_config, chart_type, options, refresh_mode)
                VALUES (?, 'admin-it-chart', ?, 'sql', 'SELECT 1', '{}'::jsonb, 'bar', '{}'::jsonb, 'manual')
                RETURNING id
                """, Long.class, ownerId, datasourceId);
    }

    private SessionPrincipal principal(long id, String role) {
        String username = jdbc.queryForObject("SELECT username FROM mc_user WHERE id=?", String.class, id);
        return new SessionPrincipal(id, username, username, role, 1, null, true);
    }
}
