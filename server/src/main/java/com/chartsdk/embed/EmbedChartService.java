package com.chartsdk.embed;

import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartCacheService;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.token.EmbedPrincipal;
import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class EmbedChartService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ChartCacheService cache;
    private final ChartComputeService compute;
    private final ChartOptionConverter converter;

    public EmbedChartService(JdbcTemplate jdbc, ObjectMapper mapper, ChartCacheService cache,
                             ChartComputeService compute, ChartOptionConverter converter) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.cache = cache;
        this.compute = compute;
        this.converter = converter;
    }

    public Map<String, Object> data(long chartId, EmbedPrincipal principal) {
        ChartDefinition chart = findChart(chartId, principal.userId());
        CachedChartRows rows = servedRows(chart, isMultiSource(chart.id()));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("chartId", chart.id());
        response.put("computedAt", rows.computedAt().toString());
        response.put("rowCount", rows.rows().rowCount());
        response.put("truncated", rows.rows().truncated()); // 1000행 절단 노출(G5) — 임베드도 "상위 N개" 안내 가능
        response.put("option", converter.convert(rows.rows(), chart.chartType(), chart.options()));
        return response;
    }

    /**
     * 서빙 경로 불변식(설계 §8): 다중 소스 차트는 임베드 hot-path 에서 페더레이션을 절대 호출하지 않고
     * 캐시 스냅샷만 반환한다(고트래픽에서 N개 고객 DB 두들김 방지). 스냅샷 부재 시 명시적 오류.
     * 단일 소스는 기존대로 캐시 미스/만료 시 단일 비행 재계산(G1/G4).
     */
    CachedChartRows servedRows(ChartDefinition chart, boolean multiSource) {
        if (multiSource) {
            return cache.find(chart.id()).orElseThrow(() -> new ApiException(
                    HttpStatus.SERVICE_UNAVAILABLE, "SNAPSHOT_NOT_READY",
                    "Multi-source chart snapshot is not ready; refresh the chart to compute it."));
        }
        return cache.findUsable(chart.id(), chart.refreshMode(), chart.cacheTtlSeconds(), chart.version())
                .orElseGet(() -> compute.refreshSingleFlight(
                        chart.id(), chart.datasourceId(), chart.sqlQuery(), chart.version(), !"live".equals(chart.refreshMode())));
    }

    private boolean isMultiSource(long chartId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM mc_chart_datasource WHERE chart_id=?", Integer.class, chartId);
        return n != null && n >= 2;
    }

    private ChartDefinition findChart(long chartId, long userId) {
        return jdbc.query("""
                SELECT id, datasource_id, sql_query, chart_type, options::text, refresh_mode, cache_ttl_seconds, version
                  FROM mc_chart
                 WHERE id=?
                   AND (owner_id=? OR owner_id IS NULL)
                """, rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
            return chart(rs);
        }, chartId, userId);
    }

    private ChartDefinition chart(ResultSet rs) throws SQLException {
        return new ChartDefinition(
                rs.getLong("id"),
                rs.getLong("datasource_id"),
                rs.getString("sql_query"),
                rs.getString("chart_type"),
                readJson(rs.getString("options")),
                rs.getString("refresh_mode"),
                rs.getInt("cache_ttl_seconds"),
                rs.getInt("version")
        );
    }

    private Map<String, Object> readJson(String json) {
        try {
            return mapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception e) {
            return Map.of();
        }
    }

    record ChartDefinition(long id, long datasourceId, String sqlQuery, String chartType,
                           Map<String, Object> options, String refreshMode, int cacheTtlSeconds, int version) {
    }
}
