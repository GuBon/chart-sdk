package com.chartsdk.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class FlywayHistoryTableConfigurationIT {
    private static final String DATABASE = "chartsdk_history_table_migration_it";
    private static final String ADMIN_URL = "jdbc:postgresql://localhost:5433/postgres";
    private static final String URL = "jdbc:postgresql://localhost:5433/" + DATABASE;
    private static final String USER = "postgres";
    private static final String PASSWORD = "0218";
    private static final String NON_OWNER_ROLE = "chartsdk_history_it_non_owner";
    private static final String NON_OWNER_PASSWORD = "non-owner";

    private static JdbcTemplate jdbc;
    private static List<Map<String, Object>> historyBeforeRename;

    @BeforeAll
    static void migrateLegacyHistoryWithoutLosingRows() {
        assumeTrue(reachable("localhost", 5433), "PostgreSQL(5433) unavailable");
        resetDatabase();

        Flyway.configure()
                .dataSource(URL, USER, PASSWORD)
                .table(FlywayHistoryTableConfiguration.LEGACY_HISTORY_TABLE)
                .locations("classpath:db/migration")
                .target("9")
                .load()
                .migrate();
        jdbc = jdbc(URL, USER, PASSWORD);
        historyBeforeRename = historyRows(FlywayHistoryTableConfiguration.LEGACY_HISTORY_TABLE, "9");

        Flyway current = Flyway.configure()
                .dataSource(URL, USER, PASSWORD)
                .table(FlywayHistoryTableConfiguration.HISTORY_TABLE)
                .locations("classpath:db/migration")
                .load();
        FlywayHistoryTableConfiguration.migrate(current);
    }

    @AfterAll
    static void removeDatabase() {
        if (reachable("localhost", 5433)) {
            jdbc(ADMIN_URL, USER, PASSWORD).execute("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
        }
    }

    @Test
    void renamesTheLegacyTableAndPreservesEveryExistingHistoryRow() {
        assertThat(jdbc.queryForObject(
                "SELECT to_regclass('public.flyway_schema_history') IS NULL", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT to_regclass('public.mc_flyway_schema_history') IS NOT NULL", Boolean.class)).isTrue();
        assertThat(historyRows(FlywayHistoryTableConfiguration.HISTORY_TABLE, "9"))
                .isEqualTo(historyBeforeRename);
    }

    @Test
    void continuesMigrationsUsingOnlyThePrefixedHistoryTable() {
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM mc_flyway_schema_history
                 WHERE version='10' AND success=true
                """, Integer.class)).isEqualTo(1);
    }

    @Test
    void refusesToRenameWhenTheMigrationUserDoesNotOwnTheLegacyTable() {
        jdbc.execute("DROP ROLE IF EXISTS " + NON_OWNER_ROLE);
        jdbc.execute("CREATE ROLE " + NON_OWNER_ROLE + " LOGIN PASSWORD '" + NON_OWNER_PASSWORD + "'");
        jdbc.execute("ALTER TABLE mc_flyway_schema_history RENAME TO flyway_schema_history");
        try {
            assertThatThrownBy(() -> FlywayHistoryTableConfiguration.renameLegacyHistoryTable(
                    dataSource(URL, NON_OWNER_ROLE, NON_OWNER_PASSWORD)))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining(NON_OWNER_ROLE)
                    .hasMessageContaining("does not own it")
                    .hasMessageContaining("SPRING_FLYWAY_USER");
            assertThat(jdbc.queryForObject(
                    "SELECT to_regclass('public.flyway_schema_history') IS NOT NULL", Boolean.class)).isTrue();
        } finally {
            jdbc.execute("ALTER TABLE flyway_schema_history RENAME TO mc_flyway_schema_history");
            jdbc.execute("DROP ROLE IF EXISTS " + NON_OWNER_ROLE);
        }
    }

    @Test
    void refusesToChooseWhenLegacyAndPrefixedHistoriesBothExist() {
        jdbc.execute("CREATE TABLE flyway_schema_history (installed_rank integer)");
        try {
            assertThatThrownBy(() -> FlywayHistoryTableConfiguration.renameLegacyHistoryTable(
                    dataSource(URL, USER, PASSWORD)))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Both public.flyway_schema_history")
                    .hasMessageContaining("public.mc_flyway_schema_history");
        } finally {
            jdbc.execute("DROP TABLE flyway_schema_history");
        }
    }

    private static List<Map<String, Object>> historyRows(String table, String throughVersion) {
        return jdbc.queryForList("""
                SELECT installed_rank, version, description, type, script, checksum, installed_by, success
                  FROM %s
                 WHERE version::integer <= ?::integer
                 ORDER BY installed_rank
                """.formatted(table), throughVersion);
    }

    private static JdbcTemplate jdbc(String url, String user, String password) {
        return new JdbcTemplate(dataSource(url, user, password));
    }

    private static DriverManagerDataSource dataSource(String url, String user, String password) {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url, user, password);
        dataSource.setDriverClassName("org.postgresql.Driver");
        return dataSource;
    }

    private static void resetDatabase() {
        JdbcTemplate admin = jdbc(ADMIN_URL, USER, PASSWORD);
        admin.execute("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
        admin.execute("CREATE DATABASE " + DATABASE);
    }

    private static boolean reachable(String host, int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 500);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
