package com.chartsdk.cache;

import com.chartsdk.datasource.DatasourceRuntimeVersions;
import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
public class ChartCacheService {
    private final JdbcTemplate jdbc;
    private final CachedChartPayloadCodec codec;
    private final ChartCacheWriter writer;
    private final DatasourceRuntimeVersions runtimeVersions;

    public ChartCacheService(JdbcTemplate jdbc, ObjectMapper mapper, ChartCacheWriter writer,
                             DatasourceRuntimeVersions runtimeVersions) {
        this.jdbc = jdbc;
        this.codec = new CachedChartPayloadCodec(mapper);
        this.writer = writer;
        this.runtimeVersions = runtimeVersions;
    }

    /** live는 항상 재계산해야 하므로 스냅샷을 보지 않는다. 그 외에는 {@link #findCompatible}과 같다. */
    public Optional<CachedChartRows> findUsable(long chartId, String refreshMode,
                                                int currentVersion, SamplingMetadata sampling) {
        if ("live".equals(refreshMode)) return Optional.empty();
        return findCompatible(chartId, currentVersion, sampling);
    }

    /**
     * 현재 정의·표본 계약과 호환되는 마지막 성공 스냅샷을 반환한다.
     * 계산 시각과 무관하게 수동 스냅샷은 유지하지만 정의가 오래된 결과는 절대 반환하지 않는다.
     */
    public Optional<CachedChartRows> findCompatible(long chartId, int currentVersion, SamplingMetadata sampling) {
        return runtimeVersions.withBlockedCacheDatasources(blocked ->
                chartReferencesBlockedDatasource(chartId, blocked)
                        ? Optional.empty()
                        : findCompatibleStored(chartId, currentVersion, sampling));
    }

