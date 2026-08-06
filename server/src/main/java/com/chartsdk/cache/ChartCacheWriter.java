package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;

/** Performs only the short, version-fenced metadata write for a prepared cache payload. */
@Service
public class ChartCacheWriter {
    private final JdbcTemplate jdbc;

    public ChartCacheWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Instant upsert(long chartId, String payload, QueryRows rows, int definitionVersion) {
        assertCurrentDefinition(chartId, definitionVersion);
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
                """, chartId, payload, Timestamp.from(computedAt), rows.elapsedMs(), rows.rowCount(), definitionVersion);
        return computedAt;
    }

    private void assertCurrentDefinition(long chartId, int expectedVersion) {
        Integer currentVersion = jdbc.query("SELECT version FROM mc_chart WHERE id=? FOR SHARE", rs ->
                rs.next() ? rs.getInt("version") : null, chartId);
        if (currentVersion == null) {
            throw new StaleChartDefinitionException(chartId, expectedVersion, -1);
        }
        if (currentVersion != expectedVersion) {
            throw new StaleChartDefinitionException(chartId, expectedVersion, currentVersion);
        }
    }
}
