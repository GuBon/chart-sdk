package com.chartsdk.chart;

/** Controller-Service-Repository 사이의 차트 목록 조회 조건. */
public record ChartListQuery(
        String q,
        String type,
        Long datasourceId,
        String schema,
        String relation,
        String sort,
        Integer page,
        Integer pageSize
) {
    public boolean hasRelation() {
        return relation != null && !relation.isBlank();
    }

    public boolean hasSchema() {
        return hasRelation() || (schema != null && !schema.isBlank());
    }

    public String relationSchema() {
        return schema == null || schema.isBlank() ? "public" : schema;
    }

    public int resolvedPageSize() {
        // null·0·음수는 모두 "의미 있는 값 없음"으로 보고 기본값(8)로 되돌린다 — 0/음수가 1로 클램프되어
        // 페이지당 1개만 보이는 비대칭을 없앤다(설계 L3). 유효 값은 1~60으로 상한만 클램프한다.
        int requested = pageSize == null || pageSize <= 0 ? 8 : pageSize;
        return clamp(requested, 1, 60);
    }

    public int resolvedPage(int totalPages) {
        return clamp(page == null ? 1 : page, 1, Math.max(1, totalPages));
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
