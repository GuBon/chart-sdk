package com.chartsdk.embed;

import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.converter.SeriesPivot;
import com.chartsdk.token.EmbedKeyPrincipal;
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

    /** 서빙 대상 차트는 임베드 키 바인딩(principal.chartId())에서만 나온다 — 클라이언트는 chartId 를 보낼 수 없다. */
    public Map<String, Object> data(EmbedKeyPrincipal principal) {
        ChartDefinition chart = findChart(principal.chartId(), principal.userId());
        // 서빙 불변식(설계 §8)은 ChartComputeService.serve 에 단일화 — 다중 소스는 캐시 스냅샷만.
        CachedChartRows rows = compute.serve(
                chart.id(), chart.refreshMode(), chart.version(), chart.sampling());
        var displayRows = SeriesPivot.pivot(rows.rows(), chart.builderConfig(), chart.chartType());
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("chartId", chart.id());
        response.put("computedAt", rows.computedAt().toString());
        response.put("rowCount", displayRows.rowCount());
        response.put("truncated", rows.rows().truncated()); // 신규 차트 계산은 전체 결과이며, 레거시/제한 결과 호환 메타데이터는 유지한다.
        response.put("option", converter.convert(
                displayRows,
                chart.chartType(),
                chart.options(),
                chart.builderConfig(),
                chart.refreshMode()
        ));
        if (rows.sampling() != null) rows.sampling().putInto(response);
        return response;
    }

    private ChartDefinition findChart(long chartId, long userId) {
        return jdbc.query("""
                SELECT id, datasource_id, sql_query, chart_type, options::text, builder_config::text,
                       refresh_mode, version
                  FROM mc_chart
                 WHERE id=?
                   AND owner_id=?
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
                readJson(rs.getString("builder_config")),
                rs.getString("refresh_mode"),
                rs.getInt("version"),
                SamplingMetadata.fromBuilderConfig(readJson(rs.getString("builder_config")))
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
                           Map<String, Object> options, Map<String, Object> builderConfig,
                           String refreshMode, int version,
                           SamplingMetadata sampling) {
    }
}
