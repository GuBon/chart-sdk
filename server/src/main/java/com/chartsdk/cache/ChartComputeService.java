package com.chartsdk.cache;

import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 차트 결과 재계산 + 캐시 시드의 단일 진입점. 저장 시드(S2 [저장])·수동 갱신(S2 [지금 갱신])이 공유한다.
 */
@Service
public class ChartComputeService {
    private final JdbcTemplate jdbc;
    private final QueryExecutor queries;
    private final ChartCacheService cache;

    public ChartComputeService(JdbcTemplate jdbc, QueryExecutor queries, ChartCacheService cache) {
        this.jdbc = jdbc;
        this.queries = queries;
        this.cache = cache;
    }

    /** 차트를 즉시 재계산해 캐시에 반영. 차트 없으면 404. */
    public CachedChartRows recompute(long chartId) {
        Chart chart = jdbc.query("SELECT datasource_id, sql_query FROM mc_chart WHERE id=?", rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
            return new Chart(rs.getLong("datasource_id"), rs.getString("sql_query"));
        }, chartId);
        QueryRows rows = queries.execute(chart.datasourceId(), chart.sqlQuery());
        return cache.upsert(chartId, rows);
    }

    /** 저장 직후 캐시 시드(베스트 에포트). 데이터소스 장애로 실패해도 저장은 유지한다. */
    public void seedQuietly(long chartId) {
        try {
            recompute(chartId);
        } catch (RuntimeException ignored) {
            // 시드는 self-heal 로 대체 가능 — 저장 트랜잭션을 깨지 않는다.
        }
    }

    private record Chart(long datasourceId, String sqlQuery) {
    }
}
