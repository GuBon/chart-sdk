package com.chartsdk.converter;

import com.chartsdk.config.OptionDefaults;
import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 차트 옵션 → ECharts option 단일 변환기 (변환기 매핑 스펙). 임베드·노코드 미리보기·옵션 재조립이 공유한다.
 * 파이프라인: withDefaults(deep) → applySort → 축/시리즈 조립(@variant·직접매핑·@color·@legend 등).
 * 주의: JSON 전송이라 JS 함수(숫자 포맷 콤마 등)는 표현 불가 — 단위 접미사는 ECharts 문자열 템플릿('{value}단위')로 처리한다.
 */
@Service
public class ChartOptionConverter {
    private static final String EMBEDDED_MAPS_KEY = "__chartsdkMaps";
    private static final String MAP_VIEWPORT_KEY = "__chartsdkMapViewport";
    private static final String TOOLTIP_METADATA_KEY = "__chartsdkTooltip";
    private static final String SPATIAL_AREA_NAME = "__chartsdk_area_name";
    private static final String SPATIAL_AREA_VALUE = "__chartsdk_area_value";
    private static final String SPATIAL_AREA_GEOJSON = "__chartsdk_geojson";
    private static final List<String> LEGACY_DEFAULT_PALETTE = List.of(
            "#88CCEE", "#CC6677", "#DDCC77", "#117733", "#332288", "#AA4499",
            "#44AA99", "#999933", "#882255", "#661100", "#6699CC", "#888888"
    );
    private static final int AXIS_NAME_GAP = 56;
    private static final int AXIS_ENDPOINT_NAME_GAP = 8;
    // ECharts 는 title/legend/grid/visualMap 을 자동 배치하지 않는다. 예약 높이는 사용자 글꼴 크기에서 계산하며 mock과 수식이 같아야 한다.
    private record Typography(int title, int legend, int axis, int dataLabel, int tooltip) {}
    private record LayoutMetrics(int titleHeight, int legendHeight, int visualMapHeight) {}

    private final OptionDefaults defaults;
    private final ObjectMapper mapper;

    public ChartOptionConverter(OptionDefaults defaults) {
        this(defaults, new ObjectMapper());
    }

    @Autowired
    public ChartOptionConverter(OptionDefaults defaults, ObjectMapper mapper) {
        this.defaults = defaults;
        this.mapper = mapper;
    }

    private static boolean hasTitle(Map<String, Object> opt) {
        return !string(opt.get("title"), "").isEmpty();
    }

    private static boolean titleAtBottom(Map<String, Object> opt) {
        return hasTitle(opt) && "bottom".equals(string(opt.get("titleV"), "top"));
    }

    public Map<String, Object> convert(QueryRows rows, String chartType, Map<String, Object> options) {
        Map<String, Object> normalizedOptions = migrateLegacyInteractionOptions(
                options == null ? Map.of() : options,
                chartType
        );
        Map<String, Object> opt = deepMerge(defaults.forType(chartType), normalizedOptions);
        boolean legacyColorTheme = !normalizedOptions.isEmpty()
                && number(map(normalizedOptions.get("colorTheme")).get("version"), 0) != 2;
        if (legacyColorTheme) {
            // colorTheme 도입 전 저장된 지도/히트맵은 종전 Safe + 2색 visualMap 결과를 유지한다.
            opt.remove("colorTheme");
            opt.put("paletteReversed", false);
            if (("map".equals(chartType) || "heatmap".equals(chartType))
                    && !normalizedOptions.containsKey("palette")) {
                opt.put("palette", LEGACY_DEFAULT_PALETTE);
                if (!normalizedOptions.containsKey("palettePreset")) opt.put("palettePreset", "safe");
            }
        }
        String variant = string(opt.get("variant"), "basic");

        List<Map<String, Object>> columns = rows.columns();
        List<List<Object>> dataRows = applySort(rows.rows(), string(opt.get("sortOrder"), "none"));
        List<Object> categories = new ArrayList<>();
        for (List<Object> r : dataRows) categories.add(r.isEmpty() ? null : r.get(0));

        List<String> colorNames = new ArrayList<>();
        if ("pie".equals(chartType)) {
            categories.forEach(category -> colorNames.add(String.valueOf(category)));
        } else {
            for (int c = 1; c < columns.size(); c++) colorNames.add(string(columns.get(c).get("name"), ""));
        }
        Map<String, Object> autoColorMap = ColorResolver.resolveSeriesColors(opt, colorNames);
        opt.put("autoColorMap", autoColorMap);
        ItemColorResolver itemColors = ItemColorResolver.from(opt);

        Map<String, Object> o = new LinkedHashMap<>();
        o.put("__chartsdkAutoColorMap", autoColorMap);
        o.put("__chartsdkValueFormat", Map.of(
                "tooltip", string(map(opt.get("tooltip")).get("valueFormat"), "raw"),
                "yAxis", string(map(opt.get("yAxis")).get("format"), "raw"),
                "unit", string(map(opt.get("yAxis")).get("unit"), "")
        ));
        // 배경: 임베드가 어떤 호스트 페이지(다크 포함) 위에서도 자기완결적으로 보이도록 불투명 기본(흰색).
        // 저장된 옵션에 backgroundColor 가 있으면 그 값을 쓴다(차트별 설정). SDK 는 data-chart-background 로 재정의 가능.
        o.put("backgroundColor", string(opt.get("backgroundColor"), "#ffffff"));
        applyTitle(o, opt);
        applyColor(o, opt);
        applyLegend(o, opt);
        applyTooltip(o, opt, chartType);

        // 신규 유형은 직교 폴스루를 타지 않고 전용 조립(축·시리즈 형태가 다르다).
        if ("boxplot".equals(chartType)) { buildBoxplot(o, opt, columns, dataRows, itemColors); return o; }
        if ("heatmap".equals(chartType)) { buildHeatmap(o, opt, columns, dataRows, itemColors); return o; }
        if ("map".equals(chartType)) { buildMap(o, opt, columns, dataRows, itemColors); return o; }
        if ("geoscatter".equals(chartType)) { buildGeoScatter(o, opt, columns, dataRows, itemColors); return o; }

        if ("pie".equals(chartType)) {
            o.put("series", List.of(buildPieSeries(opt, variant, dataRows, itemColors)));
            return o;
        }

        boolean horizontal = "bar".equals(chartType) && "horizontal".equals(variant);
        boolean scatter = "scatter".equals(chartType);
        applyGrid(o, opt, horizontal);
        applyAxes(o, opt, scatter, horizontal, categories);
        o.put("series", buildCartesianSeries(opt, chartType, variant, columns, dataRows, horizontal, scatter, itemColors));
        return o;
    }

    // ── 정렬 (@sort) ─────────────────────────────────────
    private List<List<Object>> applySort(List<List<Object>> rows, String sortOrder) {
        if (rows.isEmpty() || !("asc".equals(sortOrder) || "desc".equals(sortOrder))) return rows;
        List<List<Object>> sorted = new ArrayList<>(rows);
        int sign = "asc".equals(sortOrder) ? 1 : -1;
        sorted.sort((a, b) -> sign * Double.compare(num(a, 1), num(b, 1)));
        return sorted;
    }

    private static double num(List<Object> row, int i) {
        if (row.size() <= i || !(row.get(i) instanceof Number n)) return Double.NEGATIVE_INFINITY;
        return n.doubleValue();
    }

    // ── 제목·색·범례·툴팁 ─────────────────────────────────
    private void applyTitle(Map<String, Object> o, Map<String, Object> opt) {
        String title = string(opt.get("title"), "");
        if (title.isEmpty()) return;
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("text", title);
        t.put("left", string(opt.get("titleH"), "center"));
        t.put("top", string(opt.get("titleV"), "top"));
        t.put("textStyle", Map.of("fontSize", typography(opt).title()));
        o.put("title", t);
    }

    private void applyColor(Map<String, Object> o, Map<String, Object> opt) {
        List<Object> palette = ColorResolver.orderedPalette(opt);
        if (!palette.isEmpty()) {
            o.put("color", palette);
        }
    }

