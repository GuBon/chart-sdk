package com.chartsdk.cache;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/** Short metadata-DB operations for coordinating refreshes across application instances. */
@Repository
public class ChartRefreshLeaseRepository {
    private final JdbcTemplate jdbc;

    public ChartRefreshLeaseRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<String> tryAcquire(long chartId, int definitionVersion, int leaseSeconds) {
        String token = UUID.randomUUID().toString();
        String acquired = jdbc.query("""
                INSERT INTO mc_chart_refresh_lease(chart_id, definition_version, lease_token, expires_at)
                VALUES (?, ?, ?::uuid, now() + (? * INTERVAL '1 second'))
                ON CONFLICT (chart_id) DO UPDATE
                    SET definition_version=EXCLUDED.definition_version,
                        lease_token=EXCLUDED.lease_token,
                        expires_at=EXCLUDED.expires_at
                  WHERE mc_chart_refresh_lease.expires_at <= now()
                     OR mc_chart_refresh_lease.definition_version <> EXCLUDED.definition_version
                RETURNING lease_token::text
                """, rs -> rs.next() ? rs.getString(1) : null,
                chartId, definitionVersion, token, leaseSeconds);
        return Optional.ofNullable(acquired);
    }

    public void release(long chartId, String token) {
        jdbc.update("DELETE FROM mc_chart_refresh_lease WHERE chart_id=? AND lease_token=?::uuid",
                chartId, token);
    }
}
