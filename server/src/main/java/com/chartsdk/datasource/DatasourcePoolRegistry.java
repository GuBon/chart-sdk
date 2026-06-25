package com.chartsdk.datasource;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 고객 데이터소스별 커넥션 풀 레지스트리(HikariCP). 매 요청 DriverManager 새 연결 대신 풀에서 빌려준다(정합성 I2).
 * - 풀은 datasourceId 별로 1개, 상한 = mc_datasource.max_pool_size (운영 DB 보호).
 * - 고객 DB 는 항상 읽기 전용 풀 + connect timeout 으로 무한 대기 방지.
 * - 데이터소스 수정/삭제 시 evict 로 폐기(다음 사용 시 새 자격증명으로 재생성).
 */
@Component
public class DatasourcePoolRegistry {
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int VALIDATION_TIMEOUT_MS = 5_000;

    private final DatasourceService datasources;
    private final Map<Long, HikariDataSource> pools = new ConcurrentHashMap<>();

    public DatasourcePoolRegistry(DatasourceService datasources) {
        this.datasources = datasources;
    }

    /** 데이터소스 풀에서 읽기 전용 커넥션을 빌린다(try-with-resources 로 반납). */
    public Connection connection(long datasourceId) throws SQLException {
        return pools.computeIfAbsent(datasourceId, this::createPool).getConnection();
    }

    /** 자격증명/설정 변경·삭제 시 호출 — 기존 풀을 닫아 다음 사용 때 재생성되게 한다. */
    public void evict(long datasourceId) {
        HikariDataSource pool = pools.remove(datasourceId);
        if (pool != null) pool.close();
    }

    private HikariDataSource createPool(long datasourceId) {
        DatasourceCredentials c = datasources.credentials(datasourceId);
        HikariConfig cfg = new HikariConfig();
        cfg.setPoolName("ds-" + datasourceId);
        cfg.setJdbcUrl(c.jdbcUrl());
        cfg.setUsername(c.dbUser());
        cfg.setPassword(c.dbPassword());
        cfg.setReadOnly(true);                       // 고객 DB 는 읽기 전용 — 풀 레벨에서 강제
        cfg.setMaximumPoolSize(Math.max(1, c.maxPoolSize()));
        cfg.setMinimumIdle(0);                        // 유휴 시 0까지 줄여 고객 DB 연결 점유 최소화
        cfg.setConnectionTimeout(CONNECT_TIMEOUT_MS); // 풀 고갈/도달 불가 시 빠르게 실패(무한 대기 금지)
        cfg.setValidationTimeout(VALIDATION_TIMEOUT_MS);
        cfg.setIdleTimeout(60_000);
        cfg.setMaxLifetime(600_000);
        return new HikariDataSource(cfg);
    }

    @PreDestroy
    void closeAll() {
        pools.values().forEach(HikariDataSource::close);
        pools.clear();
    }
}
