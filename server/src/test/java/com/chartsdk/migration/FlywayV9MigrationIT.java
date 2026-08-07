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
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class FlywayV9MigrationIT {
    private static final String DATABASE = "chartsdk_colorbrewer_migration_it";
    private static final String ADMIN_URL = "jdbc:postgresql://localhost:5433/postgres";
    private static final String URL = "jdbc:postgresql://localhost:5433/" + DATABASE;
    private static final String USER = "postgres";
    private static final String PASSWORD = "0218";

    private static JdbcTemplate jdbc;
    private static long barChartId;
    private static long mapChartId;

    @BeforeAll
    static void migrateFromV8() {
        assumeTrue(reachable("localhost", 5433), "PostgreSQL(5433) unavailable");
        resetDatabase();

        flyway("8").migrate();
        jdbc = jdbc(URL, USER, PASSWORD);
        Long datasourceId = jdbc.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc)
                VALUES ('colorbrewer-source', 'localhost', 5432, 'source', 'reader', 'legacy')
                RETURNING id
                """, Long.class);
        barChartId = insertChart(datasourceId, "legacy-bar", "bar", """
                {
                  "palettePreset":"category10",
                  "palette":["#1f77b4","#ff7f0e"],
                  "autoColorMap":{"A":"#1f77b4"},
                  "colorMap":{"A":"#123456"},
                  "itemColorOverrides":[{"key":"A","color":"#654321"}],
                  "colorTheme":{"version":3,"categoricalPreset":"category10"}
                }
                """);
        mapChartId = insertChart(datasourceId, "legacy-map", "map", """
                {
                  "palettePreset":"viridis",
                  "palette":["#440154","#FDE725"],
                  "colorTheme":{"version":3,"continuousPreset":"viridis"}
                }
                """);

        flyway("9").migrate();
    }

    @AfterAll
    static void removeDatabase() {
        if (reachable("localhost", 5433)) {
            jdbc(ADMIN_URL, USER, PASSWORD).execute("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
        }
    }

    @Test
    void v9IsRecordedAndReplacesLegacyPalettesAndOverrides() {
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM flyway_schema_history
                 WHERE version='9' AND success=true
                """, Integer.class)).isEqualTo(1);

        assertColorBrewerDefaults(barChartId, "dark2", "#1B9E77", 8);
        assertColorBrewerDefaults(mapChartId, "blues", "#F7FBFF", 9);
    }

    private static void assertColorBrewerDefaults(long chartId, String preset, String firstColor, int colorCount) {
        assertThat(jdbc.queryForObject(
                "SELECT options->>'palettePreset' FROM mc_chart WHERE id=?", String.class, chartId))
                .isEqualTo(preset);
        assertThat(jdbc.queryForObject(
                "SELECT options->'palette'->>0 FROM mc_chart WHERE id=?", String.class, chartId))
                .isEqualTo(firstColor);
        assertThat(jdbc.queryForObject(
                "SELECT jsonb_array_length(options->'palette') FROM mc_chart WHERE id=?", Integer.class, chartId))
                .isEqualTo(colorCount);
        assertThat(jdbc.queryForObject(
                "SELECT (options->'colorTheme'->>'version')::integer FROM mc_chart WHERE id=?", Integer.class, chartId))
                .isEqualTo(4);
        assertThat(jdbc.queryForObject(
                "SELECT options->'autoColorMap' = '{}'::jsonb FROM mc_chart WHERE id=?", Boolean.class, chartId))
                .isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT options->'colorMap' = '{}'::jsonb FROM mc_chart WHERE id=?", Boolean.class, chartId))
                .isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT options->'itemColorOverrides' = '[]'::jsonb FROM mc_chart WHERE id=?", Boolean.class, chartId))
                .isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT version FROM mc_chart WHERE id=?", Integer.class, chartId))
                .isEqualTo(1);
    }

    private static long insertChart(Long datasourceId, String name, String chartType, String options) {
        return jdbc.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, chart_type, options)
                VALUES (?, ?, 'sql', 'SELECT 1', ?, ?::jsonb)
                RETURNING id
                """, Long.class, name, datasourceId, chartType, options);
    }

    private static Flyway flyway(String target) {
        return Flyway.configure()
                .dataSource(URL, USER, PASSWORD)
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
