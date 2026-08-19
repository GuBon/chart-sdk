package com.chartsdk.auth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class AuthFlowIT {
    private static final String PASSWORD = "correct horse battery staple";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:postgresql://localhost:5433/chartsol");
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "0218");
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired CsrfTokenRepository csrfTokens;
    @Autowired ObjectMapper mapper;

    private final List<String> usernames = new ArrayList<>();

    @AfterEach
    void cleanUp() {
        for (String username : usernames) {
            jdbc.update("DELETE FROM mc_chart WHERE owner_id IN (SELECT id FROM mc_user WHERE username_normalized=?)",
                    username.toLowerCase());
            jdbc.update("DELETE FROM mc_datasource WHERE owner_id IN (SELECT id FROM mc_user WHERE username_normalized=?)",
                    username.toLowerCase());
            jdbc.update("DELETE FROM mc_user WHERE username_normalized=?", username.toLowerCase());
        }
        jdbc.update("DELETE FROM mc_session WHERE principal_name LIKE 'auth-it-%'");
        jdbc.update("DELETE FROM mc_auth_rate_limit");
    }

    @Test
    void csrfEndpointUsesCookieWithoutCreatingDatabaseSession() throws Exception {
        assertThat(csrfTokens).isInstanceOf(CookieCsrfTokenRepository.class);
        Integer sessionsBefore = jdbc.queryForObject("SELECT count(*) FROM mc_session", Integer.class);

        MvcResult result = mvc.perform(get("/api/v1/auth/csrf"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.headerName").value("X-CSRF-TOKEN"))
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andReturn();

        assertThat(result.getRequest().getSession(false)).isNull();
        assertThat(result.getResponse().getHeader("Set-Cookie"))
                .contains("chartsdk-csrf=", "HttpOnly", "Path=/");
        assertThat(result.getResponse().getCookie("chartsdk-csrf").getAttribute("SameSite")).isEqualTo("Lax");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM mc_session", Integer.class))
                .isEqualTo(sessionsBefore);
    }

    @Test
    void signupLoginCookieAndOwnerScopeWorkEndToEnd() throws Exception {
        String first = username("one");
        String second = username("two");

        mvc.perform(get("/api/v1/datasources"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("AUTH_REQUIRED"));

        signup(first);
        signup(second);

        String storedHash = jdbc.queryForObject(
                "SELECT password_hash FROM mc_user WHERE username_normalized=?", String.class, first.toLowerCase());
        assertThat(storedHash).startsWith("{argon2}").doesNotContain(PASSWORD);

        // 가입은 자동 로그인하지 않는다.
        mvc.perform(get("/api/v1/auth/me"))
                .andExpect(status().isUnauthorized());

        Cookie firstSession = login(first);
        Cookie secondSession = login(second);
        assertThat(firstSession.isHttpOnly()).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT max_inactive_interval FROM mc_session WHERE principal_name=?",
                Integer.class, first)).isEqualTo(8 * 60 * 60);

        mvc.perform(get("/api/v1/admin/users").cookie(firstSession))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("ACCESS_DENIED"));
        mvc.perform(post("/api/v1/datasources")
                        .cookie(firstSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("CSRF_INVALID"));

        long firstId = userId(first);
        long secondId = userId(second);
        long firstDatasource = insertDatasource(firstId, "owned-by-first");
        long secondDatasource = insertDatasource(secondId, "owned-by-second");
        insertChart(firstId, firstDatasource, "chart-owned-by-first");
        insertChart(secondId, secondDatasource, "chart-owned-by-second");

        mvc.perform(get("/api/v1/datasources").cookie(firstSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.datasources.length()").value(1))
                .andExpect(jsonPath("$.datasources[0].name").value("owned-by-first"));

        mvc.perform(get("/api/v1/datasources").cookie(secondSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.datasources.length()").value(1))
                .andExpect(jsonPath("$.datasources[0].name").value("owned-by-second"));

        mvc.perform(get("/api/v1/charts").cookie(firstSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.charts.length()").value(1))
                .andExpect(jsonPath("$.charts[0].name").value("chart-owned-by-first"));
        mvc.perform(get("/api/v1/charts").cookie(secondSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.charts.length()").value(1))
                .andExpect(jsonPath("$.charts[0].name").value("chart-owned-by-second"));

        CsrfCredentials invalidLoginCsrf = csrf();
        mvc.perform(post("/api/v1/auth/login")
                        .cookie(invalidLoginCsrf.cookie())
                        .header(invalidLoginCsrf.headerName(), invalidLoginCsrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"%s\",\"password\":\"wrong\"}".formatted(first)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"));

        jdbc.update("UPDATE mc_user SET is_active=false, auth_version=auth_version+1 WHERE id=?", firstId);
        mvc.perform(get("/api/v1/auth/me").cookie(firstSession))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("USER_DISABLED"));
    }

    @Test
    void fourthLoginExpiresOldestOfThreeSessions() throws Exception {
        String username = username("sessions");
        signup(username);
        Cookie first = login(username);
        login(username);
        login(username);
        Cookie fourth = login(username);

        mvc.perform(get("/api/v1/auth/me").cookie(first))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("SESSION_EXPIRED"));
        mvc.perform(get("/api/v1/auth/me").cookie(fourth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(username));
    }

    private void signup(String username) throws Exception {
        usernames.add(username);
        CsrfCredentials csrf = csrf();
        mvc.perform(post("/api/v1/auth/signup")
                        .cookie(csrf.cookie())
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"%s","password":"%s","passwordConfirm":"%s"}
                                """.formatted(username, PASSWORD, PASSWORD)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value(username))
                .andExpect(jsonPath("$.role").value("member"));
    }

    private Cookie login(String username) throws Exception {
        CsrfCredentials csrf = csrf();
        MvcResult result = mvc.perform(post("/api/v1/auth/login")
                        .cookie(csrf.cookie())
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(username))
                .andReturn();
        Cookie cookie = result.getResponse().getCookie("chartsdk-session");
        assertThat(cookie).as("login session cookie").isNotNull();
        assertThat(cookie.isHttpOnly()).isTrue();
        assertThat(cookie.getAttribute("SameSite")).isEqualTo("Lax");
        return cookie;
    }

    private CsrfCredentials csrf() throws Exception {
        MvcResult result = mvc.perform(get("/api/v1/auth/csrf"))
                .andExpect(status().isOk())
                .andReturn();
        Map<String, String> body = mapper.readValue(
                result.getResponse().getContentAsByteArray(), new TypeReference<>() {});
        Cookie cookie = result.getResponse().getCookie("chartsdk-csrf");
        assertThat(cookie).as("CSRF cookie").isNotNull();
        return new CsrfCredentials(cookie, body.get("headerName"), body.get("token"));
    }

    private String username(String suffix) {
        return "auth-it-" + suffix + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private long userId(String username) {
        return jdbc.queryForObject(
                "SELECT id FROM mc_user WHERE username_normalized=?", Long.class, username.toLowerCase());
    }

    private long insertDatasource(long ownerId, String name) {
        return jdbc.queryForObject("""
                INSERT INTO mc_datasource(owner_id, name, host, port, database_name, db_user, db_password_enc)
                VALUES (?, ?, 'localhost', 5432, 'test', 'reader', 'encrypted-for-test')
                RETURNING id
                """, Long.class, ownerId, name);
    }

    private void insertChart(long ownerId, long datasourceId, String name) {
        Long chartId = jdbc.queryForObject("""
                INSERT INTO mc_chart(
                    owner_id, name, datasource_id, define_mode, sql_query,
                    builder_config, chart_type, options, refresh_mode)
                VALUES (?, ?, ?, 'sql', 'SELECT 1 AS value', '{}'::jsonb, 'bar', '{}'::jsonb, 'manual')
                RETURNING id
                """, Long.class, ownerId, name, datasourceId);
        jdbc.update("""
                INSERT INTO mc_chart_datasource(chart_id, datasource_id, owner_id)
                VALUES (?, ?, ?)
                """, chartId, datasourceId, ownerId);
    }

    private record CsrfCredentials(Cookie cookie, String headerName, String token) {
    }
}
