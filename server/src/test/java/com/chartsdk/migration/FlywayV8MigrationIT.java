package com.chartsdk.migration;

import com.chartsdk.cache.ChartRefreshLeaseRepository;
import com.chartsdk.cache.SampleCacheBuildLeaseRepository;
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

class FlywayV8MigrationIT {
    private static final String DATABASE = "chartsdk_migration_it";
    private static final String ADMIN_URL = "jdbc:postgresql://localhost:5433/postgres";
    private static final String URL = "jdbc:postgresql://localhost:5433/" + DATABASE;
    private static final String USER = "postgres";
    private static final String PASSWORD = "0218";

    private static JdbcTemplate jdbc;
    private static long chartId;
    private static String cachedResultBeforeV8;

    @BeforeAll
    static void migrateFromV7() {
        assumeTrue(reachable("localhost", 5433), "PostgreSQL(5433) unavailable");
        resetDatabase();

        flyway("7").migrate();
        jdbc = jdbc(URL, USER, PASSWORD);
        Long datasourceId = jdbc.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc)
                VALUES ('migration-source', 'localhost', 5432, 'source', 'reader', 'legacy')
                RETURNING id
                """, Long.class);
        chartId = jdbc.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, chart_type)
                VALUES ('migration-chart', ?, 'sql', 'SELECT 1', 'bar')
                RETURNING id
                """, Long.class, datasourceId);
        jdbc.update("""
                INSERT INTO mc_chart_cache(chart_id, result, computed_at, elapsed_ms, row_count, definition_version)
                VALUES (?, ?::jsonb, now(), 1, 0, 0)
                """, chartId, """
                {"columns":[],"rows":[],"rowCount":0,"truncated":false,"elapsedMs":1,
                 "sampling":{"version":7,"mode":"auto","requestedMethod":"auto","sizeTarget":10000,
                 "seed":77,"approximate":true,"method":"INDEX_RANDOM","valueMode":"sample"}}
                """);
        cachedResultBeforeV8 = jdbc.queryForObject(
                "SELECT result::text FROM mc_chart_cache WHERE chart_id=?", String.class, chartId);

        flyway("8").migrate();
    }

    @AfterAll
    static void removeDatabase() {
        if (reachable("localhost", 5433)) {
            jdbc(ADMIN_URL, USER, PASSWORD).execute("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
        }
    }

    @Test
    void v8IsRecordedAndPreservesTheV7SamplingSnapshot() {
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM mc_flyway_schema_history
                 WHERE version='8' AND success=true
                """, Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT to_regclass('public.mc_chart_refresh_lease') IS NOT NULL", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT to_regclass('public.mc_sample_cache_build_lease') IS NOT NULL", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT result::text FROM mc_chart_cache WHERE chart_id=?", String.class, chartId))
                .isEqualTo(cachedResultBeforeV8);
    }

    @Test
    void chartLeaseRejectsDuplicatesExpiresAndUsesTokenFencing() {
        ChartRefreshLeaseRepository leases = new ChartRefreshLeaseRepository(jdbc);
        String first = leases.tryAcquire(chartId, 0, 30).orElseThrow();

        assertThat(leases.tryAcquire(chartId, 0, 30)).isEmpty();
        jdbc.update("UPDATE mc_chart_refresh_lease SET expires_at=now() - interval '1 second' WHERE chart_id=?", chartId);
        String replacement = leases.tryAcquire(chartId, 0, 30).orElseThrow();
        assertThat(replacement).isNotEqualTo(first);

        leases.release(chartId, first);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM mc_chart_refresh_lease WHERE chart_id=?", Integer.class, chartId)).isEqualTo(1);
        leases.release(chartId, replacement);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM mc_chart_refresh_lease WHERE chart_id=?", Integer.class, chartId)).isZero();
    }

    @Test
    void sampleBuildLeaseRejectsDuplicatesExpiresAndUsesTokenFencing() {
        String fingerprint = "a".repeat(64);
        SampleCacheBuildLeaseRepository leases = new SampleCacheBuildLeaseRepository(jdbc, 5);
        String first = leases.tryAcquire(fingerprint).orElseThrow();

        assertThat(leases.tryAcquire(fingerprint)).isEmpty();
        jdbc.update("""
                UPDATE mc_sample_cache_build_lease
                   SET expires_at=now() - interval '1 second'
                 WHERE fingerprint=?
                """, fingerprint);
        String replacement = leases.tryAcquire(fingerprint).orElseThrow();
        assertThat(replacement).isNotEqualTo(first);

        leases.release(fingerprint, first);
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM mc_sample_cache_build_lease WHERE fingerprint=?
                """, Integer.class, fingerprint)).isEqualTo(1);
        leases.release(fingerprint, replacement);
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM mc_sample_cache_build_lease WHERE fingerprint=?
                """, Integer.class, fingerprint)).isZero();
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
