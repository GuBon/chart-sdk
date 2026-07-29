package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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

    public Optional<CachedChartRows> findUsable(long chartId, String refreshMode, int ttlSeconds,
                                                int currentVersion, SamplingMetadata sampling) {
        if ("live".equals(refreshMode)) return Optional.empty();
        return jdbc.query("""
                SELECT result::text, computed_at, definition_version
                  FROM mc_chart_cache
                 WHERE chart_id=?
                """, rs -> {
            if (!rs.next()) return Optional.empty();
            Optional<CachedChartRows> compatible = decodeCompatible(
                    rs.getString("result"),
                    rs.getTimestamp("computed_at"),
                    rs.getObject("definition_version", Integer.class),
                    currentVersion,
                    sampling
            );
            if (compatible.isEmpty()) return Optional.empty();
            Instant computedAt = compatible.get().computedAt();
            if ("ttl".equals(refreshMode) && computedAt.plusSeconds(ttlSeconds).isBefore(Instant.now())) {
                return Optional.empty();
            }
            return compatible;
        }, chartId);
    }

    /**
     * TTL만 무시하고 현재 정의·표본 계약과 호환되는 마지막 성공 결과를 반환한다.
     * 데이터 시각이 오래된 stale은 허용하지만 정의가 오래된 결과는 절대 반환하지 않는다.
     */
    public Optional<CachedChartRows> findCompatible(long chartId, int currentVersion, SamplingMetadata sampling) {
        return jdbc.query("""
                SELECT result::text, computed_at, definition_version
                  FROM mc_chart_cache
                 WHERE chart_id=?
                """, rs -> {
            if (!rs.next()) return Optional.empty();
            return decodeCompatible(
                    rs.getString("result"),
                    rs.getTimestamp("computed_at"),
                    rs.getObject("definition_version", Integer.class),
                    currentVersion,
                    sampling
            );
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

    /**
     * 마지막 성공 결과는 그대로 둔 채 최신 재계산 실패만 기록한다.
     * 성공 결과가 아직 없는 최초 시드 실패도 남길 수 있도록 V5부터 error-only 행을 허용한다.
     * 단일 비행 트랜잭션이 롤백돼도 진단 정보는 보존돼야 하므로 독립 트랜잭션으로 기록한다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(long chartId, Throwable failure) {
        Instant failedAt = Instant.now();
        jdbc.update("""
                INSERT INTO mc_chart_cache(chart_id, result, computed_at, elapsed_ms, row_count,
                                           definition_version, last_error, last_error_at)
                VALUES (?, NULL, NULL, NULL, NULL, NULL, ?, ?)
                ON CONFLICT (chart_id) DO UPDATE
                    SET last_error=EXCLUDED.last_error,
                        last_error_at=EXCLUDED.last_error_at
                """, chartId, failureMessage(failure), Timestamp.from(failedAt));
    }

    private Optional<CachedChartRows> decodeCompatible(String json, Timestamp computedAt,
                                                       Integer cachedVersion, int currentVersion,
                                                       SamplingMetadata sampling) {
        // error-only 행, 정의 버전 불일치(또는 미상), 깨진 payload는 모두 캐시 미스다.
        if (json == null || computedAt == null || cachedVersion == null || cachedVersion != currentVersion) {
            return Optional.empty();
        }
        CachedChartPayloadCodec.Decoded payload = codec.read(json);
        if (payload == null || payload.rows().truncated()) return Optional.empty();
        if (sampling == null && payload.sampling() != null) return Optional.empty();
        if (sampling != null && (payload.sampling() == null || !payload.sampling().matchesDefinition(sampling))) {
            return Optional.empty();
        }
        return Optional.of(new CachedChartRows(payload.rows(), computedAt.toInstant(), payload.sampling()));
    }

    private static String failureMessage(Throwable failure) {
        String message = failure == null ? null : failure.getMessage();
        if (message == null || message.isBlank()) {
            message = failure == null ? "Unknown cache refresh failure" : failure.getClass().getSimpleName();
        }
        message = message.replace('\0', ' ').strip();
        return message.length() <= 2_000 ? message : message.substring(0, 2_000);
    }
}
