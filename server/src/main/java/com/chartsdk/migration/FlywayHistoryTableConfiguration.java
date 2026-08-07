package com.chartsdk.migration;

import org.flywaydb.core.Flyway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

/** Keeps Flyway's metadata inside the ChartSDK-owned {@code mc_*} namespace. */
@Configuration(proxyBeanMethods = false)
public class FlywayHistoryTableConfiguration {
    public static final String HISTORY_TABLE = "mc_flyway_schema_history";
    static final String LEGACY_HISTORY_TABLE = "flyway_schema_history";

    private static final Logger log = LoggerFactory.getLogger(FlywayHistoryTableConfiguration.class);
    private static final String SCHEMA = "public";

    @Bean
    FlywayMigrationStrategy flywayMigrationStrategy() {
        return FlywayHistoryTableConfiguration::migrate;
    }

    static void migrate(Flyway flyway) {
        if (!HISTORY_TABLE.equals(flyway.getConfiguration().getTable())) {
            throw new IllegalStateException(
                    "Flyway history table must be configured as " + HISTORY_TABLE);
        }
        renameLegacyHistoryTable(flyway.getConfiguration().getDataSource());
        flyway.migrate();
    }

    static void renameLegacyHistoryTable(DataSource dataSource) {
        try (Connection connection = dataSource.getConnection()) {
            boolean originalAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                // Serialize the one-time bridge when multiple application replicas start together.
                try (Statement statement = connection.createStatement()) {
                    statement.execute("SELECT pg_advisory_xact_lock(hashtext('chartsdk.flyway-history-table')::bigint)");
                }

                boolean legacyExists = relationExists(connection, LEGACY_HISTORY_TABLE);
                boolean currentExists = relationExists(connection, HISTORY_TABLE);
                if (legacyExists && currentExists) {
                    throw new IllegalStateException(
                            "Both public." + LEGACY_HISTORY_TABLE + " and public." + HISTORY_TABLE
                                    + " exist; refusing to choose a Flyway history automatically");
                }
                boolean renamed = false;
                if (legacyExists) {
                    assertLegacyTableIsRenamable(connection);
                    try (Statement statement = connection.createStatement()) {
                        statement.execute("ALTER TABLE " + SCHEMA + "." + LEGACY_HISTORY_TABLE
                                + " RENAME TO " + HISTORY_TABLE);
                    }
                    renamed = true;
                }
                connection.commit();
                if (renamed) {
                    log.info("Renamed legacy Flyway history table to {}", HISTORY_TABLE);
                }
            } catch (Exception exception) {
                connection.rollback();
                if (exception instanceof IllegalStateException illegalStateException) {
                    throw illegalStateException;
                }
                throw new IllegalStateException("Failed to align the Flyway history table name", exception);
            } finally {
                connection.setAutoCommit(originalAutoCommit);
            }
        } catch (SQLException exception) {
            throw new IllegalStateException("Failed to inspect the Flyway history table", exception);
        }
    }

    /**
     * ALTER TABLE ... RENAME 은 소유 role 만 실행할 수 있다. runtime datasource(chartsdk_app)로 마이그레이션을
     * 돌리는 배포는 여기서 원시 permission denied 대신 조치 가능한 원인을 받는다.
     */
    private static void assertLegacyTableIsRenamable(Connection connection) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT current_user AS migration_user,
                       pg_has_role(current_user, c.relowner, 'MEMBER') AS owns
                  FROM pg_class c
                 WHERE c.oid = to_regclass(?)
                """)) {
            statement.setString(1, SCHEMA + "." + LEGACY_HISTORY_TABLE);
            try (ResultSet result = statement.executeQuery()) {
                // 존재 확인 직후 사라진 예외적 상황은 rename 이 자연스럽게 실패하도록 둔다.
                if (!result.next()) return;
                if (result.getBoolean("owns")) return;
                throw new IllegalStateException(
                        "Cannot rename " + SCHEMA + "." + LEGACY_HISTORY_TABLE + " to " + HISTORY_TABLE
                                + ": the migration user \"" + result.getString("migration_user")
                                + "\" does not own it. Run migrations as the owning role"
                                + " (SPRING_FLYWAY_USER/SPRING_FLYWAY_PASSWORD) or rename the table manually.");
            }
        }
    }

    private static boolean relationExists(Connection connection, String table) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT to_regclass(?) IS NOT NULL")) {
            statement.setString(1, SCHEMA + "." + table);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getBoolean(1);
            }
        }
    }
}
