package com.chartsdk.chart;

import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartCacheService;
import com.chartsdk.cache.ChartRefreshCoordinator;
import com.chartsdk.cache.SampleFingerprint;
import com.chartsdk.cache.SampleRowCacheService;
import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.crypto.DatasourcePasswordCodec;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.dto.ChartSaveRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Phase 4 딥 통합 — 다중 소스 차트의 저장→서빙 full-chain 을 전체 Spring 컨텍스트로 관통 검증(gap #1).
 * 5433 서버에 throwaway 메타 DB(chartsdk_it)를 새로 만들어 실 메타(chartsol)를 건드리지 않고, 실 소스
 * tandanji(15432)·docker(5433 chartsol_user)를 데이터소스로 등록해 실제 페더레이션 시드·서빙을 확인한다.
 * (Testcontainers 는 이 환경 Docker 엔진 비호환으로 사용 불가.)
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class MultiSourceChartLifecycleIT {

    @DynamicPropertySource
    static void metaDb(DynamicPropertyRegistry registry) {
        try (Connection c = DriverManager.getConnection("jdbc:postgresql://localhost:5433/postgres", "postgres", "0218");
             Statement s = c.createStatement()) {
            s.execute("DROP DATABASE IF EXISTS chartsdk_it WITH (FORCE)");
            s.execute("CREATE DATABASE chartsdk_it");
        } catch (Exception e) {
            throw new IllegalStateException("throwaway 메타 DB 생성 실패(5433 미가동?): " + e.getMessage(), e);
        }
        registry.add("spring.datasource.url", () -> "jdbc:postgresql://localhost:5433/chartsdk_it");
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "0218");
    }

    @Autowired ChartService chartService;
    @Autowired JdbcTemplate meta;
    @Autowired DatasourcePasswordCodec codec;
    @Autowired ChartRefreshCoordinator refreshes;
    @Autowired ChartCacheService cache;
    @Autowired SampleRowCacheService sampleRows;
    @Autowired ObjectMapper mapper;

    @Test
    void multiSourceV7SamplingSnapshotRemainsAvailableAndIsReturnedAsV9() throws Exception {
        long primaryId = insertDatasource(
                "it-v7-primary-" + System.nanoTime(), "localhost", 5433, "unused", "unused", "unused");
        long secondaryId = insertDatasource(
                "it-v7-secondary-" + System.nanoTime(), "localhost", 5433, "unused", "unused", "unused");
        Map<String, Object> builderConfig = Map.of(
                "table", Map.of("datasourceId", primaryId, "schema", "public", "name", "load_points"),
                "joins", List.of(),
                "xAxis", "x_value",
                "yAxis", List.of(Map.of("column", "y_value", "agg", "none")),
                "sample", Map.of("mode", "auto", "size", 10_000, "seed", 77));
        Long chartId = meta.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, builder_config, chart_type,
                                     refresh_mode)
                VALUES (?, ?, 'builder', 'SELECT 1', ?::jsonb, 'scatter', 'manual')
                RETURNING id
                """, Long.class, "v7-compatible-snapshot", primaryId, mapper.writeValueAsString(builderConfig));
        assertThat(chartId).isNotNull();
        meta.update("INSERT INTO mc_chart_datasource(chart_id, datasource_id) VALUES (?, ?)", chartId, primaryId);
        meta.update("INSERT INTO mc_chart_datasource(chart_id, datasource_id) VALUES (?, ?)", chartId, secondaryId);

        SamplingMetadata legacy = SamplingMetadata.fromMap(Map.of(
                "version", 7, "mode", "auto", "requestedMethod", "auto",
                "approximate", true, "method", "INDEX_RANDOM", "valueMode", "sample",
                "sizeTarget", 10_000, "seed", 77, "populationEstimate", 1_000_000,
                "sampleSize", 10_000));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("columns", List.of());
        payload.put("rows", List.of());
        payload.put("rowCount", 0);
        payload.put("truncated", false);
        payload.put("elapsedMs", 1);
        payload.put("sampling", legacy.toMap());
        meta.update("""
                INSERT INTO mc_chart_cache(chart_id, result, computed_at, elapsed_ms, row_count, definition_version)
                VALUES (?, ?::jsonb, now(), 1, 0, 0)
                """, chartId, mapper.writeValueAsString(payload));

        Map<String, Object> preview = chartService.preview(chartId);

        @SuppressWarnings("unchecked")
        Map<String, Object> sampling = (Map<String, Object>) preview.get("sampling");
        assertThat(sampling).containsEntry("version", SamplingMetadata.CONTRACT_VERSION);
        assertThat(sampling).containsEntry("method", "INDEX_RANDOM");
    }

    @Test
    void multiSourceChartSaveSeedsJunctionAndCacheThenServesSnapshot() {
        assumeTrue(reachable("127.0.0.1", 15432), "tandanji(15432) 미가동 — skip");

        long tId = insertDatasource("it-tandanji", "127.0.0.1", 15432, "tandanji", "tandanji", "tandanji");
        long dId = insertDatasource("it-docker", "localhost", 5433, "chartsol_user", "postgres", "0218");

        Map<String, Object> cfg = Map.of(
                "table", Map.of("datasourceId", tId, "schema", "tandanji", "name", "exercise_logs"),
                "joins", List.of(Map.of(
                        "table", Map.of("datasourceId", dId, "schema", "public", "name", "users"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "exercise_logs.user_id", "rightColumn", "users.id"))),
                "xAxis", "users.id",
                "yAxis", List.of(Map.of("column", "exercise_logs.calories_burned", "agg", "sum", "alias", "cal")),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 77));
        ChartSaveRequest req = new ChartSaveRequest(
                "멀티소스 IT", null, tId, "builder", null, cfg, "bar", Map.of(), null, null);

        Map<String, Object> created = chartService.create(req);
        long chartId = ((Number) created.get("id")).longValue();
        assertThat(created.get("mainTable")).isEqualTo(
                Map.of("datasourceId", tId, "datasourceName", "it-tandanji", "schema", "tandanji", "name", "exercise_logs"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> listed = (List<Map<String, Object>>) chartService
                .list(new ChartListQuery(null, null, null, null, null, null, 1, 12)).get("charts");
        assertThat(listed)
                .filteredOn(chart -> ((Number) chart.get("id")).longValue() == chartId)
                .singleElement()
                .extracting(chart -> chart.get("mainTable"))
                .isEqualTo(Map.of("datasourceId", tId, "datasourceName", "it-tandanji", "schema", "tandanji", "name", "exercise_logs"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> referencedBySecondarySource = (List<Map<String, Object>>) chartService
                .list(new ChartListQuery(null, null, dId, null, null, null, 1, 12)).get("charts");
        assertThat(referencedBySecondarySource)
                .extracting(chart -> ((Number) chart.get("id")).longValue())
                .contains(chartId);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> mainRelationCharts = (List<Map<String, Object>>) chartService
                .list(new ChartListQuery(null, null, tId, "tandanji", "exercise_logs", null, 1, 12)).get("charts");
        assertThat(mainRelationCharts)
                .extracting(chart -> ((Number) chart.get("id")).longValue())
                .contains(chartId);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> joinedSchemaCharts = (List<Map<String, Object>>) chartService
                .list(new ChartListQuery(null, null, dId, "public", null, null, 1, 12)).get("charts");
        assertThat(joinedSchemaCharts)
                .extracting(chart -> ((Number) chart.get("id")).longValue())
                .contains(chartId);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> joinedRelationCharts = (List<Map<String, Object>>) chartService
                .list(new ChartListQuery(null, null, dId, "public", "users", null, 1, 12)).get("charts");
        assertThat(joinedRelationCharts)
                .extracting(chart -> ((Number) chart.get("id")).longValue())
                .contains(chartId);

        meta.update("UPDATE mc_datasource SET name=? WHERE id=?", "it-tandanji-renamed", tId);
        assertThat(chartService.get(chartId).get("mainTable")).isEqualTo(
                Map.of("datasourceId", tId, "datasourceName", "it-tandanji-renamed", "schema", "tandanji", "name", "exercise_logs"));

        // 1) junction — 두 소스가 기록된다(§12.1).
        assertThat(meta.queryForObject(
                "SELECT count(*) FROM mc_chart_datasource WHERE chart_id=?", Integer.class, chartId)).isEqualTo(2);
        // JOIN + WHERE 이후 Bernoulli로 만든 역할 열만 L1에 저장한다.
        assertThat(meta.queryForObject(
                "SELECT count(*) FROM mc_sample_row_cache", Integer.class)).isEqualTo(1);
        assertThat(meta.queryForObject("""
                SELECT payload->'columns' @> '[{"name":"__chartsdk_x"}]'::jsonb
                   AND payload->'columns' @> '[{"name":"__chartsdk_y_0"}]'::jsonb
                  FROM mc_sample_row_cache
                """, Boolean.class)).isTrue();
        assertThat(sampleRows.find(
                SampleFingerprint.of(tId, Set.of(tId, dId), cfg, "bar"), 3_600)).isPresent();
        Map<String, Object> averageCfg = new LinkedHashMap<>(cfg);
        averageCfg.put("yAxis", List.of(Map.of(
                "column", "exercise_logs.calories_burned", "agg", "avg", "alias", "average_cal")));
        chartService.create(new ChartSaveRequest(
                "same L1, different aggregate", null, tId, "builder", null,
                averageCfg, "bar", Map.of(), null, null));
        assertThat(meta.queryForObject(
                "SELECT count(*) FROM mc_sample_row_cache", Integer.class)).isEqualTo(1);
        // 2) refresh_mode — 다중 소스는 스냅샷 → manual 로 고정(§7).
        assertThat(meta.queryForObject(
                "SELECT refresh_mode FROM mc_chart WHERE id=?", String.class, chartId)).isEqualTo("manual");
        // 3) 캐시 시드 — 저장 시 실제 페더레이션 계산이 캐시에 반영된다(§7.7).
        assertThat(meta.queryForObject(
                "SELECT count(*) FROM mc_chart_cache WHERE chart_id=?", Integer.class, chartId)).isEqualTo(1);
        // 4) 서빙 — 다중 소스 미리보기는 캐시 스냅샷을 반환한다(페더레이션 미호출, §8).
        Map<String, Object> preview = chartService.preview(chartId);
        assertThat(((Number) preview.get("rowCount")).intValue()).isGreaterThan(0);
        assertThat(preview.get("option")).isNotNull();
    }

    @Test
    void refreshLeaseRunsConcurrentRefreshOnlyOnce() throws Exception {
        long datasourceId = insertDatasource(
                "it-lock-" + System.nanoTime(), "localhost", 5433, "chartsdk_it", "postgres", "0218");
        Long chartId = meta.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, chart_type)
                VALUES (?, ?, 'sql', 'SELECT 1', 'bar')
                RETURNING id
                """, Long.class, "lock-test", datasourceId);
        assertThat(chartId).isNotNull();

        QueryRows queryRows = new QueryRows(List.of(), List.of(), 0, false, 1);
        CountDownLatch winnerEntered = new CountDownLatch(1);
        CountDownLatch followerEntered = new CountDownLatch(1);
        CountDownLatch releaseWinner = new CountDownLatch(1);
        AtomicInteger refreshCalls = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<CachedChartRows> winner = pool.submit(() -> refreshes.refreshSingleFlight(
                    chartId, 0, false, null, () -> {
                        refreshCalls.incrementAndGet();
                        winnerEntered.countDown();
                        await(releaseWinner);
                        return cache.upsert(chartId, queryRows, 0, null);
                    }));
            assertThat(winnerEntered.await(5, TimeUnit.SECONDS)).isTrue();

            Future<CachedChartRows> loser = pool.submit(() -> {
                followerEntered.countDown();
                return refreshes.refreshSingleFlight(chartId, 0, false, null, () -> {
                    refreshCalls.incrementAndGet();
                    return cache.upsert(chartId, queryRows, 0, null);
                });
            });

            assertThat(followerEntered.await(1, TimeUnit.SECONDS)).isTrue();
            assertThat(loser).isNotDone();
            assertThat(refreshCalls).hasValue(1);
            releaseWinner.countDown();

            CachedChartRows winnerResult = winner.get(5, TimeUnit.SECONDS);
            CachedChartRows loserResult = loser.get(5, TimeUnit.SECONDS);
            assertThat(refreshCalls).hasValue(1);
            // PostgreSQL timestamptz는 마이크로초 정밀도라 JVM Instant 나노초가 반올림될 수 있다.
            assertThat(java.time.Duration.between(
                    loserResult.computedAt(), winnerResult.computedAt()).abs())
                    .isLessThanOrEqualTo(java.time.Duration.ofNanos(1_000));
            assertThat(meta.queryForObject(
                    "SELECT count(*) FROM mc_chart_cache WHERE chart_id=?", Integer.class, chartId)).isEqualTo(1);
        } finally {
            releaseWinner.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void firstRefreshFailureIsRecordedAndNextSuccessClearsIt() {
        long datasourceId = insertDatasource(
                "it-failure-" + System.nanoTime(), "localhost", 5433, "chartsdk_it", "postgres", "0218");
        Long chartId = meta.queryForObject("""
                INSERT INTO mc_chart(name, datasource_id, define_mode, sql_query, chart_type)
                VALUES (?, ?, 'sql', 'SELECT 1', 'bar')
                RETURNING id
                """, Long.class, "failure-test", datasourceId);
        assertThat(chartId).isNotNull();

        cache.recordFailure(chartId, 0, new RuntimeException("source unavailable"));

        Map<String, Object> failureState = meta.queryForMap("""
                SELECT result, computed_at, last_error, last_error_at
                  FROM mc_chart_cache
                 WHERE chart_id=?
                """, chartId);
        assertThat(failureState)
                .containsEntry("result", null)
                .containsEntry("computed_at", null)
                .containsEntry("last_error", "source unavailable");
        assertThat(failureState.get("last_error_at")).isNotNull();

        cache.upsert(chartId, new QueryRows(List.of(), List.of(), 0, false, 1), 0, null);

        Map<String, Object> successState = meta.queryForMap("""
                SELECT result, computed_at, last_error, last_error_at
                  FROM mc_chart_cache
                 WHERE chart_id=?
                """, chartId);
        assertThat(successState.get("result")).isNotNull();
        assertThat(successState.get("computed_at")).isNotNull();
        assertThat(successState)
                .containsEntry("last_error", null)
                .containsEntry("last_error_at", null);
    }

    @Test
    void updateReturnsIncrementedVersionAndSeedsPreparedRowsWithThatVersion() {
        long datasourceId = insertDatasource(
                "it-update-" + System.nanoTime(), "localhost", 5433, "chartsdk_it", "postgres", "0218");
        ChartSaveRequest create = new ChartSaveRequest(
                "update-test", null, datasourceId, "sql", "SELECT 1 AS value",
                Map.of("table", "chart_value"), "bar", Map.of(), "manual", null);
        Map<String, Object> created = chartService.create(create);
        long chartId = ((Number) created.get("id")).longValue();
        assertThat(created.get("version")).isEqualTo(0);

        ChartSaveRequest update = new ChartSaveRequest(
                "update-test", null, datasourceId, "sql", "SELECT 2 AS value",
                Map.of("table", "chart_value"), "bar", Map.of(), "manual", 0);
        Map<String, Object> updated = chartService.update(chartId, update);

        assertThat(updated.get("version")).isEqualTo(1);
        assertThat(meta.queryForObject("""
                SELECT definition_version
                  FROM mc_chart_cache
                 WHERE chart_id=?
                """, Integer.class, chartId)).isEqualTo(1);
        assertThat(meta.queryForObject("""
                SELECT result->'rows'->0->>0
                  FROM mc_chart_cache
                 WHERE chart_id=?
                """, String.class, chartId)).isEqualTo("2");
    }

    private long insertDatasource(String name, String host, int port, String db, String user, String pass) {
        Long id = meta.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc, max_pool_size)
                VALUES (?,?,?,?,?,?,5) RETURNING id
                """, Long.class, name, host, port, db, user, codec.encrypt(pass));
        return id;
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("refresh lease test release timed out");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private static boolean reachable(String host, int port) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, port), 1000);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
