package com.chartsdk.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProductionEnvironmentGuardTest {
    private final ProductionEnvironmentGuard guard = new ProductionEnvironmentGuard();

    @Test
    void ignoresDevelopmentProfile() {
        MockEnvironment environment = new MockEnvironment();

        assertThatCode(() -> guard.postProcessEnvironment(environment, null))
                .doesNotThrowAnyException();
    }

    @Test
    void acceptsCompleteProductionConfiguration() {
        MockEnvironment environment = validProductionEnvironment();

        assertThatCode(() -> guard.postProcessEnvironment(environment, null))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsMissingRequiredProductionProperties() {
        for (String property : requiredProperties().keySet()) {
            MockEnvironment environment = validProductionEnvironment();
            environment.setProperty(property, " ");

            assertThatThrownBy(() -> guard.postProcessEnvironment(environment, null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(property)
                    .hasMessageContaining("must be provided");
        }
    }

    @Test
    void rejectsEveryRepositoryDevelopmentDefault() {
        Map<String, String> developmentDefaults = Map.of(
                "spring.datasource.url", ProductionEnvironmentGuard.DEV_DATABASE_URL,
                "spring.datasource.username", ProductionEnvironmentGuard.DEV_DATABASE_USERNAME,
                "spring.datasource.password", ProductionEnvironmentGuard.DEV_DATABASE_PASSWORD,
                "chartsdk.embed.key-secret", ProductionEnvironmentGuard.DEV_EMBED_KEY_SECRET,
                "chartsdk.datasource.enc-key", ProductionEnvironmentGuard.DEV_DATASOURCE_ENC_KEY
        );

        for (Map.Entry<String, String> entry : developmentDefaults.entrySet()) {
            MockEnvironment environment = validProductionEnvironment();
            environment.setProperty(entry.getKey(), entry.getValue());

            assertThatThrownBy(() -> guard.postProcessEnvironment(environment, null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(entry.getKey())
                    .hasMessageContaining("development default is forbidden");
        }
    }

    @Test
    void rejectsWeakSecretsAndLegacyPlaintextFallback() {
        for (String property : new String[]{"chartsdk.embed.key-secret", "chartsdk.datasource.enc-key"}) {
            MockEnvironment environment = validProductionEnvironment();
            environment.setProperty(property, "too-short");

            assertThatThrownBy(() -> guard.postProcessEnvironment(environment, null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(property)
                    .hasMessageContaining("at least 32 UTF-8 bytes");
        }

        MockEnvironment plaintext = validProductionEnvironment();
        plaintext.setProperty("chartsdk.datasource.password.allow-legacy-plaintext", "true");
        assertThatThrownBy(() -> guard.postProcessEnvironment(plaintext, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("allow-legacy-plaintext")
                .hasMessageContaining("must be disabled");
    }

    @Test
    void rejectsInsecureOrNonHostProductionCookies() {
        for (String property : new String[]{
                "server.servlet.session.cookie.secure", "chartsdk.csrf.cookie.secure"}) {
            MockEnvironment environment = validProductionEnvironment();
            environment.setProperty(property, "false");

            assertThatThrownBy(() -> guard.postProcessEnvironment(environment, null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(property)
                    .hasMessageContaining("must be true");
        }

        for (String property : new String[]{
                "server.servlet.session.cookie.name", "chartsdk.csrf.cookie.name"}) {
            MockEnvironment environment = validProductionEnvironment();
            environment.setProperty(property, "insecure-cookie-name");

            assertThatThrownBy(() -> guard.postProcessEnvironment(environment, null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(property)
                    .hasMessageContaining("__Host-");
        }
    }

    private static MockEnvironment validProductionEnvironment() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        for (Map.Entry<String, String> entry : requiredProperties().entrySet()) {
            environment.setProperty(entry.getKey(), entry.getValue());
        }
        return environment;
    }

    private static Map<String, String> requiredProperties() {
        return Map.ofEntries(
                Map.entry("spring.datasource.url", "jdbc:postgresql://db.internal:5432/chartsdk"),
                Map.entry("spring.datasource.username", "chartsdk_app"),
                Map.entry("spring.datasource.password", "production-database-password"),
                Map.entry("chartsdk.embed.key-secret", "strong-production-embed-secret-0000000001"),
                Map.entry("chartsdk.datasource.enc-key", "strong-production-datasource-key-000001"),
                Map.entry("chartsdk.datasource.password.allow-legacy-plaintext", "false"),
                Map.entry("server.servlet.session.cookie.name", "__Host-chartsdk-session"),
                Map.entry("server.servlet.session.cookie.secure", "true"),
                Map.entry("chartsdk.csrf.cookie.name", "__Host-chartsdk-csrf"),
                Map.entry("chartsdk.csrf.cookie.secure", "true")
        );
    }
}
