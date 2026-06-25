package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

@Service
public class ChartCacheService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ChartCacheService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Optional<CachedChartRows> findUsable(long chartId, String refreshMode, int ttlSeconds, int currentVersion) {
        if ("live".equals(refreshMode)) return Optional.empty();
        return jdbc.query("""
                SELECT result::text, computed_at, definition_version
                  FROM mc_chart_cache
                 WHERE chart_id=?
                """, rs -> {
            if (!rs.next()) return Optional.empty();
            // 정의 버전 불일치(또는 미상) → stale (정의≠데이터 방지, G2)
            int cachedVersion = rs.getInt("definition_version");
            if (rs.wasNull() || cachedVersion != currentVersion) return Optional.empty();
            Instant computedAt = rs.getTimestamp("computed_at").toInstant();
            if ("ttl".equals(refreshMode) && computedAt.plusSeconds(ttlSeconds).isBefore(Instant.now())) {
                return Optional.empty();
            }
            return Optional.of(new CachedChartRows(readRows(rs.getString("result")), computedAt));
        }, chartId);
    }

    /** ttl·refresh_mode 무시하고 마지막 성공 결과(stale 포함)를 그대로 반환 — SWR 의 stale 반환용. */
    public Optional<CachedChartRows> find(long chartId) {
        return jdbc.query("""
                SELECT result::text, computed_at
                  FROM mc_chart_cache
                 WHERE chart_id=?
                """, rs -> {
            if (!rs.next()) return Optional.empty();
            Instant computedAt = rs.getTimestamp("computed_at").toInstant();
            return Optional.of(new CachedChartRows(readRows(rs.getString("result")), computedAt));
        }, chartId);
    }

    public CachedChartRows upsert(long chartId, QueryRows rows, int definitionVersion) {
        Instant computedAt = Instant.now();
        jdbc.update("""
                INSERT INTO mc_chart_cache(chart_id, result, computed_at, elapsed_ms, row_count, definition_version, last_error, last_error_at)
                VALUES (?, ?::jsonb, ?, ?, ?, ?, NULL, NULL)
                ON CONFLICT (chart_id) DO UPDATE
                    SET result=EXCLUDED.result,
                        computed_at=EXCLUDED.computed_at,
                        elapsed_ms=EXCLUDED.elapsed_ms,
                        row_count=EXCLUDED.row_count,
                        definition_version=EXCLUDED.definition_version,
                        last_error=NULL,
                        last_error_at=NULL
                """, chartId, writeRows(rows), Timestamp.from(computedAt), rows.elapsedMs(), rows.rowCount(), definitionVersion);
        return new CachedChartRows(rows, computedAt);
    }

    private String writeRows(QueryRows rows) {
        try {
            return mapper.writeValueAsString(Map.of(
                    "columns", rows.columns(),
                    "rows", rows.rows(),
                    "rowCount", rows.rowCount(),
                    "truncated", rows.truncated(),
                    "elapsedMs", rows.elapsedMs()
            ));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private QueryRows readRows(String json) {
        try {
            Map<String, Object> result = mapper.readValue(json, new TypeReference<>() {
            });
            return mapper.convertValue(result, QueryRows.class);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
