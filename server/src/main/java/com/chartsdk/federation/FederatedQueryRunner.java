package com.chartsdk.federation;

import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.cache.SamplingQueryRows;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.FederatedCatalog;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SamplePlan;
import com.chartsdk.query.SamplingPlanner;
import com.chartsdk.query.SchemaCatalog;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Set;

/**
 * 실행 라우터(설계 §2) — 참조 데이터소스 수로 단일/다중 경로를 가른다.
 * <ul>
 *   <li>distinct 소스 ≤ 1 : 기존 {@link QueryExecutor}(PG 직접, {@link RefRenderer#SINGLE}) — 무변경·최고 성능.</li>
 *   <li>distinct 소스 ≥ 2 : {@link DuckDbFederation}(DuckDB, {@link RefRenderer#FEDERATED}).</li>
 * </ul>
 * 서빙 경로(임베드/목록)는 이 라우터를 거치지 않고 캐시 스냅샷만 반환한다(설계 §8).
 */
@Service
public class FederatedQueryRunner {

    private final QueryExecutor queries;
    private final DuckDbFederation federation;
    private final SamplingPlanner planner;

    public FederatedQueryRunner(QueryExecutor queries, DuckDbFederation federation, SamplingPlanner planner) {
        this.queries = queries;
        this.federation = federation;
        this.planner = planner;
    }

    /** 계산 결과 + 생성 SQL(표시·저장용) + 참조 소스 집합(junction 영속화용). */
    public record BuiltResult(QueryRows rows, BuilderSqlBuilder.Sql sql, Set<Long> datasourceIds,
                              SamplingMetadata sampling) {
        public BuiltResult(QueryRows rows, BuilderSqlBuilder.Sql sql, Set<Long> datasourceIds) {
            this(rows, sql, datasourceIds, sql == null ? null : sql.sampling());
        }
    }

    /** builderConfig 로부터 SQL 생성 + 실행(미리보기·저장 시드·수동 새로고침의 재생성 경로). */
    public BuiltResult runBuilder(long primaryDatasourceId, Map<String, Object> cfg, String chartType, boolean rawMode) {
        Set<Long> refs = BuilderSqlBuilder.referencedDatasources(cfg);
        if (refs.size() >= 2) {
            FederatedCatalog catalog = federation.catalog(refs);
            // 다중 소스 조인도 JOIN+WHERE 결과를 모집단으로 삼는다. 이 계획은 DB 카탈로그를 조회하지 않는다.
            SamplePlan plan = planner.plan(primaryDatasourceId, cfg, rawMode);
            BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(
                    catalog, RefRenderer.FEDERATED, cfg, chartType, rawMode, plan);
            SamplingQueryRows.Result result = SamplingQueryRows.extract(
                    federation.execute(refs, sql.text(), sql.params()), sql.sampling());
            return new BuiltResult(result.rows(), sql, refs, result.sampling());
        }
        long dsId = refs.isEmpty() ? primaryDatasourceId : refs.iterator().next();
        SchemaCatalog catalog = queries.catalog(dsId);
        SamplePlan plan = planner.plan(dsId, cfg, rawMode); // 관계 종류·조인 유무·PK·행수·밀도로 RESULT_RANDOM 포함 실행 방식 결정
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, cfg, chartType, rawMode, plan);
        SamplingQueryRows.Result result = SamplingQueryRows.extract(
                queries.execute(dsId, sql.text(), sql.params()), sql.sampling());
        return new BuiltResult(result.rows(), sql, Set.of(dsId), result.sampling());
    }

    /** 저장된 리터럴 SQL 실행(저장 시드·수동 새로고침의 재실행 경로). 소스 수로 라우팅. */
    public QueryRows runStored(Set<Long> datasourceIds, long primaryDatasourceId, String storedSql) {
        if (datasourceIds != null && datasourceIds.size() >= 2) {
            return federation.execute(datasourceIds, storedSql);
        }
        return queries.execute(primaryDatasourceId, storedSql);
    }
}
