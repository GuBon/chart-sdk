package com.chartsdk.cache;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * PostgreSQL advisory transaction lock을 소유하는 별도 Spring 빈.
 * ChartComputeService의 내부 호출로 @Transactional 프록시가 우회되지 않도록 트랜잭션 경계를 분리한다.
 */
@Service
public class ChartRefreshCoordinator {
    private final JdbcTemplate jdbc;
    private final ChartCacheService cache;

    public ChartRefreshCoordinator(JdbcTemplate jdbc, ChartCacheService cache) {
        this.jdbc = jdbc;
        this.cache = cache;
    }

    @Transactional
    public CachedChartRows refreshSingleFlight(long chartId, int definitionVersion, boolean allowStale,
                                               SamplingMetadata sampling,
                                               Supplier<CachedChartRows> refresh) {
        Instant requestedAt = Instant.now();
        Boolean won = jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(?)", Boolean.class, chartId);
        if (Boolean.TRUE.equals(won)) return refresh.get();

        Optional<CachedChartRows> stale = cache.findCompatible(chartId, definitionVersion, sampling);
        if (allowStale && stale.isPresent()) return stale.get();

        // 승자의 트랜잭션이 끝날 때까지 기다린 뒤 그 승자가 만든 현재 정의의 결과만 사용한다.
        jdbc.query("SELECT pg_advisory_xact_lock(?)", rs -> null, chartId);
        Optional<CachedChartRows> refreshed = cache.findCompatible(chartId, definitionVersion, sampling);
        if (refreshed.isPresent()
                && (allowStale || !refreshed.get().computedAt().isBefore(requestedAt))) {
            return refreshed.get();
        }
        // 승자가 실패했거나 호환 캐시를 만들지 못했으면 락을 이어받은 현재 요청이 계산한다.
        return refresh.get();
    }
}
