package com.chartsdk.converter;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 현재 차트 결과와 빌더 매핑에서 툴팁에 표시할 수 있는 항목을 만든다.
 *
 * <p>필드 키와 레이블은 {@code chart-options/tooltip.ts}와 같은 계약이다.
 * 저장 옵션에는 기본값과 다른 표시 여부만 남기고, 변환 시점에 현재 결과 컬럼을
 * 다시 해석하므로 컬럼 구성이 바뀌어도 새 필드는 자동으로 나타난다.</p>
 */
final class TooltipFieldResolver {
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

    private static final String LONGITUDE = "__chartsdk_longitude";
    private static final String LATITUDE = "__chartsdk_latitude";
    private static final String POINT_NAME = "__chartsdk_point_name";
    private static final String POINT_VALUE = "__chartsdk_point_value";
    private static final String POINT_SIZE = "__chartsdk_size";
    private static final String GEO_SERIES = "__chartsdk_series";

    private TooltipFieldResolver() {
    }

    static List<Map<String, Object>> visibleFields(
            String chartType,
            Map<String, Object> options,
            List<Map<String, Object>> columns,
            Map<String, Object> builderConfig
    ) {
        List<Map<String, Object>> descriptors = fieldsFor(
                chartType,
                options == null ? Map.of() : options,
                columns == null ? List.of() : columns,
                builderConfig == null ? Map.of() : builderConfig
        );
        Map<String, Object> visibility = map(map(options == null ? null : options.get("tooltip")).get("fields"));
        return descriptors.stream()
                .filter(descriptor -> {
                    Object override = visibility.get(String.valueOf(descriptor.get("key")));
                    return override instanceof Boolean visible
                            ? visible
                            : !Boolean.FALSE.equals(descriptor.get("defaultVisible"));
                })
                .toList();
    }

    private static List<Map<String, Object>> fieldsFor(
            String chartType,
            Map<String, Object> options,
            List<Map<String, Object>> columns,
            Map<String, Object> builder
    ) {
        // 빌더 설정만으로 필드를 추측하지 않고, 실제 차트 조회 결과가 있을 때만 카탈로그를 만든다.
        if (columns.isEmpty()) return List.of();
        return switch (chartType) {
            case "bar", "line" -> cartesianFields(chartType, options, columns, builder);
            case "pie" -> pieFields(columns, builder);
            case "scatter" -> scatterFields(options, columns, builder);
            case "boxplot" -> boxplotFields(columns, builder);
            case "heatmap" -> heatmapFields(columns, builder);
            case "map" -> "heatmap".equals(string(options.get("variant"), "map"))
                    ? geoPointFields(chartType, columns, builder)
                    : areaMapFields(columns, builder);
            case "geoscatter" -> geoPointFields(chartType, columns, builder);
            default -> List.of();
        };
    }

    private static List<Map<String, Object>> cartesianFields(
            String chartType,
            Map<String, Object> options,
            List<Map<String, Object>> columns,
            Map<String, Object> builder
    ) {
        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        String seriesBy = string(builder.get("seriesBy"), "").trim();
        List<Map<String, Object>> fields = new ArrayList<>();
        String xIdentity = string(builder.get("xAxis"), resultColumn(columns, 0, "x"));
        fields.add(field(
                "x:" + xIdentity,
                humanize(builder.get("xAxis"), resultColumn(columns, 0, "카테고리"), builder),
                "가로축",
                "category"
        ));

        if (!seriesBy.isEmpty()) {
            fields.add(field("series:" + seriesBy, humanize(seriesBy, "계열", builder), "계열", "series"));
            Map<String, Object> source = at(measures, 0);
            fields.add(field(
                    measureKey(source, 0, resultColumn(columns, 2, "값")),
                    measureLabel(source, resultColumn(columns, 2, "값"), builder),
                    aggregateRole(source),
                    "measure",
                    null,
                    1,
                    true
            ));
            return fields;
        }

        for (int index = 1; index < columns.size(); index++) {
            Map<String, Object> source = at(measures, index - 1);
            String columnName = columnName(columns.get(index), "");
            fields.add(field(
                    measureKey(source, index - 1, columnName),
                    measureLabel(source, columnName, builder),
                    aggregateRole(source),
                    "measure",
                    columnName,
                    index,
                    true
            ));
        }
        if ("bar".equals(chartType) && Boolean.TRUE.equals(map(options.get("bar")).get("normalize"))) {
            fields.add(field("derived:percent", "구성비", "계산값", "percent"));
        }
        return fields;
    }

