package com.chartsdk.federation;

import com.chartsdk.crypto.DatasourcePasswordCodec;
import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.SamplingPlanner;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Phase 3 통합 — 실제 가동 중인 메타 DB + 등록 데이터소스(tandanji, docker)로 실행 라우터({@link FederatedQueryRunner})를
 * 관통 검증한다. 다중 소스는 DuckDB 페더레이션으로, 단일 소스는 PG 직접 경로로 라우팅됨을 실 데이터로 확인.
 *
 * <p>Testcontainers 는 이 환경의 Docker 엔진(29.x) ↔ Testcontainers 번들 docker-java 비호환(HTTP 400)으로 사용 불가라,
 * 이미 가동 중인 실 인프라로 검증한다. 인프라 미가동 시 {@link org.junit.jupiter.api.Assumptions assumeTrue} 로 skip.
 */
class FederationRoutingIT {

    private static FederatedQueryRunner runner;
    private static Long dsTandanji;
    private static Long dsDocker;

    @BeforeAll
    static void setup() {
        assumeTrue(reachable("localhost", 5433), "메타 DB(5433) 미가동 — skip");
        assumeTrue(reachable("127.0.0.1", 15432), "tandanji(15432) 미가동 — skip");

        JdbcTemplate meta = jdbc("jdbc:postgresql://localhost:5433/chartsol", "postgres", "0218");
        DatasourcePasswordCodec codec = new DatasourcePasswordCodec("dev-chartsol-datasource-enc-change-me");

        dsTandanji = idByDatabase(meta, "tandanji");
        dsDocker = idByDatabase(meta, "chartsol_user");
        assumeTrue(dsTandanji != null && dsDocker != null, "등록된 tandanji/docker 데이터소스 미존재 — skip");

        DatasourceService dss = new DatasourceService(meta, codec);
        QueryExecutor qe = new QueryExecutor(new DatasourcePoolRegistry(dss));
        runner = new FederatedQueryRunner(qe, new DuckDbFederation(dss, qe), new SamplingPlanner(qe));
    }

    @Test
    void multiSourceRoutesToFederationAcrossRegisteredDatasources() {
        Map<String, Object> cfg = Map.of(
                "table", ref(dsTandanji, "tandanji", "exercise_logs"),
                "joins", List.of(Map.of(
                        "table", ref(dsDocker, "public", "users"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "exercise_logs.user_id", "rightColumn", "users.id"))),
                "xAxis", "users.id",
                "yAxis", List.of(Map.of("column", "exercise_logs.calories_burned", "agg", "sum", "alias", "cal")));

        FederatedQueryRunner.BuiltResult r = runner.runBuilder(dsTandanji, cfg, "bar", false);

        // 라우팅: 두 소스 → 페더레이션, SQL 은 ds 별칭으로 한정.
        assertThat(r.datasourceIds()).containsExactlyInAnyOrder(dsTandanji, dsDocker);
        assertThat(r.sql().text())
                .contains("\"ds" + dsTandanji + "\".\"tandanji\".\"exercise_logs\"")
                .contains("\"ds" + dsDocker + "\".\"public\".\"users\"");
        // 실제 교차 서버 조인 집계가 행을 반환한다(Phase 0 에서 동일 조인 확인).
        assertThat(r.rows().rowCount()).isGreaterThan(0);
    }