    private Optional<CachedChartRows> findCompatibleStored(long chartId, int currentVersion,
                                                            SamplingMetadata sampling) {
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

    /** Loads every compatible snapshot for a chart-list page in one database round trip. */
    public Map<Long, CachedChartRows> findCompatible(Map<Long, ChartCacheExpectation> expectations) {
        if (expectations == null || expectations.isEmpty()) return Map.of();
        return runtimeVersions.withBlockedCacheDatasources(blocked -> {
            Map<Long, ChartCacheExpectation> accessible = accessibleExpectations(expectations, blocked);
            return findCompatibleStored(accessible);
        });
    }

    private Map<Long, CachedChartRows> findCompatibleStored(
            Map<Long, ChartCacheExpectation> expectations) {
        if (expectations.isEmpty()) return Map.of();
        String placeholders = String.join(", ", java.util.Collections.nCopies(expectations.size(), "?"));
        String sql = "SELECT chart_id, result::text, computed_at, definition_version"
                + " FROM mc_chart_cache WHERE chart_id IN (" + placeholders + ")";
        return jdbc.query(sql, rs -> {
            Map<Long, CachedChartRows> compatible = new LinkedHashMap<>();
            while (rs.next()) {
                long chartId = rs.getLong("chart_id");
                ChartCacheExpectation expectation = expectations.get(chartId);
                if (expectation == null) continue;
                try {
                    decodeCompatible(
                            rs.getString("result"),
                            rs.getTimestamp("computed_at"),
                            rs.getObject("definition_version", Integer.class),
                            expectation.definitionVersion(),
                            expectation.sampling()
                    ).ifPresent(rows -> compatible.put(chartId, rows));
                } catch (RuntimeException ignored) {
                    // One corrupt legacy payload must not hide every other card in the batch.
                }
            }
            return compatible;
        }, expectations.keySet().toArray());
    }

    public CachedChartRows upsert(long chartId, QueryRows rows, int definitionVersion, SamplingMetadata sampling) {
        return runtimeVersions.withBlockedCacheDatasources(blocked -> {
            Instant computedAt = Instant.now();
            if (!chartReferencesBlockedDatasource(chartId, blocked)) {
                String payload = codec.write(rows, sampling);
                computedAt = writer.upsert(chartId, payload, rows, definitionVersion);
            }
            return new CachedChartRows(rows, computedAt, sampling);
        });
    }

    /**
     * 마지막 성공 결과는 그대로 둔 채 최신 재계산 실패만 기록한다.
     * 성공 결과가 아직 없는 최초 시드 실패도 남길 수 있도록 V5부터 error-only 행을 허용한다.
     * 단일 비행 트랜잭션이 롤백돼도 진단 정보는 보존돼야 하므로 독립 트랜잭션으로 기록한다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(long chartId, int definitionVersion, Throwable failure) {
        runtimeVersions.withBlockedCacheDatasources(blocked -> {
            if (!chartReferencesBlockedDatasource(chartId, blocked)) {
                recordFailureStored(chartId, definitionVersion, failure);
            }
            return null;
        });
    }

    private void recordFailureStored(long chartId, int definitionVersion, Throwable failure) {
        if (!isCurrentDefinition(chartId, definitionVersion)) return;
        Instant failedAt = Instant.now();
        jdbc.update("""
                INSERT INTO mc_chart_cache(chart_id, result, computed_at, elapsed_ms, row_count,
                                           definition_version, last_error, last_error_at)
                SELECT ?, NULL, NULL, NULL, NULL, ?, ?, ?
                 WHERE EXISTS (SELECT 1 FROM mc_chart WHERE id=? AND version=?)
                ON CONFLICT (chart_id) DO UPDATE
                    SET last_error=EXCLUDED.last_error,
                        last_error_at=EXCLUDED.last_error_at
                 WHERE EXISTS (SELECT 1 FROM mc_chart WHERE id=EXCLUDED.chart_id
                                AND version=EXCLUDED.definition_version)
                """, chartId, definitionVersion, failureMessage(failure), Timestamp.from(failedAt),
                chartId, definitionVersion);
    }

    private boolean chartReferencesBlockedDatasource(long chartId, Set<Long> blockedDatasourceIds) {
        if (blockedDatasourceIds.isEmpty()) return false;
        String placeholders = String.join(", ", Collections.nCopies(blockedDatasourceIds.size(), "?"));
        ArrayList<Object> arguments = new ArrayList<>();
        arguments.add(chartId);
        arguments.addAll(blockedDatasourceIds);
        Boolean blocked = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM mc_chart_datasource"
                        + " WHERE chart_id=? AND datasource_id IN (" + placeholders + "))",
                Boolean.class, arguments.toArray());
        return Boolean.TRUE.equals(blocked);
    }

    private Map<Long, ChartCacheExpectation> accessibleExpectations(
            Map<Long, ChartCacheExpectation> expectations, Set<Long> blockedDatasourceIds) {
        if (blockedDatasourceIds.isEmpty()) return expectations;
        String chartPlaceholders = String.join(", ", Collections.nCopies(expectations.size(), "?"));
        String datasourcePlaceholders = String.join(", ", Collections.nCopies(blockedDatasourceIds.size(), "?"));
        ArrayList<Object> arguments = new ArrayList<>(expectations.keySet());
        arguments.addAll(blockedDatasourceIds);
        Set<Long> blockedCharts = Set.copyOf(jdbc.queryForList(
                "SELECT DISTINCT chart_id FROM mc_chart_datasource"
                        + " WHERE chart_id IN (" + chartPlaceholders + ")"
                        + " AND datasource_id IN (" + datasourcePlaceholders + ")",
                Long.class, arguments.toArray()));
        if (blockedCharts.isEmpty()) return expectations;
        Map<Long, ChartCacheExpectation> accessible = new LinkedHashMap<>();
        expectations.forEach((chartId, expectation) -> {
            if (!blockedCharts.contains(chartId)) accessible.put(chartId, expectation);
        });
        return accessible;
    }

    private boolean isCurrentDefinition(long chartId, int expectedVersion) {
        Integer currentVersion = jdbc.query("SELECT version FROM mc_chart WHERE id=? FOR SHARE", rs ->
                rs.next() ? rs.getInt("version") : null, chartId);
        return currentVersion != null && currentVersion == expectedVersion;
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
        SamplingMetadata compatibleSampling = payload.sampling() == null
                ? null : payload.sampling().toCurrentContract();
        return Optional.of(new CachedChartRows(payload.rows(), computedAt.toInstant(), compatibleSampling));
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
