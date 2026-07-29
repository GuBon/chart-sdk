package com.chartsdk.chart;

import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.web.ApiException;
import com.chartsdk.web.dto.ChartSaveRequest;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class ChartRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ChartRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Map<String, Object> list(Long ownerId, ChartListQuery query) {
        StringBuilder where = new StringBuilder(" FROM mc_chart WHERE 1=1");
        java.util.ArrayList<Object> params = new java.util.ArrayList<>();
        appendOwnerScope(where, params, ownerId);
        if (query.q() != null && !query.q().isBlank()) {
            where.append(" AND (name ILIKE ? OR description ILIKE ?)");
            params.add("%" + query.q() + "%");
            params.add("%" + query.q() + "%");
        }
        if (query.type() != null && !query.type().isBlank()) {
            where.append(" AND chart_type=?");
            params.add(query.type());
        }
        if (query.datasourceId() != null) {
            // 조인의 보조 소스로 참조한 차트도 데이터소스 화면에 포함한다.
            where.append(" AND EXISTS (SELECT 1 FROM mc_chart_datasource mcd WHERE mcd.chart_id=mc_chart.id AND mcd.datasource_id=?)");
            params.add(query.datasourceId());
        }
        if (query.hasSchema()) {
            // 데이터소스 범위와 동일하게 기준 관계와 joins[].table의 보조 관계를 모두 포함한다.
            where.append("""
                     AND EXISTS (
                         SELECT 1
                           FROM (
                               SELECT mc_chart.builder_config->'table' AS table_ref
                               UNION ALL
                               SELECT join_item->'table'
                                 FROM jsonb_array_elements(
                                     CASE
                                         WHEN jsonb_typeof(mc_chart.builder_config->'joins')='array'
                                         THEN mc_chart.builder_config->'joins'
                                         ELSE '[]'::jsonb
                                     END
                                 ) AS join_item
                           ) AS chart_ref
                          WHERE chart_ref.table_ref IS NOT NULL
                """);
            if (query.datasourceId() != null) {
                where.append(" AND COALESCE(NULLIF(chart_ref.table_ref->>'datasourceId', '')::bigint, mc_chart.datasource_id)=?");
                params.add(query.datasourceId());
            }
            where.append(" AND COALESCE(chart_ref.table_ref->>'schema', 'public')=?");
            params.add(query.relationSchema());
            if (query.hasRelation()) {
                where.append(" AND chart_ref.table_ref->>'name'=?");
                params.add(query.relation());
            }
            where.append(")");
        }

        int safePageSize = query.resolvedPageSize();
        int total = count(where, params);
        int totalPages = total == 0 ? 1 : (int) Math.ceil((double) total / safePageSize);
        int safePage = query.resolvedPage(totalPages);

        StringBuilder sql = new StringBuilder("""
                SELECT id, name, description, chart_type, datasource_id, builder_config::text, updated_at,
                       (SELECT ds.name
                          FROM mc_datasource ds
                         WHERE ds.id=COALESCE(NULLIF(mc_chart.builder_config->'table'->>'datasourceId', '')::bigint,
                                              mc_chart.datasource_id)) AS datasource_name
                """);
        sql.append(where);
        sql.append(" ORDER BY ").append(orderBy(query.sort()));
        sql.append(" LIMIT ? OFFSET ?");

        java.util.ArrayList<Object> queryParams = new java.util.ArrayList<>(params);
        queryParams.add(safePageSize);
        queryParams.add((safePage - 1) * safePageSize);

        List<Map<String, Object>> charts = jdbc.query(sql.toString(), (rs, rowNum) -> summary(rs), queryParams.toArray());
        return Map.of(
                "charts", charts,
                "page", safePage,
                "pageSize", safePageSize,
                "total", total,
                "totalPages", totalPages
        );
    }

    public Map<String, Object> get(Long ownerId, long id) {
        StringBuilder sql = new StringBuilder("""
                SELECT mc_chart.*,
                       (SELECT ds.name
                          FROM mc_datasource ds
                         WHERE ds.id=COALESCE(NULLIF(mc_chart.builder_config->'table'->>'datasourceId', '')::bigint,
                                              mc_chart.datasource_id)) AS datasource_name
                  FROM mc_chart
                 WHERE id=?
                """);
        java.util.ArrayList<Object> params = new java.util.ArrayList<>();
        params.add(id);
        appendOwnerScope(sql, params, ownerId);
        return jdbc.query(sql.toString(), rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
            return detail(rs);
        }, params.toArray());
    }

    public Long create(Long ownerId, ChartSaveRequest input) {
        return jdbc.queryForObject("""
                INSERT INTO mc_chart(owner_id, name, description, datasource_id, define_mode, sql_query, builder_config, chart_type, options, refresh_mode, cache_ttl_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb, ?, ?)
                RETURNING id
                """, Long.class,
                ownerId,
                input.name(),
                input.description(),
                input.datasourceId(),
                valueOrDefault(input.defineMode(), "builder"),
                valueOrDefault(input.sqlQuery(), "SELECT 1"),
                json(input.builderConfig()),
                valueOrDefault(input.chartType(), "bar"),
                json(valueOrDefault(input.options(), Map.of())),
                valueOrDefault(input.refreshMode(), "ttl"),
                valueOrDefault(input.cacheTtlSeconds(), 3600));
    }

    /** 수정 성공 시 증가된 정의 버전, 소유자/낙관적 락 불일치 시 null을 반환한다. */
    public Integer update(Long ownerId, long id, ChartSaveRequest input) {
        Integer expectedVersion = input.version();
        StringBuilder sql = new StringBuilder("""
                UPDATE mc_chart
                   SET name=?, description=?, datasource_id=?, define_mode=?, sql_query=?, builder_config=?::jsonb,
                       chart_type=?, options=?::jsonb, refresh_mode=?, cache_ttl_seconds=?, version=version+1
                 WHERE id=?
                """);
        java.util.ArrayList<Object> args = new java.util.ArrayList<>();
        args.add(input.name());
        args.add(input.description());
        args.add(input.datasourceId());
        args.add(valueOrDefault(input.defineMode(), "builder"));
        args.add(valueOrDefault(input.sqlQuery(), "SELECT 1"));
        args.add(json(input.builderConfig()));
        args.add(valueOrDefault(input.chartType(), "bar"));
        args.add(json(valueOrDefault(input.options(), Map.of())));
        args.add(valueOrDefault(input.refreshMode(), "ttl"));
        args.add(valueOrDefault(input.cacheTtlSeconds(), 3600));
        args.add(id);
        appendOwnerScope(sql, args, ownerId);
        if (expectedVersion != null) {
            sql.append(" AND version=?");
            args.add(expectedVersion);
        }
        sql.append(" RETURNING version");
        return jdbc.query(sql.toString(), rs -> rs.next() ? rs.getInt("version") : null, args.toArray());
    }

    public boolean exists(Long ownerId, long id) {
        StringBuilder sql = new StringBuilder("SELECT count(*) FROM mc_chart WHERE id=?");
        java.util.ArrayList<Object> params = new java.util.ArrayList<>();
        params.add(id);
        appendOwnerScope(sql, params, ownerId);
        Integer exists = jdbc.queryForObject(sql.toString(), Integer.class, params.toArray());
        return exists != null && exists > 0;
    }

    public void delete(Long ownerId, long id) {
        StringBuilder sql = new StringBuilder("DELETE FROM mc_chart WHERE id=?");
        java.util.ArrayList<Object> params = new java.util.ArrayList<>();
        params.add(id);
        appendOwnerScope(sql, params, ownerId);
        jdbc.update(sql.toString(), params.toArray());
    }

    public Long duplicate(Long ownerId, long id) {
        try {
            StringBuilder sql = new StringBuilder("""
                    INSERT INTO mc_chart(owner_id, name, description, datasource_id, define_mode, sql_query, builder_config,
                                         chart_type, options, refresh_mode, cache_ttl_seconds)
                    SELECT owner_id, name || ' (?щ낯)', description, datasource_id, define_mode, sql_query, builder_config,
                           chart_type, options, refresh_mode, cache_ttl_seconds
                      FROM mc_chart WHERE id=?
                    """);
            java.util.ArrayList<Object> params = new java.util.ArrayList<>();
            params.add(id);
            appendOwnerScope(sql, params, ownerId);
            sql.append(" RETURNING id");
            return jdbc.queryForObject(sql.toString(), Long.class, params.toArray());
        } catch (org.springframework.dao.EmptyResultDataAccessException e) {
            throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
        }
    }

    /** 차트가 참조하는 데이터소스 집합을 junction 에 반영(교체). 저장 시 호출(설계 §12.1). */
    public void setChartDatasources(long chartId, java.util.Set<Long> datasourceIds) {
        jdbc.update("DELETE FROM mc_chart_datasource WHERE chart_id=?", chartId);
        for (Long ds : datasourceIds) {
            jdbc.update("INSERT INTO mc_chart_datasource(chart_id, datasource_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
                    chartId, ds);
        }
    }

    /** 차트가 참조하는 데이터소스 집합. stored SQL 실행 라우팅(단일 vs 페더레이션)에 쓴다. */
    public java.util.Set<Long> chartDatasources(long chartId) {
        return new java.util.LinkedHashSet<>(
                jdbc.queryForList("SELECT datasource_id FROM mc_chart_datasource WHERE chart_id=?", Long.class, chartId));
    }

    public void copyCache(long newId, long originalId) {
        jdbc.update("""
                INSERT INTO mc_chart_cache(chart_id, result, computed_at, elapsed_ms, row_count, definition_version)
                SELECT ?, result, computed_at, elapsed_ms, row_count, 0
                  FROM mc_chart_cache
                 WHERE chart_id=? AND result IS NOT NULL
                ON CONFLICT (chart_id) DO NOTHING
                """, newId, originalId);
    }

    public ChartDefinition previewDefinition(Long ownerId, long id) {
        StringBuilder sql = new StringBuilder("""
                SELECT id, datasource_id, sql_query, chart_type, options::text, builder_config::text,
                       refresh_mode, cache_ttl_seconds, version
                  FROM mc_chart
                 WHERE id=?
                """);
        java.util.ArrayList<Object> params = new java.util.ArrayList<>();
        params.add(id);
        appendOwnerScope(sql, params, ownerId);
        return jdbc.query(sql.toString(), rs -> {
            if (!rs.next()) throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
            return new ChartDefinition(
                    rs.getLong("id"),
                    rs.getLong("datasource_id"),
                    rs.getString("sql_query"),
                    rs.getString("chart_type"),
                    readJson(rs.getString("options")),
                    readJson(rs.getString("builder_config")),
                    rs.getString("refresh_mode"),
                    rs.getInt("cache_ttl_seconds"),
                    rs.getInt("version"),
                    SamplingMetadata.fromBuilderConfig(readJson(rs.getString("builder_config")))
            );
        }, params.toArray());
    }

    private static void appendOwnerScope(StringBuilder sql, List<Object> params, Long ownerId) {
        if (ownerId == null) return;
        sql.append(" AND (owner_id=? OR owner_id IS NULL)");
        params.add(ownerId);
    }

    private Map<String, Object> summary(ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getLong("id"));
        m.put("name", rs.getString("name"));
        m.put("description", rs.getString("description"));
        m.put("chartType", rs.getString("chart_type"));
        m.put("datasourceId", rs.getLong("datasource_id"));
        m.put("mainTable", mainTable(
                readJson(rs.getString("builder_config")),
                rs.getLong("datasource_id"),
                rs.getString("datasource_name")
        ));
        m.put("updatedAt", timestampString(rs.getTimestamp("updated_at")));
        return m;
    }

    private static Map<String, Object> mainTable(Map<String, Object> builderConfig, long fallbackDatasourceId,
                                                  String datasourceName) {
        Object raw = builderConfig.get("table");
        if (raw instanceof Map<?, ?> table) {
            Object rawDatasourceId = table.get("datasourceId");
            long datasourceId = rawDatasourceId instanceof Number n ? n.longValue() : fallbackDatasourceId;
            String schema = table.get("schema") instanceof String s && !s.isBlank() ? s : "public";
            Object name = table.get("name");
            if (name instanceof String s && !s.isBlank()) {
                return Map.of(
                        "datasourceId", datasourceId,
                        "datasourceName", datasourceName,
                        "schema", schema,
                        "name", s
                );
            }
        }
        if (raw instanceof String relation && !relation.isBlank()) {
            int separator = relation.indexOf('.');
            String schema = separator < 0 ? "public" : relation.substring(0, separator);
            String name = separator < 0 ? relation : relation.substring(separator + 1);
            return Map.of(
                    "datasourceId", fallbackDatasourceId,
                    "datasourceName", datasourceName,
                    "schema", schema,
                    "name", name
            );
        }
        return null;
    }

    private Map<String, Object> detail(ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> m = summary(rs);
        m.put("defineMode", rs.getString("define_mode"));
        m.put("sqlQuery", rs.getString("sql_query"));
        m.put("builderConfig", readJson(rs.getString("builder_config")));
        m.put("options", readJson(rs.getString("options")));
        m.put("refreshMode", rs.getString("refresh_mode"));
        m.put("cacheTtlSeconds", rs.getInt("cache_ttl_seconds"));
        m.put("version", rs.getInt("version"));
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

    private static <T> T valueOrDefault(T value, T fallback) {
        return value == null ? fallback : value;
    }

    private static String timestampString(Timestamp ts) {
        return Instant.ofEpochMilli(ts.getTime()).toString();
    }

    private int count(StringBuilder where, List<Object> params) {
        Integer total = jdbc.queryForObject("SELECT count(*)" + where, Integer.class, params.toArray());
        return total == null ? 0 : total;
    }

    private static String orderBy(String sort) {
        return switch (sort == null ? "updated_desc" : sort) {
            case "updated_asc" -> "updated_at ASC, id ASC";
            case "name_asc" -> "lower(name) ASC, id ASC";
            case "name_desc" -> "lower(name) DESC, id DESC";
            default -> "updated_at DESC, id DESC";
        };
    }
}
