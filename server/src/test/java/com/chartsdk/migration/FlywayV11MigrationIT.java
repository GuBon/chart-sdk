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

class FlywayV11MigrationIT {
    private static final String DATABASE = "chartsdk_embed_key_migration_it";
    private static final String ADMIN_URL = "jdbc:postgresql://localhost:5433/postgres";
    private static final String URL = "jdbc:postgresql://localhost:5433/" + DATABASE;
    private static final String USER = "postgres";
    private static final String PASSWORD = "0218";

    private static JdbcTemplate jdbc;
    private static long userId;
    private static long chartId;

    @BeforeAll
    static void migrateFromV10() {
        assumeTrue(reachable("localhost", 5433), "PostgreSQL(5433) unavailable");
        resetDatabase();

        flyway("10").migrate();
        jdbc = jdbc(URL, USER, PASSWORD);
        userId = jdbc.queryForObject("""
                INSERT INTO mc_user(username, display_name)
                VALUES ('embed-key-user', '임베드 키 사용자')
                RETURNING id
                """, Long.class);
        long datasourceId = jdbc.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc)
                VALUES ('embed-key-source', 'localhost', 5432, 'source', 'reader', 'legacy')
                RETURNING id
                """, Long.class);
        chartId = jdbc.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, chart_type)
                VALUES ('embed-key-chart', ?, 'sql', 'SELECT 1', 'bar')
                RETURNING id
                """, Long.class, datasourceId);

        flyway("11").migrate();
    }

    @AfterAll
    static void removeDatabase() {
        if (reachable("localhost", 5433)) {
            jdbc(ADMIN_URL, USER, PASSWORD).execute("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
        }
    }

    @Test
    void v11EnforcesSingleActiveKeyPerUserChartPair() {
        long first = insertKey(userId, chartId);
        assertThatThrownBy(() -> insertKey(userId, chartId))
                .hasMessageContaining("uq_mc_embed_key_active");

        // 회수(ROTATED) 후에는 새 활성 키 발급이 가능하고, 이력 행은 보존된다.
        jdbc.update("""
                UPDATE mc_embed_key
                   SET is_active=false, revoked_at=now(), revoked_reason='ROTATED'
                 WHERE id=?
                """, first);
        long second = insertKey(userId, chartId);
        assertThat(second).isGreaterThan(first);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM mc_embed_key WHERE user_id=? AND chart_id=?",
                Integer.class, userId, chartId)).isEqualTo(2);
        jdbc.update("DELETE FROM mc_embed_key WHERE user_id=? AND chart_id=?", userId, chartId);
    }

    @Test
    void v11KeepsActiveFlagAndRevocationConsistent() {
        long keyId = insertKey(userId, chartId);
        // 활성인데 회수 시각이 있는 모순 상태 차단
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE mc_embed_key SET revoked_at=now() WHERE id=?", keyId))
                .hasMessageContaining("chk_mc_embed_key_revocation");
        // 비활성 전환은 회수 시각과 함께만 가능
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE mc_embed_key SET is_active=false WHERE id=?", keyId))
                .hasMessageContaining("chk_mc_embed_key_revocation");
        jdbc.update("DELETE FROM mc_embed_key WHERE id=?", keyId);
    }

    @Test
    void v11RemovesKeysWhenChartIsDeleted() {
        long datasourceId = jdbc.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc)
                VALUES ('embed-key-cascade-source', 'localhost', 5432, 'source', 'reader', 'legacy')
                RETURNING id
                """, Long.class);
        Long doomedChart = jdbc.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, chart_type)
                VALUES ('embed-key-doomed', ?, 'sql', 'SELECT 1', 'bar')
                RETURNING id
                """, Long.class, datasourceId);
        long keyId = insertKey(userId, doomedChart);

        jdbc.update("DELETE FROM mc_chart WHERE id=?", doomedChart);

        // 서명이 유효해도 행이 없으면 검증이 TOKEN_REVOKED 로 수렴하는 전제(캐스케이드 소멸)를 스키마가 보장한다.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM mc_embed_key WHERE id=?", Integer.class, keyId)).isZero();
    }

    private static long insertKey(long userId, long chartId) {
        return jdbc.queryForObject("""
                INSERT INTO mc_embed_key(user_id, chart_id, expires_at)
                VALUES (?, ?, now() + interval '365 days')
                RETURNING id
                """, Long.class, userId, chartId);
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
