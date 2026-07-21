package com.chartsdk.datasource;

/** 데이터소스 생성·수정 입력. null인 운영 기본값을 입력 모델에서 한 번만 해석한다. */
public record DatasourceInput(
        String name,
        String host,
        Integer port,
        String databaseName,
        String dbUser,
        String dbPassword,
        Integer maxPoolSize
) {
    public int resolvedPort() {
        return port == null ? 5432 : port;
    }

    public int resolvedMaxPoolSize() {
        return maxPoolSize == null ? 5 : maxPoolSize;
    }
}
