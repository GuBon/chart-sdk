package com.chartsdk.federation;

import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.FederatedCatalog;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
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

    public FederatedQueryRunner(QueryExecutor queries, DuckDbFederation federation) {
        this.queries = queries;
        this.federation = federation;
    }

    /** 계산 결과 + 생성 SQL(표시·저장용) + 참조 소스 집합(junction 영속화용). */
    public record BuiltResult(QueryRows rows, BuilderSqlBuilder.Sql sql, Set<Long> datasourceIds) {
    }

    /** builderConfig 로부터 SQL 생성 + 실행(미리보기·저장 시드·수동 새로고침의 재생성 경로). */
    public BuiltResult runBuilder(long primaryDatasourceId, Map<String, Object> cfg, String chartType, boolean rawMode) {
        Set<Long> refs = BuilderSqlBuilder.referencedDatasources(cfg);
        if (refs.size() >= 2) {
            FederatedCatalog catalog = federation.catalog(refs);
            BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, RefRenderer.FEDERATED, cfg, chartType, rawMode);
            QueryRows rows = federation.execute(refs, sql.text(), sql.params());
            return new BuiltResult(rows, sql, refs);
        }
        long dsId = refs.isEmpty() ? primaryDatasourceId : refs.iterator().next();
        SchemaCatalog catalog = queries.catalog(dsId);
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, cfg, chartType, rawMode);
        QueryRows rows = queries.execute(dsId, sql.text(), sql.params());
        return new BuiltResult(rows, sql, Set.of(dsId));
    }

    /** 저장된 리터럴 SQL 실행(저장 시드·수동 새로고침의 재실행 경로). 소스 수로 라우팅. */
    public QueryRows runStored(Set<Long> datasourceIds, long primaryDatasourceId, String storedSql) {
        if (datasourceIds != null && datasourceIds.size() >= 2) {
            return federation.execute(datasourceIds, storedSql);
        }
        return queries.execute(primaryDatasourceId, storedSql);
    }
}
