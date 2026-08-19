package com.chartsdk.auth;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;

import static org.assertj.core.api.Assertions.assertThat;

class SecurityConfigTest {
    private final SecurityConfig config = new SecurityConfig();

    @Test
    void csrfTokenUsesHttpOnlyCookieWithoutCreatingHttpSession() {
        CsrfTokenRepository repository = config.csrfTokenRepository("chartsdk-csrf", false);
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        CsrfToken token = repository.generateToken(request);
        repository.saveToken(token, request, response);

        assertThat(repository).isInstanceOf(CookieCsrfTokenRepository.class);
        assertThat(request.getSession(false)).isNull();
        assertThat(response.getHeader(HttpHeaders.SET_COOKIE))
                .contains("chartsdk-csrf=")
                .contains("Path=/")
                .contains("HttpOnly")
                .doesNotContain("Secure");
        assertThat(response.getCookie("chartsdk-csrf").getAttribute("SameSite")).isEqualTo("Lax");
    }

    @Test
    void productionCsrfCookieUsesSecureHostPrefix() {
        CsrfTokenRepository repository = config.csrfTokenRepository("__Host-chartsdk-csrf", true);
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        repository.saveToken(repository.generateToken(request), request, response);

        assertThat(request.getSession(false)).isNull();
        assertThat(response.getHeader(HttpHeaders.SET_COOKIE))
                .contains("__Host-chartsdk-csrf=")
                .contains("Path=/")
                .contains("Secure")
                .contains("HttpOnly");
        assertThat(response.getCookie("__Host-chartsdk-csrf").getAttribute("SameSite")).isEqualTo("Lax");
    }
}