    private static List<Map<String, Object>> scatterFields(
            Map<String, Object> options,
            List<Map<String, Object>> columns,
            Map<String, Object> builder
    ) {
        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        String bubbleName = "bubble".equals(string(options.get("variant"), ""))
                ? string(map(options.get("scatter")).get("bubbleField"), "")
                : "";
        String xName = resultColumn(columns, 0, "X");
        List<Map<String, Object>> fields = new ArrayList<>();
        String xIdentity = string(builder.get("xAxis"), xName);
        fields.add(field("x:" + xIdentity, humanize(builder.get("xAxis"), xName, builder), "가로축", "x",
                null, 0, true));

        for (int index = 1; index < columns.size(); index++) {
            Map<String, Object> source = at(measures, index - 1);
            String columnName = columnName(columns.get(index), "");
            if (!bubbleName.isEmpty() && bubbleName.equals(columnName)) {
                fields.add(field(
                        "bubble:" + string(source.get("column"), columnName),
                        measureLabel(source, columnName, builder),
                        "버블 크기",
                        "bubbleSize",
                        null,
                        2,
                        true
                ));
            } else {
                fields.add(field(
                        measureKey(source, index - 1, columnName),
                        measureLabel(source, columnName, builder),
                        "세로축",
                        "y",
                        columnName,
                        1,
                        true
                ));
            }
        }
        return fields;
    }

    private static List<Map<String, Object>> pieFields(
            List<Map<String, Object>> columns,
            Map<String, Object> builder
    ) {
        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        Map<String, Object> source = at(measures, 0);
        String categoryName = resultColumn(columns, 0, "항목");
        String valueName = resultColumn(columns, 1, "값");
        return List.of(
                field(
                        "category:" + string(builder.get("xAxis"), categoryName),
                        humanize(builder.get("xAxis"), categoryName, builder),
                        "항목",
                        "category"
                ),
                field(
                        measureKey(source, 0, valueName),
                        measureLabel(source, valueName, builder),
                        aggregateRole(source),
                        "measure"
                ),
                field("derived:percent", "구성비", "계산값", "percent")
        );
    }

    private static List<Map<String, Object>> boxplotFields(
            List<Map<String, Object>> columns,
            Map<String, Object> builder
    ) {
        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        Map<String, Object> source = at(measures, 0);
        String categoryName = resultColumn(columns, 0, "카테고리");
        String valueName = measureLabel(source, resultColumn(columns, 1, "값"), builder);
        String identity = string(source.get("column"), resultColumn(columns, 1, "value"));
        return List.of(
                field(
                        "category:" + string(builder.get("xAxis"), categoryName),
                        humanize(builder.get("xAxis"), categoryName, builder),
                        "카테고리",
                        "category"
                ),
                field("box:min:" + identity, valueName + " 최솟값", "계산값", "boxMin", null, 0, true),
                field("box:q1:" + identity, valueName + " 1사분위수", "계산값", "boxQ1", null, 1, true),
                field("box:median:" + identity, valueName + " 중앙값", "계산값", "boxMedian", null, 2, true),
                field("box:q3:" + identity, valueName + " 3사분위수", "계산값", "boxQ3", null, 3, true),
                field("box:max:" + identity, valueName + " 최댓값", "계산값", "boxMax", null, 4, true),
                field("box:outlier:" + identity, valueName + " 이상치", "계산값", "boxOutlier")
        );
    }

