package com.chartsdk.datasource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class RuntimeDatabaseRoleIT {
    private static final String META_URL = env(
            "CHARTSDK_ROLE_META_URL", "jdbc:postgresql://localhost:5433/chartsol");
    private static final String SOURCE_URL = env(
            "CHARTSDK_ROLE_SOURCE_URL", "jdbc:postgresql://localhost:5433/chartsol_user");
    private static final String ADMIN_USER = env("CHARTSDK_ROLE_ADMIN_USER", "postgres");
    private static final String ADMIN_PASSWORD = env("CHARTSDK_ROLE_ADMIN_PASSWORD", "0218");
    private static final String APP_USER = env("CHARTSDK_ROLE_APP_USER", "chartsdk_app");
    private static final String APP_PASSWORD = env("CHARTSDK_ROLE_APP_PASSWORD", "chartsdk-app");
    private static final String SOURCE_USER = env(
            "CHARTSDK_ROLE_SOURCE_USER", "chartsdk_source_reader");
    private static final String SOURCE_PASSWORD = env(
            "CHARTSDK_ROLE_SOURCE_PASSWORD", "chartsdk-source-reader");
    private static JdbcTemplate runtime;
    private static JdbcTemplate source;
    private static JdbcTemplate sourceAdmin;

    @BeforeAll
    static void migrateMetaDatabase() {
        assumeTrue(canConnect(META_URL, ADMIN_USER, ADMIN_PASSWORD), "Role-test PostgreSQL unavailable");
        boolean rolesAvailable = canConnect(META_URL, APP_USER, APP_PASSWORD)
                && canConnect(SOURCE_URL, SOURCE_USER, SOURCE_PASSWORD);
        if (Boolean.parseBoolean(System.getenv("CHARTSDK_REQUIRE_ROLE_IT"))) {
            assertThat(rolesAvailable).as("Docker runtime/source roles must be provisioned in CI").isTrue();
        } else {
            assumeTrue(rolesAvailable, "Runtime roles are not provisioned in this existing local volume");
        }
        Flyway.configure().dataSource(META_URL, ADMIN_USER, ADMIN_PASSWORD)
                .table("mc_flyway_schema_history")
                .baselineOnMigrate(true)
                .locations("classpath:db/migration").load().migrate();
        runtime = jdbc(META_URL, APP_USER, APP_PASSWORD);
        sourceAdmin = jdbc(SOURCE_URL, ADMIN_USER, ADMIN_PASSWORD);
        sourceAdmin.execute("DROP TABLE IF EXISTS quality_audit_role_probe");
        sourceAdmin.execute("DROP TABLE IF EXISTS raw_import_role_probe");
        sourceAdmin.execute("CREATE TABLE raw_import_role_probe (id integer PRIMARY KEY)");
        sourceAdmin.execute("CREATE TABLE quality_audit_role_probe (id integer PRIMARY KEY)");
        source = jdbc(SOURCE_URL, SOURCE_USER, SOURCE_PASSWORD);
    }

    @AfterAll
    static void removeSourceRoleProbes() {
        if (sourceAdmin == null) return;
        sourceAdmin.execute("DROP TABLE IF EXISTS quality_audit_role_probe");
        sourceAdmin.execute("DROP TABLE IF EXISTS raw_import_role_probe");
    }

    @Test
    void runtimeCanUseEveryApplicationTableAndSequenceButCannotRunDdl() {
        List<String> tables = List.of(
                "mc_user", "mc_user_token", "mc_datasource", "mc_chart", "mc_chart_cache",
                "mc_chart_datasource", "mc_data_display_name", "mc_sample_row_cache",
                "mc_chart_refresh_lease", "mc_sample_cache_build_lease");
        for (String table : tables) {
            for (String privilege : List.of("SELECT", "INSERT", "UPDATE", "DELETE")) {
                assertThat(runtime.queryForObject(
                        "SELECT has_table_privilege(current_user, ?, ?)", Boolean.class,
                        "public." + table, privilege))
                        .as("%s on %s", privilege, table)
                        .isTrue();
            }
        }

        for (String sequence : List.of(
                "mc_user_id_seq", "mc_user_token_id_seq", "mc_datasource_id_seq", "mc_chart_id_seq")) {
            assertThat(runtime.queryForObject(
                    "SELECT has_sequence_privilege(current_user, ?, 'USAGE')", Boolean.class,
                    "public." + sequence))
                    .as("USAGE on %s", sequence)
                    .isTrue();
        }
        assertThat(runtime.queryForObject(
                "SELECT has_schema_privilege(current_user, 'public', 'CREATE')", Boolean.class)).isFalse();
        assertThat(runtime.queryForObject(
                "SELECT has_table_privilege(current_user, 'public.mc_flyway_schema_history', 'SELECT')",
                Boolean.class)).isFalse();
    }

    @Test
    void sourceReaderSeesEveryBusinessTableAndCannotWrite() {
        List<String> visible = source.queryForList("""
                SELECT table_name
                  FROM information_schema.tables
                 WHERE table_schema='public'
                   AND table_type='BASE TABLE'
                 ORDER BY table_name
                """, String.class);
        assertThat(visible).contains(
                "sales", "users", "visits", "products", "orders", "regional_population",
                "raw_import_role_probe", "quality_audit_role_probe");
        for (String table : visible) {
            assertThat(source.queryForObject(
                    "SELECT has_table_privilege(current_user, ?, 'SELECT')", Boolean.class,
                    "public." + table)).as("SELECT on %s", table).isTrue();
            for (String privilege : List.of("INSERT", "UPDATE", "DELETE", "TRUNCATE")) {
                assertThat(source.queryForObject(
                        "SELECT has_table_privilege(current_user, ?, ?)", Boolean.class,
                        "public." + table, privilege)).as("%s on %s", privilege, table).isFalse();
            }
        }
        assertThat(source.queryForObject(
                "SELECT has_schema_privilege(current_user, 'public', 'CREATE')", Boolean.class)).isFalse();
    }

    private static JdbcTemplate jdbc(String url, String user, String password) {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url, user, password);
        dataSource.setDriverClassName("org.postgresql.Driver");
        return new JdbcTemplate(dataSource);
    }

    private static boolean canConnect(String url, String user, String password) {
        try {
            jdbc(url, user, password).queryForObject("SELECT 1", Integer.class);
            return true;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