    @Test
    void crossSourceSamplingEstimatesJoinedPopulationAndAppliesSeededBernoulliAfterWhere() {
        Map<String, Object> cfg = Map.of(
                "table", ref(dsTandanji, "tandanji", "exercise_logs"),
                "joins", List.of(Map.of(
                        "table", ref(dsDocker, "public", "users"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "exercise_logs.user_id", "rightColumn", "users.id"))),
                "xAxis", "users.id",
                "yAxis", List.of(Map.of("column", "exercise_logs.calories_burned", "agg", "sum", "alias", "cal")),
                "where", List.of(Map.of("column", "exercise_logs.calories_burned", "op", "gt", "value", 0)),
                "sample", Map.of("mode", "manual", "size", 1_000, "seed", 321));

        FederatedQueryRunner.BuiltResult first = runner.runBuilder(dsTandanji, cfg, "bar", false);
        FederatedQueryRunner.BuiltResult second = runner.runBuilder(dsTandanji, cfg, "bar", false);

        assertThat(first.sampling().method()).isEqualTo("RESULT_RANDOM");
        assertThat(first.sampling().populationEstimate()).isPositive();
        assertThat(first.rows().rows()).isEqualTo(second.rows().rows());
        assertThat(first.sql().text())
                .contains("INNER JOIN")
                .contains("WHERE \"ds" + dsTandanji + "\".\"tandanji\".\"exercise_logs\".\"calories_burned\" > ? OFFSET 0)")
                .contains("WHERE random() < ?")
                .doesNotContain("ORDER BY random()", "reservoir(");
    }

    @Test
    void storedLiteralFederatedSqlReExecutesViaRunStored() {
        // 저장→임베드 경로: runBuilder 로 생성한 페더레이션 SQL 을 리터럴 인라인(? → 값)한 뒤, 임베드·새로고침이
        // 쓰는 runStored 로 재실행. WHERE 로 리터럴 인라인 경로까지 관통 검증한다.
        Map<String, Object> cfg = Map.of(
                "table", ref(dsTandanji, "tandanji", "exercise_logs"),
                "joins", List.of(Map.of(
                        "table", ref(dsDocker, "public", "users"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "exercise_logs.user_id", "rightColumn", "users.id"))),
                "xAxis", "users.id",
                "yAxis", List.of(Map.of("column", "exercise_logs.calories_burned", "agg", "sum", "alias", "cal")),
                "where", List.of(Map.of("column", "exercise_logs.calories_burned", "op", "gt", "value", 0)));

        FederatedQueryRunner.BuiltResult built = runner.runBuilder(dsTandanji, cfg, "bar", false);
        assertThat(built.sql().params()).isNotEmpty(); // WHERE 바인딩 존재
        String storedSql = com.chartsdk.query.SqlLiterals.inline(built.sql().text(), built.sql().params());
        assertThat(storedSql).doesNotContain("?"); // 리터럴화 완료

        com.chartsdk.query.QueryRows rows = runner.runStored(built.datasourceIds(), dsTandanji, storedSql);

        // 저장 SQL 재실행 결과가 재생성 경로와 동일해야 한다(임베드가 스냅샷을 정확히 재현).
        assertThat(rows.rowCount()).isGreaterThan(0).isEqualTo(built.rows().rowCount());
    }

    @Test
    void singleSourceRoutesToDirectPathWithoutDatasourceAlias() {
        Map<String, Object> cfg = Map.of(
                "table", ref(dsTandanji, "tandanji", "exercise_logs"),
                "xAxis", "user_id",
                "yAxis", List.of(Map.of("column", "calories_burned", "agg", "sum", "alias", "cal")));

        FederatedQueryRunner.BuiltResult r = runner.runBuilder(dsTandanji, cfg, "bar", false);

        assertThat(r.datasourceIds()).containsExactly(dsTandanji);
        assertThat(r.sql().text()).doesNotContain("\"ds"); // 단일 소스 = PG 직접, ds 별칭 없음
        assertThat(r.rows().rowCount()).isGreaterThan(0);
    }

    // ── 헬퍼 ─────────────────────────────────────────────
    private static Map<String, Object> ref(long ds, String schema, String name) {
        return Map.of("datasourceId", ds, "schema", schema, "name", name);
    }

    private static JdbcTemplate jdbc(String url, String user, String pass) {
        DriverManagerDataSource ds = new DriverManagerDataSource(url, user, pass);
        ds.setDriverClassName("org.postgresql.Driver");
        return new JdbcTemplate(ds);
    }

    private static Long idByDatabase(JdbcTemplate meta, String db) {
        try {
            return meta.queryForObject(
                    "SELECT id FROM mc_datasource WHERE database_name=? AND is_active=true ORDER BY id LIMIT 1",
                    Long.class, db);
        } catch (DataAccessException e) {
            return null;
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