    private static List<Map<String, Object>> heatmapFields(
            List<Map<String, Object>> columns,
            Map<String, Object> builder
    ) {
        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        String xName = resultColumn(columns, 0, "가로 항목");
        List<Map<String, Object>> fields = new ArrayList<>();
        fields.add(field(
                "x:" + string(builder.get("xAxis"), xName),
                humanize(builder.get("xAxis"), xName, builder),
                "가로축",
                "category"
        ));
        for (int index = 1; index < columns.size(); index++) {
            Map<String, Object> source = at(measures, index - 1);
            String columnName = columnName(columns.get(index), "");
            fields.add(field(
                    measureKey(source, index - 1, columnName),
                    measureLabel(source, columnName, builder),
                    "측정 항목",
                    "measure",
                    columnName,
                    2,
                    true
            ));
        }
        return fields;
    }

    private static List<Map<String, Object>> areaMapFields(
            List<Map<String, Object>> columns,
            Map<String, Object> builder
    ) {
        Map<String, Object> area = map(builder.get("geoArea"));
        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        Map<String, Object> firstMeasure = at(measures, 0);
        Object nameRef = firstNonNull(area.get("nameColumn"), builder.get("xAxis"), resultColumn(columns, 0, "지역"));
        Object valueRef = firstNonNull(area.get("valueColumn"), firstMeasure.get("column"), resultColumn(columns, 1, "값"));
        Map<String, Object> valueSource = area.get("valueColumn") != null
                ? Map.of("column", area.get("valueColumn"), "agg", "none")
                : firstMeasure;

        List<Map<String, Object>> fields = new ArrayList<>();
        fields.add(field("region:" + nameRef, humanize(nameRef, "지역", builder), "지역", "category"));
        String seriesBy = string(builder.get("seriesBy"), "");
        if (!seriesBy.isEmpty()) {
            fields.add(field("series:" + seriesBy, humanize(seriesBy, "계열", builder), "계열", "series"));
        }
        if (valueRef != null && !String.valueOf(valueRef).isEmpty()) {
            fields.add(field(
                    measureKey(valueSource, 0, String.valueOf(valueRef)),
                    measureLabel(valueSource, String.valueOf(valueRef), builder),
                    aggregateRole(valueSource),
                    "geoValue"
            ));
        }
        return fields;
    }

    private static List<Map<String, Object>> geoPointFields(
            String chartType,
            List<Map<String, Object>> columns,
            Map<String, Object> builder
    ) {
        Map<String, Object> point = map(builder.get("geoPoint"));
        List<Map<String, Object>> measures = maps(builder.get("yAxis"));
        List<Map<String, Object>> fields = new ArrayList<>();
        Object nameRef = point.get("nameColumn");
        Object valueRef = point.get("valueColumn");
        Object sizeRef = firstNonNull(
                point.get("sizeColumn"),
                "geoscatter".equals(chartType) ? at(measures, 1).get("column") : null
        );

        if (nameRef != null || hasColumn(columns, POINT_NAME)) {
            Object source = nameRef == null ? POINT_NAME : nameRef;
            fields.add(field("geo:name:" + source, humanize(nameRef, "포인트 이름", builder), "포인트 이름", "geoName"));
        }
        String seriesBy = string(builder.get("seriesBy"), "");
        if (!seriesBy.isEmpty() || hasColumn(columns, GEO_SERIES)) {
            Object source = seriesBy.isEmpty() ? GEO_SERIES : seriesBy;
            fields.add(field("series:" + source, humanize(
                    seriesBy.isEmpty() ? null : seriesBy, "계열", builder), "계열", "series"));
        }
        if (valueRef != null || hasColumn(columns, POINT_VALUE)) {
            Object source = valueRef == null ? POINT_VALUE : valueRef;
            fields.add(field(
                    "geo:value:" + source,
                    humanize(valueRef, "값", builder),
                    "map".equals(chartType) ? "강도 값" : "값",
                    "geoValue",
                    null,
                    2,
                    true
            ));
        }
        if ("geoscatter".equals(chartType) && (sizeRef != null || hasColumn(columns, POINT_SIZE))) {
            Object source = sizeRef == null ? POINT_SIZE : sizeRef;
            fields.add(field(
                    "geo:size:" + source,
                    humanize(sizeRef, "크기", builder),
                    "포인트 크기",
                    "geoSize",
                    null,
                    3,
                    true
            ));
        }
        boolean spatial = "spatial".equals(string(point.get("mode"), ""));
        Object longitudeRef = spatial ? "경도" : firstNonNull(builder.get("xAxis"), LONGITUDE);
        Object latitudeRef = spatial ? "위도" : firstNonNull(at(measures, 0).get("column"), LATITUDE);
        String coordinateRole = spatial ? "위치 계산값" : "위치";
        fields.add(field(
                "geo:longitude:" + longitudeRef,
                humanize(longitudeRef, "경도", builder),
                coordinateRole,
                "longitude",
                null,
                0,
                false
        ));
        fields.add(field(
                "geo:latitude:" + latitudeRef,
                humanize(latitudeRef, "위도", builder),
                coordinateRole,
                "latitude",
                null,
                1,
                false
        ));
        return fields;
    }

