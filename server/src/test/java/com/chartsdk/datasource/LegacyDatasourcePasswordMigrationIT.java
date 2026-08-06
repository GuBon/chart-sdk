package com.chartsdk.datasource;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class LegacyDatasourcePasswordMigrationIT {
    private static final String DATABASE = "chartsdk_password_it";
    private static final String ADMIN_URL = "jdbc:postgresql://localhost:5433/postgres";
    private static final String URL = "jdbc:postgresql://localhost:5433/" + DATABASE;
    private static final String USER = "postgres";
    private static final String PASSWORD = "0218";

    private static DriverManagerDataSource dataSource;
    private static JdbcTemplate jdbc;
    private static DatasourcePasswordCodec codec;

    @BeforeAll
    static void prepareDatabase() {
        assumeTrue(reachable("localhost", 5433), "PostgreSQL(5433) unavailable");
        JdbcTemplate admin = jdbc(ADMIN_URL);
        admin.execute("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
        admin.execute("CREATE DATABASE " + DATABASE);
        Flyway.configure().dataSource(URL, USER, PASSWORD)
                .locations("classpath:db/migration").load().migrate();
        dataSource = dataSource(URL);
        jdbc = new JdbcTemplate(dataSource);
        codec = new DatasourcePasswordCodec("migration-key");
    }

    @AfterAll
    static void removeDatabase() {
        if (reachable("localhost", 5433)) {
            jdbc(ADMIN_URL).execute("DROP DATABASE IF EXISTS " + DATABASE + " WITH (FORCE)");
        }
    }

    @Test
    void convertsMixedRowsWithoutChangingConnectionIdentity() {
        insert("legacy-a", "db-a", "plain-a");
        insert("legacy-b", "db-b", "plain-b");
        insert("encrypted-a", "db-c", codec.encrypt("cipher-a"));
        insert("encrypted-b", "db-d", codec.encrypt("cipher-b"));
        insert("encrypted-c", "db-e", codec.encrypt("cipher-c"));
        List<String> identitiesBefore = jdbc.queryForList("""
                SELECT name || ':' || database_name FROM mc_datasource ORDER BY id
                """, String.class);

        DatasourcePasswordRepository repository = new DatasourcePasswordRepository(jdbc);
        LegacyDatasourcePasswordMigrationService service =
                new LegacyDatasourcePasswordMigrationService(repository, codec);
        TransactionTemplate transaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        LegacyDatasourcePasswordMigrationService.MigrationResult result =
                transaction.execute(status -> service.migrate());

        assertThat(result).isEqualTo(new LegacyDatasourcePasswordMigrationService.MigrationResult(5, 3, 2, 0));
        assertThat(repository.countLegacy()).isZero();
        assertThat(jdbc.queryForList("""
                SELECT name || ':' || database_name FROM mc_datasource ORDER BY id
                """, String.class)).isEqualTo(identitiesBefore);
        assertThat(jdbc.queryForList(
                "SELECT db_password_enc FROM mc_datasource ORDER BY id", String.class))
                .allSatisfy(value -> {
                    assertThat(codec.isEncrypted(value)).isTrue();
                    assertThat(codec.decrypt(value)).isNotBlank();
                });
    }

    private static void insert(String name, String database, String storedPassword) {
        jdbc.update("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc)
                VALUES (?, 'localhost', 5432, ?, 'reader', ?)
                """, name, database, storedPassword);
    }

    private static JdbcTemplate jdbc(String url) {
        return new JdbcTemplate(dataSource(url));
    }

    private static DriverManagerDataSource dataSource(String url) {
        DriverManagerDataSource result = new DriverManagerDataSource(url, USER, PASSWORD);
        result.setDriverClassName("org.postgresql.Driver");
        return result;
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
