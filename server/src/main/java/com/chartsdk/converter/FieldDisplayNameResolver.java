package com.chartsdk.converter;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 물리 컬럼 참조와 차트에 저장한 표시 이름 스냅샷을 일관되게 해석한다. */
public final class FieldDisplayNameResolver {
    public static final String SERIES_DISPLAY_NAMES_KEY = "__chartsdkSeriesDisplayNames";
    public static final String AXIS_DISPLAY_NAMES_KEY = "__chartsdkAxisDisplayNames";

    private static final Map<String, String> AGGREGATE_LABELS = Map.ofEntries(
            Map.entry("sum", "합계"),
            Map.entry("avg", "평균"),
            Map.entry("stddev", "표준편차"),
            Map.entry("variance", "분산"),
            Map.entry("count", "개수"),
            Map.entry("count_distinct", "고유 개수"),
            Map.entry("min", "최솟값"),
            Map.entry("max", "최댓값"),
            Map.entry("none", "값")
    );

    private FieldDisplayNameResolver() {
    }

    public static String fieldName(Map<String, Object> builder, Object fieldRef, String fallback) {
        String reference = string(fieldRef, "").trim();
        Object rawNames = builder.get("fieldDisplayNames");
        if (rawNames instanceof Map<?, ?> names && !reference.isEmpty()) {
            String displayName = string(names.get(reference), "").trim();
            if (!displayName.isEmpty()) return displayName;
        }
        return humanize(reference.isEmpty() ? fallback : reference, fallback);
    }

    public static String measureName(
            Map<String, Object> builder,
            Map<String, Object> field,
            String fallback
    ) {
        String alias = string(field.get("alias"), "").trim();
        if (!alias.isEmpty()) return alias;
        String base = fieldName(builder, field.get("column"), fallback);
        String aggregate = string(field.get("agg"), "none");
        return "none".equals(aggregate)
                ? base
                : base + " " + AGGREGATE_LABELS.getOrDefault(aggregate, aggregate);
    }

    public static Map<String, String> seriesNames(
            Map<String, Object> builder,
            List<Map<String, Object>> columns
    ) {
        if (builder == null || builder.isEmpty()) return Map.of();
        if (!string(builder.get("seriesBy"), "").trim().isEmpty()) return Map.of();
        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        Map<String, String> names = new LinkedHashMap<>();
        for (int index = 1; index < columns.size(); index++) {
            String physicalName = string(columns.get(index).get("name"), "");
            Map<String, Object> measure = index - 1 < measures.size()
                    ? measures.get(index - 1)
                    : Map.of();
            String fieldRef = string(measure.get("column"), "").trim();
            if (!hasSnapshot(builder, fieldRef)) continue;
            String displayName = measureName(builder, measure, physicalName);
            if (!displayName.isEmpty() && !displayName.equals(physicalName)) {
                names.put(physicalName, displayName);
            }
        }
        return names;
    }

    public static boolean hasSnapshot(Map<String, Object> builder, Object fieldRef) {
        String reference = string(fieldRef, "").trim();
        if (reference.isEmpty()) return false;
        Object rawNames = builder.get("fieldDisplayNames");
        return rawNames instanceof Map<?, ?> names
                && !string(names.get(reference), "").trim().isEmpty();
    }

    public static String aggregateLabel(Object aggregate) {
        String key = string(aggregate, "none");
        return AGGREGATE_LABELS.getOrDefault(key, key);
    }

    /**
     * Adds presentation-only names to query metadata while preserving result-column names and order.
     * Pivoted series keep their data values as headers; only the source X field is relabeled there.
     */
    public static List<Map<String, Object>> displayColumns(
            Map<String, Object> builder,
            List<Map<String, Object>> columns,
            boolean pivoted
    ) {
        List<Map<String, Object>> result = columns.stream()
                .map(LinkedHashMap::new)
                .map(column -> (Map<String, Object>) column)
                .toList();
        if (result.isEmpty() || builder == null || builder.isEmpty()) return result;

        putDisplayName(result.get(0), fieldName(
                builder,
                builder.get("xAxis"),
                string(result.get(0).get("name"), "")
        ));

        String seriesBy = string(builder.get("seriesBy"), "").trim();
        if (pivoted && !seriesBy.isEmpty()) return result;

        int measureStart = 1;
        if (!seriesBy.isEmpty() && result.size() > 1) {
            putDisplayName(result.get(1), fieldName(
                    builder,
                    seriesBy,
                    string(result.get(1).get("name"), "")
            ));
            measureStart = 2;
        }

        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        for (int index = 0; index < measures.size() && measureStart + index < result.size(); index++) {
            Map<String, Object> column = result.get(measureStart + index);
            putDisplayName(column, measureName(
                    builder,
                    measures.get(index),
                    string(column.get("name"), "")
            ));
        }
        return result;
    }

    private static String humanize(String value, String fallback) {
        String text = value == null ? "" : value.trim();
        int dot = text.lastIndexOf('.');
        if (dot >= 0) text = text.substring(dot + 1);
        text = text.replaceFirst("^__chartsdk_", "")
                .replaceAll("[_-]+", " ")
                .trim();
        return text.isEmpty() ? fallback : text;
    }

    private static void putDisplayName(Map<String, Object> column, String displayName) {
        String physicalName = string(column.get("name"), "");
        if (displayName != null && !displayName.isBlank() && !displayName.equals(physicalName)) {
            column.put("displayName", displayName);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object value) {
        if (!(value instanceof List<?> values)) return List.of();
        return values.stream()
                .map(item -> item instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.<String, Object>of())
                .toList();
    }

    private static String string(Object value, String fallback) {
        return value == null ? fallback : String.valueOf(value);
    }
}
