package com.chartsdk.query;

/**
 * 식별자 화이트리스트 조회 추상화. 단일 소스({@link SchemaCatalog})와 다중 소스({@link FederatedCatalog})가
 * 같은 인터페이스로 검증된다. {@code datasourceId} 는 다중 소스에서만 의미가 있고, 단일 소스는 무시한다.
 */
public interface Catalog {

    boolean hasTable(Long datasourceId, String schema, String table);

    String columnType(Long datasourceId, String schema, String table, String column);

    default boolean hasColumn(Long datasourceId, String schema, String table, String column) {
        return columnType(datasourceId, schema, table, column) != null;
    }
}