    private void applyLegend(Map<String, Object> o, Map<String, Object> opt) {
        Map<String, Object> legend = map(opt.get("legend"));
        if (legend.isEmpty()) return;
        Map<String, Object> l = new LinkedHashMap<>();
        l.put("show", legend.getOrDefault("show", true));
        String position = string(legend.get("position"), "bottom");
        Typography typography = typography(opt);
        LayoutMetrics metrics = layoutMetrics(typography);
        // 제목이 같은 모서리(상/하)에 있으면 범례를 제목 다음 줄로 밀어 겹침 방지(규칙 1). 좌/우 범례는 제목과 축이 달라 무관.
        boolean titleTop = hasTitle(opt) && "top".equals(string(opt.get("titleV"), "top"));
        boolean titleBottom = titleAtBottom(opt);
        switch (position) {
            case "top" -> { l.put("top", titleTop ? metrics.titleHeight() : 0); l.put("orient", "horizontal"); }
            case "left" -> { l.put("left", 0); l.put("orient", "vertical"); }
            case "right" -> { l.put("right", 0); l.put("orient", "vertical"); }
            default -> { l.put("bottom", titleBottom ? metrics.titleHeight() : 0); l.put("orient", "horizontal"); }
        }
        l.put("textStyle", Map.of("fontSize", typography.legend()));
        // 상·하 범례는 항상 scroll로 단일행을 보장해야 계산한 범례 블록 높이와 실제 레이아웃이 일치한다.
        // 좌·우는 기존 T2 토글을 존중한다.
        boolean horizontal = "top".equals(position) || "bottom".equals(position);
        if (horizontal || Boolean.TRUE.equals(legend.get("scroll"))) l.put("type", "scroll");
        o.put("legend", l);
    }

    private void applyTooltip(Map<String, Object> o, Map<String, Object> opt, String chartType) {
        Map<String, Object> tooltip = map(opt.get("tooltip"));
        Map<String, Object> t = new LinkedHashMap<>();
        boolean enabled = !Boolean.FALSE.equals(tooltip.get("enabled"));
        if (!enabled) t.put("show", false);

        String trigger = string(tooltip.get("trigger"), "auto");
        if (!"auto".equals(trigger)) t.put("trigger", trigger);
        String axisPointer = string(tooltip.get("axisPointer"), "auto");
        if (!"auto".equals(axisPointer)) t.put("axisPointer", Map.of("type", axisPointer));
        switch (string(tooltip.get("confine"), "auto")) {
            case "inside" -> t.put("confine", true);
            case "free" -> t.put("confine", false);
            default -> { /* ECharts 기본값(null)을 그대로 사용 */ }
        }
        putIfNotNull(t, "backgroundColor", tooltip.get("backgroundColor"));
        putIfNotNull(t, "borderColor", tooltip.get("borderColor"));
        if (tooltip.get("borderWidth") instanceof Number borderWidth) t.put("borderWidth", borderWidth);
        if (tooltip.get("padding") instanceof Number padding) t.put("padding", padding);
        Map<String, Object> textStyle = new LinkedHashMap<>();
        textStyle.put("fontSize", typography(opt).tooltip());
        putIfNotNull(textStyle, "color", tooltip.get("textColor"));
        t.put("textStyle", textStyle);
        o.put("tooltip", t);

        if (enabled && "custom".equals(string(tooltip.get("contentMode"), "auto"))) {
            o.put(TOOLTIP_METADATA_KEY, Map.of(
                    "chartType", chartType,
                    "template", string(tooltip.get("template"), tooltipTemplateFor(chartType))
            ));
        } else {
            o.remove(TOOLTIP_METADATA_KEY);
        }
    }

    private String tooltipTemplateFor(String chartType) {
        return switch (chartType) {
            case "bar", "line" -> "{series}\n{name}: {value}";
            case "pie" -> "{name}: {value} ({percent}%)";
            case "scatter" -> "{series}\nX: {x}\nY: {y}";
            case "boxplot" -> "{name}\n최솟값: {min}\nQ1: {q1}\n중앙값: {median}\nQ3: {q3}\n최댓값: {max}";
            case "heatmap" -> "X: {x}\nY: {y}\n값: {value}";
            case "map" -> "지역: {name}\n값: {value}";
            case "geoscatter" -> "경도: {lng}\n위도: {lat}";
            default -> "{series}\n{name}: {value}";
        };
    }

    /** 모든 시리즈가 공유하는 강조 계약. 자동 항목은 생략해 ECharts 유형별 기본값을 그대로 사용한다. */
    private void applySeriesEmphasis(Map<String, Object> series, Map<String, Object> opt, String seriesType) {
        Map<String, Object> config = map(opt.get("emphasis"));
        if (Boolean.FALSE.equals(config.get("enabled"))) {
            series.put("emphasis", Map.of("disabled", true));
            return;
        }

        Map<String, Object> emphasis = new LinkedHashMap<>();
        String focus = string(config.get("focus"), "auto");
        if (!"auto".equals(focus)) emphasis.put("focus", focus);

        if (List.of("line", "pie", "scatter", "boxplot").contains(seriesType)
                && config.get("scale") instanceof Boolean scale) {
            emphasis.put("scale", scale);
        }
        if ("pie".equals(seriesType) && config.get("scaleSize") instanceof Number scaleSize) {
            emphasis.put("scaleSize", scaleSize);
        }
        if ("line".equals(seriesType) && config.get("lineWidth") instanceof Number lineWidth) {
            putNested(emphasis, "lineStyle", "width", lineWidth);
        }
        if ("boxplot".equals(seriesType) && config.get("borderWidth") instanceof Number borderWidth) {
            putNested(emphasis, "itemStyle", "borderWidth", borderWidth);
        }

        if ("custom".equals(string(config.get("colorMode"), "auto"))) {
            String color = string(config.get("color"), "#FFD700");
            switch (seriesType) {
                case "map" -> putNested(emphasis, "itemStyle", "areaColor", color);
                case "line" -> {
                    putNested(emphasis, "itemStyle", "color", color);
                    putNested(emphasis, "lineStyle", "color", color);
                }
                case "boxplot" -> {
                    putNested(emphasis, "itemStyle", "color", color);
                    putNested(emphasis, "itemStyle", "borderColor", color);
                }
                default -> putNested(emphasis, "itemStyle", "color", color);
            }
        }

        if (!emphasis.isEmpty()) series.put("emphasis", emphasis);
    }

    /** geo 컴포넌트는 series와 강조 색상 경로가 달라 별도 어댑터만 둔다. */
    private void applyGeoEmphasis(Map<String, Object> geo, Map<String, Object> opt) {
        Map<String, Object> config = map(opt.get("emphasis"));
        if (Boolean.FALSE.equals(config.get("enabled"))) {
            geo.put("emphasis", Map.of("disabled", true));
            return;
        }
        Map<String, Object> emphasis = new LinkedHashMap<>();
        String focus = string(config.get("focus"), "auto");
        if (!"auto".equals(focus)) emphasis.put("focus", focus);
        if ("custom".equals(string(config.get("colorMode"), "auto"))) {
            putNested(emphasis, "itemStyle", "areaColor", string(config.get("color"), "#FFD700"));
        }
        if (!emphasis.isEmpty()) geo.put("emphasis", emphasis);
    }

    private void putNested(Map<String, Object> target, String group, String key, Object value) {
        Map<String, Object> nested = new LinkedHashMap<>(map(target.get(group)));
        nested.put(key, value);
        target.put(group, nested);
    }

