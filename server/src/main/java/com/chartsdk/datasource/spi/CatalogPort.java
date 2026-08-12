package com.chartsdk.datasource.spi;

import com.chartsdk.query.SchemaCatalog;

/**
 * 소스에서 카탈로그(식별자 화이트리스트) 메타데이터를 읽는 방법 — 소스 종류별 확장점.
 *
 * <p>새 데이터소스 종류는 이 포트 구현 하나로 카탈로그 파이프라인(TTL 캐시·화이트리스트 검증·
 * 스키마 API)에 합류한다. TTL 캐시와 무효화는 종류 무관 {@code CatalogService}가 담당하므로
 * 구현은 매 호출 원본 메타데이터를 새로 읽기만 하면 된다.
 *
 * <p>반환 카탈로그는 {@link SchemaCatalog} 계약(시스템 스키마·{@code mc_} 관계 제외)을 지켜야
 * 화이트리스트 검증이 곧 내부 테이블 차단을 겸한다(노코드 SQL생성규칙 §9).
 */
public interface CatalogPort {

    SchemaCatalog load(long datasourceId);
}
