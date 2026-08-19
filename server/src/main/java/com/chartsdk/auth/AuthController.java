package com.chartsdk.auth;

import com.chartsdk.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class AuthController {
    private final AuthService auth;
    private final AuthenticationManager authenticationManager;
    private final SessionAuthenticationStrategy sessionStrategy;
    private final SecurityContextRepository securityContexts;
    private final AuthRateLimiter rateLimiter;
    private final ClientIpResolver clientIps;

    public AuthController(AuthService auth, AuthenticationManager authenticationManager,
                          SessionAuthenticationStrategy sessionStrategy,
                          SecurityContextRepository securityContexts,
                          AuthRateLimiter rateLimiter,
                          ClientIpResolver clientIps) {
        this.auth = auth;
        this.authenticationManager = authenticationManager;
        this.sessionStrategy = sessionStrategy;
        this.securityContexts = securityContexts;
        this.rateLimiter = rateLimiter;
        this.clientIps = clientIps;
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("headerName", token.getHeaderName(), "token", token.getToken());
    }

    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthUserResponse signup(@Valid @RequestBody SignupRequest input, HttpServletRequest request) {
        String client = clientIps.resolve(request);
        rateLimiter.reserve("signup-ip", client, 5, 3600, 3600);
        return auth.signup(input);
    }

    @PostMapping("/login")
    public AuthUserResponse login(@Valid @RequestBody LoginRequest input,
                                  HttpServletRequest request, HttpServletResponse response) {
        String normalizedUsername = UsernameNormalizer.normalize(input.username());
        String client = clientIps.resolve(request);
        rateLimiter.reserve("login-user", normalizedUsername, 10, 900, 900);
        boolean ipReserved = false;
        try {
            rateLimiter.reserve("login-ip", client, 50, 900, 900);
            ipReserved = true;
            Authentication authenticated = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(
                            normalizedUsername, input.password()));
            SessionPrincipal principal = ((SessionPrincipal) authenticated.getPrincipal()).withoutPassword();
            Authentication sessionAuthentication = UsernamePasswordAuthenticationToken.authenticated(
                    principal, null, principal.getAuthorities());
            sessionStrategy.onAuthentication(sessionAuthentication, request, response);

            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(sessionAuthentication);
            SecurityContextHolder.setContext(context);
            securityContexts.saveContext(context, request, response);
            rateLimiter.compensate("login-user", normalizedUsername);
            rateLimiter.compensate("login-ip", client);
            return AuthUserResponse.from(principal);
        } catch (AuthenticationException e) {
            SecurityContextHolder.clearContext();
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS",
                    "아이디 또는 비밀번호가 올바르지 않습니다.");
        } catch (ApiException e) {
            if (!ipReserved) rateLimiter.compensate("login-user", normalizedUsername);
            throw e;
        }
    }

    @GetMapping("/me")
    public AuthUserResponse me(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof SessionPrincipal principal)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTH_REQUIRED", "로그인이 필요합니다.");
        }
        return AuthUserResponse.from(principal);
    }
}
