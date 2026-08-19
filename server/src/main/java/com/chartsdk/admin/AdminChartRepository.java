package com.chartsdk.admin;

import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.chart.ChartDefinition;
import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.Map;

@Repository
public class AdminChartRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public AdminChartRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Map<String, Object> detail(long chartId) {
        Map<String, Object> chart = jdbc.query("""
                SELECT c.*, u.username,
                       COALESCE(NULLIF(u.display_name, ''), u.username) AS owner_display_name,
                       ds.name AS datasource_name
                  FROM mc_chart c
                  LEFT JOIN mc_user u ON u.id=c.owner_id
                  LEFT JOIN mc_datasource ds ON ds.id=c.datasource_id
                 WHERE c.id=?
                """, rs -> rs.next() ? detailRow(rs) : null, chartId);
        if (chart == null) throw chartNotFound();
        return chart;
    }

    public ChartDefinition previewDefinition(long chartId) {
        ChartDefinition definition = jdbc.query("""
                SELECT id, datasource_id, sql_query, chart_type, options::text, builder_config::text,
                       refresh_mode, version
                  FROM mc_chart
                 WHERE id=?
                """, rs -> {
            if (!rs.next()) return null;
            Map<String, Object> builder = readJson(rs.getString("builder_config"));
            return new ChartDefinition(
                    rs.getLong("id"),
                    rs.getLong("datasource_id"),
                    rs.getString("sql_query"),
                    rs.getString("chart_type"),
                    readJson(rs.getString("options")),
                    builder,
                    rs.getString("refresh_mode"),
                    rs.getInt("version"),
                    SamplingMetadata.fromBuilderConfig(builder)
            );
        }, chartId);
        if (definition == null) throw chartNotFound();
        return definition;
    }

    private Map<String, Object> detailRow(ResultSet rs) throws SQLException {
        Map<String, Object> row = summary(rs);
        row.put("datasourceId", rs.getLong("datasource_id"));
        row.put("datasourceName", rs.getString("datasource_name"));
        row.put("defineMode", rs.getString("define_mode"));
        row.put("sqlQuery", rs.getString("sql_query"));
        row.put("builderConfig", readJson(rs.getString("builder_config")));
        row.put("options", readJson(rs.getString("options")));
        row.put("version", rs.getInt("version"));
        return row;
    }

    private static Map<String, Object> summary(ResultSet rs) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", rs.getLong("id"));
        long ownerId = rs.getLong("owner_id");
        row.put("ownerId", rs.wasNull() ? null : ownerId);
        row.put("ownerUsername", rs.getString("username"));
        row.put("ownerDisplayName", rs.getString("owner_display_name"));
        row.put("name", rs.getString("name"));
        row.put("description", rs.getString("description"));
        row.put("chartType", rs.getString("chart_type"));
        row.put("refreshMode", rs.getString("refresh_mode"));
        row.put("createdAt", instant(rs.getTimestamp("created_at")));
        row.put("updatedAt", instant(rs.getTimestamp("updated_at")));
        return row;
    }

    private Map<String, Object> readJson(String value) {
        try {
            return mapper.readValue(value, new TypeReference<>() { });
        } catch (Exception e) {
            throw new IllegalStateException("Stored chart JSON is invalid", e);
        }
    }

    private static String instant(Timestamp value) {
        return value == null ? null : value.toInstant().toString();
    }

    private static ApiException chartNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "차트를 찾을 수 없습니다.");
    }
}