    // ── 신규: 상자수염·히트맵·지도 ────────────────────────
    /** 상자수염: 카테고리(0열)별로 값(1열)을 모아 5수 요약([min,Q1,median,Q3,max])을 계산. 전용 축(직교 폴스루의 이중축 오염 회피). */
    private void buildBoxplot(Map<String, Object> o, Map<String, Object> opt, List<Map<String, Object>> columns,
                              List<List<Object>> rows, ItemColorResolver itemColors) {
        LinkedHashMap<String, List<Double>> groups = new LinkedHashMap<>();
        for (List<Object> r : rows) {
            String cat = r.isEmpty() ? "" : String.valueOf(r.get(0));
            if (r.size() > 1 && r.get(1) instanceof Number n) {
                groups.computeIfAbsent(cat, k -> new ArrayList<>()).add(n.doubleValue());
            }
        }
        List<Object> cats = new ArrayList<>(groups.keySet());
        String seriesName = columns.size() > 1 ? string(columns.get(1).get("name"), "분포") : "분포";
        List<Object> data = new ArrayList<>();
        for (Map.Entry<String, List<Double>> entry : groups.entrySet()) {
            Object itemColor = itemColors.color("boxplot", seriesName, List.of(entry.getKey()), 0);
            data.add(withItemColor(fiveNumberSummary(entry.getValue()), itemColor, "color", true));
        }

        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));
        int axisFontSize = typography(opt).axis();
        Map<String, Object> xAxis = new LinkedHashMap<>();
        xAxis.put("type", "category");
        xAxis.put("data", cats);
        xAxis.put("boundaryGap", true);
        decorateAxis(xAxis, xCfg, true, true, true, axisFontSize);
        Map<String, Object> yAxis = new LinkedHashMap<>();
        yAxis.put("type", "log".equals(string(yCfg.get("scale"), "value")) ? "log" : "value");
        decorateAxis(yAxis, yCfg, false, false, false, axisFontSize);

        applyGrid(o, opt, false);
        o.put("xAxis", xAxis);
        o.put("yAxis", yAxis);

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "boxplot");
        s.put("name", seriesName);
        s.put("data", data);
        Object color = ColorResolver.pickColor(opt, seriesName, 0);
        if (color != null) {
            Map<String, Object> itemStyle = new LinkedHashMap<>();
            itemStyle.put("color", color);
            itemStyle.put("borderColor", color);
            s.put("itemStyle", itemStyle);
        }
        applySeriesEmphasis(s, opt, "boxplot");
        o.put("series", List.of(s));
    }

    /** 히트맵: X=카테고리(행), Y=값 시리즈 컬럼명, 값=집계값 → data [xIdx, yIdx, value] + visualMap. */
    private void buildHeatmap(Map<String, Object> o, Map<String, Object> opt, List<Map<String, Object>> columns,
                              List<List<Object>> rows, ItemColorResolver itemColors) {
        List<Object> cats = new ArrayList<>();
        for (List<Object> r : rows) cats.add(r.isEmpty() ? null : r.get(0));
        List<Object> yNames = new ArrayList<>();
        for (int c = 1; c < columns.size(); c++) yNames.add(string(columns.get(c).get("name"), "series" + c));

        List<Object> data = new ArrayList<>();
        ItemColorResolver.Occurrences itemOccurrences = new ItemColorResolver.Occurrences();
        double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
        for (int xi = 0; xi < rows.size(); xi++) {
            List<Object> r = rows.get(xi);
            for (int c = 1; c < columns.size(); c++) {
                double v = (r.size() > c && r.get(c) instanceof Number n) ? n.doubleValue() : 0;
                List<Object> dimensions = java.util.Arrays.asList(cats.get(xi), yNames.get(c - 1));
                int occurrence = itemOccurrences.next("heatmap", "", dimensions);
                Object itemColor = itemColors.color("heatmap", "", dimensions, occurrence);
                data.add(withItemColor(List.of(xi, c - 1, v), itemColor, "color", false));
                if (v < min) min = v;
                if (v > max) max = v;
            }
        }
        if (Double.isInfinite(min)) { min = 0; max = 1; }
        if (min == max) max = min + 1;

        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));
        Typography typography = typography(opt);
        LayoutMetrics metrics = layoutMetrics(typography);
        Map<String, Object> xAxis = new LinkedHashMap<>();
        xAxis.put("type", "category");
        xAxis.put("data", cats);
        xAxis.put("splitArea", Map.of("show", true));
        decorateAxis(xAxis, xCfg, true, true, true, typography.axis());
        Map<String, Object> yAxis = new LinkedHashMap<>();
        yAxis.put("type", "category");
        yAxis.put("data", yNames);
        yAxis.put("splitArea", Map.of("show", true));
        decorateAxis(yAxis, yCfg, false, false, false, typography.axis());

        Map<String, Object> grid = new LinkedHashMap<>(presetGrid(string(map(opt.get("grid")).get("preset"), "normal")));
        grid.put("containLabel", map(opt.get("grid")).getOrDefault("containLabel", true));
        applyMargins(grid, opt, false, false); // 제목만 가산(heatmap 은 범례 제거) — 규칙 2
        // 하단 visualMap 공간 확보. visualMap 은 하단 제목이 있으면 동적 제목 높이만큼 올라가 그 위에 쌓인다.
        grid.put("bottom", ((Number) grid.get("bottom")).intValue() + metrics.visualMapHeight());
        o.remove("legend"); // heatmap 은 visualMap 이 범례 대체 (공통 zone 잔존 legend 제거)
        o.put("grid", grid);
        o.put("xAxis", xAxis);
        o.put("yAxis", yAxis);
        o.put("visualMap", visualMap(min, max, opt));

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "heatmap");
        s.put("name", "값");
        s.put("data", data);
        s.put("label", Map.of("show", Boolean.TRUE.equals(opt.get("dataLabel")), "fontSize", typography.dataLabel()));
        applySeriesEmphasis(s, opt, "heatmap");
        o.put("series", List.of(s));
    }

    /** 지도: 내장 행정구역 또는 DB Polygon GeoJSON 경계에 이름·값을 연결한다. */
    private void buildMap(Map<String, Object> o, Map<String, Object> opt,
                          List<Map<String, Object>> columns, List<List<Object>> rows,
                          ItemColorResolver itemColors) {
        int nameIndex = columnIndex(columns, SPATIAL_AREA_NAME);
        int valueIndex = columnIndex(columns, SPATIAL_AREA_VALUE);
        int geoJsonIndex = columnIndex(columns, SPATIAL_AREA_GEOJSON);
        boolean spatial = nameIndex >= 0 && valueIndex >= 0 && geoJsonIndex >= 0;
        List<Object> data = new ArrayList<>();
        ItemColorResolver.Occurrences itemOccurrences = new ItemColorResolver.Occurrences();
        List<Object> features = new ArrayList<>();
        MessageDigest digest = spatial ? sha256() : null;
        double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
        for (List<Object> r : rows) {
            int ni = spatial ? nameIndex : 0;
            int vi = spatial ? valueIndex : 1;
            String name = r.size() > ni ? String.valueOf(r.get(ni)) : "";
            if (spatial) {
                if (r.size() <= geoJsonIndex || !(r.get(geoJsonIndex) instanceof String geometryJson)) continue;
                Map<String, Object> geometry = parsePolygonGeometry(geometryJson);
                if (geometry == null) continue;
                Map<String, Object> feature = new LinkedHashMap<>();
                feature.put("type", "Feature");
                feature.put("properties", Map.of("name", name));
                feature.put("geometry", geometry);
                features.add(feature);
                digest.update(name.getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                digest.update(geometryJson.getBytes(StandardCharsets.UTF_8));
            }
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("name", name);
            double v = (r.size() > vi && r.get(vi) instanceof Number n) ? n.doubleValue() : 0;
            point.put("value", v);
            List<Object> dimensions = List.of(name);
            int occurrence = itemOccurrences.next("map", "", dimensions);
            Object itemColor = itemColors.color("map", "", dimensions, occurrence);
            data.add(withItemColor(point, itemColor, "areaColor", false));
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (Double.isInfinite(min)) { min = 0; max = 1; }
        if (min == max) max = min + 1;

        o.remove("legend"); // 지도는 visualMap 이 범례 대체
        o.put("visualMap", visualMap(min, max, opt));

        String selectedMap = spatial ? dynamicMapName(digest) : mapName(opt);
        if (spatial) {
            Map<String, Object> featureCollection = new LinkedHashMap<>();
            featureCollection.put("type", "FeatureCollection");
            featureCollection.put("features", features);
            o.put(EMBEDDED_MAPS_KEY, List.of(Map.of("name", selectedMap, "geoJSON", featureCollection)));
        }

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "map");
        s.put("name", columns.size() > 1 ? string(columns.get(1).get("name"), "값") : "값");
        s.put("map", selectedMap);
        s.put("roam", Boolean.TRUE.equals(map(opt.get("map")).get("roam")));
        s.put("label", Map.of("show", Boolean.TRUE.equals(opt.get("dataLabel")), "fontSize", typography(opt).dataLabel()));
        applyLabelLayout(s, opt);
        applySeriesEmphasis(s, opt, "map");
        s.put("data", data);
        o.put("series", List.of(s));
        applyMapViewportMetadata(o, opt);
    }

    private Map<String, Object> parsePolygonGeometry(String json) {
        try {
            Map<String, Object> geometry = mapper.readValue(json, new TypeReference<>() {});
            String type = String.valueOf(geometry.get("type"));
            return "Polygon".equals(type) || "MultiPolygon".equals(type) ? geometry : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static String dynamicMapName(MessageDigest digest) {
        return "chartsdk-dynamic-" + HexFormat.of().formatHex(digest.digest()).substring(0, 16);
    }

    /**
     * 지도 포인트: 경도(0열)·위도(1열)(+선택 크기값 2열) → geo 좌표계 + scatter (공식 effectScatter-map 예제 구조).
     * JSON 전송이라 symbolSize 콜백 불가 → 크기값이 있으면 포인트별 symbolSize 를 계산해 데이터 항목에 넣는다(6~28px sqrt).
     */
    private void buildGeoScatter(Map<String, Object> o, Map<String, Object> opt, List<Map<String, Object>> columns,
                                 List<List<Object>> rows, ItemColorResolver itemColors) {
        boolean hasSize = columns.size() > 2;
        double sMin = Double.POSITIVE_INFINITY, sMax = Double.NEGATIVE_INFINITY;
        if (hasSize) {
            for (List<Object> r : rows) {
                if (r.size() > 2 && r.get(2) instanceof Number n) {
                    double v = n.doubleValue();
                    if (v < sMin) sMin = v;
                    if (v > sMax) sMax = v;
                }
            }
        }
        int base = map(opt.get("geoscatter")).get("symbolSize") instanceof Number n ? n.intValue() : 10;

        List<Object> data = new ArrayList<>();
        ItemColorResolver.Occurrences itemOccurrences = new ItemColorResolver.Occurrences();
        for (List<Object> r : rows) {
            double lng = (r.size() > 0 && r.get(0) instanceof Number n) ? n.doubleValue() : 0;
            double lat = (r.size() > 1 && r.get(1) instanceof Number n) ? n.doubleValue() : 0;
            List<Object> dimensions = List.of(roundCoordinate(lng), roundCoordinate(lat));
            int occurrence = itemOccurrences.next("geoscatter", "", dimensions);
            Object itemColor = itemColors.color("geoscatter", "", dimensions, occurrence);
            if (!hasSize || Double.isInfinite(sMin)) {
                data.add(withItemColor(List.of(lng, lat), itemColor, "color", false));
                continue;
            }
            double v = (r.size() > 2 && r.get(2) instanceof Number n) ? n.doubleValue() : 0;
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("value", List.of(lng, lat, v));
            point.put("symbolSize", sMax == sMin ? base : (int) Math.round(6 + 22 * Math.sqrt((v - sMin) / (sMax - sMin))));
            data.add(withItemColor(point, itemColor, "color", false));
        }

        o.remove("legend"); // 단일 포인트 시리즈 — 범례 무의미
        Map<String, Object> geo = new LinkedHashMap<>();
        geo.put("map", mapName(opt));
        geo.put("roam", Boolean.TRUE.equals(map(opt.get("map")).get("roam")));
        geo.put("label", Map.of("show", false));
        geo.put("itemStyle", Map.of("areaColor", "#f3f4f6", "borderColor", "#d1d5db"));
        applyGeoEmphasis(geo, opt);
        o.put("geo", geo);

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "scatter");
        s.put("coordinateSystem", "geo");
        s.put("name", columns.size() > 1 ? string(columns.get(1).get("name"), "포인트") : "포인트");
        s.put("symbolSize", base);
        Object color = ColorResolver.paletteColor(opt, 0);
        if (color != null) s.put("itemStyle", Map.of("color", color));
        applySeriesEmphasis(s, opt, "scatter");
        s.put("data", data);
        o.put("series", List.of(s));
        applyMapViewportMetadata(o, opt);
    }

    /** Admin과 SDK가 등록된 GeoJSON·포인트 데이터에 동일한 표시 영역을 적용하도록 내부 계약을 전달한다. */
    private void applyMapViewportMetadata(Map<String, Object> option, Map<String, Object> opt) {
        Object viewport = map(opt.get("map")).get("viewport");
        option.put(MAP_VIEWPORT_KEY, viewport instanceof Map<?, ?> ? viewport : Map.of("mode", "data"));
    }

    /** map.name 옵션(kr-sido|kr-sigungu) — 화이트리스트 밖 값은 kr-sido 로 폴백(등록 자산만 허용). */
    private String mapName(Map<String, Object> opt) {
        String name = string(map(opt.get("map")).get("name"), "kr-sido");
        return "kr-sigungu".equals(name) ? "kr-sigungu" : "kr-sido";
    }

    /** heatmap·map 공용 visualMap. v2는 순차형 전체 단계, 구 저장 데이터는 종전 2색 계약을 유지한다. */
    private Map<String, Object> visualMap(double min, double max, Map<String, Object> opt) {
        List<Object> palette = ColorResolver.orderedPalette(opt);
        Object top = palette.isEmpty() ? null : palette.get(0);
        boolean continuousPalette = number(map(opt.get("colorTheme")).get("version"), 0) == 2;
        Typography typography = typography(opt);
        LayoutMetrics metrics = layoutMetrics(typography);
        Map<String, Object> vm = new LinkedHashMap<>();
        vm.put("min", min);
        vm.put("max", max);
        vm.put("calculable", true);
        vm.put("orient", "horizontal");
        vm.put("left", "center");
        // 제목이 하단이면 visualMap 을 제목 위로 올려 겹침 방지(규칙 1의 map/heatmap 변형).
        vm.put("bottom", titleAtBottom(opt) ? metrics.titleHeight() : 0);
        vm.put("textStyle", Map.of("fontSize", typography.legend()));
        vm.put("inRange", Map.of(
                "color",
                continuousPalette && !palette.isEmpty()
                        ? palette
                        : List.of("#f7f7f7", top != null ? top : "#5470C6")
        ));
        return vm;
    }

    /** 정렬 후 R-7 선형보간 분위수. */
    private static double quantile(List<Double> sorted, double p) {
        int n = sorted.size();
        if (n == 0) return 0;
        if (n == 1) return sorted.get(0);
        double h = (n - 1) * p;
        int lo = (int) Math.floor(h);
        int hi = Math.min(lo + 1, n - 1);
        return sorted.get(lo) + (h - lo) * (sorted.get(hi) - sorted.get(lo));
    }

    /** 5수 요약 [min, Q1, median, Q3, max]. */
    private static List<Double> fiveNumberSummary(List<Double> values) {
        List<Double> s = new ArrayList<>(values);
        s.sort(Double::compare);
        return List.of(s.get(0), quantile(s, 0.25), quantile(s, 0.5), quantile(s, 0.75), s.get(s.size() - 1));
    }

    // ── 그리드·축 ────────────────────────────────────────
    private void applyGrid(Map<String, Object> o, Map<String, Object> opt, boolean horizontal) {
        Map<String, Object> grid = map(opt.get("grid"));
        Map<String, Object> g = new LinkedHashMap<>(presetGrid(string(grid.get("preset"), "normal")));
        g.put("containLabel", grid.getOrDefault("containLabel", true));
        applyMargins(g, opt, true, horizontal); // 제목·범례·축 이름만큼 여백 가산
        o.put("grid", g);
    }

    /** 프리셋 기초 여백 — 제목·범례 영역은 뺀 순수 플롯 여백. 요소별 가산은 applyMargins 가 담당. */
    private Map<String, Object> presetGrid(String preset) {
        return switch (preset) {
            case "compact" -> Map.of("left", 8, "right", 8, "top", 8, "bottom", 8);
            case "loose" -> Map.of("left", 48, "right", 48, "top", 48, "bottom", 48);
            default -> Map.of("left", 24, "right", 24, "top", 28, "bottom", 24);
        };
    }

    /** grid 의 top/bottom 에 글꼴에서 계산한 제목·범례 예약 높이를 같은 모서리별로 가산한다.
     *  includeLegend=false 는 범례를 제거하는 유형(heatmap 등)에서 범례 가산을 건너뛸 때. */
    private void applyMargins(Map<String, Object> g, Map<String, Object> opt, boolean includeLegend, boolean horizontal) {
        int left = ((Number) g.get("left")).intValue();
        int right = ((Number) g.get("right")).intValue();
        int top = ((Number) g.get("top")).intValue();
        int bottom = ((Number) g.get("bottom")).intValue();
        Typography typography = typography(opt);
        LayoutMetrics metrics = layoutMetrics(typography);
        boolean titleTop = hasTitle(opt) && "top".equals(string(opt.get("titleV"), "top"));
        if (titleTop) top += metrics.titleHeight();
        if (titleAtBottom(opt)) bottom += metrics.titleHeight();
        if (includeLegend) {
            Map<String, Object> legend = map(opt.get("legend"));
            boolean shown = !legend.isEmpty() && !Boolean.FALSE.equals(legend.get("show"));
            String pos = string(legend.get("position"), "bottom");
            if (shown && "top".equals(pos)) top += metrics.legendHeight();
            if (shown && "bottom".equals(pos)) bottom += metrics.legendHeight();
        }
        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));
        Map<String, Object> physicalXCfg = horizontal ? yCfg : xCfg;
        Map<String, Object> physicalYCfg = horizontal ? xCfg : yCfg;
        String physicalXPosition = axisPosition(physicalXCfg, !horizontal, true);
        String physicalYPosition = axisPosition(physicalYCfg, horizontal, false);
        int physicalXReserve = axisReserve(physicalXCfg, typography.axis());
        int physicalYReserve = axisReserve(physicalYCfg, typography.axis());
        if ("top".equals(physicalXPosition)) top += physicalXReserve;
        else bottom += physicalXReserve;
        if ("right".equals(physicalYPosition)) right += physicalYReserve;
        else left += physicalYReserve;
        int physicalXEndpointReserve = axisEndpointReserve(
                physicalXCfg, !horizontal, true, typography.axis());
        int physicalYEndpointReserve = axisEndpointReserve(
                physicalYCfg, horizontal, false, typography.axis());
        if ("start".equals(physicalXCfg.get("titleLocation"))) left += physicalXEndpointReserve;
        if ("end".equals(physicalXCfg.get("titleLocation"))) right += physicalXEndpointReserve;
        if ("start".equals(physicalYCfg.get("titleLocation"))) bottom += physicalYEndpointReserve;
        if ("end".equals(physicalYCfg.get("titleLocation"))) top += physicalYEndpointReserve;

        // 보조 Y축은 주축의 반대편에 배치되므로 양쪽 여백을 각각 확보한다.
        if (!horizontal && Boolean.TRUE.equals(yCfg.get("secondAxis"))) {
            if ("right".equals(physicalYPosition)) left += physicalYReserve;
            else right += physicalYReserve;
        }
        g.put("left", left);
        g.put("right", right);
        g.put("top", top);
        g.put("bottom", bottom);
    }

    private void applyAxes(Map<String, Object> o, Map<String, Object> opt, boolean scatter, boolean horizontal, List<Object> categories) {
        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));
        int axisFontSize = typography(opt).axis();

        Map<String, Object> categoryAxis = new LinkedHashMap<>();
        categoryAxis.put("type", "category");
        categoryAxis.put("data", categories);

        Map<String, Object> valueAxis = new LinkedHashMap<>();
        valueAxis.put("type", "log".equals(string(yCfg.get("scale"), "value")) ? "log" : "value");

        if (scatter) {
            // 분포: X·Y 모두 수치축, data 없음. (데이터는 [x,y] 쌍)
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("type", "log".equals(string(xCfg.get("scale"), "value")) ? "log" : "value");
            decorateAxis(x, xCfg, true, true, true, axisFontSize);
            decorateAxis(valueAxis, yCfg, false, false, false, axisFontSize);
            o.put("xAxis", x);
            o.put("yAxis", valueAxis);
            return;
        }

        // 가로 막대에서는 범주축이 실제 Y축이므로 라벨을 기울이지 않는다.
        decorateAxis(categoryAxis, xCfg, !horizontal, true, !horizontal, axisFontSize);
        decorateAxis(valueAxis, yCfg, false, false, horizontal, axisFontSize);

        if (horizontal) {
            o.put("xAxis", valueAxis);
            o.put("yAxis", categoryAxis);
            return;
        }
        o.put("xAxis", categoryAxis);
        // 이중축(@yAxis.second): 두 번째 값축 추가 (시리즈는 2번째부터 yAxisIndex=1)
        if (Boolean.TRUE.equals(yCfg.get("secondAxis"))) {
            Map<String, Object> second = new LinkedHashMap<>(valueAxis);
            second.put("position", "right".equals(axisPosition(yCfg, false, false)) ? "left" : "right");
            o.put("yAxis", List.of(valueAxis, second));
        } else {
            o.put("yAxis", valueAxis);
        }
    }

    /** 축 공통 장식: 제목·물리적 위치, rotate(카테고리), splitLine, min/max(수동), 단위 포맷터. */
    private void decorateAxis(Map<String, Object> axis, Map<String, Object> cfg,
                              boolean rulesAsX, boolean logicalIsX, boolean physicalIsX, int fontSize) {
        String title = string(cfg.get("title"), "");
        if (!title.isEmpty()) {
            axis.put("name", title);
            String location = titleLocation(cfg.get("titleLocation"));
            axis.put("nameLocation", location);
            axis.put("nameGap", "middle".equals(location)
                    ? Math.max(0, number(cfg.get("titleGap"), AXIS_NAME_GAP))
                    : AXIS_ENDPOINT_NAME_GAP);
            axis.put("nameRotate", axisTitleRotation(cfg, logicalIsX, physicalIsX));
        }
        axis.put("position", axisPosition(cfg, logicalIsX, physicalIsX));
        if (cfg.containsKey("splitLine")) axis.put("splitLine", Map.of("show", Boolean.TRUE.equals(cfg.get("splitLine"))));
        if (rulesAsX && cfg.get("rotate") instanceof Number rotate && rotate.intValue() != 0) {
            axis.put("axisLabel", new LinkedHashMap<>(Map.of("rotate", rotate)));
        }
        if (!rulesAsX && "manual".equals(string(cfg.get("rangeMode"), "auto"))) {
            if (cfg.get("min") != null) axis.put("min", cfg.get("min"));
            if (cfg.get("max") != null) axis.put("max", cfg.get("max"));
        }
        if (rulesAsX) {
            if (cfg.get("min") != null) axis.put("min", cfg.get("min"));
            if (cfg.get("max") != null) axis.put("max", cfg.get("max"));
        }
        if (!rulesAsX) {
            String unit = string(cfg.get("unit"), "");
            if (!unit.isEmpty()) {
                @SuppressWarnings("unchecked")
                Map<String, Object> label = (Map<String, Object>) axis.computeIfAbsent("axisLabel", k -> new LinkedHashMap<>());
                label.put("formatter", "{value}" + unit);
            }
        }
        if ("category".equals(axis.get("type"))) {
            @SuppressWarnings("unchecked")
            Map<String, Object> label = (Map<String, Object>) axis.computeIfAbsent("axisLabel", k -> new LinkedHashMap<>());
            applyCategoryLabelDensity(label, cfg, logicalIsX);
        } else {
            applyNumericAxisTicks(axis, cfg, logicalIsX);
        }
        applyAxisTypography(axis, fontSize);
    }

    private void applyCategoryLabelDensity(Map<String, Object> label, Map<String, Object> cfg, boolean logicalIsX) {
        String mode = string(cfg.get("labelIntervalMode"), logicalIsX ? "all" : "auto");
        switch (mode) {
            case "auto" -> label.put("interval", "auto");
            case "step" -> label.put("interval", Math.max(0, number(cfg.get("labelEvery"), 2) - 1));
            default -> {
                mode = "all";
                label.put("interval", 0);
            }
        }
        if (cfg.containsKey("showMinLabel")) label.put("showMinLabel", Boolean.TRUE.equals(cfg.get("showMinLabel")));
        if (cfg.containsKey("showMaxLabel")) label.put("showMaxLabel", Boolean.TRUE.equals(cfg.get("showMaxLabel")));
        label.put("hideOverlap", logicalIsX
                ? "auto".equals(mode)
                : !"all".equals(mode) && Boolean.TRUE.equals(cfg.get("hideOverlap")));
    }

    private void applyNumericAxisTicks(Map<String, Object> axis, Map<String, Object> cfg, boolean logicalIsX) {
        if ("log".equals(axis.get("type"))) {
            axis.put("logBase", Math.max(2, number(cfg.get("logBase"), 10)));
            return;
        }

        axis.put("scale", !Boolean.TRUE.equals(cfg.getOrDefault("includeZero", true)));
        if ("fixed".equals(string(cfg.get("tickMode"), "auto"))) {
            Number interval = positiveNumber(cfg.get("interval"));
            if (interval != null) axis.put("interval", interval);
            return;
        }

        axis.put("splitNumber", clampInt(number(cfg.get("splitNumber"), 5), 2, 20));
        if (logicalIsX) {
            Number minInterval = positiveNumber(cfg.get("minInterval"));
            Number maxInterval = positiveNumber(cfg.get("maxInterval"));
            if (minInterval != null) axis.put("minInterval", minInterval);
            if (maxInterval != null) axis.put("maxInterval", maxInterval);
        }
    }

    private Number positiveNumber(Object value) {
        if (!(value instanceof Number number) || !Double.isFinite(number.doubleValue()) || number.doubleValue() <= 0) return null;
        if (value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long) {
            return Long.valueOf(number.longValue());
        }
        return Double.valueOf(number.doubleValue());
    }

    private String titleLocation(Object value) {
        String location = string(value, "middle");
        return switch (location) {
            case "start", "end" -> location;
            default -> "middle";
        };
    }

    /**
     * 저장 옵션은 논리적 X/Y축 기준이다. 가로 막대처럼 축이 교환되면 ECharts의 물리적 방향으로 변환한다.
     */
    private String axisPosition(Map<String, Object> cfg, boolean logicalIsX, boolean physicalIsX) {
        String configured = string(cfg.get("position"), logicalIsX ? "bottom" : "left");
        String logicalPosition = logicalIsX
                ? ("top".equals(configured) ? "top" : "bottom")
                : ("right".equals(configured) ? "right" : "left");
        if (logicalIsX == physicalIsX) return logicalPosition;
        if (logicalIsX) return "top".equals(logicalPosition) ? "right" : "left";
        return "right".equals(logicalPosition) ? "top" : "bottom";
    }

    private int axisTitleRotation(Map<String, Object> cfg, boolean logicalIsX, boolean physicalIsX) {
        int logicalDefault = logicalIsX ? 0 : -90;
        int physicalDefault = physicalIsX ? 0 : -90;
        return physicalDefault + number(cfg.get("titleRotate"), logicalDefault) - logicalDefault;
    }

    private int axisReserve(Map<String, Object> cfg, int fontSize) {
        if (string(cfg.get("title"), "").isEmpty()) return 0;
        String location = titleLocation(cfg.get("titleLocation"));
        if (!"middle".equals(location)) return fontSize + 12;
        int gap = Math.max(0, number(cfg.get("titleGap"), AXIS_NAME_GAP));
        return fontSize + 12 + Math.max(0, gap - AXIS_NAME_GAP);
    }

    private int axisEndpointReserve(Map<String, Object> cfg, boolean logicalIsX,
                                    boolean physicalIsX, int fontSize) {
        String title = string(cfg.get("title"), "");
        if (title.isEmpty()) return 0;
        String location = titleLocation(cfg.get("titleLocation"));
        if ("middle".equals(location)) return 0;
        double rotation = Math.toRadians(axisTitleRotation(cfg, logicalIsX, physicalIsX));
        double textWidth = estimatedTextWidth(title, fontSize);
        double projectedLength = physicalIsX
                ? Math.abs(Math.cos(rotation)) * textWidth + Math.abs(Math.sin(rotation)) * fontSize
                : Math.abs(Math.sin(rotation)) * textWidth + Math.abs(Math.cos(rotation)) * fontSize;
        return AXIS_ENDPOINT_NAME_GAP + (int) Math.ceil(projectedLength);
    }

    private double estimatedTextWidth(String text, int fontSize) {
        double units = text.codePoints()
                .mapToDouble(codePoint -> Character.isWhitespace(codePoint)
                        ? 0.35
                        : codePoint <= 0x7f ? 0.58 : 1.0)
                .sum();
        return Math.ceil(units * fontSize);
    }

    private void applyAxisTypography(Map<String, Object> axis, int fontSize) {
        Map<String, Object> label = new LinkedHashMap<>(map(axis.get("axisLabel")));
        label.put("fontSize", fontSize);
        axis.put("axisLabel", label);
        axis.put("nameTextStyle", Map.of("fontSize", fontSize));
    }

    // ── 시리즈 (직교) ────────────────────────────────────
    private List<Map<String, Object>> buildCartesianSeries(Map<String, Object> opt, String chartType, String variant,
                                                           List<Map<String, Object>> columns, List<List<Object>> dataRows,
                                                           boolean horizontal, boolean scatter,
                                                           ItemColorResolver itemColors) {
        Map<String, Object> barCfg = map(opt.get("bar"));
        Map<String, Object> lineCfg = map(opt.get("line"));
        Map<String, Object> scatterCfg = map(opt.get("scatter"));
        Map<String, Object> seriesTypes = map(opt.get("seriesTypes")); // 혼합(combo): 시리즈명 → "bar"/"line"
        boolean stacked = "stacked".equals(variant) || "stackedArea".equals(variant);
        boolean secondAxis = !horizontal && !scatter && Boolean.TRUE.equals(map(opt.get("yAxis")).get("secondAxis"));
        int bubbleIdx = scatter && "bubble".equals(variant) ? columnIndex(columns, string(scatterCfg.get("bubbleField"), null)) : -1;

        // 100% 정규화(누적 막대): 카테고리(행)별 합으로 나눠 각 카테고리 스택이 100%가 되게 한다.
        double[] catTotals = (stacked && Boolean.TRUE.equals(barCfg.get("normalize"))) ? rowTotals(columns, dataRows) : null;

        List<Map<String, Object>> series = new ArrayList<>();
        for (int c = 1; c < columns.size(); c++) {
            int col = c;
            Map<String, Object> s = new LinkedHashMap<>();
            String colName = string(columns.get(c).get("name"), "");
            // 혼합(combo): 시리즈별 type 오버라이드(bar/line). 분포는 오버라이드 없음.
            String seriesType = chartType;
            if (!scatter) {
                Object override = seriesTypes.get(colName);
                if ("bar".equals(override) || "line".equals(override)) seriesType = (String) override;
            }
            s.put("type", seriesType);
            s.put("name", colName);

            List<Object> data = new ArrayList<>();
            ItemColorResolver.Occurrences itemOccurrences = new ItemColorResolver.Occurrences();
            for (int ri = 0; ri < dataRows.size(); ri++) {
                List<Object> r = dataRows.get(ri);
                Object y = r.size() > col ? r.get(col) : null;
                Object itemValue;
                List<Object> dimensions;
                String itemKind;
                if (scatter) {
                    Object x = r.isEmpty() ? null : r.get(0);
                    itemValue = bubbleIdx >= 0 && r.size() > bubbleIdx
                            ? java.util.Arrays.asList(x, y, r.get(bubbleIdx))
                            : java.util.Arrays.asList(x, y);
                    dimensions = java.util.Arrays.asList(x, y);
                    itemKind = "scatter";
                } else if (catTotals != null && y instanceof Number n && catTotals[ri] != 0) {
                    itemValue = n.doubleValue() / catTotals[ri];
                    dimensions = java.util.Arrays.asList(r.isEmpty() ? null : r.get(0));
                    itemKind = "cartesian";
                } else {
                    itemValue = y;
                    dimensions = java.util.Arrays.asList(r.isEmpty() ? null : r.get(0));
                    itemKind = "cartesian";
                }
                int occurrence = itemOccurrences.next(itemKind, colName, dimensions);
                Object itemColor = itemColors.color(itemKind, colName, dimensions, occurrence);
                data.add(withItemColor(itemValue, itemColor, "color", false));
            }
            s.put("data", data);

            if (stacked) s.put("stack", "total");
            applyVariantDelta(s, variant, lineCfg);
            applyLabel(s, opt);
            if ("bar".equals(seriesType)) applyBar(s, barCfg);
            if ("line".equals(seriesType)) applyLine(s, lineCfg);
            if (scatter && bubbleIdx < 0 && scatterCfg.get("symbolSize") != null) s.put("symbolSize", scatterCfg.get("symbolSize"));
            if (scatter && scatterCfg.get("symbol") != null) s.put("symbol", scatterCfg.get("symbol"));
            ColorResolver.applySeriesColor(s, seriesType, ColorResolver.pickColor(opt, colName, c - 1));
            applySeriesEmphasis(s, opt, seriesType);
            if (secondAxis && c >= 2) s.put("yAxisIndex", 1);
            series.add(s);
        }
        return series;
    }

    private void applyVariantDelta(Map<String, Object> s, String variant, Map<String, Object> lineCfg) {
        switch (variant) {
            case "smooth" -> s.put("smooth", true);
            case "step" -> s.put("step", "end");
            case "area", "stackedArea" -> {
                Object opacity = lineCfg.get("areaOpacity");
                s.put("areaStyle", opacity == null ? new LinkedHashMap<>() : new LinkedHashMap<>(Map.of("opacity", opacity)));
            }
            default -> { /* basic/stacked/group/horizontal: 별도 delta 없음 */ }
        }
    }

    private void applyLabel(Map<String, Object> s, Map<String, Object> opt) {
        if (Boolean.TRUE.equals(opt.get("dataLabel"))) {
            Map<String, Object> label = new LinkedHashMap<>();
            label.put("show", true);
            label.put("fontSize", typography(opt).dataLabel());
            String position = string(opt.get("labelPosition"), null);
            if (position != null) label.put("position", position);
            s.put("label", label);
            applyLabelLayout(s, opt);
        }
    }

    /** 데이터 라벨을 노출하는 시리즈 공통 겹침 방지. map처럼 전용 조립 경로에서도 재사용한다. */
    private void applyLabelLayout(Map<String, Object> s, Map<String, Object> opt) {
        if (Boolean.TRUE.equals(opt.get("dataLabel"))) {
            // 공식 labelLayout.hideOverlap. JSON 직렬화 가능한 객체형이라 방식 A 제약과 충돌하지 않는다.
            s.put("labelLayout", Map.of("hideOverlap", true));
        }
    }

    private void applyBar(Map<String, Object> s, Map<String, Object> barCfg) {
        if (barCfg.get("width") instanceof Number width) s.put("barWidth", width + "%");
        else putIfNotNull(s, "barWidth", barCfg.get("width"));
        if (barCfg.get("gap") instanceof Number gap) s.put("barGap", gap + "%");
        else putIfNotNull(s, "barGap", barCfg.get("gap"));
        if (barCfg.get("borderRadius") != null) s.put("itemStyle", new LinkedHashMap<>(Map.of("borderRadius", barCfg.get("borderRadius"))));
        if (Boolean.TRUE.equals(barCfg.get("showBackground"))) s.put("showBackground", true);
    }

    private void applyLine(Map<String, Object> s, Map<String, Object> lineCfg) {
        Map<String, Object> lineStyle = new LinkedHashMap<>();
        putIfNotNull(lineStyle, "width", lineCfg.get("width"));
        putIfNotNull(lineStyle, "type", lineCfg.get("lineType"));
        if (!lineStyle.isEmpty()) s.put("lineStyle", lineStyle);
        putIfNotNull(s, "showSymbol", lineCfg.get("showSymbol"));
        putIfNotNull(s, "symbolSize", lineCfg.get("symbolSize"));
        putIfNotNull(s, "connectNulls", lineCfg.get("connectNulls"));
    }

    // ── 시리즈 (원형) ────────────────────────────────────
    private Map<String, Object> buildPieSeries(Map<String, Object> opt, String variant, List<List<Object>> dataRows,
                                               ItemColorResolver itemColors) {
        Map<String, Object> pieCfg = map(opt.get("pie"));
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "pie");

        List<Object> data = new ArrayList<>();
        ItemColorResolver.Occurrences itemOccurrences = new ItemColorResolver.Occurrences();
        int i = 0;
        for (List<Object> r : dataRows) {
            Map<String, Object> point = new LinkedHashMap<>();
            Object name = r.isEmpty() ? "" : r.get(0);
            point.put("name", name);
            point.put("value", r.size() > 1 ? r.get(1) : 0);
            Object color = ColorResolver.pickColor(opt, String.valueOf(name), i);
            if (color != null) point.put("itemStyle", Map.of("color", color));
            List<Object> dimensions = java.util.Arrays.asList(name);
            int occurrence = itemOccurrences.next("pie", "", dimensions);
            Object itemColor = itemColors.color("pie", "", dimensions, occurrence);
            data.add(withItemColor(point, itemColor, "color", false));
            i++;
        }
        s.put("data", data);

        if ("donut".equals(variant)) {
            int width = pieCfg.get("donutWidth") instanceof Number n ? n.intValue() : 40;
            s.put("radius", List.of((100 - width) + "%", "100%"));
        }
        if ("rose".equals(variant)) s.put("roseType", "radius");

        Map<String, Object> label = new LinkedHashMap<>();
        label.put("show", Boolean.TRUE.equals(opt.get("dataLabel")) || !"basic".equals(variant) || pieCfg.get("labelPosition") != null);
        label.put("fontSize", typography(opt).dataLabel());
        putIfNotNull(label, "position", pieCfg.get("labelPosition"));
        s.put("label", label);
        putIfNotNull(s, "startAngle", pieCfg.get("startAngle"));
        putIfNotNull(s, "minAngle", pieCfg.get("minAngle"));
        applySeriesEmphasis(s, opt, "pie");
        return s;
    }

    @SuppressWarnings("unchecked")
    private Object withItemColor(Object value, Object color, String colorKey, boolean matchBorderColor) {
        if (color == null) return value;
        Map<String, Object> item;
        if (value instanceof Map<?, ?> existing) {
            item = new LinkedHashMap<>((Map<String, Object>) existing);
        } else {
            item = new LinkedHashMap<>();
            item.put("value", value);
        }
        Map<String, Object> itemStyle = item.get("itemStyle") instanceof Map<?, ?> existingStyle
                ? new LinkedHashMap<>((Map<String, Object>) existingStyle)
                : new LinkedHashMap<>();
        itemStyle.put(colorKey, color);
        if (matchBorderColor) itemStyle.put("borderColor", color);
        item.put("itemStyle", itemStyle);
        return item;
    }

    private double roundCoordinate(double value) {
        return Math.round(value * 1_000_000d) / 1_000_000d;
    }

    // ── 색 매핑 ──────────────────────────────────────────
    /** 카테고리(행)별 값 시리즈 합 — 100% 정규화 분모. */
    private double[] rowTotals(List<Map<String, Object>> columns, List<List<Object>> rows) {
        double[] totals = new double[rows.size()];
        for (int ri = 0; ri < rows.size(); ri++) {
            List<Object> r = rows.get(ri);
            for (int c = 1; c < columns.size(); c++) {
                if (r.size() > c && r.get(c) instanceof Number n) totals[ri] += n.doubleValue();
            }
        }
        return totals;
    }

    private int columnIndex(List<Map<String, Object>> columns, String name) {
        if (name == null) return -1;
        for (int i = 0; i < columns.size(); i++) {
            if (name.equals(columns.get(i).get("name"))) return i;
        }
        return -1;
    }

    // ── 논리 크기·글꼴·레이아웃 ────────────────────────────
    /** chart-options/display.ts와 같은 계약. 자동 모드는 논리 캔버스 프리셋에 맞추고, 직접 지정은 요소별 px 값을 사용한다. */
    private Typography typography(Map<String, Object> opt) {
        Map<String, Object> display = map(opt.get("display"));
        Map<String, Object> typography = map(opt.get("typography"));
        String preset = string(display.get("preset"), "standard");
        String mode = string(typography.get("mode"), "auto");
        int scale = clampInt(number(typography.get("scale"), 100), 80, 150);

        if ("custom".equals(mode)) {
            return new Typography(
                    clampInt(number(typography.get("titleFontSize"), 18), 10, 48),
                    clampInt(number(typography.get("legendFontSize"), 12), 8, 32),
                    clampInt(number(typography.get("axisFontSize"), 12), 8, 32),
                    clampInt(number(typography.get("dataLabelFontSize"), 12), 8, 32),
                    clampInt(number(typography.get("tooltipFontSize"), 12), 8, 32));
        }

        int titleBase;
        int bodyBase;
        switch (preset) {
            case "small" -> { titleBase = 14; bodyBase = 10; }
            case "large" -> { titleBase = 22; bodyBase = 14; }
            case "hd" -> { titleBase = 24; bodyBase = 15; }
            case "fhd" -> { titleBase = 26; bodyBase = 16; }
            case "custom" -> {
                int width = clampInt(number(display.get("width"), 640), 240, 3840);
                int height = clampInt(number(display.get("height"), 360), 180, 2160);
                double areaRatio = (width * (double) height) / (640.0 * 360.0);
                // chart-options/display.ts와 동일: 같은 종횡비의 기존 크기감은 유지하면서 가로·세로를 모두 반영한다.
                double ratio = Math.max(0.78, Math.min(1.5, Math.pow(areaRatio, 0.25)));
                titleBase = (int) Math.round(18 * ratio);
                bodyBase = (int) Math.round(12 * ratio);
            }
            default -> { titleBase = 18; bodyBase = 12; }
        }
        int title = scaledFont(titleBase, scale, 10, 48);
        int body = scaledFont(bodyBase, scale, 8, 32);
        return new Typography(title, body, body, body, body);
    }

    /** 기본 640×360, 100%에서 26/24/36px가 되어 기존 차트 외형을 유지한다. */
    private LayoutMetrics layoutMetrics(Typography typography) {
        int titleHeight = (int) Math.ceil(typography.title() * 1.2) + 4;
        int legendHeight = (int) Math.ceil(typography.legend() * 1.25) + 9;
        return new LayoutMetrics(titleHeight, legendHeight, legendHeight + 12);
    }

    private int scaledFont(int base, int scale, int min, int max) {
        return clampInt((int) Math.round(base * scale / 100.0), min, max);
    }

    private static int number(Object value, int fallback) {
        return value instanceof Number n && Double.isFinite(n.doubleValue()) ? (int) Math.round(n.doubleValue()) : fallback;
    }

    private static int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    // ── deep merge & 헬퍼 ────────────────────────────────
    private Map<String, Object> migrateLegacyInteractionOptions(Map<String, Object> options, String chartType) {
        Map<String, Object> next = deepMerge(new LinkedHashMap<>(), options);
        boolean cartesian = switch (chartType) {
            case "bar", "line", "scatter", "boxplot", "heatmap" -> true;
            default -> false;
        };
        if (cartesian) {
            Map<String, Object> metadata = new LinkedHashMap<>(map(next.get("_chartsdk")));
            boolean legacyAxisTitleLayout = number(metadata.get("axisTitleLayout"), 0) < 2;
            for (String axisKey : List.of("xAxis", "yAxis")) {
                if (!(next.get(axisKey) instanceof Map<?, ?>)) continue;
                Map<String, Object> axis = new LinkedHashMap<>(map(next.get(axisKey)));
                axis.remove("offset");
                if ("xAxis".equals(axisKey)) axis.remove("hideOverlap");
                if ("yAxis".equals(axisKey)) {
                    axis.remove("minInterval");
                    axis.remove("maxInterval");
                }
                if ("yAxis".equals(axisKey)
                        && legacyAxisTitleLayout
                        && axis.get("titleRotate") instanceof Number rotation
                        && rotation.doubleValue() == 90) {
                    axis.put("titleRotate", -90);
                }
                next.put(axisKey, axis);
            }
            metadata.put("axisTitleLayout", 2);
            next.put("_chartsdk", metadata);
        }
        if (!"map".equals(chartType) && !"geoscatter".equals(chartType)) return next;

        Map<String, Object> mapOptions = new LinkedHashMap<>(map(next.get("map")));
        Map<String, Object> legacyTooltip = map(mapOptions.get("tooltip"));
        Map<String, Object> legacyEmphasis = map(mapOptions.get("emphasis"));
        Map<String, Object> tooltip = new LinkedHashMap<>(map(next.get("tooltip")));
        Map<String, Object> emphasis = new LinkedHashMap<>(map(next.get("emphasis")));

        if (!tooltip.containsKey("enabled") && legacyTooltip.containsKey("enabled")) {
            tooltip.put("enabled", legacyTooltip.get("enabled"));
        }
        if (!tooltip.containsKey("template") && legacyTooltip.containsKey("template")) {
            tooltip.put("contentMode", "custom");
            tooltip.put("template", legacyTooltip.get("template"));
        }
        if (!emphasis.containsKey("enabled") && legacyEmphasis.containsKey("enabled")) {
            emphasis.put("enabled", legacyEmphasis.get("enabled"));
        }
        if (!emphasis.containsKey("color") && legacyEmphasis.containsKey("color")) {
            emphasis.put("colorMode", "custom");
            emphasis.put("color", legacyEmphasis.get("color"));
        }

        mapOptions.remove("tooltip");
        mapOptions.remove("emphasis");
        next.put("map", mapOptions);
        if (!tooltip.isEmpty()) next.put("tooltip", tooltip);
        if (!emphasis.isEmpty()) next.put("emphasis", emphasis);
        return next;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> deepMerge(Map<String, Object> base, Map<String, Object> override) {
        Map<String, Object> out = new LinkedHashMap<>(base);
        for (Map.Entry<String, Object> e : override.entrySet()) {
            Object cur = out.get(e.getKey());
            Object next = e.getValue();
            if (cur instanceof Map<?, ?> cm && next instanceof Map<?, ?> nm) {
                out.put(e.getKey(), deepMerge((Map<String, Object>) cm, (Map<String, Object>) nm));
            } else {
                out.put(e.getKey(), next);
            }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }

    private static String string(Object value, String fallback) {
        if (value == null) return fallback;
        String s = String.valueOf(value);
        return s.isBlank() ? fallback : s;
    }

    private static void putIfNotNull(Map<String, Object> m, String key, Object value) {
        if (value != null) m.put(key, value);
    }
}
