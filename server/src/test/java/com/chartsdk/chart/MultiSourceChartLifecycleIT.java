package com.chartsdk.chart;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import com.chartsdk.web.dto.ChartSaveRequest;
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
import java.util.List;
import java.util.Map;

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
                "yAxis", List.of(Map.of("column", "exercise_logs.calories_burned", "agg", "sum", "alias", "cal")));
        ChartSaveRequest req = new ChartSaveRequest(
                "멀티소스 IT", null, tId, "builder", null, cfg, "bar", Map.of(), null, null, null);

        Map<String, Object> created = chartService.create(req);
        long chartId = ((Number) created.get("id")).longValue();

        // 1) junction — 두 소스가 기록된다(§12.1).
        assertThat(meta.queryForObject(
                "SELECT count(*) FROM mc_chart_datasource WHERE chart_id=?", Integer.class, chartId)).isEqualTo(2);
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

    private long insertDatasource(String name, String host, int port, String db, String user, String pass) {
        Long id = meta.queryForObject("""
                INSERT INTO mc_datasource(name, host, port, database_name, db_user, db_password_enc, max_pool_size)
                VALUES (?,?,?,?,?,?,5) RETURNING id
                """, Long.class, name, host, port, db, user, codec.encrypt(pass));
        return id;
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
