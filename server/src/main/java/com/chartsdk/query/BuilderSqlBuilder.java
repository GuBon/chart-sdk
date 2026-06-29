package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 노코드 builderConfig → (검증된 SQL + 바인딩). 모든 식별자는 SchemaCatalog 화이트리스트로 검증한 뒤에만
 * 큰따옴표로 감싼다(노코드 SQL생성규칙 §1.2·§9·§11). 값은 전부 PreparedStatement 바인딩.
 * 검증 실패는 SQL 생성 전에 400 으로 차단한다 — 노코드 사용자에게 DB 에러를 노출하지 않는다(§9).
 */
public final class BuilderSqlBuilder {

    public record Sql(String text, List<Object> params) {
    }

    private final SchemaCatalog catalog;
    private final Map<String, Object> cfg;
    private final String chartType;
    private final boolean rawMode;
    private final String baseTable;
    private final List<Map<String, Object>> joins;
    private final boolean hasJoins;
    private final Set<String> knownTables = new LinkedHashSet<>();

    private BuilderSqlBuilder(SchemaCatalog catalog, Map<String, Object> cfg, String chartType, boolean rawMode) {
        this.catalog = catalog;
        this.cfg = cfg;
        this.chartType = chartType;
        this.rawMode = rawMode;
        this.baseTable = str(cfg.get("table"));
        this.joins = asMapList(cfg.get("joins"));
        this.hasJoins = !joins.isEmpty();
    }

    public static Sql generate(SchemaCatalog catalog, Map<String, Object> cfg, String chartType, boolean rawMode) {
        return new BuilderSqlBuilder(catalog, cfg, chartType, rawMode).build();
    }

