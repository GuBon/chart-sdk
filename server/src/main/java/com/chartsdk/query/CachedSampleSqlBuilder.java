package com.chartsdk.query;

import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Builds the final chart query over an L1-cached RESULT_RANDOM row sample. */
public final class CachedSampleSqlBuilder {
    public static final String SAMPLE_TABLE = "__chartsdk_sample";
    private static final String SOURCE_CTE = "__chartsdk_l1_source";
    private static final String N_CTE = "__chartsdk_n";
    private static final String RESULT_X = "__chartsdk_x";
    private static final String RESULT_SERIES = "__chartsdk_series";
    private static final String RESULT_Y_PREFIX = "__chartsdk_y_";
    private static final String SPATIAL_LONGITUDE = "__chartsdk_longitude";
    private static final String SPATIAL_LATITUDE = "__chartsdk_latitude";
    private static final String GEO_POINT_NAME = "__chartsdk_point_name";
    private static final String GEO_POINT_VALUE = "__chartsdk_point_value";
    private static final String SPATIAL_SIZE = "__chartsdk_size";
    private static final String GEO_SERIES = "__chartsdk_series";
    private static final String SPATIAL_AREA_NAME = "__chartsdk_area_name";
    private static final String SPATIAL_AREA_VALUE = "__chartsdk_area_value";
    private static final String SPATIAL_AREA_GEOJSON = "__chartsdk_geojson";

    public record Plan(BuilderSqlBuilder.Sql aggregate, BuilderSqlBuilder.Sql display) {
    }

    private CachedSampleSqlBuilder() {
    }

    public static Plan build(Map<String, Object> cfg, String chartType, QueryRows sample,
                             BuilderSqlBuilder.Sql source) {
        if (sample == null || source == null || source.sampling() == null) {
            throw invalid("Cached sample metadata is required.");
        }
        Map<String, String> types = columnTypes(sample);
        FinalParts parts = isSpatialPoint(cfg, chartType)
                ? spatialPoint(types)
                : isSpatialArea(cfg, chartType)
                        ? spatialArea(types)
                        : ordinary(cfg, chartType, types);

        String local = parts.nCte() == null
                ? parts.select()
                : "WITH " + q(N_CTE) + " AS (" + parts.nCte() + ") " + parts.select();

        String sourceColumns = String.join(", ", sample.columns().stream()
                .map(column -> q(SOURCE_CTE) + "." + q(String.valueOf(column.get("name"))))
                .toList());
        StringBuilder display = new StringBuilder("WITH ")
                .append(q(SOURCE_CTE)).append(" AS MATERIALIZED (")
                .append(source.text()).append("), ")
                .append(q(SAMPLE_TABLE)).append(" AS MATERIALIZED (SELECT ")
                .append(sourceColumns).append(" FROM ").append(q(SOURCE_CTE)).append(")");
        if (parts.nCte() != null) {
            display.append(", ").append(q(N_CTE)).append(" AS (").append(parts.nCte()).append(")");
        }
        display.append(" ").append(parts.select());

        SamplingMetadata sampling = source.sampling();
        return new Plan(
                new BuilderSqlBuilder.Sql(local, List.of(), sampling),
                new BuilderSqlBuilder.Sql(display.toString(), source.params(), sampling));
    }

    private static FinalParts ordinary(Map<String, Object> cfg, String chartType,
                                       Map<String, String> types) {
        String xRef = string(cfg.get("xAxis"));
        List<Map<String, Object>> yAxis = maps(cfg.get("yAxis"));
        String seriesRef = string(cfg.get("seriesBy"));
        if (xRef == null) throw invalid("xAxis is required.");
        if (yAxis.isEmpty()) throw invalid("At least one yAxis is required.");
        require(types, RESULT_X);
        for (int i = 0; i < yAxis.size(); i++) require(types, RESULT_Y_PREFIX + i);
        if (seriesRef != null) require(types, RESULT_SERIES);

        boolean allNone = yAxis.stream().allMatch(y -> "none".equals(string(y.get("agg"))));
        boolean anyNone = yAxis.stream().anyMatch(y -> "none".equals(string(y.get("agg"))));
        boolean geoPoint = isGeoPoint(chartType, cfg);
        boolean geoArea = isGeoArea(chartType, cfg);
        if ("scatter".equals(chartType) && !allNone) {
            throw mismatch("scatter requires agg 'none' on all yAxis.");
        }
        if ("boxplot".equals(chartType) && (!allNone || yAxis.size() != 1)) {
            throw mismatch("boxplot requires exactly one raw value field.");
        }
        if (!"scatter".equals(chartType) && !"boxplot".equals(chartType)
                && !geoPoint && anyNone && !allNone) {
            throw mismatch("raw values cannot be mixed with aggregate yAxis fields.");
        }

        String sample = q(SAMPLE_TABLE);
        String x = sample + "." + q(RESULT_X);
        String bucket = string(cfg.get("xAxisBucket"));
        String xAlias = geoPoint ? SPATIAL_LONGITUDE : geoArea ? SPATIAL_AREA_NAME : unqualified(xRef);
        String xSql;
        if (bucket == null) {
            xSql = x + " AS " + q(xAlias);
        } else {
            if (!Set.of("day", "week", "month").contains(bucket)) {
                throw invalid("Unsupported bucket: " + bucket);
            }
            if (!isDate(types.get(RESULT_X))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "BUCKET_TYPE_MISMATCH",
                        "Bucket requires a date/timestamp column.");
            }
            xSql = "DATE_TRUNC('" + bucket + "', " + x + ") AS " + q(unqualified(xRef));
        }

