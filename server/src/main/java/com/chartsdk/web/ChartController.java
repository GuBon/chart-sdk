package com.chartsdk.web;

import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartComputeService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/charts")
public class ChartController {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ChartComputeService compute;

    public ChartController(JdbcTemplate jdbc, ObjectMapper mapper, ChartComputeService compute) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.compute = compute;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String q,
                                    @RequestParam(required = false) String type,
                                    @RequestParam(required = false) Long datasourceId) {
        StringBuilder sql = new StringBuilder("""
                SELECT id, name, description, chart_type, datasource_id, updated_at
                  FROM mc_chart
                 WHERE 1=1
                """);
        java.util.ArrayList<Object> params = new java.util.ArrayList<>();
        if (q != null && !q.isBlank()) {
            sql.append(" AND (name ILIKE ? OR description ILIKE ?)");
            params.add("%" + q + "%");
            params.add("%" + q + "%");
        }
        if (type != null && !type.isBlank()) {
            sql.append(" AND chart_type=?");
            params.add(type);
        }
        if (datasourceId != null) {
            sql.append(" AND datasource_id=?");
            params.add(datasourceId);
        }
        sql.append(" ORDER BY updated_at DESC");
        List<Map<String, Object>> charts = jdbc.query(sql.toString(), (rs, rowNum) -> summary(rs), params.toArray());
        return Map.of("charts", charts);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable long id) {
        return jdbc.query("SELECT * FROM mc_chart WHERE id=?", rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
            return detail(rs);
        }, id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestBody Map<String, Object> input) {
        Long id = jdbc.queryForObject("""
                INSERT INTO mc_chart(name, description, datasource_id, define_mode, sql_query, builder_config, chart_type, options, refresh_mode, cache_ttl_seconds)
                VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb, ?, ?)
                RETURNING id
                """, Long.class,
                input.get("name"),
                input.get("description"),
                number(input.get("datasourceId")),
                input.getOrDefault("defineMode", "builder"),
                input.getOrDefault("sqlQuery", "SELECT 1"),
                json(input.get("builderConfig")),
                input.getOrDefault("chartType", "bar"),
                json(input.getOrDefault("options", Map.of())),
                input.getOrDefault("refreshMode", "ttl"),
                number(input.getOrDefault("cacheTtlSeconds", 3600)));
        compute.seedQuietly(id); // 저장 성공 시 캐시 시드 (PRD 7.7)
        return get(id);
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable long id, @RequestBody Map<String, Object> input) {
        int updated = jdbc.update("""
                UPDATE mc_chart
                   SET name=?, description=?, datasource_id=?, define_mode=?, sql_query=?, builder_config=?::jsonb,
                       chart_type=?, options=?::jsonb, refresh_mode=?, cache_ttl_seconds=?
                 WHERE id=?
                """,
                input.get("name"),
                input.get("description"),
                number(input.get("datasourceId")),
                input.getOrDefault("defineMode", "builder"),
                input.getOrDefault("sqlQuery", "SELECT 1"),
                json(input.get("builderConfig")),
                input.getOrDefault("chartType", "bar"),
                json(input.getOrDefault("options", Map.of())),
                input.getOrDefault("refreshMode", "ttl"),
                number(input.getOrDefault("cacheTtlSeconds", 3600)),
                id);
        if (updated == 0) throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
        compute.seedQuietly(id); // 저장 성공 시 캐시 갱신 (PRD 7.7)
        return get(id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        jdbc.update("DELETE FROM mc_chart WHERE id=?", id);
    }

    /** 결과 캐시 수동 갱신 — S2 [지금 갱신]. 즉시 재계산 후 캐시 갱신. */
    @PostMapping("/{id}/refresh")
    public Map<String, Object> refresh(@PathVariable long id) {
        CachedChartRows rows = compute.recompute(id);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("chartId", id);
        result.put("computedAt", rows.computedAt().toString());
        result.put("rowCount", rows.rows().rowCount());
        result.put("elapsedMs", rows.rows().elapsedMs());
        return result;
    }

    /** 차트 복제 — S1 카드 액션. 이름 "{원본} (사본)", 캐시는 원본 결과로 시드(재실행 없음). */
    @PostMapping("/{id}/duplicate")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> duplicate(@PathVariable long id) {
        Long newId;
        try {
            newId = jdbc.queryForObject("""
                    INSERT INTO mc_chart(owner_id, name, description, datasource_id, define_mode, sql_query, builder_config,
                                         chart_type, options, refresh_mode, cache_ttl_seconds)
                    SELECT owner_id, name || ' (사본)', description, datasource_id, define_mode, sql_query, builder_config,
                           chart_type, options, refresh_mode, cache_ttl_seconds
                      FROM mc_chart WHERE id=?
                    RETURNING id
                    """, Long.class, id);
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
        }
        // 원본 캐시가 있으면 재실행 없이 복사
        jdbc.update("""
                INSERT INTO mc_chart_cache(chart_id, result, computed_at, elapsed_ms, row_count)
                SELECT ?, result, computed_at, elapsed_ms, row_count FROM mc_chart_cache WHERE chart_id=?
                ON CONFLICT (chart_id) DO NOTHING
                """, newId, id);
        return get(newId);
    }

    private Map<String, Object> summary(ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getLong("id"));
        m.put("name", rs.getString("name"));
        m.put("description", rs.getString("description"));
        m.put("chartType", rs.getString("chart_type"));
        m.put("datasourceId", rs.getLong("datasource_id"));
        m.put("updatedAt", timestampString(rs.getTimestamp("updated_at")));
        return m;
    }

    private Map<String, Object> detail(ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> m = summary(rs);
        m.put("defineMode", rs.getString("define_mode"));
        m.put("sqlQuery", rs.getString("sql_query"));
        m.put("builderConfig", readJson(rs.getString("builder_config")));
        m.put("options", readJson(rs.getString("options")));
        m.put("refreshMode", rs.getString("refresh_mode"));
        m.put("cacheTtlSeconds", rs.getInt("cache_ttl_seconds"));
        m.put("createdAt", timestampString(rs.getTimestamp("created_at")));
        return m;
    }

    private String json(Object value) {
        try {
            return mapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JSON", e.getMessage());
        }
    }

    private Map<String, Object> readJson(String value) {
        try {
            return mapper.readValue(value, new TypeReference<>() {
            });
        } catch (Exception e) {
            return Map.of();
        }
    }

    private static long number(Object value) {
        return ((Number) value).longValue();
    }

    private static String timestampString(Timestamp ts) {
        return Instant.ofEpochMilli(ts.getTime()).toString();
    }
}
