package com.chartsdk.query.engine;

import java.util.Set;

/**
 * 소스 구성 판정의 단일 진실원(설계 §4.4). "이 차트의 소스 구성이 무엇인가"에 따른 세 가지 결정 —
 * ① 실행 엔진(직접 vs 페더레이션) ② 서빙 시 재계산 금지(캐시-온리) ③ 저장 시 갱신 모드 정규화 —
 * 이 인터페이스 뒤에서만 내려진다.
 *
 * <p>새 데이터소스 종류가 오면 이 정책 구현만 종류를 인지하면 된다(예: 파일 소스는 항상 페더레이션
 * 엔진 + 스냅샷 고정). 호출부(runner·serve·save)는 무변경이다.
 */
public interface SourceCompositionPolicy {

    /** 이 소스 집합은 페더레이션 엔진(DuckDB)으로 실행해야 하는가. */
    boolean requiresFederation(Set<Long> datasourceIds);

    /**
     * 서빙 시 재계산을 금지하고 캐시 스냅샷만 반환해야 하는가(서빙 불변식, 연합조회 설계 §8).
     * distinct 소스 수 기반 오버로드 — 차트 단위 판정({@code ChartComputeService.isMultiSource})이
     * junction count 만 갖고 있어도 규칙을 여기서 단일 소유한다.
     */
    boolean requiresSnapshot(int distinctSourceCount);

    default boolean requiresSnapshot(Set<Long> datasourceIds) {
        return requiresSnapshot(datasourceIds.size());
    }

    /** 저장 시 갱신 모드 정규화 — 스냅샷 필수 구성이면 {@code manual}로 강제한다(PRD §7.7). */
    default String normalizeRefreshMode(Set<Long> datasourceIds, String requested) {
        return requiresSnapshot(datasourceIds) ? "manual" : requested;
    }
}
