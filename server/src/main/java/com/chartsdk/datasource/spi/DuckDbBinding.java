package com.chartsdk.datasource.spi;

import java.util.List;

/**
 * 소스를 DuckDB 세션에 붙이는 방법 — 소스 종류별 확장점. 엔진({@code DuckDbFederation})은
 * 받은 SQL을 실행만 하고 접속 규약(드라이버·확장·자격증명 문자열)을 조립하지 않는다(설계 §4.2).
 *
 * <p>새 소스 종류(예: 파일)는 이 포트 구현 하나로 페더레이션 실행 경로에 합류한다 —
 * {@code ds{id}} 별칭 규약({@code RefRenderer.attachAlias})만 지키면 SQL 생성기·실행기는 무변경이다.
 */
public interface DuckDbBinding {

    /** 세션 1회 초기화 SQL(확장 로드 등). ATTACH 보다 먼저 순서대로 실행된다. */
    List<String> sessionInitSql();

    /** 이 소스를 세션에 붙이는 ATTACH 문. 자격증명 조회를 1회로 유지하도록 마스킹 로그 문과 함께 반환한다. */
    AttachStatement attach(long datasourceId);

    /** 실행용 SQL 과 로깅용(비밀번호 마스킹, 연합조회 설계 §10) SQL 쌍. */
    record AttachStatement(String sql, String maskedSql) {
    }
}
