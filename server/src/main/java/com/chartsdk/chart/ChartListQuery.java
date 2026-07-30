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
        return clamp(pageSize == null ? 8 : pageSize, 1, 60);
    }

    public int resolvedPage(int totalPages) {
        return clamp(page == null ? 1 : page, 1, Math.max(1, totalPages));
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
