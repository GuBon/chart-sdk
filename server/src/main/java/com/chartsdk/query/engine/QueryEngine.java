package com.chartsdk.query.engine;

import com.chartsdk.cache.CachedResultSample;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.Catalog;
import com.chartsdk.query.PointCollectionResult;
import com.chartsdk.query.QueryRows;
import com.chartsdk.query.RefRenderer;
import com.chartsdk.query.SamplePlan;

import java.util.Set;
import java.util.function.LongFunction;

/**
 * 실행 엔진 공통 포트(설계 §4.3). 빌더 실행 흐름(카탈로그 → 표본 계획 → SQL 생성 → 실행)은
 * {@code FederatedQueryRunner}가 한 벌로 조율하고, 엔진이 갈리는 지점만 이 포트 뒤로 모은다.
 *
 * <p>구현 2개: 단일 PostgreSQL 직접 실행({@link PostgresQueryEngine})과 DuckDB 페더레이션
 * ({@code DuckDbQueryEngine}). L1 결과표본·레거시 Bernoulli 는 엔진의 실행 모델 차이(페더레이션은
 * EXPLAIN 과 표본 실행이 같은 ATTACH 세션이어야 함)가 실재하므로 계약 수준
 * ({@link #loadResultSample}·{@link #executeResultRandom})으로만 통일하고 내부 절차는 통합하지 않는다.
 */
public interface QueryEngine {

    /** 이 엔진의 테이블 참조 렌더링 규약({@code "schema"."table"} vs {@code "ds{id}"."schema"."table"}). */
    RefRenderer renderer();

    /** 참조 소스 집합의 식별자 화이트리스트 카탈로그. */
    Catalog catalog(Set<Long> datasourceIds);

    /** 전체 차트 결과 실행 — 제품 행 상한 없음. */
    QueryRows executeChart(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql);

    /** 미리보기·원본 탐색 실행 — {@code MAX_ROWS} 제한. */
    QueryRows executePreview(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql);

    /** 자동 포인트 표본 — 전체 스캔 + 결정적 reservoir 보존. */
    PointCollectionResult executeAutoPoints(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql,
                                            int targetSize, long seed);

    /** 실행 없이 JOIN+WHERE 결과 행 수를 추정한다(RESULT_RANDOM 확률 계산용). */
    long explainEstimatedRows(Set<Long> datasourceIds, BuilderSqlBuilder.Sql sql);

    /**
     * L1 결과표본 로드 — 모집단 추정 후 {@code sourceFactory}가 만든 표본 SQL 을 실행해 경계 내
     * 행을 돌려준다. 추정·실행의 세션 결합 방식은 엔진이 결정한다(표본추출 계약).
     */
    CachedResultSample loadResultSample(Set<Long> datasourceIds, BuilderSqlBuilder.Sql population,
                                        LongFunction<BuilderSqlBuilder.ResultSampleSource> sourceFactory,
                                        SamplePlan plan);

    /**
     * L1 캐시 없는 레거시 RESULT_RANDOM — 모집단 추정 후 {@code sqlFactory}가 만든 표본 집계 SQL 을
     * seed 고정으로 실행한다.
     */
    Planned executeResultRandom(Set<Long> datasourceIds, BuilderSqlBuilder.Sql population,
                                LongFunction<BuilderSqlBuilder.Sql> sqlFactory,
                                boolean chartResult, long seed);

    /** 추정치 반영이 끝난 최종 SQL 과 그 실행 결과. */
    record Planned(QueryRows rows, BuilderSqlBuilder.Sql sql) {
    }
}
