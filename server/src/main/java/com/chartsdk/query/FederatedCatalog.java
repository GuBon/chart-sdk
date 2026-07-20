package com.chartsdk.query;

import java.util.Map;

/**
 * 다중 소스 카탈로그 — datasourceId 별 {@link SchemaCatalog} 를 union 해 {@code (datasourceId, schema, table)}
 * 로 화이트리스트를 검증한다. 각 소스 카탈로그는 이미 {@code mc_}·시스템 스키마를 제외해 로딩되므로(설계 §5·§10),
 * 페더레이션 식별자 검증이 곧 소스별 mc_ 접근 차단을 겸한다.
 */
public record FederatedCatalog(Map<Long, SchemaCatalog> bySource) implements Catalog {

    @Override
    public boolean hasTable(Long datasourceId, String schema, String table) {
        SchemaCatalog c = bySource.get(datasourceId);
        return c != null && c.hasTable(schema, table);
    }

    @Override
    public String columnType(Long datasourceId, String schema, String table, String column) {
        SchemaCatalog c = bySource.get(datasourceId);
        return c == null ? null : c.columnType(schema, table, column);
    }

    @Override
    public boolean isQueryable(Long datasourceId, String schema, String table) {
        SchemaCatalog c = bySource.get(datasourceId);
        return c != null && c.isQueryable(schema, table);
    }
}
