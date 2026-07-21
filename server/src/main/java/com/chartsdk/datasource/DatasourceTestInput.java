package com.chartsdk.datasource;

/** 저장 전 직접 연결 또는 저장된 ID 재검증에 사용하는 입력. */
public record DatasourceTestInput(
        Long id,
        String host,
        Integer port,
        String databaseName,
        String dbUser,
        String dbPassword
) {
    public int resolvedPort() {
        return port == null ? 5432 : port;
    }
}
