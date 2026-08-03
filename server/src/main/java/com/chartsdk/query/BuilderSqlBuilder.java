package com.chartsdk.query;

import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;

import java.sql.Timestamp;
import java.math.BigDecimal;
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

    public record Sql(String text, List<Object> params, SamplingMetadata sampling) {
        public Sql(String text, List<Object> params) {
            this(text, params, null);
        }
    }

    private final Catalog catalog;
    private RefRenderer renderer; // INDEX_RANDOM 경로에서 CTE 별칭 렌더러로 교체(그 외 불변)
    private final Map<String, Object> cfg;
    private final String chartType;
    private final boolean rawMode;
    private final SamplePlan plan; // 표본 실행 계획(null = 무플랜 레거시/비표본)
    private final boolean federated;
    private final TableRef baseRef;
    private final List<Map<String, Object>> joins;
    private final boolean hasJoins;
    /** 이 쿼리에 등장한 테이블(핸들 → 한정 참조). 컬럼 참조의 소스·스키마 해석에 쓴다(동명 테이블은 서로 다른 핸들). */
    private final Map<String, TableRef> knownTables = new LinkedHashMap<>();

    // 인덱스 표본 CTE 식별자(예약 접두 __chartsdk_ — alias 가드와 일치).
    private static final String SAMPLE_CTE = "__chartsdk_sample";
    private static final String N_CTE = "__chartsdk_n";
    private static final String POPULATION_CTE = "__chartsdk_population";
    private static final String BASE_ALIAS = "__chartsdk_base";
    private static final String KEYS_ALIAS = "__chartsdk_keys";
    private static final String RESULT_X = "__chartsdk_x";
    private static final String RESULT_SERIES = "__chartsdk_series";
    private static final String RESULT_Y_PREFIX = "__chartsdk_y_";
    private static final String SPATIAL_LONGITUDE = "__chartsdk_longitude";
    private static final String SPATIAL_LATITUDE = "__chartsdk_latitude";
    private static final String GEO_POINT_NAME = "__chartsdk_point_name";
    private static final String GEO_POINT_VALUE = "__chartsdk_point_value";
    private static final String SPATIAL_SIZE = "__chartsdk_size";
    private static final String GEO_POINT_COLOR = "__chartsdk_color_value";
    private static final String GEO_SERIES = "__chartsdk_series";
    private static final String SPATIAL_AREA_NAME = "__chartsdk_area_name";
    private static final String SPATIAL_AREA_VALUE = "__chartsdk_area_value";
    private static final String SPATIAL_AREA_GEOJSON = "__chartsdk_geojson";
    private static final String SPATIAL_SOURCE = "__chartsdk_spatial_source";
    private static final String SPATIAL_VALUE = "__chartsdk_spatial_value";
    private static final String SPATIAL_CTE = "__chartsdk_spatial";

    private BuilderSqlBuilder(Catalog catalog, RefRenderer renderer, Map<String, Object> cfg,
                             String chartType, boolean rawMode, SamplePlan plan, boolean federated) {
        this.catalog = catalog;
        this.renderer = renderer;
        this.cfg = cfg;
        this.chartType = chartType;
        this.rawMode = rawMode;
        this.plan = plan;
        this.federated = federated;
        this.baseRef = parseTableRef(cfg.get("table"));
        this.joins = asMapList(cfg.get("joins"));
        this.hasJoins = !joins.isEmpty();
    }

    /** 단일 소스 경로(PG 직접 실행). 무플랜 — 레거시 SYSTEM/비표본. */
    public static Sql generate(SchemaCatalog catalog, Map<String, Object> cfg, String chartType, boolean rawMode) {
        return new BuilderSqlBuilder(catalog, RefRenderer.SINGLE, cfg, chartType, rawMode, null, false).build();
    }

    /** 단일 소스 + 표본 실행 계획(INDEX_RANDOM/RESULT_RANDOM/SYSTEM/FULL_SCAN). */
    public static Sql generate(SchemaCatalog catalog, Map<String, Object> cfg, String chartType, boolean rawMode, SamplePlan plan) {
        return new BuilderSqlBuilder(catalog, RefRenderer.SINGLE, cfg, chartType, rawMode, plan, false).build();
    }

    /** 일반 경로 — 카탈로그·렌더러 주입(다중 소스 페더레이션 등). */
    public static Sql generate(Catalog catalog, RefRenderer renderer, Map<String, Object> cfg, String chartType, boolean rawMode) {
        return new BuilderSqlBuilder(catalog, renderer, cfg, chartType, rawMode, null, renderer == RefRenderer.FEDERATED).build();
    }

    /** 다중 소스 포함 일반 경로 + 실행 표본 계획. */
    public static Sql generate(Catalog catalog, RefRenderer renderer, Map<String, Object> cfg,
                               String chartType, boolean rawMode, SamplePlan plan) {
        return new BuilderSqlBuilder(catalog, renderer, cfg, chartType, rawMode, plan,
                renderer == RefRenderer.FEDERATED).build();
    }

    /** RESULT_RANDOM 확률 계산용 JOIN+WHERE 모집단 계획 SQL. EXPLAIN 전용이며 실제 행은 읽지 않는다. */
    public static Sql generateSamplingPopulation(Catalog catalog, RefRenderer renderer,
                                                 Map<String, Object> cfg, String chartType) {
        return new BuilderSqlBuilder(catalog, renderer, cfg, chartType, false, null,
                renderer == RefRenderer.FEDERATED).buildSamplingPopulation();
    }

    /** 단일 PostgreSQL 소스의 RESULT_RANDOM 모집단 계획 SQL. */
    public static Sql generateSamplingPopulation(SchemaCatalog catalog, Map<String, Object> cfg,
                                                 String chartType) {
        return generateSamplingPopulation(catalog, RefRenderer.SINGLE, cfg, chartType);
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

        String joins = buildJoins(); // 조인 검증 + 절 생성 (knownTables 확장 — select/where 해석 전에 선행)
        SamplingMetadata sampling = rawMode ? null : resolveSampling(); // rows 탭은 표본 집계와 별도 원본 미리보기

        String xAxis = str(cfg.get("xAxis"));
        String seriesBy = str(cfg.get("seriesBy"));
        List<Map<String, Object>> yAxis = asMapList(cfg.get("yAxis"));
        if (rawMode) {
            // 행 조회 모드: SELECT * + WHERE + 선택 원본 컬럼 정렬 + LIMIT.
            // x/y 기반 차트 정렬(target=x/yN)은 기존 원본 조회 호환을 위해 무시한다.
            List<Object> params = new ArrayList<>();
            String where = buildWhere(params);
            String order = buildRawOrder();
            return new Sql("SELECT *" + " FROM " + render(baseRef) + joins + where + order
                    + " LIMIT " + QueryExecutor.MAX_ROWS, params, null);
        }

        if (isSpatialGeoPoint()) {
            return buildSpatialGeoScatter(joins, sampling);
        }
        if (isSpatialGeoArea()) {
            return buildSpatialGeoMap(joins, sampling);
        }

        if (xAxis == null) throw invalidReq("xAxis is required.");
        if (yAxis.isEmpty()) throw invalidReq("At least one yAxis is required.");
        Ref x = resolveRef(xAxis);
        Ref series = seriesBy == null ? null : resolveRef(seriesBy);

        // 차트 종류별 검증 (생성규칙 §9) — 표본 형태 결정·렌더러 교체보다 먼저 수행한다.
        boolean allNone = yAxis.stream().allMatch(y -> "none".equals(str(y.get("agg"))));
        validateChartShape(x, series, yAxis, allNone);

        if (sampling != null && sampling.approximate() && "RESULT_RANDOM".equals(sampling.method())) {
            return buildResultRandom(x, series, yAxis, joins, sampling);
        }

        // 표본 SQL 형태 — INDEX_RANDOM: CTE 래핑 + 별칭 렌더러 / SYSTEM: TABLESAMPLE / 그 외: 평이.
        boolean approximate = sampling != null && sampling.approximate();
        boolean indexRandom = approximate && "INDEX_RANDOM".equals(sampling.method());
        if (indexRandom && (plan == null || plan.method() != SamplePlan.Method.INDEX_RANDOM)) {
            throw invalidReq("Index sampling requires an execution plan.");
        }
        String cteHead = "";
        List<Object> leadingParams = new ArrayList<>();
        String fromBase;
        if (indexRandom) {
            String physicalBase = RefRenderer.SINGLE.table(baseRef.datasourceId(), baseRef.schema(), baseRef.table());
            String pk = SqlIdentifier.quote(plan.pkColumn());
            String sampleCte = SqlIdentifier.quote(SAMPLE_CTE), nCte = SqlIdentifier.quote(N_CTE);
            String baseAlias = SqlIdentifier.quote(BASE_ALIAS), keysAlias = SqlIdentifier.quote(KEYS_ALIAS);
            String v = SqlIdentifier.quote("v"), sampled = SqlIdentifier.quote("sampled");
            cteHead = "WITH " + sampleCte + " AS (SELECT " + baseAlias + ".* FROM unnest(?) AS " + keysAlias + "(" + v + ") "
                    + "JOIN " + physicalBase + " " + baseAlias + " ON " + baseAlias + "." + pk + " = " + keysAlias + "." + v + "), "
                    + nCte + " AS (SELECT COUNT(*) AS " + sampled + " FROM " + sampleCte + ") ";
            leadingParams.add(plan.keys());
            renderer = RefRenderer.alias(SAMPLE_CTE); // 이후 모든 외부 참조를 CTE 별칭으로 렌더
            fromBase = sampleCte;
        } else if (approximate && "SYSTEM".equals(sampling.method())) {
            double blockRate = plan != null ? plan.blockRate() : sampling.rate();
            fromBase = render(baseRef) + " TABLESAMPLE SYSTEM (" + number(blockRate) + ") REPEATABLE (" + sampling.seed() + ")";
        } else {
            fromBase = render(baseRef); // FULL_SCAN 또는 표본 없음
        }
        String from = " FROM " + fromBase + joins;

        String bucket = str(cfg.get("xAxisBucket"));
        String xSql;
        if (bucket == null) {
            if (isGeoPointSeries()) {
                xSql = render(x) + " AS " + SqlIdentifier.quote(SPATIAL_LONGITUDE);
            } else if (isGeoAreaSeries()) {
                xSql = "CAST(" + render(x) + " AS text) AS " + SqlIdentifier.quote(SPATIAL_AREA_NAME);
            } else {
                xSql = render(x);
            }
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
        if (series != null) {
            String alias = isGeoSeries() ? GEO_SERIES : series.column();
            String expression = isGeoSeries() ? "CAST(" + render(series) + " AS text)" : render(series);
            selects.add(expression + " AS " + SqlIdentifier.quote(alias));
        }
        for (int yIndex = 0; yIndex < yAxis.size(); yIndex++) {
            Map<String, Object> y = yAxis.get(yIndex);
            Ref col = resolveRef(str(y.get("column")));
            String agg = str(y.get("agg"));
            assertAggCompatible(agg, col);
            String alias = str(y.get("alias"));
            if (alias == null) alias = "none".equals(agg) ? col.column() : (agg == null ? "val" : agg) + "_" + col.column();
            if (alias.startsWith("__chartsdk_")) throw invalidReq("Alias cannot start with reserved prefix __chartsdk_.");
            if (isGeoPointSeries()) alias = yIndex == 0 ? SPATIAL_LATITUDE : SPATIAL_SIZE;
            if (isGeoAreaSeries() && yIndex == 0) alias = SPATIAL_AREA_VALUE;
            selects.add(aggSql(agg, col) + " AS " + SqlIdentifier.quote(alias));
        }
        if (isGeoPointSeries()) appendGeoPointRoleSelects(selects);
        // 표본 입력 수는 결과 행 수(그룹 수)와 다르다. 그룹별 n·전체 n(+INDEX_RANDOM 은 그룹별 mean/sd)을 숨은 열로 수집하고
        // 실행 라우터가 API/변환기 전달 전에 제거한다(오차범위 계산용 — §표본추출).
        // 원본값 행 표본은 각 행 자체가 결과다. 집계용 숨은 COUNT/통계 열을 섞으면
        // GROUP BY 없는 원본 열과 충돌하므로 실행 메타데이터의 행 수는 결과 rows에서 계산한다.
        if (approximate && !allNone) selects.addAll(hiddenSampleColumns(yAxis, indexRandom));

        List<Object> params = new ArrayList<>(leadingParams);
        String where = buildWhere(params);
        String order = buildOrder(yAxis.size(), series != null);

        String groupBy;
        if (allNone) {
            groupBy = ""; // 분포(scatter)·원본 행: 집계 없음 → GROUP BY 없음 (기존 모순 버그 수정)
        } else {
            groupBy = " GROUP BY " + (bucket == null ? render(x) : "1")
                    + (series == null ? "" : ", " + render(series));
        }

        String sql = cteHead + "SELECT " + String.join(", ", selects) + from + where + groupBy + order;
        return new Sql(sql, params, sampling);
    }

    /**
     * Bernoulli 확률의 분모가 되는 결과 모집단을 PostgreSQL/DuckDB planner에 질의한다.
     * SELECT 1만 투영하므로 공간 변환이나 집계는 실행 계획에 포함하지 않는다.
     */
    private Sql buildSamplingPopulation() {
        if (baseRef == null) throw invalidReq("table is required.");
        assertTable(baseRef);
        registerTable(baseRef);
        String joins = buildJoins();
        List<Object> params = new ArrayList<>();
        String where = buildWhere(params);
        return new Sql("SELECT 1 FROM " + render(baseRef) + joins + where, params, null);
    }

    /** 표본 스펙(sampling())을 실행 계획으로 해석 — 무플랜은 레거시(SYSTEM/exact) 해석 그대로. */
    private SamplingMetadata resolveSampling() {
        SamplingMetadata spec = sampling();
        if (spec == null) return null;
        if (plan == null && hasJoins) {
            int size = spec.sizeTarget() == null ? SamplingPlanner.DEFAULT_SIZE : spec.sizeTarget();
            return spec.asResultRandom(0, size);
        }
        if (plan == null) return spec;
        return switch (plan.method()) {
            case FULL_SCAN -> spec.asExact();
            case SYSTEM -> spec.asSystem(plan.populationEstimate(), plan.sampleSize());
            case INDEX_RANDOM -> spec.asIndexRandom(plan.populationEstimate(), plan.sampleSize());
            case RESULT_RANDOM -> spec.asResultRandom(plan.populationEstimate(), plan.sampleSize());
            case NONE -> spec;
        };
    }

    private record RawSamplingSource(String cteHead, String fromBase, List<Object> leadingParams) {}

    /**
     * 집계하지 않는 공간 행에도 일반 원본값과 동일한 표본 계획을 적용한다.
     * INDEX_RANDOM은 먼저 물리 PK 표본 CTE를 만들고 이후 공간 함수를 그 별칭에 적용한다.
     */
    private RawSamplingSource prepareRawSamplingSource(SamplingMetadata sampling) {
        boolean approximate = sampling != null && sampling.approximate();
        if (approximate && "INDEX_RANDOM".equals(sampling.method())) {
            if (plan == null || plan.method() != SamplePlan.Method.INDEX_RANDOM) {
                throw invalidReq("Index sampling requires an execution plan.");
            }
            String physicalBase = RefRenderer.SINGLE.table(baseRef.datasourceId(), baseRef.schema(), baseRef.table());
            String pk = SqlIdentifier.quote(plan.pkColumn());
            String sampleCte = SqlIdentifier.quote(SAMPLE_CTE);
            String baseAlias = SqlIdentifier.quote(BASE_ALIAS);
            String keysAlias = SqlIdentifier.quote(KEYS_ALIAS);
            String value = SqlIdentifier.quote("v");
            String cte = "WITH " + sampleCte + " AS (SELECT " + baseAlias + ".* FROM unnest(?) AS "
                    + keysAlias + "(" + value + ") JOIN " + physicalBase + " " + baseAlias
                    + " ON " + baseAlias + "." + pk + " = " + keysAlias + "." + value + ") ";
            renderer = RefRenderer.alias(SAMPLE_CTE);
            return new RawSamplingSource(cte, sampleCte, new ArrayList<>(List.of(plan.keys())));
        }
        if (approximate && "SYSTEM".equals(sampling.method())) {
            double blockRate = plan != null ? plan.blockRate() : sampling.rate();
            String from = render(baseRef) + " TABLESAMPLE SYSTEM (" + number(blockRate)
                    + ") REPEATABLE (" + sampling.seed() + ")";
            return new RawSamplingSource("", from, new ArrayList<>());
        }
        return new RawSamplingSource("", render(baseRef), new ArrayList<>());
    }

    private Sql finishRawProjectionSampling(String sql, List<Object> params, SamplingMetadata sampling) {
        if (sampling == null || !sampling.approximate() || !"RESULT_RANDOM".equals(sampling.method())) {
            return new Sql(sql, params, sampling);
        }
        String population = SqlIdentifier.quote(POPULATION_CTE);
        String sample = SqlIdentifier.quote(SAMPLE_CTE);
        String barrier = hasJoins ? " OFFSET 0" : "";
        String wrapped = "WITH " + population + " AS (" + sql + barrier + "), "
                + sample + " AS MATERIALIZED (SELECT " + population + ".* FROM " + population
                + " WHERE random() < ?) SELECT * FROM " + sample;
        List<Object> wrappedParams = new ArrayList<>(params);
        wrappedParams.add(resultBernoulliProbability(sampling));
        return new Sql(wrapped, wrappedParams, sampling);
    }

    /**
     * VIEW 또는 JOIN+WHERE 결과를 실행 경계로 확정한 뒤 독립 Bernoulli 행 표본을 만들고 집계한다.
     * OFFSET 0은 PostgreSQL/DuckDB가 외부 random 조건을 JOIN 한쪽으로 밀어 넣지 못하게 하는 스트리밍 경계다.
     */
    private Sql buildResultRandom(Ref x, Ref series, List<Map<String, Object>> yAxis, String joins,
                                   SamplingMetadata sampling) {
        boolean allNone = yAxis.stream().allMatch(y -> "none".equals(str(y.get("agg"))));

        List<String> projected = new ArrayList<>();
        projected.add(render(x) + " AS " + SqlIdentifier.quote(RESULT_X));
        if (series != null) projected.add(render(series) + " AS " + SqlIdentifier.quote(RESULT_SERIES));
        List<Ref> yRefs = new ArrayList<>();
        for (int i = 0; i < yAxis.size(); i++) {
            Ref ref = resolveRef(str(yAxis.get(i).get("column")));
            assertAggCompatible(str(yAxis.get(i).get("agg")), ref);
            yRefs.add(ref);
            projected.add(render(ref) + " AS " + SqlIdentifier.quote(RESULT_Y_PREFIX + i));
        }
        Map<String, Ref> geoPointRoleRefs = geoPointRoleRefs();
        for (Map.Entry<String, Ref> entry : geoPointRoleRefs.entrySet()) {
            String expression = render(entry.getValue());
            if (GEO_POINT_NAME.equals(entry.getKey())) expression = "CAST(" + expression + " AS text)";
            projected.add(expression + " AS " + SqlIdentifier.quote(entry.getKey()));
        }

        List<Object> params = new ArrayList<>();
        StringBuilder cte = new StringBuilder("WITH ");

        String where = buildWhere(params);
        String population = SqlIdentifier.quote(POPULATION_CTE);
        String sample = SqlIdentifier.quote(SAMPLE_CTE);
        String nCte = SqlIdentifier.quote(N_CTE);
        String barrier = hasJoins ? " OFFSET 0" : "";
        cte.append(population).append(" AS (SELECT ")
                .append(String.join(", ", projected))
                .append(" FROM ").append(render(baseRef)).append(joins).append(where).append(barrier).append("), ")
                .append(sample).append(" AS MATERIALIZED (SELECT ").append(population).append(".* FROM ")
                .append(population).append(" WHERE random() < ?");
        params.add(resultBernoulliProbability(sampling));
        cte.append("), ").append(nCte).append(" AS (SELECT COUNT(*) AS ")
                .append(SqlIdentifier.quote("sampled")).append(" FROM ").append(sample).append(") ");

        String sampledX = sampleColumn(RESULT_X);
        String bucket = str(cfg.get("xAxisBucket"));
        String xSql;
        if (bucket == null) {
            String xAlias = isGeoPointSeries() ? SPATIAL_LONGITUDE
                    : isGeoAreaSeries() ? SPATIAL_AREA_NAME : x.column();
            xSql = sampledX + " AS " + SqlIdentifier.quote(xAlias);
        } else {
            if (!Set.of("day", "week", "month").contains(bucket)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "BUCKET_TYPE_MISMATCH", "Unsupported bucket: " + bucket);
            }
            if (!isDate(typeOf(x))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "BUCKET_TYPE_MISMATCH", "Bucket requires a date/timestamp column.");
            }
            xSql = "DATE_TRUNC('" + bucket + "', " + sampledX + ") AS " + SqlIdentifier.quote(x.column());
        }

        List<String> selects = new ArrayList<>();
        selects.add(xSql);
        String sampledSeries = series == null ? null : sampleColumn(RESULT_SERIES);
        if (sampledSeries != null) {
            selects.add(sampledSeries + " AS " + SqlIdentifier.quote(isGeoSeries() ? GEO_SERIES : series.column()));
        }
        for (int i = 0; i < yAxis.size(); i++) {
            String agg = str(yAxis.get(i).get("agg"));
            String alias = str(yAxis.get(i).get("alias"));
            if (alias == null) alias = "none".equals(agg)
                    ? yRefs.get(i).column()
                    : (agg == null ? "val" : agg) + "_" + yRefs.get(i).column();
            if (alias.startsWith("__chartsdk_")) throw invalidReq("Alias cannot start with reserved prefix __chartsdk_.");
            if (isGeoPointSeries()) alias = i == 0 ? SPATIAL_LATITUDE : SPATIAL_SIZE;
            if (isGeoAreaSeries() && i == 0) alias = SPATIAL_AREA_VALUE;
            selects.add(aggSql(agg, sampleColumn(RESULT_Y_PREFIX + i)) + " AS " + SqlIdentifier.quote(alias));
        }
        for (String alias : geoPointRoleRefs.keySet()) {
            if (selects.stream().noneMatch(select -> select.endsWith(" AS " + SqlIdentifier.quote(alias)))) {
                selects.add(sampleColumn(alias) + " AS " + SqlIdentifier.quote(alias));
            }
        }
        if (allNone) {
            String order = buildOrder(yAxis.size(), series != null);
            String sql = cte + "SELECT " + String.join(", ", selects) + " FROM " + sample + order;
            return new Sql(sql, params, sampling);
        }
        selects.addAll(hiddenResultSampleColumns(yAxis));

        String groupBy = " GROUP BY " + (bucket == null ? sampledX : "1")
                + (sampledSeries == null ? "" : ", " + sampledSeries);
        String order = buildOrder(yAxis.size(), series != null);
        String sql = cte + "SELECT " + String.join(", ", selects) + " FROM " + sample
                + groupBy + order;
        return new Sql(sql, params, sampling);
    }

    /**
     * PostGIS Point 컬럼을 ECharts 공통 행 형태 [경도, 위도, (크기)]로 투영한다.
     * 컬럼 식별자는 카탈로그 화이트리스트를 통과하고 타입도 SRID가 명시된 Point로 제한한다.
     */
    private Sql buildSpatialGeoScatter(String joins, SamplingMetadata sampling) {
        if (federated) {
            throw invalidReq("Spatial point columns are not supported across multiple datasources.");
        }
        RawSamplingSource source = prepareRawSamplingSource(sampling);

        Map<String, Object> geoPoint = asMap(cfg.get("geoPoint"));
        String pointColumn = geoPoint == null ? null : str(geoPoint.get("spatialColumn"));
        if (pointColumn == null) throw invalidReq("geoPoint.spatialColumn is required.");
        Ref point = resolveRef(pointColumn);
        if (!isSpatialPointType(typeOf(point))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH",
                    "geoscatter spatial column must be geometry/geography Point with an SRID.");
        }

        String pointSql = render(point);
        if (isResultRandom(sampling)) {
            return buildResultRandomSpatialPoint(joins, sampling, pointSql);
        }
        // geography와 geometry를 한 경로로 처리한다. geometry 캐스트는 기존 SRID를 보존하고 ST_Transform이 WGS84로 정규화한다.
        String wgs84 = "ST_Transform((" + pointSql + ")::geometry, 4326)";
        List<String> selects = new ArrayList<>();
        selects.add("ST_X(" + wgs84 + ") AS " + SqlIdentifier.quote(SPATIAL_LONGITUDE));
        selects.add("ST_Y(" + wgs84 + ") AS " + SqlIdentifier.quote(SPATIAL_LATITUDE));
        appendGeoPointRoleSelects(selects);
        String seriesColumn = str(cfg.get("seriesBy"));
        if (seriesColumn != null) {
            Ref series = resolveRef(seriesColumn);
            selects.add("CAST(" + render(series) + " AS text) AS " + SqlIdentifier.quote(GEO_SERIES));
        }

        List<Object> params = new ArrayList<>(source.leadingParams());
        String where = buildWhere(params);
        where += where.isEmpty() ? " WHERE " + pointSql + " IS NOT NULL" : " AND " + pointSql + " IS NOT NULL";
        String sql = source.cteHead() + "SELECT " + String.join(", ", selects)
                + " FROM " + source.fromBase() + joins + where;
        return finishRawProjectionSampling(sql, params, sampling);
    }

    /**
     * Samples the completed JOIN + user-WHERE result before invoking PostGIS functions. The
     * materialized spatial CTE also guarantees that the transformed geometry is calculated once
     * even though the final projection reads both X and Y from it.
     */
    private Sql buildResultRandomSpatialPoint(String joins, SamplingMetadata sampling, String pointSql) {
        List<String> projected = new ArrayList<>();
        projected.add(pointSql + " AS " + SqlIdentifier.quote(SPATIAL_SOURCE));
        appendGeoPointRoleSelects(projected);

        String seriesColumn = str(cfg.get("seriesBy"));
        if (seriesColumn != null) {
            projected.add("CAST(" + render(resolveRef(seriesColumn)) + " AS text) AS "
                    + SqlIdentifier.quote(GEO_SERIES));
        }

        List<Object> params = new ArrayList<>();
        String where = buildWhere(params);
        String population = SqlIdentifier.quote(POPULATION_CTE);
        String sample = SqlIdentifier.quote(SAMPLE_CTE);
        String spatial = SqlIdentifier.quote(SPATIAL_CTE);
        String sampleSource = sample + "." + SqlIdentifier.quote(SPATIAL_SOURCE);
        String spatialValue = spatial + "." + SqlIdentifier.quote(SPATIAL_VALUE);
        String barrier = hasJoins ? " OFFSET 0" : "";

        StringBuilder sql = new StringBuilder("WITH ")
                .append(population).append(" AS (SELECT ").append(String.join(", ", projected))
                .append(" FROM ").append(render(baseRef)).append(joins).append(where).append(barrier)
                .append("), ").append(sample).append(" AS MATERIALIZED (SELECT ")
                .append(population).append(".* FROM ").append(population)
                .append(" WHERE random() < ?), ").append(spatial)
                .append(" AS MATERIALIZED (SELECT ST_Transform((").append(sampleSource)
                .append(")::geometry, 4326) AS ").append(SqlIdentifier.quote(SPATIAL_VALUE))
                .append(", ").append(sample).append(".* FROM ").append(sample)
                .append(" WHERE ").append(sampleSource).append(" IS NOT NULL) SELECT ST_X(")
                .append(spatialValue).append(") AS ").append(SqlIdentifier.quote(SPATIAL_LONGITUDE))
                .append(", ST_Y(").append(spatialValue).append(") AS ")
                .append(SqlIdentifier.quote(SPATIAL_LATITUDE));
        for (String alias : geoPointRoleRefs().keySet()) {
            sql.append(", ").append(spatial).append(".").append(SqlIdentifier.quote(alias))
                    .append(" AS ").append(SqlIdentifier.quote(alias));
        }
        if (seriesColumn != null) {
            sql.append(", ").append(spatial).append(".").append(SqlIdentifier.quote(GEO_SERIES))
                    .append(" AS ").append(SqlIdentifier.quote(GEO_SERIES));
        }
        sql.append(" FROM ").append(spatial);

        params.add(resultBernoulliProbability(sampling));
        return new Sql(sql.toString(), params, sampling);
    }

    private boolean isSpatialGeoPoint() {
        Map<String, Object> geoPoint = asMap(cfg.get("geoPoint"));
        return isGeoPointSeries() && geoPoint != null
                && "spatial".equals(str(geoPoint.get("mode")));
    }

    /** PostGIS Polygon/MultiPolygon을 동적 ECharts 지도 경계용 GeoJSON 행으로 투영한다. */
    private Sql buildSpatialGeoMap(String joins, SamplingMetadata sampling) {
        if (federated) {
            throw invalidReq("Spatial polygon columns are not supported across multiple datasources.");
        }
        RawSamplingSource source = prepareRawSamplingSource(sampling);

        Map<String, Object> geoArea = asMap(cfg.get("geoArea"));
        String spatialColumn = geoArea == null ? null : str(geoArea.get("spatialColumn"));
        String nameColumn = geoArea == null ? null : str(geoArea.get("nameColumn"));
        String valueColumn = geoArea == null ? null : str(geoArea.get("valueColumn"));
        if (spatialColumn == null) throw invalidReq("geoArea.spatialColumn is required.");
        if (nameColumn == null) throw invalidReq("geoArea.nameColumn is required.");
        if (valueColumn == null) throw invalidReq("geoArea.valueColumn is required.");

        Ref area = resolveRef(spatialColumn);
        Ref name = resolveRef(nameColumn);
        Ref value = resolveRef(valueColumn);
        if (!isSpatialAreaType(typeOf(area))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH",
                    "map spatial column must be geometry/geography Polygon or MultiPolygon with an SRID.");
        }
        if (!isNumeric(typeOf(value))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH",
                    "map spatial value column must be numeric.");
        }

        String areaSql = render(area);
        if (isResultRandom(sampling)) {
            return buildResultRandomSpatialArea(joins, sampling, areaSql, name, value);
        }
        String wgs84 = "ST_Transform((" + areaSql + ")::geometry, 4326)";
        List<String> selects = new ArrayList<>(List.of(
                "CAST(" + render(name) + " AS text) AS " + SqlIdentifier.quote(SPATIAL_AREA_NAME),
                render(value) + " AS " + SqlIdentifier.quote(SPATIAL_AREA_VALUE),
                "ST_AsGeoJSON(" + wgs84 + ", 6) AS " + SqlIdentifier.quote(SPATIAL_AREA_GEOJSON)
        ));
        String seriesColumn = str(cfg.get("seriesBy"));
        if (seriesColumn != null) {
            Ref series = resolveRef(seriesColumn);
            selects.add("CAST(" + render(series) + " AS text) AS " + SqlIdentifier.quote(GEO_SERIES));
        }

        List<Object> params = new ArrayList<>(source.leadingParams());
        String where = buildWhere(params);
        where += where.isEmpty() ? " WHERE " + areaSql + " IS NOT NULL" : " AND " + areaSql + " IS NOT NULL";
        String sql = source.cteHead() + "SELECT " + String.join(", ", selects)
                + " FROM " + source.fromBase() + joins + where;
        return finishRawProjectionSampling(sql, params, sampling);
    }

    /** RESULT_RANDOM variant of the area projection; sampling happens before transform/GeoJSON. */
    private Sql buildResultRandomSpatialArea(String joins, SamplingMetadata sampling, String areaSql,
                                             Ref name, Ref value) {
        List<String> projected = new ArrayList<>(List.of(
                areaSql + " AS " + SqlIdentifier.quote(SPATIAL_SOURCE),
                "CAST(" + render(name) + " AS text) AS " + SqlIdentifier.quote(SPATIAL_AREA_NAME),
                render(value) + " AS " + SqlIdentifier.quote(SPATIAL_AREA_VALUE)
        ));
        String seriesColumn = str(cfg.get("seriesBy"));
        if (seriesColumn != null) {
            projected.add("CAST(" + render(resolveRef(seriesColumn)) + " AS text) AS "
                    + SqlIdentifier.quote(GEO_SERIES));
        }

        List<Object> params = new ArrayList<>();
        String where = buildWhere(params);
        String population = SqlIdentifier.quote(POPULATION_CTE);
        String sample = SqlIdentifier.quote(SAMPLE_CTE);
        String spatial = SqlIdentifier.quote(SPATIAL_CTE);
        String sampleSource = sample + "." + SqlIdentifier.quote(SPATIAL_SOURCE);
        String spatialValue = spatial + "." + SqlIdentifier.quote(SPATIAL_VALUE);
        String barrier = hasJoins ? " OFFSET 0" : "";

        StringBuilder sql = new StringBuilder("WITH ")
                .append(population).append(" AS (SELECT ").append(String.join(", ", projected))
                .append(" FROM ").append(render(baseRef)).append(joins).append(where).append(barrier)
                .append("), ").append(sample).append(" AS MATERIALIZED (SELECT ")
                .append(population).append(".* FROM ").append(population)
                .append(" WHERE random() < ?), ").append(spatial)
                .append(" AS MATERIALIZED (SELECT ST_Transform((").append(sampleSource)
                .append(")::geometry, 4326) AS ").append(SqlIdentifier.quote(SPATIAL_VALUE))
                .append(", ").append(sample).append(".* FROM ").append(sample)
                .append(" WHERE ").append(sampleSource).append(" IS NOT NULL) SELECT ")
                .append(spatial).append(".").append(SqlIdentifier.quote(SPATIAL_AREA_NAME))
                .append(" AS ").append(SqlIdentifier.quote(SPATIAL_AREA_NAME)).append(", ")
                .append(spatial).append(".").append(SqlIdentifier.quote(SPATIAL_AREA_VALUE))
                .append(" AS ").append(SqlIdentifier.quote(SPATIAL_AREA_VALUE))
                .append(", ST_AsGeoJSON(").append(spatialValue).append(", 6) AS ")
                .append(SqlIdentifier.quote(SPATIAL_AREA_GEOJSON));
        if (seriesColumn != null) {
            sql.append(", ").append(spatial).append(".").append(SqlIdentifier.quote(GEO_SERIES))
                    .append(" AS ").append(SqlIdentifier.quote(GEO_SERIES));
        }
        sql.append(" FROM ").append(spatial);

        params.add(resultBernoulliProbability(sampling));
        return new Sql(sql.toString(), params, sampling);
    }

    private static boolean isResultRandom(SamplingMetadata sampling) {
        return sampling != null && sampling.approximate() && "RESULT_RANDOM".equals(sampling.method());
    }

    private boolean isSpatialGeoArea() {
        Map<String, Object> geoArea = asMap(cfg.get("geoArea"));
        return isGeoAreaSeries() && geoArea != null
                && "spatial".equals(str(geoArea.get("mode")));
    }

    private boolean isGeoPointSeries() {
        return "geoscatter".equals(chartType)
                || ("map".equals(chartType) && "heatmap".equals(str(cfg.get("geoSeriesType"))));
    }

    private boolean isGeoAreaSeries() {
        return "map".equals(chartType) && !isGeoPointSeries();
    }

    private boolean isGeoSeries() {
        return isGeoPointSeries() || isGeoAreaSeries();
    }

    private void appendGeoPointRoleSelects(List<String> selects) {
        for (Map.Entry<String, Ref> entry : geoPointRoleRefs().entrySet()) {
            String quotedAlias = SqlIdentifier.quote(entry.getKey());
            if (selects.stream().anyMatch(select -> select.endsWith(" AS " + quotedAlias))) continue;
            String expression = render(entry.getValue());
            if (GEO_POINT_NAME.equals(entry.getKey())) expression = "CAST(" + expression + " AS text)";
            selects.add(expression + " AS " + quotedAlias);
        }
    }

    private Map<String, Ref> geoPointRoleRefs() {
        Map<String, Ref> refs = new LinkedHashMap<>();
        if (!isGeoPointSeries()) return refs;
        Map<String, Object> geoPoint = asMap(cfg.get("geoPoint"));
        if (geoPoint == null) return refs;
        for (String[] role : List.of(
                new String[]{"nameColumn", GEO_POINT_NAME, "text"},
                new String[]{"valueColumn", GEO_POINT_VALUE, "numeric"},
                new String[]{"sizeColumn", SPATIAL_SIZE, "numeric"},
                new String[]{"colorColumn", GEO_POINT_COLOR, "numeric"})) {
            String column = str(geoPoint.get(role[0]));
            if (column == null) continue;
            Ref ref = resolveRef(column);
            if ("numeric".equals(role[2]) && !isNumeric(typeOf(ref))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH",
                        "Geo point " + role[0] + " must be numeric.");
            }
            refs.put(role[1], ref);
        }
        return refs;
    }

    private static boolean isSpatialPointType(String type) {
        if (type == null) return false;
        String compact = type.toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
        return compact.matches(".*(?:geometry|geography)\\(point(?:zm|z|m)?,[1-9]\\d*\\).*");
    }

    private static boolean isSpatialAreaType(String type) {
        if (type == null) return false;
        String compact = type.toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
        return compact.matches(".*(?:geometry|geography)\\((?:multi)?polygon(?:zm|z|m)?,[1-9]\\d*\\).*");
    }

    private List<String> hiddenResultSampleColumns(List<Map<String, Object>> yAxis) {
        List<String> cols = new ArrayList<>();
        cols.add("COUNT(*) AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_GROUP_COUNT));
        cols.add("(SELECT " + SqlIdentifier.quote("sampled") + " FROM " + SqlIdentifier.quote(N_CTE)
                + ") AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_TOTAL_COUNT));
        for (int i = 0; i < yAxis.size(); i++) {
            String agg = str(yAxis.get(i).get("agg"));
            if (!Set.of("avg", "stddev", "variance").contains(agg)) continue;
            String q = sampleColumn(RESULT_Y_PREFIX + i);
            cols.add("COUNT(" + q + ") AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_SERIES_COUNT_PREFIX + i));
            cols.add("AVG(" + q + ") AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_MEAN_PREFIX + i));
            cols.add("STDDEV_SAMP(" + q + ") AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_SD_PREFIX + i));
        }
        return cols;
    }

    private static String sampleColumn(String column) {
        return SqlIdentifier.quote(SAMPLE_CTE) + "." + SqlIdentifier.quote(column);
    }

    /** 목표 K를 모집단 추정치 N̂의 독립 포함 확률로 변환한다. 추정 불가 시 전량을 보존한다. */
    static double resultBernoulliProbability(SamplingMetadata sampling) {
        int target = sampling.sampleSize() != null ? sampling.sampleSize()
                : sampling.sizeTarget() != null ? sampling.sizeTarget() : SamplingPlanner.DEFAULT_SIZE;
        Long population = sampling.populationEstimate();
        if (population == null || population <= 0) return 1.0;
        return Math.max(0.0, Math.min(1.0, target / (double) population));
    }

    private static String appendNotNull(String where, String expression) {
        return where + (where.isEmpty() ? " WHERE " : " AND ") + expression + " IS NOT NULL";
    }

    /** 오차범위 계산용 숨은 열 — 그룹별 COUNT + 전체 표본수(+INDEX_RANDOM 은 시리즈별 유효 n·필요 시 mean/sd). */
    private List<String> hiddenSampleColumns(List<Map<String, Object>> yAxis, boolean indexRandom) {
        List<String> cols = new ArrayList<>();
        cols.add("COUNT(*) AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_GROUP_COUNT));
        if (indexRandom) {
            cols.add("(SELECT " + SqlIdentifier.quote("sampled") + " FROM " + SqlIdentifier.quote(N_CTE)
                    + ") AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_TOTAL_COUNT));
            for (int i = 0; i < yAxis.size(); i++) {
                String agg = str(yAxis.get(i).get("agg"));
                if (!Set.of("avg", "stddev", "variance").contains(agg)) continue;
                Ref col = resolveRef(str(yAxis.get(i).get("column")));
                String q = render(col);
                // COUNT(*)가 아니라 집계 대상 열의 비NULL 개수여야 AVG·분산 계열의 실제 n과 일치한다.
                cols.add("COUNT(" + q + ") AS "
                        + SqlIdentifier.quote(SamplingMetadata.HIDDEN_SERIES_COUNT_PREFIX + i));
                if (!isNumeric(typeOf(col))) continue;
                cols.add("AVG(" + q + ") AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_MEAN_PREFIX + i));
                cols.add("STDDEV_SAMP(" + q + ") AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_SD_PREFIX + i));
            }
        } else {
            // SYSTEM: window 로 LIMIT 전 모든 그룹의 COUNT 합(전체 표본수)을 계산.
            cols.add("SUM(COUNT(*)) OVER () AS " + SqlIdentifier.quote(SamplingMetadata.HIDDEN_TOTAL_COUNT));
        }
        return cols;
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
    private String buildOrder(int seriesCount, boolean hasSeriesBy) {
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
            pos = idx + (hasSeriesBy ? 3 : 2);
        } else {
            throw invalidReq("Invalid orderBy target: " + target);
        }
        String direction = str(order.get("direction"));
        boolean asc = "asc".equalsIgnoreCase(direction);
        return " ORDER BY " + pos + (asc ? " ASC" : " DESC");
    }

    /** X/Y 없는 조회 전용 정렬. column: 접두사가 붙은 검증된 원본 컬럼 참조만 허용한다. */
    private String buildRawOrder() {
        Map<String, Object> order = asMap(cfg.get("orderBy"));
        if (order == null) return "";
        String target = str(order.get("target"));
        if (target == null || !target.startsWith("column:")) return "";
        String columnRef = target.substring("column:".length());
        if (columnRef.isBlank()) throw invalidReq("Raw order column is required.");
        Ref column = resolveRef(columnRef);
        String direction = str(order.get("direction"));
        boolean asc = "asc".equalsIgnoreCase(direction);
        return " ORDER BY " + render(column) + (asc ? " ASC" : " DESC");
    }

    // ── 표본 (스펙 검증 → SamplingMetadata) ────────────────
    private SamplingMetadata sampling() {
        Object raw = cfg.get("sample");
        if (!(raw instanceof Map<?, ?> sample)) return null;
        Object rawRate = sample.get("rate"); // 레거시/SYSTEM 핀 전용(선택). 무편향 표본은 size(갯수) 기반.
        if (rawRate != null) {
            double rate = rawRate instanceof Number n ? n.doubleValue() : -1;
            if (!Double.isFinite(rate) || rate < SamplingMetadata.MIN_RATE || rate > SamplingMetadata.MAX_RATE
                    || Math.abs(rate * 10 - Math.rint(rate * 10)) > 0.0000001) {
                throw invalidReq("sample.rate must be between 0.1 and 100 with at most one decimal place.");
            }
        }
        Object rawSize = sample.get("size");
        if (rawSize != null && (!(rawSize instanceof Number n) || n.intValue() < SamplingMetadata.MIN_SIZE
                || n.intValue() > SamplingMetadata.MAX_SIZE)) {
            throw invalidReq("sample.size must be between " + SamplingMetadata.MIN_SIZE
                    + " and " + SamplingMetadata.MAX_SIZE + ".");
        }
        Object rawMethod = sample.get("method");
        if (rawMethod != null && !Set.of("auto", "system").contains(String.valueOf(rawMethod))) {
            throw invalidReq("sample.method must be auto or system.");
        }
        Object rawMode = sample.get("mode");
        if (rawMode != null && !Set.of("auto", "manual").contains(String.valueOf(rawMode))) {
            throw invalidReq("sample.mode must be auto or manual.");
        }
        Object rawSeed = sample.get("seed");
        if (rawSeed != null && (!(rawSeed instanceof Number n) || n.longValue() < 0 || n.longValue() > Integer.MAX_VALUE)) {
            throw invalidReq("sample.seed must be between 0 and 2147483647.");
        }
        SamplingMetadata metadata = SamplingMetadata.fromBuilderConfig(cfg);
        if (metadata == null) throw invalidReq("Invalid sample configuration.");
        return metadata;
    }

    // ── 검증 헬퍼 ────────────────────────────────────────
    private void validateChartShape(Ref x, Ref series, List<Map<String, Object>> yAxis, boolean allNone) {
        if (series != null) {
            if (!("bar".equals(chartType) || "line".equals(chartType) || isGeoSeries())) {
                throw invalidReq("seriesBy is not supported for this chart type.");
            }
            if (("bar".equals(chartType) || "line".equals(chartType)) && yAxis.size() != 1) {
                throw invalidReq("seriesBy requires exactly one yAxis field.");
            }
        }
        boolean anyNone = yAxis.stream().anyMatch(y -> "none".equals(str(y.get("agg"))));
        if ("scatter".equals(chartType)) {
            if (!allNone) throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "scatter requires agg 'none' on all yAxis.");
            if (!isNumeric(typeOf(x))) throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "scatter xAxis must be numeric.");
        } else if ("boxplot".equals(chartType)) {
            // 상자수염: 카테고리별 원본값 분포 → 집계 없음(allNone) + 단일 값 컬럼.
            if (!allNone) throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "boxplot requires agg 'none' on the value field.");
            if (yAxis.size() != 1) throw invalidReq("boxplot requires exactly one value field.");
        } else if (isGeoPointSeries()) {
            // 지도 포인트: X=경도·Y=위도이며 이름·값·크기·색상값은 별도 역할 컬럼으로 전달한다.
            if (!allNone) throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "Geo point coordinates require agg 'none'.");
            if (yAxis.size() != 1) throw invalidReq("Geo point input requires exactly one latitude field.");
            if (!isNumeric(typeOf(x))) throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "Geo point longitude must be numeric.");
        } else {
            if (anyNone && !allNone) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", "raw values cannot be mixed with aggregate yAxis fields.");
            }
            if ("pie".equals(chartType) && yAxis.size() != 1) throw invalidReq("pie requires exactly one yAxis.");
            if (isGeoAreaSeries() && yAxis.size() != 1) throw invalidReq("map requires exactly one value field.");
        }
    }

    private void assertTable(TableRef table) {
        if (!catalog.hasTable(table.datasourceId(), table.schema(), table.table())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTIFIER", "Unknown table: " + display(table));
        }
        if (!catalog.isQueryable(table.datasourceId(), table.schema(), table.table())) {
            throw new ApiException(HttpStatus.CONFLICT, "MATERIALIZED_VIEW_NOT_POPULATED",
                    "Materialized view must be refreshed before it can be queried: " + display(table));
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
            case "sum", "avg", "stddev", "variance" -> {
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
        return aggSql(agg, render(col));
    }

    private String aggSql(String agg, String q) {
        String resolvedAgg = agg == null ? "sum" : agg;
        return switch (resolvedAgg) {
            case "avg" -> "AVG(" + q + ")";
            case "stddev" -> "STDDEV(" + q + ")";
            case "variance" -> "VARIANCE(" + q + ")";
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
        return t.contains("int") || t.startsWith("numeric") || t.startsWith("decimal") || t.equals("real")
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

    private static String number(double value) {
        return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString();
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
