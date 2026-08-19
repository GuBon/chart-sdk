package com.chartsdk.auth;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.ConcurrentSessionControlAuthenticationStrategy;
import org.springframework.security.web.authentication.session.RegisterSessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.session.security.SpringSessionBackedSessionRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Value;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityConfig {
    public static final int MAX_ACTIVE_SESSIONS = 3;

    @Bean
    public PasswordEncoder passwordEncoder() {
        Map<String, PasswordEncoder> encoders = new LinkedHashMap<>();
        encoders.put("argon2", Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8());
        encoders.put("bcrypt", new BCryptPasswordEncoder());
        DelegatingPasswordEncoder encoder = new DelegatingPasswordEncoder("argon2", encoders);
        // V13 이전에 별도 도구로 만든 bcrypt 문자열도 {bcrypt} 접두사 없이 검증할 수 있게 한다.
        encoder.setDefaultPasswordEncoderForMatches(new BCryptPasswordEncoder());
        return encoder;
    }

    @Bean
    public AuthenticationManager authenticationManager(
            ChartUserDetailsService users, PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(users);
        provider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(provider);
    }

    @Bean
    public CsrfTokenRepository csrfTokenRepository(
            @Value("${chartsdk.csrf.cookie.name:chartsdk-csrf}") String cookieName,
            @Value("${chartsdk.csrf.cookie.secure:false}") boolean secure) {
        CookieCsrfTokenRepository repository = new CookieCsrfTokenRepository();
        repository.setCookieName(cookieName);
        repository.setHeaderName("X-CSRF-TOKEN");
        repository.setParameterName("_csrf");
        repository.setCookiePath("/");
        repository.setCookieCustomizer(cookie -> cookie
                .httpOnly(true)
                .secure(secure)
                .sameSite("Lax"));
        return repository;
    }

    @Bean
    public SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    public <S extends Session> SpringSessionBackedSessionRegistry<S> sessionRegistry(
            FindByIndexNameSessionRepository<S> sessions) {
        return new SpringSessionBackedSessionRegistry<>(sessions);
    }

    @Bean
    public SessionAuthenticationStrategy sessionAuthenticationStrategy(
            SessionRegistry sessions, CsrfTokenRepository csrfTokens) {
        ConcurrentSessionControlAuthenticationStrategy concurrency =
                new ConcurrentSessionControlAuthenticationStrategy(sessions);
        concurrency.setMaximumSessions(MAX_ACTIVE_SESSIONS);
        concurrency.setExceptionIfMaximumExceeded(false);

        return new CompositeSessionAuthenticationStrategy(List.of(
                concurrency,
                new ChangeSessionIdAuthenticationStrategy(),
                new RegisterSessionAuthenticationStrategy(sessions),
                new CsrfAuthenticationStrategy(csrfTokens)
        ));
    }

    @Bean
    @Order(1)
    public SecurityFilterChain publicStatelessSecurityFilterChain(HttpSecurity http) throws Exception {
        http
                .securityMatcher("/api/v1/charts/data", "/maps/**", "/actuator/health/**")
                .cors(cors -> { })
                .csrf(csrf -> csrf.disable())
                .securityContext(context -> context.disable())
                .requestCache(cache -> cache.disable())
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .logout(logout -> logout.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }

    @Bean
    @Order(2)
    public SecurityFilterChain adminSecurityFilterChain(
            HttpSecurity http,
            SessionRegistry sessions,
            CsrfTokenRepository csrfTokens,
            SecurityErrorWriter errors,
            JdbcTemplate jdbc) throws Exception {
        http
                .cors(cors -> { })
                .csrf(csrf -> csrf.csrfTokenRepository(csrfTokens))
                .securityContext(context -> context.requireExplicitSave(true))
                .requestCache(cache -> cache.disable())
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .sessionManagement(session -> {
                    session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED);
                    session.maximumSessions(MAX_ACTIVE_SESSIONS)
                            .maxSessionsPreventsLogin(false)
                            .sessionRegistry(sessions)
                            .expiredSessionStrategy(event -> errors.write(
                                    event.getResponse(), 401, "SESSION_EXPIRED",
                                    "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."));
                })
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(
                                "/api/v1/auth/csrf",
                                "/api/v1/auth/signup",
                                "/api/v1/auth/login"
                        ).permitAll()
                        .requestMatchers("/api/v1/admin/**", "/actuator/**").hasRole("ADMIN")
                        .requestMatchers("/api/v1/**").authenticated()
                        .anyRequest().permitAll())
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint((request, response, exception) -> errors.write(
                                response, 401, "AUTH_REQUIRED", "로그인이 필요합니다."))
                        .accessDeniedHandler((request, response, exception) -> {
                            if (exception instanceof CsrfException) {
                                errors.write(response, 403, "CSRF_INVALID",
                                        "요청 보안 토큰이 만료되었습니다. 다시 시도해 주세요.");
                            } else {
                                errors.write(response, 403, "ACCESS_DENIED", "접근 권한이 없습니다.");
                            }
                        }))
                .logout(logout -> logout
                        .logoutUrl("/api/v1/auth/logout")
                        .invalidateHttpSession(true)
                        .clearAuthentication(true)
                        .deleteCookies("chartsdk-session", "__Host-chartsdk-session")
                        .logoutSuccessHandler((request, response, authentication) -> response.setStatus(204)));

        http.addFilterAfter(new AccountStateFilter(jdbc, errors), SecurityContextHolderFilter.class);

        return http.build();
    }
}