    private Sql build() {
        if (baseTable == null) throw invalidReq("table is required.");
        assertTable(baseTable);
        knownTables.add(baseTable);

        if (hasJoins && cfg.get("sample") != null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_BUILDER_CONFIG", "Sample cannot be used with joins.");
        }

        String joins = buildJoins(); // 조인 검증 + 절 생성 (knownTables 확장 — select/where 해석 전에 선행)
        String sample = rawMode ? "" : sampleSql(); // 표본은 집계 경로 전용 (rows 모드는 무시 — §3B/§3C)
        String from = " FROM " + SqlIdentifier.quote(baseTable) + sample + joins;

        String xAxis = str(cfg.get("xAxis"));
        List<Map<String, Object>> yAxis = asMapList(cfg.get("yAxis"));
        if (rawMode) {
            // 원본 데이터 모드: SELECT * + WHERE + LIMIT (집계·정렬·버킷·표본 무시 — 생성규칙 §3B)
            List<Object> params = new ArrayList<>();
            String where = buildWhere(params);
            return new Sql("SELECT *" + from + where + " LIMIT " + QueryExecutor.MAX_ROWS, params);
        }

        if (xAxis == null) throw invalidReq("xAxis is required.");
        if (yAxis.isEmpty()) throw invalidReq("At least one yAxis is required.");
        Ref x = resolveRef(xAxis);

        // 차트 종류별 검증 (생성규칙 §9)
        boolean allNone = yAxis.stream().allMatch(y -> "none".equals(str(y.get("agg"))));
        validateChartShape(x, yAxis, allNone);

        String bucket = str(cfg.get("xAxisBucket"));
        String xSql;
        if (bucket == null) {
            xSql = x.quoted();
        } else {
            if (!Set.of("day", "week", "month").contains(bucket)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "BUCKET_TYPE_MISMATCH", "Unsupported bucket: " + bucket);
            }
            if (!isDate(typeOf(x))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "BUCKET_TYPE_MISMATCH", "Bucket requires a date/timestamp column.");
            }
            xSql = "DATE_TRUNC('" + bucket + "', " + x.quoted() + ") AS " + SqlIdentifier.quote(x.column);
        }

        List<String> selects = new ArrayList<>();
        selects.add(xSql);
        for (Map<String, Object> y : yAxis) {
            Ref col = resolveRef(str(y.get("column")));
            String agg = str(y.get("agg"));
            assertAggCompatible(agg, col);
            String alias = str(y.get("alias"));
            if (alias == null) alias = "none".equals(agg) ? col.column : (agg == null ? "val" : agg) + "_" + col.column;
            selects.add(aggSql(agg, col) + " AS " + SqlIdentifier.quote(alias));
        }

        List<Object> params = new ArrayList<>();
        String where = buildWhere(params);
        String order = buildOrder(yAxis.size());

        String groupBy;
        if (allNone) {
            groupBy = ""; // 분포(scatter)·원본 행: 집계 없음 → GROUP BY 없음 (기존 모순 버그 수정)
        } else {
            groupBy = " GROUP BY " + (bucket == null ? x.quoted() : "1");
        }

        String sql = "SELECT " + String.join(", ", selects) + from + where + groupBy + order
                + " LIMIT " + QueryExecutor.MAX_ROWS;
        return new Sql(sql, params);
    }

    // ── 조인 ─────────────────────────────────────────────
    private String buildJoins() {
        if (!hasJoins) return "";
        StringBuilder sb = new StringBuilder();
        for (Map<String, Object> join : joins) {
            String jt = str(join.get("table"));
            assertTable(jt);
            Map<String, Object> on = asMap(join.get("on"));
            if (on == null) throw invalidReq("join.on is required.");
            Ref left = resolveRef(str(on.get("leftColumn")));
            Ref right = resolveRef(str(on.get("rightColumn")));
            // 체인 규칙: leftColumn 은 base·앞선 조인 테이블만 / rightColumn 은 이 조인 테이블 자신 (§11.2)
            if (!knownTables.contains(left.table)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JOIN_CHAIN",
                        "Join left column must reference a preceding table: " + left.table);
            }
            if (!jt.equals(right.table)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JOIN_CHAIN",
                        "Join right column must belong to the joined table: " + jt);
            }
            if (!joinKeyCompatible(typeOf(left), typeOf(right))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "JOIN_KEY_TYPE_MISMATCH",
                        "Join key types are incompatible.");
            }
            String type = "inner".equals(join.get("type")) ? "INNER" : "LEFT";
            knownTables.add(jt);
            sb.append(" ").append(type).append(" JOIN ").append(SqlIdentifier.quote(jt))
                    .append(" ON ").append(left.quoted()).append(" = ").append(right.quoted());
        }
        return sb.toString();
    }

    // ── WHERE ────────────────────────────────────────────
    private String buildWhere(List<Object> params) {
        List<Map<String, Object>> where = asMapList(cfg.get("where"));
        if (where.isEmpty()) return "";
        List<String> parts = new ArrayList<>();
        for (Map<String, Object> w : where) {
            Ref col = resolveRef(str(w.get("column")));
            String op = str(w.get("op"));
            String type = typeOf(col);
            Object value = w.get("value");
            switch (op == null ? "eq" : op) {
                case "is_null" -> parts.add(col.quoted() + " IS NULL");
                case "is_not_null" -> parts.add(col.quoted() + " IS NOT NULL");
                case "contains", "starts_with" -> {
                    assertOpCompatible(op, type);
                    String s = value == null ? "" : String.valueOf(value);
                    String escaped = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
                    String pattern = "contains".equals(op) ? "%" + escaped + "%" : escaped + "%";
                    parts.add(col.quoted() + " ILIKE ?");
                    params.add(pattern);
                }
                case "in" -> {
                    List<Object> values = asList(value);
                    if (values.isEmpty()) throw invalidReq("IN requires at least one value.");
                    parts.add(col.quoted() + " IN (" + String.join(", ", values.stream().map(v -> "?").toList()) + ")");
                    for (Object v : values) params.add(bindValue(type, v));
                }
                case "between" -> {
                    List<Object> values = asList(value);
                    if (values.size() != 2) throw invalidReq("BETWEEN requires exactly two values.");
                    assertOpCompatible(op, type);
                    parts.add(col.quoted() + " BETWEEN ? AND ?");
                    params.add(bindValue(type, values.get(0)));
                    params.add(bindValue(type, values.get(1)));
                }
                case "neq" -> { parts.add(col.quoted() + " <> ?"); params.add(bindValue(type, value)); }
                case "gt" -> { assertOpCompatible(op, type); parts.add(col.quoted() + " > ?"); params.add(bindValue(type, value)); }
                case "gte" -> { assertOpCompatible(op, type); parts.add(col.quoted() + " >= ?"); params.add(bindValue(type, value)); }
                case "lt" -> { assertOpCompatible(op, type); parts.add(col.quoted() + " < ?"); params.add(bindValue(type, value)); }
                case "lte" -> { assertOpCompatible(op, type); parts.add(col.quoted() + " <= ?"); params.add(bindValue(type, value)); }
                default -> { parts.add(col.quoted() + " = ?"); params.add(bindValue(type, value)); }
            }
        }
        return " WHERE " + String.join(" AND ", parts);
    }

    // ── ORDER BY ─────────────────────────────────────────
    private String buildOrder(int seriesCount) {
        Map<String, Object> order = asMap(cfg.get("orderBy"));
        if (order == null) return "";
        String target = str(order.get("target"));
        if (target == null) target = "x";
        int pos;
        if ("x".equals(target)) {
            pos = 1;
        } else if (target.matches("y\\d+")) {
            int idx = Integer.parseInt(target.substring(1));
            if (idx >= seriesCount) throw invalidReq("orderBy target out of range: " + target);
            pos = idx + 2;
        } else {
            throw invalidReq("Invalid orderBy target: " + target);
        }
        String direction = str(order.get("direction"));
        boolean asc = "asc".equalsIgnoreCase(direction);
        return " ORDER BY " + pos + (asc ? " ASC" : " DESC");
    }

    // ── 표본 ─────────────────────────────────────────────
    private String sampleSql() {
        Object raw = cfg.get("sample");
        if (!(raw instanceof Map<?, ?> sample)) return "";
        Object rawRate = sample.get("rate");
        int rate = rawRate instanceof Number n ? n.intValue() : -1;
        if (rate < 1 || rate > 100) throw invalidReq("sample.rate must be between 1 and 100.");
        return " TABLESAMPLE SYSTEM (" + rate + ")";
    }

    // ── 검증 헬퍼 ────────────────────────────────────────
    private void validateChartShape(Ref x, List<Map<String, Object>> yAxis, boolean allNone) {
        boolean anyNone = yAxis.stream().anyMatch(y -> "none".equals(str(y.get("agg"))));
        if (allNone && cfg.get("sample") != null) {
            throw invalidReq("Sample cannot be used with raw values.");
        }
        if ("scatter".equals(chartType)) {
            if (!allNone) throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "scatter requires agg 'none' on all yAxis.");
            if (!isNumeric(typeOf(x))) throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "scatter xAxis must be numeric.");
        } else {
            if (anyNone && !allNone) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "raw values cannot be mixed with aggregate yAxis fields.");
            }
            if ("pie".equals(chartType) && yAxis.size() != 1) throw invalidReq("pie requires exactly one yAxis.");
        }
    }

    private void assertTable(String table) {
        if (!catalog.hasTable(table)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Unknown table: " + table);
        }
    }

    private void assertAggCompatible(String agg, Ref col) {
        String type = typeOf(col);
        if (agg == null) agg = "sum";
        switch (agg) {
            case "sum", "avg", "stddev" -> {
                if (!isNumeric(type)) throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", agg + " requires a numeric column.");
            }
            case "count", "count_distinct", "min", "max", "none" -> { /* 모든 타입 허용 */ }
            default -> throw invalidReq("Unknown agg: " + agg);
        }
    }

    private void assertOpCompatible(String op, String type) {
        switch (op) {
            case "gt", "gte", "lt", "lte", "between" -> {
                if (!isNumeric(type) && !isDate(type)) {
                    throw new ApiException(HttpStatus.BAD_REQUEST, "OP_TYPE_MISMATCH", op + " requires a numeric/date column.");
                }
            }
            case "contains", "starts_with" -> {
                if (!isText(type)) throw new ApiException(HttpStatus.BAD_REQUEST, "OP_TYPE_MISMATCH", op + " requires a text column.");
            }
            default -> { /* eq/neq/in/null: 모든 타입 */ }
        }
    }

    private Object bindValue(String type, Object value) {
        if (value == null) return null;
        try {
            if (isNumeric(type)) {
                if (value instanceof Number) return value;
                String s = String.valueOf(value).trim();
                if (s.contains(".") || s.contains("e") || s.contains("E")) return Double.parseDouble(s);
                return Long.parseLong(s);
            }
            if (isDate(type)) {
                if (value instanceof Number) return value;
                String s = String.valueOf(value).trim();
                if (s.length() <= 10) return java.sql.Date.valueOf(LocalDate.parse(s));
                return Timestamp.from(OffsetDateTime.parse(s).toInstant());
            }
            if (isBoolean(type)) {
                if (value instanceof Boolean) return value;
                return Boolean.parseBoolean(String.valueOf(value).trim());
            }
            return String.valueOf(value);
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "VALUE_PARSE_ERROR", "Cannot parse value for " + type + ": " + value);
        }
    }

    // ── 식별자 해석 ───────────────────────────────────────
    private record Ref(String table, String column) {
        String quoted() {
            return SqlIdentifier.quote(table) + "." + SqlIdentifier.quote(column);
        }
    }

    /** "테이블.컬럼" 또는 "컬럼"(조인 없을 때 base 암묵)을 카탈로그로 검증해 해석. */
    private Ref resolveRef(String ref) {
        if (ref == null) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Missing column reference.");
        int dot = ref.indexOf('.');
        String table;
        String column;
        if (dot >= 0) {
            table = ref.substring(0, dot);
            column = ref.substring(dot + 1);
        } else {
            if (hasJoins) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER",
                        "Ambiguous column (qualify as table.column when joins are present): " + ref);
            }
            table = baseTable;
            column = ref;
        }
        if (!catalog.hasColumn(table, column)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Unknown column: " + ref);
        }
        return new Ref(table, column);
    }

    private String typeOf(Ref ref) {
        return catalog.columnType(ref.table, ref.column);
    }

    private static String aggSql(String agg, Ref col) {
        String q = col.quoted();
        return switch (agg == null ? "sum" : agg) {
            case "avg" -> "AVG(" + q + ")";
            case "stddev" -> "STDDEV(" + q + ")";
            case "count" -> "COUNT(" + q + ")";
            case "count_distinct" -> "COUNT(DISTINCT " + q + ")";
            case "min" -> "MIN(" + q + ")";
            case "max" -> "MAX(" + q + ")";
            case "none" -> q;
            default -> "SUM(" + q + ")";
        };
    }

    // ── 타입 분류 ─────────────────────────────────────────
    private static boolean isNumeric(String t) {
        if (t == null) return false;
        t = t.toLowerCase(Locale.ROOT);
        return t.contains("int") || t.equals("numeric") || t.equals("decimal") || t.equals("real")
                || t.contains("double") || t.equals("money") || t.equals("serial") || t.contains("float");
    }

    private static boolean isDate(String t) {
        if (t == null) return false;
        t = t.toLowerCase(Locale.ROOT);
        return t.startsWith("date") || t.startsWith("timestamp");
    }

    private static boolean isBoolean(String t) {
        return t != null && t.toLowerCase(Locale.ROOT).startsWith("bool");
    }

    private static boolean isText(String t) {
        if (t == null) return false;
        t = t.toLowerCase(Locale.ROOT);
        return t.contains("char") || t.equals("text") || t.equals("citext") || t.equals("uuid");
    }

    private static boolean joinKeyCompatible(String a, String b) {
        return (isNumeric(a) && isNumeric(b)) || (isText(a) && isText(b)) || (isDate(a) && isDate(b))
                || (a != null && a.equalsIgnoreCase(b));
    }

    // ── 일반 헬퍼 ─────────────────────────────────────────
    private static ApiException invalidReq(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message);
    }

    private static String str(Object value) {
        if (value == null) return null;
        String s = String.valueOf(value);
        return s.isBlank() ? null : s;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> asMapList(Object value) {
        return value instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    private static List<Object> asList(Object value) {
        if (value instanceof List<?> l) return new ArrayList<>(l);
        if (value == null) return List.of();
        List<Object> single = new ArrayList<>();
        single.add(value);
        return single;
    }
}
