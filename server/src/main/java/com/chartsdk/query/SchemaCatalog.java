package com.chartsdk.query;

import java.util.Map;
import java.util.Set;

/**
 * 데이터소스의 public 스키마 카탈로그(테이블 → 컬럼 → data_type).
 * mc_ 내부 테이블은 로딩 단계에서 제외되므로, 화이트리스트 검증이 곧 mc_ 접근 차단을 겸한다.
 */
public record SchemaCatalog(Map<String, Map<String, String>> tables) {

    public boolean hasTable(String table) {
        return table != null && tables.containsKey(table);
    }

    /** 컬럼의 data_type (information_schema). 없으면 null. */
    public String columnType(String table, String column) {
        Map<String, String> cols = tables.get(table);
        return cols == null ? null : cols.get(column);
    }

    public boolean hasColumn(String table, String column) {
        return columnType(table, column) != null;
    }

    public Set<String> tableNames() {
        return tables.keySet();
    }
}
