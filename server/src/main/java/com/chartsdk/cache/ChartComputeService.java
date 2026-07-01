package com.chartsdk.cache;

import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;

/**
 * 차트 결과 재계산 + 캐시 시드의 단일 진입점. 저장 시드(S2 [저장])·수동 갱신(S2 [지금 갱신])·임베드 재계산이 공유한다.
 * stored SQL 실행은 {@link FederatedQueryRunner} 로 라우팅한다 — 단일 소스는 PG 직접, 다중 소스는 DuckDB 페더레이션(설계 §2).
 */
@Service
public class ChartComputeService {
    private final JdbcTemplate jdbc;
    private final FederatedQueryRunner runner;
    private final ChartCacheService cache;

    public ChartComputeService(JdbcTemplate jdbc, FederatedQueryRunner runner, ChartCacheService cache) {
        this.jdbc = jdbc;
        this.runner = runner;
        this.cache = cache;
    }

    /** 차트를 즉시 재계산해 캐시에 반영. 차트 없으면 404. */
    public CachedChartRows recompute(long chartId) {
        Chart chart = jdbc.query("SELECT datasource_id, sql_query, version FROM mc_chart WHERE id=?", rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
            return new Chart(rs.getLong("datasource_id"), rs.getString("sql_query"), rs.getInt("version"));
        }, chartId);
        QueryRows rows = runner.runStored(datasources(chartId), chart.datasourceId(), chart.sqlQuery());
        return cache.upsert(chartId, rows, chart.version()); // 캐시에 정의 버전 스탬프(G2)
    }

    /**
     * 임베드 핫패스의 단일 비행(single-flight) 재계산 — 캐시 미스/만료 시 호출.
     * pg_try_advisory_xact_lock 으로 동시 재계산을 한 요청으로 합치고(G1), 경쟁에서 진 요청은
     * allowStale 이면 기존 stale 캐시를 즉시 반환한다(SWR, G4). stale 이 없으면 승자 완료를 기다린 뒤 결과를 읽는다.
     * advisory_xact_lock 은 트랜잭션 종료 시 자동 해제되므로 @Transactional 필수.
     */
    @Transactional
    public CachedChartRows refreshSingleFlight(long chartId, long datasourceId, String sql, int definitionVersion, boolean allowStale) {
        Set<Long> dsSet = datasources(chartId);
        Boolean won = jdbc.queryForObject("SELECT pg_try_advisory_xact_lock(?)", Boolean.class, chartId);
        if (Boolean.TRUE.equals(won)) {
            return cache.upsert(chartId, runner.runStored(dsSet, datasourceId, sql), definitionVersion);
        }
        // 경쟁에서 짐 — 다른 요청이 재계산 중.
        if (allowStale) {
            Optional<CachedChartRows> stale = cache.find(chartId);
            if (stale.isPresent()) return stale.get(); // stale 즉시 반환(블로킹 회피)
        }
        // stale 이 없거나 live 모드 → 승자가 끝날 때까지 대기 후 신선한 결과를 읽는다.
        jdbc.query("SELECT pg_advisory_xact_lock(?)", rs -> null, chartId);
        return cache.find(chartId).orElseGet(() -> cache.upsert(chartId, runner.runStored(dsSet, datasourceId, sql), definitionVersion));
    }

    /** 저장 직후 캐시 시드(베스트 에포트). 데이터소스 장애로 실패해도 저장은 유지한다. */
    public void seedQuietly(long chartId) {
        try {
            recompute(chartId);
        } catch (RuntimeException ignored) {
            // 시드는 self-heal 로 대체 가능 — 저장 트랜잭션을 깨지 않는다.
        }
    }

    /** 차트가 참조하는 데이터소스 집합(junction). stored SQL 실행 라우팅에 쓴다. */
    private Set<Long> datasources(long chartId) {
        return new LinkedHashSet<>(
                jdbc.queryForList("SELECT datasource_id FROM mc_chart_datasource WHERE chart_id=?", Long.class, chartId));
    }

    private record Chart(long datasourceId, String sqlQuery, int version) {
    }
}
