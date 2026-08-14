package com.chartsdk.federation;

import com.chartsdk.datasource.DatasourceCredentials;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.datasource.postgres.PostgresDuckDbBinding;
import com.chartsdk.datasource.spi.DuckDbBinding;
import com.chartsdk.query.FederatedCatalog;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.AdmissionController;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.QueryTimeoutPolicy;
import com.chartsdk.query.PointCollectionResult;
import com.chartsdk.query.ReservoirPointCollector;
import com.chartsdk.query.SchemaCatalog;
import com.chartsdk.query.SamplingSeed;
import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLTimeoutException;
import java.sql.Statement;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongFunction;

/**
 * 다중 소스 페더레이션 실행 엔진(설계 §3). per-op 무상태: DuckDB in-memory 연결을 열어 필요한 데이터소스를
 * read-only ATTACH 하고 페더레이션 SQL 을 1회 실행한 뒤 닫는다. 계산 경로(저장/새로고침/미리보기)에서만 호출된다.
 *
 * <p>가드: read-only ATTACH · 쿼리 타임아웃 · 메모리 상한. 미리보기는 행 수를 제한하고 실제 차트는 전체 결과를 반환한다.
 * 지도 포인트 빌더는 WHERE 범위의 좌표를 전량 반환하므로 최종 LIMIT만 적용하지 않는다. 소스별 접속
 * 규약(확장 로드·ATTACH 문·자격증명 이스케이프)은 {@link DuckDbBinding}이 조립하고 이 엔진은
 * 실행만 한다(설계 §4.2). 로그에는 바인딩이 준 마스킹 문장만 남긴다(§10).
 */
@Component
public class DuckDbFederation {

