package com.chartsdk.query;

import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.datasource.postgres.PostgresCatalogPort;
import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLTimeoutException;
import java.util.List;
import java.util.Map;

/**
 * 모든 고객 DB 조회의 단일 실행 경로. 읽기 전용·타임아웃·행 제한 정책·에러코드 매핑을 한 곳에서 강제한다
 * (노코드 빌더·raw SQL·스키마 미리보기가 공유 — 별도 실행 경로를 만들지 않는다, 노코드 SQL생성규칙 §1.1).
 * 데이터 미리보기·원본 탐색은 기본 1,000행으로 제한한다. 실제 차트 계산은 제품 행 상한 없이
 * JDBC cursor fetch를 사용하며, 동시성은 {@link QueryExecutionCoordinator}가 제한한다.
 *
 * <p>카탈로그 로딩·TTL 캐시는 {@link CatalogService}(+{@link PostgresCatalogPort})로 분리했다.
 * {@link #catalog}·{@link #invalidateCatalog}·{@link #estimatedRowCounts}는 기존 호출부·테스트
 * 호환용 위임 파사드다 — 새 코드는 {@code CatalogService}를 직접 주입받는다.
 */
@Service
public class QueryExecutor {
    private static final ObjectMapper JSON = new ObjectMapper();
    public static final int MAX_ROWS = 1000;
    /** JDBC maxRows value for complete chart datasets. Zero means no product-level row cap. */
    public static final int UNBOUNDED_CHART_ROWS = 0;
    /** Bernoulli realizations vary around the requested target; this is a non-truncating guard. */
    public static final int MAX_CACHED_SAMPLE_ROWS = 75_000;

    private final DatasourcePoolRegistry pools;
    private final AdmissionController coordinator;
    private final QueryTimeoutPolicy timeouts;
    private final CatalogService catalogs;

    public QueryExecutor(DatasourcePoolRegistry pools) {
        this(pools, null, QueryTimeoutPolicy.defaults());
    }

    public QueryExecutor(DatasourcePoolRegistry pools, AdmissionController coordinator) {
        this(pools, coordinator, QueryTimeoutPolicy.defaults());
    }

    public QueryExecutor(DatasourcePoolRegistry pools, AdmissionController coordinator,
                         QueryTimeoutPolicy timeouts) {
        this(pools, coordinator, timeouts,
                new CatalogService(new PostgresCatalogPort(pools, coordinator, timeouts)));
    }

    @Autowired
    public QueryExecutor(DatasourcePoolRegistry pools, AdmissionController coordinator,
                         QueryTimeoutPolicy timeouts, CatalogService catalogs) {
        this.pools = pools;
        this.coordinator = coordinator;
        this.timeouts = timeouts;
        this.catalogs = catalogs;
    }

    public QueryRows execute(long datasourceId, String sql) {
        return execute(datasourceId, sql, List.of());
    }

    /** PreparedStatement 바인딩 실행(노코드 빌더 경로). params 가 비면 정적 실행과 동일. */
    public QueryRows execute(long datasourceId, String sql, List<Object> params) {
        return execute(datasourceId, sql, params, MAX_ROWS, null, AdmissionController.Kind.PREVIEW);
    }

    /** Executes the complete chart result. Raw-data exploration remains capped by {@link #MAX_ROWS}. */
    public QueryRows executeChart(long datasourceId, String sql, List<Object> params) {
        return execute(datasourceId, sql, params, UNBOUNDED_CHART_ROWS, null,
                AdmissionController.Kind.CHART);
    }

    /**
     * Scans the complete automatic point result but retains at most {@code targetSize} rows in
     * deterministic reservoir memory. Manual and sampling-off paths do not call this method.
     */
    public PointCollectionResult executeAutoPointChart(long datasourceId, String sql,
                                                       List<Object> params, int targetSize, long seed) {
        return execute(datasourceId, sql, params, UNBOUNDED_CHART_ROWS, null,
                AdmissionController.Kind.CHART,
                (resultSet, startNanos, ignoredMaxRows) -> ReservoirPointCollector.collect(
                        resultSet, startNanos, targetSize, seed));
    }

    /** 동일 연결에서 seed를 먼저 설정한 뒤 Bernoulli 표본 SQL을 실행한다. */
    public QueryRows executeBernoulli(long datasourceId, String sql, List<Object> params,
                                      boolean chartResult, long seed) {
        return execute(datasourceId, sql, params,
                chartResult ? UNBOUNDED_CHART_ROWS : MAX_ROWS, seed,
                AdmissionController.Kind.SAMPLE);
    }

