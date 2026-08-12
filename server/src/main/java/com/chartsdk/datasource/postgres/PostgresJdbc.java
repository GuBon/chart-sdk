package com.chartsdk.datasource.postgres;

/** PostgreSQL JDBC URL 규약 — 드라이버 URL 문자열은 이 클래스에만 존재한다. */
public final class PostgresJdbc {

    private PostgresJdbc() {
    }

    public static String url(String host, int port, String databaseName) {
        return "jdbc:postgresql://" + host + ":" + port + "/" + databaseName;
    }
}
