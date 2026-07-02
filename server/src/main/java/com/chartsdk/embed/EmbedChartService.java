package com.chartsdk.embed;

import com.chartsdk.cache.CachedChartRows;
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
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class EmbedChartService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ChartComputeService compute;
    private final ChartOptionConverter converter;

    public EmbedChartService(JdbcTemplate jdbc, ObjectMapper mapper,
                             ChartComputeService compute, ChartOptionConverter converter) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.compute = compute;
        this.converter = converter;
    }

    public Map<String, Object> data(long chartId, EmbedPrincipal principal) {
        ChartDefinition chart = findChart(chartId, principal.userId());
        // 서빙 불변식(설계 §8)은 ChartComputeService.serve 에 단일화 — 다중 소스는 캐시 스냅샷만.
        CachedChartRows rows = compute.serve(chart.id(), chart.datasourceId(), chart.sqlQuery(),
                chart.refreshMode(), chart.cacheTtlSeconds(), chart.version());
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("chartId", chart.id());
        response.put("computedAt", rows.computedAt().toString());
        response.put("rowCount", rows.rows().rowCount());
        response.put("truncated", rows.rows().truncated()); // 1000행 절단 노출(G5) — 임베드도 "상위 N개" 안내 가능
        response.put("option", converter.convert(rows.rows(), chart.chartType(), chart.options()));
        return response;
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