    /** Executes the pre-aggregation L1 Bernoulli projection without silently truncating it. */
    public QueryRows executeCachedSample(long datasourceId, String sql, List<Object> params, long seed) {
        QueryRows rows = execute(datasourceId, sql, params, MAX_CACHED_SAMPLE_ROWS + 1, seed,
                AdmissionController.Kind.SAMPLE);
        if (rows.rowCount() <= MAX_CACHED_SAMPLE_ROWS) return rows;
        throw new ApiException(
                HttpStatus.PAYLOAD_TOO_LARGE,
                "SAMPLE_REALIZATION_TOO_LARGE",
                "Bernoulli sample exceeds " + MAX_CACHED_SAMPLE_ROWS
                        + " rows. Reduce the requested sample size."
        );
    }

    /** EXPLAIN JSON 최상위 Plan Rows. 쿼리를 실행하지 않고 JOIN+WHERE 결과 행 수를 추정한다. */
    public long explainEstimatedRows(long datasourceId, String sql, List<Object> params) {
        QueryRows explained = execute(datasourceId, "EXPLAIN (FORMAT JSON) " + sql, params, MAX_ROWS, null,
                AdmissionController.Kind.EXPLAIN);
        if (explained.rows().isEmpty() || explained.rows().get(0).isEmpty()) return 0;
        try {
            JsonNode root = JSON.readTree(String.valueOf(explained.rows().get(0).get(0)));
            return Math.max(0, root.path(0).path("Plan").path("Plan Rows").asLong(0));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private QueryRows execute(long datasourceId, String sql, List<Object> params, int maxRows,
                              Long bernoulliSeed, AdmissionController.Kind kind) {
        return execute(datasourceId, sql, params, maxRows, bernoulliSeed, kind,
                (resultSet, startNanos, limit) -> QueryRows.from(resultSet, startNanos, limit));
    }

    private <T> T execute(long datasourceId, String sql, List<Object> params, int maxRows,
                          Long bernoulliSeed, AdmissionController.Kind kind,
                          ResultCollector<T> collector) {
        if (coordinator == null) {
            return executeAdmitted(datasourceId, sql, params, maxRows, bernoulliSeed, kind, collector);
        }
        try {
            return coordinator.execute(datasourceId, kind,
                    () -> executeAdmitted(
                            datasourceId, sql, params, maxRows, bernoulliSeed, kind, collector));
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "SQL_ERROR",
                    "쿼리 실행 중 오류가 발생했습니다.", e);
        }
    }

    private <T> T executeAdmitted(long datasourceId, String sql, List<Object> params,
                                  int maxRows, Long bernoulliSeed, AdmissionController.Kind kind,
                                  ResultCollector<T> collector) {
        long start = System.nanoTime();
        try (Connection conn = pools.connection(datasourceId)) {
            boolean cursorFetch = maxRows == UNBOUNDED_CHART_ROWS && conn.getAutoCommit();
            if (cursorFetch) conn.setAutoCommit(false);
            if (bernoulliSeed != null) setRandomSeed(conn, bernoulliSeed);
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                ps.setQueryTimeout(timeouts.seconds(kind));
                ps.setMaxRows(maxRows);
                if (cursorFetch) ps.setFetchSize(1_000);
                for (int i = 0; i < params.size(); i++) {
                    Object p = params.get(i);
                    if (p instanceof long[] keys) {
                        // 인덱스 표본 좌표 배열 — unnest(?) 로 바인딩(setObject 미지원, §표본추출).
                        Long[] boxed = new Long[keys.length];
                        for (int k = 0; k < keys.length; k++) boxed[k] = keys[k];
                        ps.setArray(i + 1, conn.createArrayOf("bigint", boxed));
                    } else {
                        ps.setObject(i + 1, p);
                    }
                }
                try (ResultSet rs = ps.executeQuery()) {
                    T result = collector.collect(rs, start, maxRows);
                    if (cursorFetch) conn.rollback();
                    return result;
                }
            }
        } catch (SQLTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "QUERY_TIMEOUT", "Query timed out.");
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "SQL_ERROR",
                    "쿼리 실행 중 오류가 발생했습니다.", e);
        }
    }

    @FunctionalInterface
    private interface ResultCollector<T> {
        T collect(ResultSet resultSet, long startNanos, int maxRows) throws Exception;
    }

    private static void setRandomSeed(Connection connection, long seed) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("SELECT setseed(?)")) {
            statement.setDouble(1, SamplingSeed.unit(seed));
            statement.execute();
        }
    }

    /** 카탈로그 조회 위임 파사드 — 로딩·TTL 캐시의 권위는 {@link CatalogService}다. */
    public SchemaCatalog catalog(long datasourceId) {
        return catalogs.catalog(datasourceId);
    }

    /** Allows datasource-management flows to make metadata changes visible immediately. */
    public void invalidateCatalog(long datasourceId) {
        catalogs.invalidate(datasourceId);
    }

    /** {@link CatalogService#estimatedRowCounts} 위임 파사드. */
    public Map<SchemaCatalog.Key, Long> estimatedRowCounts(long datasourceId) {
        return catalogs.estimatedRowCounts(datasourceId);
    }
}
