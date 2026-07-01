package com.chartsdk.query;

public final class SqlIdentifier {
    private SqlIdentifier() {
    }

    /** 단일 식별자를 큰따옴표로 감싼다(내부 " 는 "" escape). 화이트리스트 통과 이름만 여기까지 온다. */
    public static String quote(String ident) {
        return "\"" + ident.replace("\"", "\"\"") + "\"";
    }

    /** 스키마 한정 테이블 식별자 "schema"."table" (노코드 SQL생성규칙 §1.2). schema 가 비면 table 만 인용. */
    public static String qualify(String schema, String table) {
        if (schema == null || schema.isBlank()) return quote(table);
        return quote(schema) + "." + quote(table);
    }

    /**
     * 데이터소스 한정 테이블 식별자 "dsAlias"."schema"."table" (다중 소스 페더레이션, DuckDB ATTACH 별칭).
     * dsAlias 가 비면 스키마 한정(2단)으로 축약 — 단일 소스 경로 하위호환.
     */
    public static String qualify(String datasourceAlias, String schema, String table) {
        if (datasourceAlias == null || datasourceAlias.isBlank()) return qualify(schema, table);
        return quote(datasourceAlias) + "." + qualify(schema, table);
    }
}
