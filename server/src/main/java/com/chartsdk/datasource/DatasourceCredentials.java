package com.chartsdk.datasource;

import com.chartsdk.datasource.postgres.PostgresJdbc;

public record DatasourceCredentials(
        String host,
        int port,
        String databaseName,
        String dbUser,
        String dbPassword,
        int maxPoolSize
) {
    /** PostgreSQL 드라이버 URL — 규약 문자열은 {@link PostgresJdbc}에만 둔다. */
    public String jdbcUrl() {
        return PostgresJdbc.url(host, port, databaseName);
    }
}
