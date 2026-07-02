package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 노코드 builderConfig → (검증된 SQL + 바인딩). 모든 식별자는 {@link Catalog} 화이트리스트로 검증한 뒤에만
 * 큰따옴표로 감싼다(노코드 SQL생성규칙 §1.2·§9·§11). 값은 전부 PreparedStatement 바인딩.
 * 검증 실패는 SQL 생성 전에 400 으로 차단한다 — 노코드 사용자에게 DB 에러를 노출하지 않는다(§9).
 *
 * <p>단일 소스는 {@link RefRenderer#SINGLE}(PG, {@code "schema"."table"}), 다중 소스는
 * {@link RefRenderer#FEDERATED}(DuckDB, {@code "ds{id}"."schema"."table"})로 참조를 렌더링한다(설계 §6).
 * WHERE·집계·조인 로직은 렌더러와 무관하게 한 벌 공유한다.
 */
public final class BuilderSqlBuilder {

    public record Sql(String text, List<Object> params) {
    }

    private final Catalog catalog;
    private final RefRenderer renderer;
    private final Map<String, Object> cfg;
    private final String chartType;
    private final boolean rawMode;
    private final TableRef baseRef;
    private final List<Map<String, Object>> joins;
    private final boolean hasJoins;
    /** 이 쿼리에 등장한 테이블(핸들 → 한정 참조). 컬럼 참조의 소스·스키마 해석에 쓴다(동명 테이블은 서로 다른 핸들). */
    private final Map<String, TableRef> knownTables = new LinkedHashMap<>();

    private BuilderSqlBuilder(Catalog catalog, RefRenderer renderer, Map<String, Object> cfg, String chartType, boolean rawMode) {
        this.catalog = catalog;
        this.renderer = renderer;
        this.cfg = cfg;
        this.chartType = chartType;
        this.rawMode = rawMode;
        this.baseRef = parseTableRef(cfg.get("table"));
        this.joins = asMapList(cfg.get("joins"));
        this.hasJoins = !joins.isEmpty();
    }

    /** 단일 소스 경로(PG 직접 실행). 기존 시그니처 — 출력·동작 불변. */
    public static Sql generate(SchemaCatalog catalog, Map<String, Object> cfg, String chartType, boolean rawMode) {
        return new BuilderSqlBuilder(catalog, RefRenderer.SINGLE, cfg, chartType, rawMode).build();
    }

    /** 일반 경로 — 카탈로그·렌더러 주입(다중 소스 페더레이션 등). */
    public static Sql generate(Catalog catalog, RefRenderer renderer, Map<String, Object> cfg, String chartType, boolean rawMode) {
        return new BuilderSqlBuilder(catalog, renderer, cfg, chartType, rawMode).build();
    }

    /** builderConfig 가 참조하는 datasourceId 집합(명시된 것만). 실행 라우팅(단일 vs 페더레이션) 판정에 쓴다. */
    public static Set<Long> referencedDatasources(Map<String, Object> cfg) {
        Set<Long> ids = new LinkedHashSet<>();
        TableRef base = parseTableRef(cfg.get("table"));
        if (base != null && base.datasourceId() != null) ids.add(base.datasourceId());
        for (Map<String, Object> j : asMapList(cfg.get("joins"))) {
            TableRef t = parseTableRef(j.get("table"));
            if (t != null && t.datasourceId() != null) ids.add(t.datasourceId());
        }
        return ids;
    }

    private Sql build() {
        if (baseRef == null) throw invalidReq("table is required.");
        assertTable(baseRef);
        registerTable(baseRef);

        if (hasJoins && cfg.get("sample") != null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_BUILDER_CONFIG", "Sample cannot be used with joins.");
        }

        String joins = buildJoins(); // 조인 검증 + 절 생성 (knownTables 확장 — select/where 해석 전에 선행)
        String sample = rawMode ? "" : sampleSql(); // 표본은 집계 경로 전용 (rows 모드는 무시 — §3B/§3C)
        String from = " FROM " + render(baseRef) + sample + joins;

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
            xSql = render(x);
        } else {
            if (!Set.of("day", "week", "month").contains(bucket)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "BUCKET_TYPE_MISMATCH", "Unsupported bucket: " + bucket);
            }
            if (!isDate(typeOf(x))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "BUCKET_TYPE_MISMATCH", "Bucket requires a date/timestamp column.");
            }
            xSql = "DATE_TRUNC('" + bucket + "', " + render(x) + ") AS " + SqlIdentifier.quote(x.column());
        }

        List<String> selects = new ArrayList<>();
        selects.add(xSql);
        for (Map<String, Object> y : yAxis) {
            Ref col = resolveRef(str(y.get("column")));
            String agg = str(y.get("agg"));
            assertAggCompatible(agg, col);
            String alias = str(y.get("alias"));
            if (alias == null) alias = "none".equals(agg) ? col.column() : (agg == null ? "val" : agg) + "_" + col.column();
            selects.add(aggSql(agg, col) + " AS " + SqlIdentifier.quote(alias));
        }

        List<Object> params = new ArrayList<>();
        String where = buildWhere(params);
        String order = buildOrder(yAxis.size());

        String groupBy;
        if (allNone) {
            groupBy = ""; // 분포(scatter)·원본 행: 집계 없음 → GROUP BY 없음 (기존 모순 버그 수정)
        } else {
            groupBy = " GROUP BY " + (bucket == null ? render(x) : "1");
        }

        String sql = "SELECT " + String.join(", ", selects) + from + where + groupBy + order
                + " LIMIT " + QueryExecutor.MAX_ROWS;
        return new Sql(sql, params);
    }

    // ── 참조 렌더링(전략 위임) ─────────────────────────────
    private String render(TableRef t) {
        return renderer.table(t.datasourceId(), t.schema(), t.table());
    }

    private String render(Ref r) {
        TableRef t = r.table();
        return renderer.column(t.datasourceId(), t.schema(), t.table(), r.column());
    }

    // ── 조인 ─────────────────────────────────────────────
    private String buildJoins() {
        if (!hasJoins) return "";
        StringBuilder sb = new StringBuilder();
        for (Map<String, Object> join : joins) {
            TableRef jt = parseTableRef(join.get("table"));
            if (jt == null) throw invalidReq("join.table is required.");
            assertTable(jt);
            Map<String, Object> on = asMap(join.get("on"));
            if (on == null) throw invalidReq("join.on is required.");
            // 체인 규칙: leftColumn 은 base·앞선 조인 테이블만 / rightColumn 은 이 조인 테이블 자신 (§11.2).
            // 새 테이블을 먼저 등록해야 rightColumn(자기 자신)의 스키마를 해석할 수 있어, 등록 전 스냅샷으로 체인을 검사한다.
            Set<String> preceding = new LinkedHashSet<>(knownTables.keySet()); // 핸들 스냅샷
            registerTable(jt);
            Ref left = resolveRef(str(on.get("leftColumn")));
            Ref right = resolveRef(str(on.get("rightColumn")));
            if (!preceding.contains(left.table().handle())) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JOIN_CHAIN",
                        "Join left column must reference a preceding table: " + left.table().handle());
            }
            if (!jt.handle().equals(right.table().handle())) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JOIN_CHAIN",
                        "Join right column must belong to the joined table: " + jt.handle());
            }
            if (!joinKeyCompatible(typeOf(left), typeOf(right))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "JOIN_KEY_TYPE_MISMATCH",
                        "Join key types are incompatible.");
            }
            String type = "inner".equals(join.get("type")) ? "INNER" : "LEFT";
            sb.append(" ").append(type).append(" JOIN ").append(render(jt))
                    .append(" ON ").append(render(left)).append(" = ").append(render(right));
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
            String colSql = render(col);
            String op = str(w.get("op"));
            String type = typeOf(col);
            Object value = w.get("value");
            switch (op == null ? "eq" : op) {
                case "is_null" -> parts.add(colSql + " IS NULL");
                case "is_not_null" -> parts.add(colSql + " IS NOT NULL");
                case "contains", "starts_with" -> {
                    assertOpCompatible(op, type);
                    String s = value == null ? "" : String.valueOf(value);
                    String escaped = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
                    String pattern = "contains".equals(op) ? "%" + escaped + "%" : escaped + "%";
                    parts.add(colSql + " ILIKE ?");
                    params.add(pattern);
                }
                case "in" -> {
                    List<Object> values = asList(value);
                    if (values.isEmpty()) throw invalidReq("IN requires at least one value.");
                    parts.add(colSql + " IN (" + String.join(", ", values.stream().map(v -> "?").toList()) + ")");
                    for (Object v : values) params.add(bindValue(type, v));
                }
                case "between" -> {
                    List<Object> values = asList(value);
                    if (values.size() != 2) throw invalidReq("BETWEEN requires exactly two values.");
                    assertOpCompatible(op, type);
                    parts.add(colSql + " BETWEEN ? AND ?");
                    params.add(bindValue(type, values.get(0)));
                    params.add(bindValue(type, values.get(1)));
                }
                case "neq" -> { parts.add(colSql + " <> ?"); params.add(bindValue(type, value)); }
                case "gt" -> { assertOpCompatible(op, type); parts.add(colSql + " > ?"); params.add(bindValue(type, value)); }
                case "gte" -> { assertOpCompatible(op, type); parts.add(colSql + " >= ?"); params.add(bindValue(type, value)); }
                case "lt" -> { assertOpCompatible(op, type); parts.add(colSql + " < ?"); params.add(bindValue(type, value)); }
                case "lte" -> { assertOpCompatible(op, type); parts.add(colSql + " <= ?"); params.add(bindValue(type, value)); }
                default -> { parts.add(colSql + " = ?"); params.add(bindValue(type, value)); }
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

    private void assertTable(TableRef table) {
        if (!catalog.hasTable(table.datasourceId(), table.schema(), table.table())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Unknown table: " + display(table));
        }
    }

    /**
     * 컬럼 참조가 가리킬 테이블을 핸들로 등록한다. 서로 다른 소스/스키마의 동명 테이블은 서로 다른 핸들을 받으므로
     * 한 쿼리에서 함께 조인할 수 있다(예: users ⋈ users_2). 같은 핸들이 서로 다른 물리 테이블을 가리키면 모호하므로 거부.
     */
    private void registerTable(TableRef ref) {
        TableRef existing = knownTables.get(ref.handle());
        if (existing != null && !existing.samePhysical(ref)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER",
                    "Ambiguous table handle: " + ref.handle());
        }
        knownTables.put(ref.handle(), ref);
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
    /**
     * 소스·스키마 한정 테이블 참조. datasourceId 는 다중 소스에서만 non-null.
     * {@code handle} 은 한 쿼리 내 이 테이블 인스턴스의 유일 식별자(컬럼 참조가 이 값을 prefix 로 쓴다) —
     * 기본은 테이블 이름, 동명 테이블이 겹칠 때만 프론트가 접미(users_2)로 구분한다. SQL 출력에는 등장하지 않는다.
     */
    private record TableRef(Long datasourceId, String schema, String table, String handle) {
        boolean samePhysical(TableRef o) {
            return java.util.Objects.equals(datasourceId, o.datasourceId)
                    && schema.equals(o.schema) && table.equals(o.table);
        }
    }

    private record Ref(TableRef table, String column) {
    }

    /**
     * 테이블 참조 파싱 — 구조화 객체 {@code {datasourceId, schema, name}}(다중 소스) 또는
     * 문자열 {@code "schema.table"}/{@code "table"}(단일 소스 하위호환, datasourceId=null). null/공백 → null.
     */
    private static TableRef parseTableRef(Object raw) {
        if (raw == null) return null;
        if (raw instanceof Map<?, ?> m) {
            Object dsRaw = m.get("datasourceId");
            Long ds = dsRaw instanceof Number n ? n.longValue() : null;
            String schema = str(m.get("schema"));
            String name = str(m.get("name"));
            if (name == null) return null;
            String handle = str(m.get("handle")); // 동명 테이블 구분용 — 없으면 이름이 곧 핸들(단일/비충돌 하위호환).
            return new TableRef(ds, schema == null ? SchemaCatalog.DEFAULT_SCHEMA : schema, name, handle == null ? name : handle);
        }
        String s = str(raw);
        if (s == null) return null;
        int dot = s.indexOf('.');
        if (dot < 0) return new TableRef(null, SchemaCatalog.DEFAULT_SCHEMA, s, s);
        String schema = s.substring(0, dot);
        String name = s.substring(dot + 1);
        return new TableRef(null, schema, name, name);
    }

    /** 오류 메시지용 표기 — public 은 생략, 그 외는 schema.table (소스는 표기 생략, 검증 무관). */
    private static String display(TableRef t) {
        return SchemaCatalog.DEFAULT_SCHEMA.equals(t.schema()) ? t.table() : t.schema() + "." + t.table();
    }

    /** "테이블.컬럼" 또는 "컬럼"(조인 없을 때 base 암묵)을 카탈로그로 검증해 해석. 테이블 소스·스키마는 knownTables 로 해석. */
    private Ref resolveRef(String ref) {
        if (ref == null) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Missing column reference.");
        int dot = ref.indexOf('.');
        String tableName;
        String column;
        if (dot >= 0) {
            tableName = ref.substring(0, dot);
            column = ref.substring(dot + 1);
        } else {
            if (hasJoins) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER",
                        "Ambiguous column (qualify as table.column when joins are present): " + ref);
            }
            tableName = baseRef.handle();
            column = ref;
        }
        TableRef table = knownTables.get(tableName); // knownTables 는 핸들로 키잉
        if (table == null || !catalog.hasColumn(table.datasourceId(), table.schema(), table.table(), column)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Unknown column: " + ref);
        }
        return new Ref(table, column);
    }

    private String typeOf(Ref ref) {
        TableRef t = ref.table();
        return catalog.columnType(t.datasourceId(), t.schema(), t.table(), ref.column());
    }

    private String aggSql(String agg, Ref col) {
        String q = render(col);
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
