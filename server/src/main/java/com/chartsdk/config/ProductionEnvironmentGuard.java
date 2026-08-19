package com.chartsdk.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.Profiles;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Validates production-only invariants before the application context, datasource, or Flyway starts.
 * This prevents an incomplete production deployment from silently connecting with local credentials
 * or signing/encrypting data with repository-known development keys.
 */
public final class ProductionEnvironmentGuard implements EnvironmentPostProcessor, Ordered {
    static final String DEV_DATABASE_URL = "jdbc:postgresql://localhost:5433/chartsol";
    static final String DEV_DATABASE_USERNAME = "postgres";
    static final String DEV_DATABASE_PASSWORD = "0218";
    static final String DEV_EMBED_KEY_SECRET = "dev-chartsol-embed-key-secret-change-me";
    static final String DEV_DATASOURCE_ENC_KEY = "dev-chartsol-datasource-enc-change-me";

    private static final int MIN_SECRET_BYTES = 32;
    private static final Map<String, String> DEVELOPMENT_DEFAULTS = Map.of(
            "spring.datasource.url", DEV_DATABASE_URL,
            "spring.datasource.username", DEV_DATABASE_USERNAME,
            "spring.datasource.password", DEV_DATABASE_PASSWORD,
            "chartsdk.embed.key-secret", DEV_EMBED_KEY_SECRET,
            "chartsdk.datasource.enc-key", DEV_DATASOURCE_ENC_KEY
    );

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (!environment.acceptsProfiles(Profiles.of("prod"))) return;

        for (Map.Entry<String, String> entry : DEVELOPMENT_DEFAULTS.entrySet()) {
            String value = required(environment, entry.getKey());
            if (entry.getValue().equals(value)) {
                throw invalid(entry.getKey(), "the repository development default is forbidden");
            }
        }

        requireSecretStrength(environment, "chartsdk.embed.key-secret");
        requireSecretStrength(environment, "chartsdk.datasource.enc-key");

        if (booleanProperty(environment, "chartsdk.datasource.password.allow-legacy-plaintext")) {
            throw invalid("chartsdk.datasource.password.allow-legacy-plaintext",
                    "plaintext datasource passwords must be disabled");
        }
        requireSecureHostCookie(environment,
                "server.servlet.session.cookie.name", "server.servlet.session.cookie.secure");
        requireSecureHostCookie(environment,
                "chartsdk.csrf.cookie.name", "chartsdk.csrf.cookie.secure");
    }

    private static void requireSecretStrength(ConfigurableEnvironment environment, String property) {
        String value = required(environment, property);
        if (value.getBytes(StandardCharsets.UTF_8).length < MIN_SECRET_BYTES) {
            throw invalid(property, "must contain at least " + MIN_SECRET_BYTES + " UTF-8 bytes");
        }
    }

    private static void requireSecureHostCookie(
            ConfigurableEnvironment environment, String nameProperty, String secureProperty) {
        String name = required(environment, nameProperty);
        if (!name.startsWith("__Host-")) {
            throw invalid(nameProperty, "must use the __Host- prefix");
        }
        if (!booleanProperty(environment, secureProperty)) {
            throw invalid(secureProperty, "must be true");
        }
    }

    private static boolean booleanProperty(ConfigurableEnvironment environment, String property) {
        String value = required(environment, property);
        if (!"true".equalsIgnoreCase(value) && !"false".equalsIgnoreCase(value)) {
            throw invalid(property, "must be either true or false");
        }
        return Boolean.parseBoolean(value);
    }

    private static String required(ConfigurableEnvironment environment, String property) {
        final String value;
        try {
            value = environment.getProperty(property);
        } catch (IllegalArgumentException unresolvedPlaceholder) {
            throw invalid(property, "must be provided", unresolvedPlaceholder);
        }
        if (value == null || value.isBlank()) {
            throw invalid(property, "must be provided");
        }
        return value.strip();
    }

    private static IllegalStateException invalid(String property, String reason) {
        return invalid(property, reason, null);
    }

    private static IllegalStateException invalid(String property, String reason, Throwable cause) {
        return new IllegalStateException("Invalid production configuration '" + property + "': " + reason, cause);
    }

    @Override
    public int getOrder() {
        // ConfigDataEnvironmentPostProcessor must load application.yml and active profiles first.
        return Ordered.LOWEST_PRECEDENCE;
    }
}