    private static final Logger log = LoggerFactory.getLogger(DuckDbFederation.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    static final String MEMORY_LIMIT = "1GB";
    static final int THREADS = 4;

    private final QueryExecutor queryExecutor;
    private final AdmissionController coordinator;
    private final QueryTimeoutPolicy timeouts;
    private final DuckDbBinding binding;

    /** SQL produced after the population estimate and executed on that same attached connection. */
    public record PlannedBernoulli(QueryRows rows, BuilderSqlBuilder.Sql sql, long populationEstimate) {
    }

    public record PlannedResultSample(QueryRows rows, BuilderSqlBuilder.ResultSampleSource source,
                                      long populationEstimate) {
    }

    public DuckDbFederation(DatasourceService datasources, QueryExecutor queryExecutor) {
        this(datasources, queryExecutor, null, QueryTimeoutPolicy.defaults());
    }

    public DuckDbFederation(DatasourceService datasources, QueryExecutor queryExecutor,
                            AdmissionController coordinator) {
        this(datasources, queryExecutor, coordinator, QueryTimeoutPolicy.defaults());
    }

    /** 레거시/테스트 호환 — PostgreSQL 바인딩을 기본 조립한다. */
    public DuckDbFederation(DatasourceService datasources, QueryExecutor queryExecutor,
                            AdmissionController coordinator, QueryTimeoutPolicy timeouts) {
        this(queryExecutor, coordinator, timeouts, new PostgresDuckDbBinding(datasources));
    }

    @Autowired
    public DuckDbFederation(QueryExecutor queryExecutor, AdmissionController coordinator,
                            QueryTimeoutPolicy timeouts, DuckDbBinding binding) {
        this.queryExecutor = queryExecutor;
        this.coordinator = coordinator;
        this.timeouts = timeouts;
        this.binding = binding;
    }

    /** 참조 소스들의 카탈로그를 union 해 식별자 화이트리스트를 만든다(각 소스 mc_·시스템 스키마 제외 유지). */
    public FederatedCatalog catalog(Collection<Long> datasourceIds) {
        Map<Long, SchemaCatalog> bySource = new LinkedHashMap<>();
        for (Long id : datasourceIds) bySource.put(id, queryExecutor.catalog(id));
        return new FederatedCatalog(bySource);
    }

    /** 파라미터 없는 페더레이션 실행(저장된 리터럴 SQL 경로). */
    public QueryRows execute(Collection<Long> datasourceIds, String federatedSql) {
        return execute(datasourceIds, federatedSql, List.of());
    }

    /**
     * 페더레이션 SQL 을 실행해 rows 를 돌려준다. datasourceIds 를 {@code ds{id}} 별칭으로 read-only ATTACH 한 뒤
     * WHERE 바인딩({@code ?})은 PreparedStatement 로 넘긴다(노코드 빌더 경로). ATTACH 는 바인딩 불가라 Statement 로 선행.
     */
    public QueryRows execute(Collection<Long> datasourceIds, String federatedSql, List<Object> params) {
        return execute(datasourceIds, federatedSql, params, QueryExecutor.MAX_ROWS, null);
    }

    /** Complete chart execution without a product-level row cap. */
    public QueryRows executeChart(Collection<Long> datasourceIds, String federatedSql, List<Object> params) {
        return execute(datasourceIds, federatedSql, params, QueryExecutor.UNBOUNDED_CHART_ROWS, null);
    }

    /** Full federated scan with bounded deterministic reservoir retention for automatic points. */
    public PointCollectionResult executeAutoPointChart(Collection<Long> datasourceIds,
                                                       String federatedSql, List<Object> params,
                                                       int targetSize, long seed) {
        return admitted(datasourceIds, () -> executeAutoPointChartAdmitted(
                datasourceIds, federatedSql, params, targetSize, seed));
    }

    private PointCollectionResult executeAutoPointChartAdmitted(Collection<Long> datasourceIds,
                                                                String federatedSql,
                                                                List<Object> params,
                                                                int targetSize, long seed) {
        try (Connection connection = DriverManager.getConnection("jdbc:duckdb:")) {
            configure(connection, datasourceIds, true);
            long start = System.nanoTime();
            try (PreparedStatement statement = connection.prepareStatement(federatedSql)) {
                statement.setQueryTimeout(timeouts.seconds(AdmissionController.Kind.FEDERATION));
                statement.setMaxRows(QueryExecutor.UNBOUNDED_CHART_ROWS);
                for (int index = 0; index < params.size(); index++) {
                    statement.setObject(index + 1, params.get(index));
                }
                try (ResultSet resultSet = statement.executeQuery()) {
                    return ReservoirPointCollector.collect(resultSet, start, targetSize, seed);
                }
            }
        } catch (SQLTimeoutException failure) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Federated query timed out.");
        } catch (ApiException failure) {
            throw failure;
        } catch (SQLException failure) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "FEDERATION_ERROR", "다중 소스 조회 중 오류가 발생했습니다.", failure);
        }
    }

    /** 동일 DuckDB 연결에서 seed를 설정한 뒤 Bernoulli 표본 SQL을 실행한다. */
    public QueryRows executeBernoulli(Collection<Long> datasourceIds, String federatedSql, List<Object> params,
                                      boolean chartResult, long seed) {
        QueryRows rows = execute(datasourceIds, federatedSql, params,
                chartResult ? QueryExecutor.UNBOUNDED_CHART_ROWS : QueryExecutor.MAX_ROWS, seed);
        return rows;
    }

    /** DuckDB EXPLAIN JSON 최상위 Estimated Cardinality. 원격 JOIN+WHERE 쿼리는 실행하지 않는다. */
    public long explainEstimatedRows(Collection<Long> datasourceIds, String sql, List<Object> params) {
        return admitted(datasourceIds, () -> explainEstimatedRowsAdmitted(datasourceIds, sql, params));
    }

    private long explainEstimatedRowsAdmitted(Collection<Long> datasourceIds, String sql, List<Object> params) {
        try (Connection conn = DriverManager.getConnection("jdbc:duckdb:")) {
            configure(conn, datasourceIds, false);
            return explainEstimatedRows(conn, sql, params);
        } catch (Exception ignored) {
            return 0;
        }
    }

    /**
     * Runs EXPLAIN, builds the probability-aware SQL, and executes it without reconnecting or
     * repeating postgres ATTACH. Used by cross-datasource RESULT_RANDOM charts.
     */
    public PlannedBernoulli executePlannedBernoulli(
            Collection<Long> datasourceIds,
            String populationSql,
            List<Object> populationParams,
            LongFunction<BuilderSqlBuilder.Sql> sqlFactory,
            boolean chartResult,
            long seed
    ) {
        return admitted(datasourceIds, () -> executePlannedBernoulliAdmitted(
                datasourceIds, populationSql, populationParams, sqlFactory, chartResult, seed));
    }

    private PlannedBernoulli executePlannedBernoulliAdmitted(
            Collection<Long> datasourceIds,
            String populationSql,
            List<Object> populationParams,
            LongFunction<BuilderSqlBuilder.Sql> sqlFactory,
            boolean chartResult,
            long seed
    ) {
        try (Connection conn = DriverManager.getConnection("jdbc:duckdb:")) {
            configure(conn, datasourceIds, true);
            long estimate;
            try {
                estimate = explainEstimatedRows(conn, populationSql, populationParams);
            } catch (Exception ignored) {
                estimate = 0;
            }
            BuilderSqlBuilder.Sql sql = sqlFactory.apply(estimate);
            setRandomSeed(conn, seed);
            QueryRows rows = execute(conn, sql.text(), sql.params(),
                    chartResult ? QueryExecutor.UNBOUNDED_CHART_ROWS : QueryExecutor.MAX_ROWS);
            return new PlannedBernoulli(rows, sql, estimate);
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Federated query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (SQLException e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "FEDERATION_ERROR",
                    "다중 소스 조회 중 오류가 발생했습니다.", e);
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "FEDERATION_ERROR",
                    "다중 소스 조회 중 오류가 발생했습니다.", e);
        }
    }

    /**
     * Plans and materializes only the bounded post-JOIN Bernoulli rows on one attached DuckDB
     * session. Final aggregation is performed from the L1 cache after this method returns.
     */
    public PlannedResultSample executePlannedResultSample(
            Collection<Long> datasourceIds,
            String populationSql,
            List<Object> populationParams,
            LongFunction<BuilderSqlBuilder.ResultSampleSource> sourceFactory,
            long seed
    ) {
        return admitted(datasourceIds, () -> executePlannedResultSampleAdmitted(
                datasourceIds, populationSql, populationParams, sourceFactory, seed));
    }

    private PlannedResultSample executePlannedResultSampleAdmitted(
            Collection<Long> datasourceIds,
            String populationSql,
            List<Object> populationParams,
            LongFunction<BuilderSqlBuilder.ResultSampleSource> sourceFactory,
            long seed
    ) {
        try (Connection conn = DriverManager.getConnection("jdbc:duckdb:")) {
            configure(conn, datasourceIds, true);
            long estimate;
            try {
                estimate = explainEstimatedRows(conn, populationSql, populationParams);
            } catch (Exception ignored) {
                estimate = 0;
            }
            BuilderSqlBuilder.ResultSampleSource source = sourceFactory.apply(estimate);
            setRandomSeed(conn, seed);
            QueryRows rows = execute(conn, source.sql().text(), source.sql().params(),
                    QueryExecutor.MAX_CACHED_SAMPLE_ROWS + 1);
            if (rows.rowCount() > QueryExecutor.MAX_CACHED_SAMPLE_ROWS) {
                throw new ApiException(
                        HttpStatus.PAYLOAD_TOO_LARGE,
                        "SAMPLE_REALIZATION_TOO_LARGE",
                        "Bernoulli sample exceeds " + QueryExecutor.MAX_CACHED_SAMPLE_ROWS
                                + " rows. Reduce the requested sample size."
                );
            }
            return new PlannedResultSample(rows, source, estimate);
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Federated query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (SQLException e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "FEDERATION_ERROR",
                    "다중 소스 조회 중 오류가 발생했습니다.", e);
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "FEDERATION_ERROR",
                    "다중 소스 조회 중 오류가 발생했습니다.", e);
        }
    }

    private QueryRows execute(Collection<Long> datasourceIds, String federatedSql, List<Object> params,
                              int maxRows, Long bernoulliSeed) {
        return admitted(datasourceIds, () -> executeAdmitted(
                datasourceIds, federatedSql, params, maxRows, bernoulliSeed));
    }

    private QueryRows executeAdmitted(Collection<Long> datasourceIds, String federatedSql, List<Object> params,
                                      int maxRows, Long bernoulliSeed) {
        try (Connection conn = DriverManager.getConnection("jdbc:duckdb:")) {
            configure(conn, datasourceIds, bernoulliSeed != null);
            if (bernoulliSeed != null) setRandomSeed(conn, bernoulliSeed);
            return execute(conn, federatedSql, params, maxRows);
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Federated query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (SQLException e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "FEDERATION_ERROR",
                    "다중 소스 조회 중 오류가 발생했습니다.", e);
        }
    }

    private <T> T admitted(Collection<Long> datasourceIds,
                           AdmissionController.CheckedSupplier<T> task) {
        if (coordinator == null) {
            try {
                return task.get();
            } catch (RuntimeException e) {
                throw e;
            } catch (Exception e) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "FEDERATION_ERROR",
                    "다중 소스 조회 중 오류가 발생했습니다.", e);
            }
        }
        try {
            return coordinator.executeFederated(datasourceIds, task);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "FEDERATION_ERROR",
                    "다중 소스 조회 중 오류가 발생했습니다.", e);
        }
    }

    private long explainEstimatedRows(Connection connection, String sql, List<Object> params) throws Exception {
        try (PreparedStatement ps = connection.prepareStatement("EXPLAIN (FORMAT JSON) " + sql)) {
            ps.setQueryTimeout(timeouts.seconds(AdmissionController.Kind.FEDERATION));
            for (int i = 0; i < params.size(); i++) ps.setObject(i + 1, params.get(i));
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return 0;
                JsonNode root = JSON.readTree(rs.getString(2));
                return Math.max(0, root.path(0).path("extra_info")
                        .path("Estimated Cardinality").asLong(0));
            }
        }
    }

    private QueryRows execute(Connection connection, String sql, List<Object> params, int maxRows)
            throws SQLException {
        long start = System.nanoTime();
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setQueryTimeout(timeouts.seconds(AdmissionController.Kind.FEDERATION));
            ps.setMaxRows(maxRows);
            for (int i = 0; i < params.size(); i++) ps.setObject(i + 1, params.get(i));
            try (ResultSet rs = ps.executeQuery()) {
                return QueryRows.from(rs, start, maxRows);
            }
        }
    }

    private void configure(Connection connection, Collection<Long> datasourceIds,
                           boolean deterministicBernoulli) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(timeouts.seconds(AdmissionController.Kind.FEDERATION));
            for (String init : binding.sessionInitSql()) statement.execute(init);
            for (Long id : datasourceIds) {
                DuckDbBinding.AttachStatement attach = binding.attach(id);
                if (log.isDebugEnabled()) {
                    log.debug("federation ATTACH: {}", attach.maskedSql());
                }
                statement.execute(attach.sql());
            }
            statement.execute("SET memory_limit='" + MEMORY_LIMIT + "'");
            // seeded random()의 행 소비 순서를 고정해야 같은 seed가 같은 Bernoulli 표본을 재생한다.
            statement.execute("SET threads TO " + (deterministicBernoulli ? 1 : THREADS));
        }
    }

    private static void setRandomSeed(Connection connection, long seed) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("SELECT setseed(?)")) {
            statement.setDouble(1, SamplingSeed.unit(seed));
            statement.execute();
        }
    }

    // ── ATTACH SQL — 조립 권위는 PostgresDuckDbBinding, 여기는 기존 호출·테스트 호환 위임 ──
    /** {@link PostgresDuckDbBinding#attachSql} 위임 파사드. */
    static String attachSql(long datasourceId, DatasourceCredentials c) {
        return PostgresDuckDbBinding.attachSql(datasourceId, c);
    }

    /** {@link PostgresDuckDbBinding#maskedAttachSql} 위임 파사드. */
    static String maskedAttachSql(long datasourceId, DatasourceCredentials c) {
        return PostgresDuckDbBinding.maskedAttachSql(datasourceId, c);
    }
}
