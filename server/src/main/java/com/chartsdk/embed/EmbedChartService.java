package com.chartsdk.embed;

import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartCacheService;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.token.EmbedPrincipal;
import com.chartsdk.token.TokenService;
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
    private final TokenService tokens;
    private final ChartCacheService cache;
    private final ChartComputeService compute;
    private final ChartOptionConverter converter;

    public EmbedChartService(JdbcTemplate jdbc, ObjectMapper mapper, TokenService tokens, ChartCacheService cache,
                             ChartComputeService compute, ChartOptionConverter converter) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.tokens = tokens;
        this.cache = cache;
        this.compute = compute;
        this.converter = converter;
    }

    public Map<String, Object> data(long chartId, String authorization) {
        EmbedPrincipal principal = tokens.validateBearer(authorization);
        ChartDefinition chart = findChart(chartId, principal.userId());
        // 캐시가 신선하면 그대로, 아니면 단일 비행 재계산(경쟁 시 stale 즉시 반환 — G1/G4).
        CachedChartRows rows = cache.findUsable(chart.id(), chart.refreshMode(), chart.cacheTtlSeconds())
                .orElseGet(() -> compute.refreshSingleFlight(
                        chart.id(), chart.datasourceId(), chart.sqlQuery(), !"live".equals(chart.refreshMode())));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("chartId", chart.id());
        response.put("computedAt", rows.computedAt().toString());
        response.put("option", converter.convert(rows.rows(), chart.chartType(), chart.options()));
        return response;
    }

    private ChartDefinition findChart(long chartId, long userId) {
        return jdbc.query("""
                SELECT id, datasource_id, sql_query, chart_type, options::text, refresh_mode, cache_ttl_seconds
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
                rs.getInt("cache_ttl_seconds")
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

    private record ChartDefinition(long id, long datasourceId, String sqlQuery, String chartType,
                                   Map<String, Object> options, String refreshMode, int cacheTtlSeconds) {
    }
}
