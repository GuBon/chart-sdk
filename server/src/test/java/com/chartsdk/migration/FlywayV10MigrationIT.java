package com.chartsdk.migration;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.net.InetSocketAddress;
import java.net.Socket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class FlywayV10MigrationIT {
    private static final String DATABASE = "chartsdk_refresh_mode_migration_it";
    private static final String ADMIN_URL = "jdbc:postgresql://localhost:5433/postgres";
    private static final String URL = "jdbc:postgresql://localhost:5433/" + DATABASE;
    private static final String USER = "postgres";
    private static final String PASSWORD = "0218";

    private static JdbcTemplate jdbc;
    private static long migratedChartId;
    private static long liveChartId;
    private static long datasourceId;

    @BeforeAll
    static void migrateFromV9() {
        assumeTrue(reachable("localhost", 5433), "PostgreSQL(5433) unavailable");
        resetDatabase();

        flyway("9").migrate();
        jdbc = jdbc(URL, USER, PASSWORD);
        datasourceId = jdbc.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc)
                VALUES ('refresh-mode-source', 'localhost', 5432, 'source', 'reader', 'legacy')
                RETURNING id
                """, Long.class);
        migratedChartId = insertChart("legacy-ttl", "ttl");
        liveChartId = insertChart("existing-live", "live");

        flyway("10").migrate();
    }

    @AfterAll
    static void removeDatabase() {
        if (reachable("localhost", 5433)) {
            jdbc(ADMIN_URL, USER, PASSWORD).execute("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
        }
    }

    @Test
    void v10MigratesTtlToManualAndRemovesItsColumn() {
        assertThat(jdbc.queryForObject(
                "SELECT refresh_mode FROM mc_chart WHERE id=?", String.class, migratedChartId))
                .isEqualTo("manual");
        assertThat(jdbc.queryForObject(
                "SELECT refresh_mode FROM mc_chart WHERE id=?", String.class, liveChartId))
                .isEqualTo("live");
        assertThat(jdbc.queryForObject("""
                SELECT count(*)
                  FROM information_schema.columns
                 WHERE table_schema='public'
                   AND table_name='mc_chart'
                   AND column_name='cache_ttl_seconds'
                """, Integer.class)).isZero();
    }

    @Test
    void v10DefaultsToManualAndRejectsTtl() {
        Long chartId = jdbc.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, chart_type)
                VALUES ('default-manual', ?, 'sql', 'SELECT 1', 'bar')
                RETURNING id
                """, Long.class, datasourceId);
        assertThat(jdbc.queryForObject(
                "SELECT refresh_mode FROM mc_chart WHERE id=?", String.class, chartId))
                .isEqualTo("manual");

        assertThatThrownBy(() -> insertChart("rejected-ttl", "ttl"))
                .hasMessageContaining("chk_mc_chart_refresh");
    }

    private static long insertChart(String name, String refreshMode) {
        return jdbc.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, chart_type, refresh_mode)
                VALUES (?, ?, 'sql', 'SELECT 1', 'bar', ?)
                RETURNING id
                """, Long.class, name, datasourceId, refreshMode);
    }

    private static Flyway flyway(String target) {
        return Flyway.configure()
                .dataSource(URL, USER, PASSWORD)
                .table(FlywayHistoryTableConfiguration.HISTORY_TABLE)
                .locations("classpath:db/migration")
                .target(target)
                .cleanDisabled(true)
                .load();
    }

    private static JdbcTemplate jdbc(String url, String user, String password) {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(url, user, password);
        dataSource.setDriverClassName("org.postgresql.Driver");
        return new JdbcTemplate(dataSource);
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
