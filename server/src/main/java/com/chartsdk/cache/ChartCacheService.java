package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

@Service
public class ChartCacheService {
    private final JdbcTemplate jdbc;
    private final CachedChartPayloadCodec codec;

    public ChartCacheService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.codec = new CachedChartPayloadCodec(mapper);
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
            CachedChartPayloadCodec.Decoded payload = codec.read(rs.getString("result"));
            return payload == null ? Optional.empty()
                    : Optional.of(new CachedChartRows(payload.rows(), computedAt, payload.sampling())); // 깨진 캐시 = 미스(G7)
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
            CachedChartPayloadCodec.Decoded payload = codec.read(rs.getString("result"));
            return payload == null ? Optional.empty()
                    : Optional.of(new CachedChartRows(payload.rows(), computedAt, payload.sampling())); // 깨진 캐시 = 미스(G7)
        }, chartId);
    }

    public CachedChartRows upsert(long chartId, QueryRows rows, int definitionVersion, SamplingMetadata sampling) {
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
                """, chartId, codec.write(rows, sampling), Timestamp.from(computedAt), rows.elapsedMs(), rows.rowCount(), definitionVersion);
        return new CachedChartRows(rows, computedAt, sampling);
    }

    /** 기존 호출부 호환 — 표본이 아닌 raw SQL 차트 등은 sampling=null. */
    public CachedChartRows upsert(long chartId, QueryRows rows, int definitionVersion) {
        return upsert(chartId, rows, definitionVersion, null);
    }
}