        List<String> selects = new ArrayList<>();
        selects.add(xSql);
        String series = seriesRef == null ? null : sample + "." + q(RESULT_SERIES);
        if (series != null) {
            selects.add(series + " AS " + q((geoPoint || geoArea) ? GEO_SERIES : unqualified(seriesRef)));
        }
        for (int i = 0; i < yAxis.size(); i++) {
            Map<String, Object> y = yAxis.get(i);
            String agg = string(y.get("agg"));
            String sourceColumn = RESULT_Y_PREFIX + i;
            assertAggregate(agg, types.get(sourceColumn));
            String alias = string(y.get("alias"));
            if (alias == null) {
                String column = unqualified(string(y.get("column")));
                alias = "none".equals(agg) ? column : (agg == null ? "val" : agg) + "_" + column;
            }
            if (alias.startsWith("__chartsdk_")) throw invalid("Alias cannot start with reserved prefix __chartsdk_.");
            if (geoPoint) alias = i == 0 ? SPATIAL_LATITUDE : SPATIAL_SIZE;
            if (geoArea && i == 0) alias = SPATIAL_AREA_VALUE;
            selects.add(aggregate(agg, sample + "." + q(sourceColumn)) + " AS " + q(alias));
        }
        for (String role : List.of(GEO_POINT_NAME, GEO_POINT_VALUE, SPATIAL_SIZE)) {
            if (!types.containsKey(role)) continue;
            String alias = q(role);
            if (selects.stream().noneMatch(select -> select.endsWith(" AS " + alias))) {
                selects.add(sample + "." + alias + " AS " + alias);
            }
        }

