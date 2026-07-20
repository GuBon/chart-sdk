package com.chartsdk.query;

/** PostgreSQL에서 차트 원본으로 허용하는 읽기 관계 종류. */
public enum RelationType {
    TABLE,
    VIEW,
    MATERIALIZED_VIEW;

    public static RelationType fromRelkind(String relkind) {
        return switch (relkind == null ? "" : relkind) {
            case "v" -> VIEW;
            case "m" -> MATERIALIZED_VIEW;
            default -> TABLE; // ordinary/partitioned table
        };
    }
}
