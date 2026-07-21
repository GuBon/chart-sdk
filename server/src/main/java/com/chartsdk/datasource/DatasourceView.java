package com.chartsdk.datasource;

/** Admin API에 노출하는 데이터소스 읽기 모델. 비밀번호는 의도적으로 포함하지 않는다. */
public record DatasourceView(
        long id,
        String name,
        String host,
        int port,
        String databaseName,
        String dbUser,
        int maxPoolSize,
        String lastTestedAt,
        Boolean lastTestOk
) {
}
