package com.chartsdk.datasource;

public record DatasourceCredentials(
        String host,
        int port,
        String databaseName,
        String dbUser,
        String dbPassword,
        int maxPoolSize
) {
    public String jdbcUrl() {
        return "jdbc:postgresql://" + host + ":" + port + "/" + databaseName;
    }
}