        if (!allNone) selects.addAll(hiddenColumns(yAxis, types));
        String groupBy = allNone ? "" : " GROUP BY " + (bucket == null ? x : "1")
                + (series == null ? "" : ", " + series);
        String order = order(cfg, yAxis.size(), series != null);
        String select = "SELECT " + String.join(", ", selects) + " FROM " + sample + groupBy + order;
        String n = allNone ? null : "SELECT COUNT(*) AS " + q("sampled") + " FROM " + sample;
        return new FinalParts(n, select);
    }

    private static List<String> hiddenColumns(List<Map<String, Object>> yAxis,
                                              Map<String, String> types) {
        String sample = q(SAMPLE_TABLE);
        List<String> columns = new ArrayList<>();
        columns.add("COUNT(*) AS " + q(SamplingMetadata.HIDDEN_GROUP_COUNT));
        columns.add("(SELECT " + q("sampled") + " FROM " + q(N_CTE) + ") AS "
                + q(SamplingMetadata.HIDDEN_TOTAL_COUNT));
        for (int i = 0; i < yAxis.size(); i++) {
            String agg = string(yAxis.get(i).get("agg"));
            if (!Set.of("avg", "stddev", "variance").contains(agg)) continue;
            String source = sample + "." + q(RESULT_Y_PREFIX + i);
            columns.add("COUNT(" + source + ") AS " + q(SamplingMetadata.HIDDEN_SERIES_COUNT_PREFIX + i));
            if (isNumeric(types.get(RESULT_Y_PREFIX + i))) {
                columns.add("AVG(" + source + ") AS " + q(SamplingMetadata.HIDDEN_MEAN_PREFIX + i));
                columns.add("STDDEV_SAMP(" + source + ") AS " + q(SamplingMetadata.HIDDEN_SD_PREFIX + i));
            }
        }
        return columns;
    }

    private static FinalParts spatialPoint(Map<String, String> types) {
        List<String> names = new ArrayList<>(List.of(SPATIAL_LONGITUDE, SPATIAL_LATITUDE));
        for (String optional : List.of(GEO_POINT_NAME, GEO_POINT_VALUE, SPATIAL_SIZE, GEO_SERIES)) {
            if (types.containsKey(optional)) names.add(optional);
        }
        return rowProjection(types, names);
    }

    private static FinalParts spatialArea(Map<String, String> types) {
        List<String> names = new ArrayList<>(List.of(
                SPATIAL_AREA_NAME, SPATIAL_AREA_VALUE, SPATIAL_AREA_GEOJSON));
        if (types.containsKey(GEO_SERIES)) names.add(GEO_SERIES);
        return rowProjection(types, names);
    }

    private static FinalParts rowProjection(Map<String, String> types, List<String> names) {
        String sample = q(SAMPLE_TABLE);
        List<String> projections = new ArrayList<>();
        for (String name : names) {
            require(types, name);
            projections.add(sample + "." + q(name) + " AS " + q(name));
        }
        return new FinalParts(null, "SELECT " + String.join(", ", projections) + " FROM " + sample);
    }

    private static String order(Map<String, Object> cfg, int yCount, boolean hasSeries) {
        Map<String, Object> order = map(cfg.get("orderBy"));
        if (order == null) return "";
        String target = string(order.get("target"));
        if (target == null) target = "x";
        int position;
        if ("x".equals(target)) {
            position = 1;
        } else if (target.matches("y\\d+")) {
            int index = Integer.parseInt(target.substring(1));
            if (index >= yCount) throw invalid("orderBy target out of range: " + target);
            position = index + (hasSeries ? 3 : 2);
        } else {
            throw invalid("Invalid orderBy target: " + target);
        }
        return " ORDER BY " + position
                + ("asc".equalsIgnoreCase(string(order.get("direction"))) ? " ASC" : " DESC");
    }

    private static void assertAggregate(String agg, String type) {
        String resolved = agg == null ? "sum" : agg;
        if (Set.of("sum", "avg", "stddev", "variance").contains(resolved) && !isNumeric(type)) {
            throw mismatch(resolved + " requires a numeric column.");
        }
        if (!Set.of("sum", "avg", "stddev", "variance", "count", "count_distinct",
                "min", "max", "none").contains(resolved)) {
            throw invalid("Unknown agg: " + resolved);
        }
    }

    private static String aggregate(String agg, String column) {
        String resolved = agg == null ? "sum" : agg;
        return switch (resolved) {
            case "avg" -> "AVG(" + column + ")";
            case "stddev" -> "STDDEV(" + column + ")";
            case "variance" -> "VARIANCE(" + column + ")";
            case "count" -> "COUNT(" + column + ")";
            case "count_distinct" -> "COUNT(DISTINCT " + column + ")";
            case "min" -> "MIN(" + column + ")";
            case "max" -> "MAX(" + column + ")";
            case "none" -> column;
            default -> "SUM(" + column + ")";
        };
    }

    private static Map<String, String> columnTypes(QueryRows rows) {
        Map<String, String> result = new LinkedHashMap<>();
        for (Map<String, Object> column : rows.columns()) {
            result.put(String.valueOf(column.get("name")), String.valueOf(column.get("type")));
        }
        return result;
    }

    private static void require(Map<String, String> types, String name) {
        if (!types.containsKey(name)) throw invalid("Cached sample column is missing: " + name);
    }

    private static boolean isSpatialPoint(Map<String, Object> cfg, String chartType) {
        Map<String, Object> point = map(cfg.get("geoPoint"));
        return isGeoPoint(chartType, cfg) && point != null && "spatial".equals(string(point.get("mode")));
    }

    private static boolean isSpatialArea(Map<String, Object> cfg, String chartType) {
        Map<String, Object> area = map(cfg.get("geoArea"));
        return isGeoArea(chartType, cfg) && area != null && "spatial".equals(string(area.get("mode")));
    }

    private static boolean isGeoPoint(String chartType, Map<String, Object> cfg) {
        return "geoscatter".equals(chartType)
                || ("map".equals(chartType) && "heatmap".equals(string(cfg.get("geoSeriesType"))));
    }

    private static boolean isGeoArea(String chartType, Map<String, Object> cfg) {
        return "map".equals(chartType) && !isGeoPoint(chartType, cfg);
    }

    private static boolean isNumeric(String type) {
        if (type == null) return false;
        String t = type.toLowerCase(Locale.ROOT);
        return t.contains("int") || t.startsWith("numeric") || t.startsWith("decimal")
                || t.equals("real") || t.contains("double") || t.equals("money")
                || t.equals("serial") || t.contains("float") || t.contains("hugeint");
    }

    private static boolean isDate(String type) {
        if (type == null) return false;
        String t = type.toLowerCase(Locale.ROOT);
        return t.startsWith("date") || t.startsWith("timestamp");
    }

    private static String unqualified(String ref) {
        if (ref == null) return "value";
        int dot = ref.lastIndexOf('.');
        return dot < 0 ? ref : ref.substring(dot + 1);
    }

    private static String q(String identifier) {
        return SqlIdentifier.quote(identifier);
    }

    private static String string(Object value) {
        return value == null || String.valueOf(value).isBlank() ? null : String.valueOf(value);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> raw ? (Map<String, Object>) raw : null;
    }

    private static List<Map<String, Object>> maps(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : list) {
            Map<String, Object> map = map(item);
            if (map != null) result.add(map);
        }
        return result;
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message);
    }

    private static ApiException mismatch(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "AGG_TYPE_MISMATCH", message);
    }

    private record FinalParts(String nCte, String select) {
    }
}