    private static Map<String, Object> field(String key, String label, String role, String kind) {
        return field(key, label, role, kind, null, null, true);
    }

    private static Map<String, Object> field(
            String key,
            String label,
            String role,
            String kind,
            String seriesName,
            Integer valueIndex,
            boolean defaultVisible
    ) {
        Map<String, Object> field = new LinkedHashMap<>();
        field.put("key", key);
        field.put("label", label);
        field.put("role", role);
        field.put("kind", kind);
        field.put("defaultVisible", defaultVisible);
        if (seriesName != null) field.put("seriesName", seriesName);
        if (valueIndex != null) field.put("valueIndex", valueIndex);
        return field;
    }

    private static String measureLabel(
            Map<String, Object> source,
            String fallback,
            Map<String, Object> builder
    ) {
        return FieldDisplayNameResolver.measureName(builder, source, fallback);
    }

    private static String measureKey(Map<String, Object> source, int index, String fallback) {
        if (source.isEmpty()) return "measure:" + fallback + ":" + index;
        return "measure:" + string(source.get("agg"), "none")
                + ":" + string(source.get("column"), fallback)
                + ":" + index;
    }

    private static String aggregateRole(Map<String, Object> source) {
        return AGGREGATE_LABELS.getOrDefault(string(source.get("agg"), "none"), "값");
    }

    private static String humanize(Object value, String fallback, Map<String, Object> builder) {
        return FieldDisplayNameResolver.fieldName(builder, value, fallback);
    }

    private static String humanize(Object value, String fallback) {
        String text = string(value, fallback);
        int dot = text.lastIndexOf('.');
        if (dot >= 0) text = text.substring(dot + 1);
        text = text.replaceFirst("^__chartsdk_", "")
                .replaceAll("[_-]+", " ")
                .trim();
        return text.isEmpty() ? fallback : text;
    }

    private static String resultColumn(List<Map<String, Object>> columns, int index, String fallback) {
        return index >= 0 && index < columns.size() ? columnName(columns.get(index), fallback) : fallback;
    }

    private static String columnName(Map<String, Object> column, String fallback) {
        return string(column.get("name"), fallback);
    }

    private static boolean hasColumn(List<Map<String, Object>> columns, String name) {
        return columns.stream().anyMatch(column -> name.equals(columnName(column, "")));
    }

    private static Object firstNonNull(Object... values) {
        for (Object value : values) {
            if (value != null) return value;
        }
        return null;
    }

    private static Map<String, Object> at(List<Map<String, Object>> values, int index) {
        return index >= 0 && index < values.size() ? values.get(index) : Map.of();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object value) {
        if (!(value instanceof List<?> values)) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : values) {
            result.add(item instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of());
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static String string(Object value, String fallback) {
        if (value == null) return fallback;
        String text = String.valueOf(value);
        return text.isBlank() ? fallback : text;
    }
}
