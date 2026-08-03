package com.chartsdk.query;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 데이터소스 카탈로그(스키마.테이블 → 컬럼 → data_type). 시스템 스키마와 mc_ 내부 테이블은
 * 로딩 단계에서 제외되므로, 화이트리스트 검증이 곧 mc_ 접근 차단을 겸한다(노코드 SQL생성규칙 §9).
 *
 * <p>불변 카탈로그 — 한 번 생성되면 식별자 화이트리스트의 신뢰 기반으로 고정된다.
 *
 * <p>식별자 규칙(§1.2): 테이블은 스키마 한정이며, 빌더가 스키마를 명시하지 않으면 {@code public} 으로
 * 간주한다. 비한정 조회 헬퍼는 같은 이름이 여러 스키마에 있어도 {@code public} 을 우선 매칭한다 —
 * 스키마 없는 기존 차트(builder_config.table = "sales")의 무손실 하위호환을 위한 폴백이다.
 */
public record SchemaCatalog(
        Map<Key, Map<String, String>> byTable,
        Map<Key, RelationType> relationTypes,
        Map<Key, Long> estimatedRowCounts,
        Map<Key, Boolean> populated,
        Map<Key, String> relationDisplayNames,
        Map<Key, Map<String, String>> columnDisplayNames
) implements Catalog {

    public static final String DEFAULT_SCHEMA = "public";

    /** 스키마 한정 테이블 키. schema 는 항상 비어있지 않게 정규화된다(미지정 → public). */
    public record Key(String schema, String table) {
        public Key {
            schema = (schema == null || schema.isBlank()) ? DEFAULT_SCHEMA : schema;
        }
    }

    /** 기존 테스트·호출부 호환: 별도 메타데이터가 없으면 모두 일반 TABLE로 본다. */
    public SchemaCatalog(Map<Key, Map<String, String>> byTable) {
        this(byTable, defaultTypes(byTable), Map.of(), Map.of(), Map.of(), Map.of());
    }

    /** 관계 종류·통계까지만 제공하던 기존 생성자 호환. */
    public SchemaCatalog(
            Map<Key, Map<String, String>> byTable,
            Map<Key, RelationType> relationTypes,
            Map<Key, Long> estimatedRowCounts,
            Map<Key, Boolean> populated
    ) {
        this(byTable, relationTypes, estimatedRowCounts, populated, Map.of(), Map.of());
    }

    /** 스키마 없는 테이블 맵을 public 카탈로그로 만든다(스키마 미지정 = public, §1.2 하위호환). */
    public static SchemaCatalog ofPublic(Map<String, Map<String, String>> publicTables) {
        Map<Key, Map<String, String>> qualified = new LinkedHashMap<>();
        publicTables.forEach((table, cols) -> qualified.put(new Key(DEFAULT_SCHEMA, table), cols));
        return new SchemaCatalog(qualified);
    }

    // ── Catalog 구현(단일 소스 — datasourceId 무시) ─────────────
    @Override
    public boolean hasTable(Long datasourceId, String schema, String table) {
        return hasTable(schema, table);
    }

    @Override
    public String columnType(Long datasourceId, String schema, String table, String column) {
        return columnType(schema, table, column);
    }

    @Override
    public boolean isQueryable(Long datasourceId, String schema, String table) {
        return isQueryable(schema, table);
    }

    // ── 스키마 한정 조회 ──────────────────────────────────────
    public boolean hasTable(String schema, String table) {
        return table != null && byTable.containsKey(new Key(schema, table));
    }

    public String columnType(String schema, String table, String column) {
        Map<String, String> cols = byTable.get(new Key(schema, table));
        return cols == null ? null : cols.get(column);
    }

    public boolean hasColumn(String schema, String table, String column) {
        return columnType(schema, table, column) != null;
    }

    // ── 비한정 조회(스키마 미지정) — public 폴백 ──────────────────
    public boolean hasTable(String table) {
        return hasTable(DEFAULT_SCHEMA, table);
    }

    public String columnType(String table, String column) {
        return columnType(DEFAULT_SCHEMA, table, column);
    }

    public boolean hasColumn(String table, String column) {
        return hasColumn(DEFAULT_SCHEMA, table, column);
    }

    public RelationType relationType(String schema, String table) {
        return relationTypes.getOrDefault(new Key(schema, table), RelationType.TABLE);
    }

    public Long estimatedRowCount(String schema, String table) {
        return estimatedRowCounts.get(new Key(schema, table));
    }

    public boolean isPopulated(String schema, String table) {
        return populated.getOrDefault(new Key(schema, table), true);
    }

    public boolean isQueryable(String schema, String table) {
        return relationType(schema, table) != RelationType.MATERIALIZED_VIEW || isPopulated(schema, table);
    }

    public String relationDisplayName(String schema, String table) {
        return relationDisplayNames.get(new Key(schema, table));
    }

    public String columnDisplayName(String schema, String table, String column) {
        Map<String, String> names = columnDisplayNames.get(new Key(schema, table));
        return names == null ? null : names.get(column);
    }

    public Set<Key> tableKeys() {
        return byTable.keySet();
    }

    private static Map<Key, RelationType> defaultTypes(Map<Key, Map<String, String>> byTable) {
        Map<Key, RelationType> result = new LinkedHashMap<>();
        byTable.keySet().forEach(key -> result.put(key, RelationType.TABLE));
        return result;
    }
}
