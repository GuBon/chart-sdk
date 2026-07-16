package com.chartsdk.query;

/**
 * 테이블/컬럼 식별자를 SQL 문자열로 렌더링하는 전략. 빌더 로직(WHERE·집계·조인)은 한 벌 공유하고
 * 방언별 참조 표기만 이 전략으로 주입한다(설계 §6, DRY).
 */
public interface RefRenderer {

    /** 테이블 식별자 렌더링. */
    String table(Long datasourceId, String schema, String table);

    /** 컬럼 식별자 렌더링(테이블 한정 + 컬럼). */
    default String column(Long datasourceId, String schema, String table, String column) {
        return table(datasourceId, schema, table) + "." + SqlIdentifier.quote(column);
    }

    /** 다중 소스 ATTACH 별칭 규약 — datasourceId → "ds{id}". 렌더러와 페더레이션 엔진이 공유한다. */
    static String attachAlias(Long datasourceId) {
        return datasourceId == null ? null : "ds" + datasourceId;
    }

    /** 단일 소스(PostgreSQL 직접 실행): datasourceId 무시, {@code "schema"."table"}. 기존 출력과 동일. */
    RefRenderer SINGLE = (ds, schema, table) -> SqlIdentifier.qualify(schema, table);

    /** 다중 소스(DuckDB 페더레이션): {@code "ds{id}"."schema"."table"}. */
    RefRenderer FEDERATED = (ds, schema, table) -> SqlIdentifier.qualify(attachAlias(ds), schema, table);

    /** CTE 별칭 참조: datasourceId·schema·table 무시, {@code "alias"}. 인덱스 표본 CTE(단일 base — 조인 금지)에서만 쓴다. */
    static RefRenderer alias(String name) {
        return (ds, schema, table) -> SqlIdentifier.quote(name);
    }
}
