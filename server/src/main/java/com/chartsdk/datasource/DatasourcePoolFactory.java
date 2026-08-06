package com.chartsdk.datasource;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.stereotype.Component;

/** Creates one lazy, read-only Hikari pool from the latest persisted datasource credentials. */
@Component
public class DatasourcePoolFactory {
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int VALIDATION_TIMEOUT_MS = 5_000;

    private final DatasourceService datasources;

    public DatasourcePoolFactory(DatasourceService datasources) {
        this.datasources = datasources;
    }

    HikariDataSource create(long datasourceId) {
        DatasourceCredentials credentials = datasources.credentials(datasourceId);
        HikariConfig config = new HikariConfig();
        config.setPoolName("ds-" + datasourceId);
        config.setJdbcUrl(credentials.jdbcUrl());
        config.setUsername(credentials.dbUser());
        config.setPassword(credentials.dbPassword());
        config.setReadOnly(true);
        config.setMaximumPoolSize(Math.max(1, credentials.maxPoolSize()));
        config.setMinimumIdle(0);
        config.setConnectionTimeout(CONNECT_TIMEOUT_MS);
        config.setValidationTimeout(VALIDATION_TIMEOUT_MS);
        config.setIdleTimeout(60_000);
        config.setMaxLifetime(600_000);
        return new HikariDataSource(config);
    }
}
