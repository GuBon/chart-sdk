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
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Date;
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
    private static final String SHOW_COMPUTED_AT_KEY = "__chartsdkShowComputedAt";
    private static final String BOXPLOT_OUTLIER_SERIES_ID = "__chartsdk_boxplot_outliers";
    private static final String MOVING_AVERAGE_SERIES_ID = "__chartsdk_moving_average";
    private static final String SPATIAL_AREA_NAME = "__chartsdk_area_name";
    private static final String SPATIAL_AREA_VALUE = "__chartsdk_area_value";
    private static final String SPATIAL_AREA_GEOJSON = "__chartsdk_geojson";
    private static final String SPATIAL_LONGITUDE = "__chartsdk_longitude";
    private static final String SPATIAL_LATITUDE = "__chartsdk_latitude";
    private static final String GEO_POINT_NAME = "__chartsdk_point_name";
    private static final String GEO_POINT_VALUE = "__chartsdk_point_value";
    private static final String GEO_POINT_SIZE = "__chartsdk_size";
    private static final String GEO_SERIES = "__chartsdk_series";
    private static final List<String> LEGACY_DEFAULT_PALETTE = List.of(
            "#88CCEE", "#CC6677", "#DDCC77", "#117733", "#332288", "#AA4499",
            "#44AA99", "#999933", "#882255", "#661100", "#6699CC", "#888888"
    );
    private static final int AXIS_NAME_GAP = 56;
    private static final int AXIS_ENDPOINT_NAME_GAP = 8;
    private static final int MAX_ANALYSIS_ANNOTATIONS_PER_KIND = 12;
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

    private static boolean verticalTitle(Map<String, Object> opt) {
        return "vertical".equals(string(opt.get("titleDirection"), "horizontal"));
    }

    /**
     * 제목 텍스트 방향 → ECharts title.text (chart-options/display.ts 미러).
     * ECharts title 은 회전을 지원하지 않으므로 세로쓰기는 글자마다 줄바꿈을 넣어 쌓는다.
     * 코드포인트 단위로 끊어 서로게이트 쌍(이모지 등)이 쪼개지지 않게 한다.
     */
    private static String titleText(Map<String, Object> opt) {
        String title = string(opt.get("title"), "");
        if (!verticalTitle(opt) || title.isEmpty()) return title;
        StringBuilder stacked = new StringBuilder(title.length() * 2);
        title.codePoints().forEach(codePoint -> {
            if (stacked.length() > 0) stacked.append('\n');
            stacked.appendCodePoint(codePoint);
        });
        return stacked.toString();
    }

    /** 세로쓰기 제목이 차지하는 줄 수. 예약 높이 수식이 mock 과 같아야 범례·grid 가 어긋나지 않는다. */
    private static int titleLineCount(Map<String, Object> opt) {
        if (!verticalTitle(opt)) return 1;
        return Math.max(1, (int) string(opt.get("title"), "").codePoints().count());
    }

    public Map<String, Object> convert(QueryRows rows, String chartType, Map<String, Object> options) {
        return convert(rows, chartType, options, Map.of());
    }

    public Map<String, Object> convert(
            QueryRows rows,
            String chartType,
            Map<String, Object> options,
            Map<String, Object> builderConfig
    ) {
        Map<String, Object> storedOptions = options == null ? Map.of() : options;
        Map<String, Object> normalizedOptions = migrateLegacyInteractionOptions(
                storedOptions,
                chartType
        );
        Map<String, Object> opt = deepMerge(defaults.forType(chartType), normalizedOptions);
        // 마이그레이션은 빈 옵션에도 내부 메타데이터/빈 map 객체를 추가할 수 있다.
        // 레거시 여부는 변환 후 객체가 아니라 실제 저장 입력의 존재 여부로 판정해야 새 지도·히트맵 기본 테마가 보존된다.
        boolean legacyColorTheme = !storedOptions.isEmpty()
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
        applyFieldDisplayNames(opt, builderConfig, columns);
        Map<String, String> seriesDisplayNames = FieldDisplayNameResolver.seriesNames(
                builderConfig == null ? Map.of() : builderConfig,
                columns
        );
        boolean movingAverageEligible = "line".equals(chartType)
                && movingAverageEnabled(opt)
                && isTemporalColumn(columns.isEmpty() ? Map.of() : columns.get(0));
        List<List<Object>> dataRows = movingAverageEligible
                ? sortRowsByTime(rows.rows())
                : applySort(rows.rows(), string(opt.get("sortOrder"), "none"));
        List<Object> categories = new ArrayList<>();
        for (List<Object> r : dataRows) categories.add(r.isEmpty() ? null : r.get(0));

        int scatterBubbleIndex = -1;
        if ("scatter".equals(chartType) && "bubble".equals(variant)) {
            int candidate = columnIndex(columns, string(map(opt.get("scatter")).get("bubbleField"), null));
            // 0열=X, 1열=필수 Y이므로 크기 컬럼은 세 번째 이후 결과 컬럼만 허용한다.
            if (candidate > 1) scatterBubbleIndex = candidate;
        }
        List<String> colorNames = new ArrayList<>();
        if ("pie".equals(chartType)) {
            categories.forEach(category -> colorNames.add(String.valueOf(category)));
        } else if (("map".equals(chartType) || "geoscatter".equals(chartType))
                && columnIndex(columns, GEO_SERIES) >= 0) {
            int seriesIndex = columnIndex(columns, GEO_SERIES);
            for (List<Object> row : dataRows) {
                String seriesName = seriesName(row, seriesIndex, "미분류");
                if (!colorNames.contains(seriesName)) colorNames.add(seriesName);
            }
        } else {
            for (int c = 1; c < columns.size(); c++) {
                if (c != scatterBubbleIndex) colorNames.add(string(columns.get(c).get("name"), ""));
            }
        }
        Map<String, Object> autoColorMap = ColorResolver.resolveSeriesColors(opt, colorNames);
        opt.put("autoColorMap", autoColorMap);
        ItemColorResolver itemColors = ItemColorResolver.from(opt);

        Map<String, Object> o = new LinkedHashMap<>();
        o.put("__chartsdkAutoColorMap", autoColorMap);
        if (!seriesDisplayNames.isEmpty()) {
            o.put(FieldDisplayNameResolver.SERIES_DISPLAY_NAMES_KEY, seriesDisplayNames);
        }
        o.put(SHOW_COMPUTED_AT_KEY, !Boolean.FALSE.equals(opt.get("showComputedAt")));
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
        applyTooltip(o, opt, chartType, columns, builderConfig);
        applyDataZoom(o, opt, chartType);

        // 신규 유형은 직교 폴스루를 타지 않고 전용 조립(축·시리즈 형태가 다르다).
        if ("boxplot".equals(chartType)) { buildBoxplot(o, opt, columns, dataRows, itemColors); return o; }
        if ("heatmap".equals(chartType)) { buildHeatmap(o, opt, columns, dataRows, itemColors); return o; }
        if ("map".equals(chartType)) {
            if ("heatmap".equals(variant)) buildGeoHeatmap(o, opt, columns, dataRows, itemColors);
            else buildMap(o, opt, columns, dataRows, itemColors);
            return o;
        }
        if ("geoscatter".equals(chartType)) { buildGeoScatter(o, opt, columns, dataRows, itemColors); return o; }

        if ("pie".equals(chartType)) {
            o.put("series", List.of(buildPieSeries(opt, variant, dataRows, itemColors)));
            return o;
        }

        boolean horizontal = "bar".equals(chartType) && "horizontal".equals(variant);
        boolean scatter = "scatter".equals(chartType);
        applyGrid(o, opt, horizontal);
        applyAxes(o, opt, scatter, horizontal, categories);
        List<Map<String, Object>> series = buildCartesianSeries(
                opt, chartType, variant, columns, dataRows, horizontal, scatter, itemColors);
        applyAnalysisAnnotations(series, opt, horizontal, scatter);
        if (movingAverageEligible) applyMovingAverage(o, series, opt, columns, dataRows);
        o.put("series", series);
        return o;
    }

    private void applyFieldDisplayNames(
            Map<String, Object> opt,
            Map<String, Object> builderConfig,
            List<Map<String, Object>> columns
    ) {
        Map<String, Object> builder = builderConfig == null ? Map.of() : builderConfig;
        String xField = string(builder.get("xAxis"), "").trim();
        Map<String, Object> xAxis = new LinkedHashMap<>(map(opt.get("xAxis")));
        if (!xField.isEmpty()
                && FieldDisplayNameResolver.hasSnapshot(builder, xField)
                && string(xAxis.get("title"), "").trim().isEmpty()) {
            String fallback = columns.isEmpty() ? "X" : string(columns.get(0).get("name"), "X");
            xAxis.put("title", FieldDisplayNameResolver.fieldName(builder, xField, fallback));
            opt.put("xAxis", xAxis);
        }

        List<Map<String, Object>> measures = mapItems(builder.get("yAxis"));
        Map<String, Object> yAxis = new LinkedHashMap<>(map(opt.get("yAxis")));
        if (measures.size() == 1
                && FieldDisplayNameResolver.hasSnapshot(builder, measures.get(0).get("column"))
                && string(yAxis.get("title"), "").trim().isEmpty()) {
            String fallback = columns.size() > 1 ? string(columns.get(1).get("name"), "값") : "값";
            yAxis.put("title", FieldDisplayNameResolver.measureName(builder, measures.get(0), fallback));
            opt.put("yAxis", yAxis);
        }
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
        t.put("text", titleText(opt));
        t.put("left", string(opt.get("titleH"), "center"));
        t.put("top", string(opt.get("titleV"), "top"));
        t.put("textStyle", textStyle(typography(opt).title(), fontFamilyStack(opt, "title")));
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
        LayoutMetrics metrics = layoutMetrics(typography, opt);
        // 제목이 같은 모서리(상/하)에 있으면 범례를 제목 다음 줄로 밀어 겹침 방지(규칙 1). 좌/우 범례는 제목과 축이 달라 무관.
        boolean titleTop = hasTitle(opt) && "top".equals(string(opt.get("titleV"), "top"));
        boolean titleBottom = titleAtBottom(opt);
        switch (position) {
            case "top" -> { l.put("top", titleTop ? metrics.titleHeight() : 0); l.put("orient", "horizontal"); }
            case "left" -> { l.put("left", 0); l.put("orient", "vertical"); }
            case "right" -> { l.put("right", 0); l.put("orient", "vertical"); }
            default -> { l.put("bottom", titleBottom ? metrics.titleHeight() : 0); l.put("orient", "horizontal"); }
        }
        l.put("textStyle", textStyle(typography.legend(), fontFamilyStack(opt, "legend")));
        // 상·하 범례는 항상 scroll로 단일행을 보장해야 계산한 범례 블록 높이와 실제 레이아웃이 일치한다.
        // 좌·우는 기존 T2 토글을 존중한다.
        boolean horizontal = "top".equals(position) || "bottom".equals(position);
        if (horizontal || Boolean.TRUE.equals(legend.get("scroll"))) l.put("type", "scroll");
        o.put("legend", l);
    }

    private static final List<String> DATA_ZOOM_CHART_TYPES = List.of("bar", "line", "scatter", "boxplot", "heatmap");

    /**
     * 항상 활성화되는 휠 확대·축소(ECharts dataZoom type='inside').
     * 안쪽 방식이라 예약 높이가 0이고 제목·범례·grid 수식에 영향을 주지 않는다.
     * 과거 저장 축 설정은 보존하고, 설정이 없으면 차트 형태에 맞는 축을 자동 선택한다.
     */
    private void applyDataZoom(Map<String, Object> o, Map<String, Object> opt, String chartType) {
        if (!DATA_ZOOM_CHART_TYPES.contains(chartType)) return;
        String storedAxis = string(map(opt.get("dataZoom")).get("axis"), null);
        String axis = switch (storedAxis == null ? "" : storedAxis) {
            case "x", "y", "both" -> storedAxis;
            default -> switch (chartType) {
                case "scatter", "heatmap" -> "both";
                case "bar" -> "horizontal".equals(string(opt.get("variant"), "basic")) ? "y" : "x";
                default -> "x";
            };
        };
        Map<String, Object> inside = new LinkedHashMap<>();
        inside.put("type", "inside");
        if (!"y".equals(axis)) inside.put("xAxisIndex", List.of(0));
        if (!"x".equals(axis)) {
            inside.put("yAxisIndex", Boolean.TRUE.equals(map(opt.get("yAxis")).get("secondAxis"))
                    ? List.of(0, 1)
                    : List.of(0));
        }
        inside.put("filterMode", "filter");
        o.put("dataZoom", List.of(inside));
    }

    private void applyTooltip(
            Map<String, Object> o,
            Map<String, Object> opt,
            String chartType,
            List<Map<String, Object>> columns,
            Map<String, Object> builderConfig
    ) {
        Map<String, Object> tooltip = map(opt.get("tooltip"));
        Map<String, Object> t = new LinkedHashMap<>();
        boolean enabled = !Boolean.FALSE.equals(tooltip.get("enabled"));
        if (!enabled) t.put("show", false);

        String trigger = string(tooltip.get("trigger"), "");
        if ("item".equals(trigger) || "axis".equals(trigger)) t.put("trigger", trigger);
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
        // 툴팁은 캔버스가 아니라 HTML 로 그려져 루트 textStyle 을 상속하지 않는다.
        putIfNotNull(textStyle, "fontFamily", fontFamilyStack(opt, "tooltip"));
        putIfNotNull(textStyle, "color", tooltip.get("textColor"));
        t.put("textStyle", textStyle);
        o.put("tooltip", t);

        if (enabled) {
            Map<String, Object> metadata = new LinkedHashMap<>();
            metadata.put("mode", "fields");
            metadata.put("chartType", chartType);
            metadata.put("fields", TooltipFieldResolver.visibleFields(
                    chartType,
                    opt,
                    columns,
                    builderConfig
            ));
            metadata.put("showSeriesColor", !Boolean.FALSE.equals(tooltip.get("showSeriesColor")));
            o.put(TOOLTIP_METADATA_KEY, metadata);
        } else {
            o.remove(TOOLTIP_METADATA_KEY);
        }
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
    /** 상자수염: 카테고리(0열)별로 값(1열)을 모아 IQR 수염·사분위수와 별도 이상치를 계산. 전용 축(직교 폴스루의 이중축 오염 회피). */
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
        String seriesName = columns.size() > 1 ? string(columns.get(1).get("name"), "산점도") : "산점도";
        List<Object> data = new ArrayList<>();
        List<Object> outlierData = new ArrayList<>();
        for (Map.Entry<String, List<Double>> entry : groups.entrySet()) {
            BoxplotSummary summary = boxplotSummary(entry.getValue());
            Object itemColor = itemColors.color("boxplot", seriesName, List.of(entry.getKey()), 0);
            data.add(withItemColor(summary.box(), itemColor, "color", true));
            for (Double outlier : summary.outliers()) outlierData.add(List.of(entry.getKey(), outlier));
        }

        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));
        int axisFontSize = typography(opt).axis();
        String axisFontFamily = fontFamilyStack(opt, "axis");
        Map<String, Object> xAxis = new LinkedHashMap<>();
        xAxis.put("type", "category");
        xAxis.put("data", cats);
        xAxis.put("boundaryGap", true);
        decorateAxis(xAxis, xCfg, true, true, true, axisFontSize, axisFontFamily);
        Map<String, Object> yAxis = new LinkedHashMap<>();
        yAxis.put("type", "log".equals(string(yCfg.get("scale"), "value")) ? "log" : "value");
        decorateAxis(yAxis, yCfg, false, false, false, axisFontSize, axisFontFamily);

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
        List<Map<String, Object>> series = new ArrayList<>();
        series.add(s);
        applyAnalysisAnnotations(List.of(s), opt, false, false);

        Map<String, Object> outlierConfig = map(map(opt.get("analysis")).get("boxplotOutliers"));
        boolean showOutliers = !Boolean.FALSE.equals(outlierConfig.get("show"));
        if (showOutliers && !outlierData.isEmpty()) {
            String outlierColor = markerColor(outlierConfig.get("color"), "#D81B60");
            Map<String, Object> outliers = new LinkedHashMap<>();
            outliers.put("id", BOXPLOT_OUTLIER_SERIES_ID);
            outliers.put("type", "scatter");
            outliers.put("name", seriesName);
            outliers.put("data", outlierData);
            outliers.put("symbol", "circle");
            outliers.put("symbolSize", 9);
            outliers.put("color", outlierColor);
            outliers.put("itemStyle", Map.of("color", outlierColor));
            outliers.put("z", 4);
            applySeriesEmphasis(outliers, opt, "scatter");
            series.add(outliers);
        }
        o.put("series", series);
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
        String axisFontFamily = fontFamilyStack(opt, "axis");
        LayoutMetrics metrics = layoutMetrics(typography, opt);
        Map<String, Object> xAxis = new LinkedHashMap<>();
        xAxis.put("type", "category");
        xAxis.put("data", cats);
        xAxis.put("splitArea", Map.of("show", true));
        decorateAxis(xAxis, xCfg, true, true, true, typography.axis(), axisFontFamily);
        Map<String, Object> yAxis = new LinkedHashMap<>();
        yAxis.put("type", "category");
        yAxis.put("data", yNames);
        Map<String, Object> displayNames = map(o.get(FieldDisplayNameResolver.SERIES_DISPLAY_NAMES_KEY));
        if (!displayNames.isEmpty()) {
            yAxis.put(FieldDisplayNameResolver.AXIS_DISPLAY_NAMES_KEY, displayNames);
        }
        yAxis.put("splitArea", Map.of("show", true));
        decorateAxis(yAxis, yCfg, false, false, false, typography.axis(), axisFontFamily);

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
        Map<String, Object> label = textStyle(typography.dataLabel(), fontFamilyStack(opt, "dataLabel"));
        boolean labelShown = Boolean.TRUE.equals(opt.get("dataLabel"));
        label.put("show", labelShown);
        if (labelShown) putLabelRotation(label, opt);
        s.put("label", label);
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
        int seriesIndex = columnIndex(columns, GEO_SERIES);
        boolean reservedArea = nameIndex >= 0 && valueIndex >= 0;
        boolean spatial = reservedArea && geoJsonIndex >= 0;
        LinkedHashMap<String, List<Object>> dataBySeries = new LinkedHashMap<>();
        ItemColorResolver.Occurrences itemOccurrences = new ItemColorResolver.Occurrences();
        LinkedHashMap<String, Object> featuresByName = new LinkedHashMap<>();
        MessageDigest digest = spatial ? sha256() : null;
        double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
        for (List<Object> r : rows) {
            int ni = reservedArea ? nameIndex : 0;
            int vi = reservedArea ? valueIndex : 1;
            String name = r.size() > ni ? String.valueOf(r.get(ni)) : "";
            String seriesName = seriesName(r, seriesIndex,
                    reservedArea ? "값" : columns.size() > 1 ? string(columns.get(1).get("name"), "값") : "값");
            if (spatial) {
                if (r.size() <= geoJsonIndex || !(r.get(geoJsonIndex) instanceof String geometryJson)) continue;
                Map<String, Object> geometry = parsePolygonGeometry(geometryJson);
                if (geometry == null) continue;
                if (!featuresByName.containsKey(name)) {
                    Map<String, Object> feature = new LinkedHashMap<>();
                    feature.put("type", "Feature");
                    feature.put("properties", Map.of("name", name));
                    feature.put("geometry", geometry);
                    featuresByName.put(name, feature);
                    digest.update(name.getBytes(StandardCharsets.UTF_8));
                    digest.update((byte) 0);
                    digest.update(geometryJson.getBytes(StandardCharsets.UTF_8));
                }
            }
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("name", name);
            double v = (r.size() > vi && r.get(vi) instanceof Number n) ? n.doubleValue() : 0;
            point.put("value", v);
            List<Object> dimensions = List.of(name);
            int occurrence = itemOccurrences.next("map", seriesName, dimensions);
            Object itemColor = itemColors.color("map", seriesName, dimensions, occurrence);
            dataBySeries.computeIfAbsent(seriesName, ignored -> new ArrayList<>())
                    .add(withItemColor(point, itemColor, "areaColor", false));
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (dataBySeries.isEmpty()) dataBySeries.put("값", new ArrayList<>());
        if (Double.isInfinite(min)) { min = 0; max = 1; }
        if (min == max) max = min + 1;

        String selectedMap = spatial ? dynamicMapName(digest) : mapName(opt);
        if (spatial) {
            Map<String, Object> featureCollection = new LinkedHashMap<>();
            featureCollection.put("type", "FeatureCollection");
            featureCollection.put("features", new ArrayList<>(featuresByName.values()));
            o.put(EMBEDDED_MAPS_KEY, List.of(Map.of("name", selectedMap, "geoJSON", featureCollection)));
        }

        List<Map<String, Object>> series = new ArrayList<>();
        List<Map<String, Object>> targets = new ArrayList<>();
        int seriesNumber = 0;
        for (Map.Entry<String, List<Object>> entry : dataBySeries.entrySet()) {
            String id = "__chartsdk_geo_map_" + seriesNumber;
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("id", id);
            s.put("type", "map");
            s.put("name", entry.getKey());
            s.put("map", selectedMap);
            s.put("roam", Boolean.TRUE.equals(map(opt.get("map")).get("roam")));
            Object seriesColor = ColorResolver.pickColor(opt, entry.getKey(), seriesNumber);
            if (seriesColor != null) s.put("itemStyle", Map.of("areaColor", seriesColor));
            Map<String, Object> label = textStyle(typography(opt).dataLabel(), fontFamilyStack(opt, "dataLabel"));
            boolean labelShown = Boolean.TRUE.equals(opt.get("dataLabel"));
            label.put("show", labelShown);
            if (labelShown) putLabelRotation(label, opt);
            s.put("label", label);
            applyLabelLayout(s, opt);
            applySeriesEmphasis(s, opt, "map");
            s.putAll(nonCartesianInsets(opt, dataBySeries.size() > 1, true));
            s.put("data", entry.getValue());
            series.add(s);
            targets.add(Map.of("seriesId", id, "dimension", 0));
            seriesNumber++;
        }
        if (series.size() <= 1) o.remove("legend");
        o.put("visualMap", visualMap(min, max, opt, targets));
        o.put("series", series);
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

    /** 지도 포인트: 예약 역할 열을 seriesBy별 scatter/effectScatter로 분리해 공용 geo 위에 그린다. */
    private void buildGeoScatter(Map<String, Object> o, Map<String, Object> opt, List<Map<String, Object>> columns,
                                 List<List<Object>> rows, ItemColorResolver itemColors) {
        int longitudeIndex = columnIndex(columns, SPATIAL_LONGITUDE);
        int latitudeIndex = columnIndex(columns, SPATIAL_LATITUDE);
        boolean legacyColumns = longitudeIndex < 0 || latitudeIndex < 0;
        if (longitudeIndex < 0) longitudeIndex = 0;
        if (latitudeIndex < 0) latitudeIndex = 1;
        int nameIndex = columnIndex(columns, GEO_POINT_NAME);
        int valueIndex = columnIndex(columns, GEO_POINT_VALUE);
        int sizeIndex = columnIndex(columns, GEO_POINT_SIZE);
        int seriesIndex = columnIndex(columns, GEO_SERIES);
        if (legacyColumns && sizeIndex < 0 && columns.size() > 2) sizeIndex = 2;
        boolean hasSize = sizeIndex >= 0;
        double sMin = Double.POSITIVE_INFINITY, sMax = Double.NEGATIVE_INFINITY;
        if (hasSize) {
            for (List<Object> r : rows) {
                if (r.size() > sizeIndex && r.get(sizeIndex) instanceof Number n) {
                    double v = n.doubleValue();
                    if (v < sMin) sMin = v;
                    if (v > sMax) sMax = v;
                }
            }
        }
        int base = map(opt.get("geoscatter")).get("symbolSize") instanceof Number n ? n.intValue() : 10;
        String seriesType = "effectScatter".equals(string(opt.get("variant"), "scatter"))
                ? "effectScatter" : "scatter";
        LinkedHashMap<String, List<Object>> dataBySeries = new LinkedHashMap<>();
        ItemColorResolver.Occurrences itemOccurrences = new ItemColorResolver.Occurrences();
        for (List<Object> r : rows) {
            double lng = (r.size() > longitudeIndex && r.get(longitudeIndex) instanceof Number n) ? n.doubleValue() : 0;
            double lat = (r.size() > latitudeIndex && r.get(latitudeIndex) instanceof Number n) ? n.doubleValue() : 0;
            String seriesName = seriesName(r, seriesIndex, "포인트");
            String pointName = nameIndex >= 0 && r.size() > nameIndex && r.get(nameIndex) != null
                    ? String.valueOf(r.get(nameIndex)) : roundCoordinate(lng) + ", " + roundCoordinate(lat);
            Object pointValue = valueIndex >= 0 && r.size() > valueIndex ? r.get(valueIndex) : null;
            Object sizeValue = sizeIndex >= 0 && r.size() > sizeIndex ? r.get(sizeIndex) : null;
            List<Object> dimensions = List.of(roundCoordinate(lng), roundCoordinate(lat));
            int occurrence = itemOccurrences.next("geoscatter", seriesName, dimensions);
            Object itemColor = itemColors.color("geoscatter", seriesName, dimensions, occurrence);
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("name", pointName);
            point.put("value", java.util.Arrays.asList(lng, lat, pointValue, sizeValue));
            if (hasSize && !Double.isInfinite(sMin)) {
                point.put("symbolSize", scaledBubbleSize(sizeValue, sMin, sMax, base));
            }
            dataBySeries.computeIfAbsent(seriesName, ignored -> new ArrayList<>())
                    .add(withItemColor(point, itemColor, "color", false));
        }
        if (dataBySeries.isEmpty()) dataBySeries.put("포인트", new ArrayList<>());

        applyPointGeo(o, opt, dataBySeries.size() > 1, false);
        List<Map<String, Object>> series = new ArrayList<>();
        int index = 0;
        for (Map.Entry<String, List<Object>> entry : dataBySeries.entrySet()) {
            String id = "__chartsdk_geo_point_" + index;
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("id", id);
            s.put("type", seriesType);
            s.put("coordinateSystem", "geo");
            s.put("name", entry.getKey());
            s.put("symbol", string(map(opt.get("geoscatter")).get("symbol"), "circle"));
            s.put("symbolSize", base);
            s.put("clip", true);
            Object color = ColorResolver.pickColor(opt, entry.getKey(), index);
            Map<String, Object> pointConfig = map(opt.get("geoscatter"));
            Map<String, Object> itemStyle = new LinkedHashMap<>();
            if (color != null) itemStyle.put("color", color);
            putIfNotNull(itemStyle, "opacity", pointConfig.get("opacity"));
            putIfNotNull(itemStyle, "borderColor", pointConfig.get("borderColor"));
            putIfNotNull(itemStyle, "borderWidth", pointConfig.get("borderWidth"));
            if (!itemStyle.isEmpty()) s.put("itemStyle", itemStyle);
            if ("effectScatter".equals(seriesType)) applyEffectScatter(s, opt);
            applyPointLabel(s, opt);
            applySeriesEmphasis(s, opt, "scatter");
            s.put("data", entry.getValue());
            series.add(s);
            index++;
        }
        if (series.size() <= 1) o.remove("legend");
        o.remove("visualMap");
        o.put("series", series);
        applyMapViewportMetadata(o, opt);
    }

    /** map 대분류의 geo heatmap. 값이 없으면 각 행을 1로 사용해 순수 밀도 지도를 만든다. */
    private void buildGeoHeatmap(Map<String, Object> o, Map<String, Object> opt,
                                 List<Map<String, Object>> columns, List<List<Object>> rows,
                                 ItemColorResolver itemColors) {
        int longitudeIndex = columnIndex(columns, SPATIAL_LONGITUDE);
        int latitudeIndex = columnIndex(columns, SPATIAL_LATITUDE);
        if (longitudeIndex < 0) longitudeIndex = 0;
        if (latitudeIndex < 0) latitudeIndex = 1;
        int nameIndex = columnIndex(columns, GEO_POINT_NAME);
        int valueIndex = columnIndex(columns, GEO_POINT_VALUE);
        int seriesIndex = columnIndex(columns, GEO_SERIES);
        LinkedHashMap<String, List<Object>> dataBySeries = new LinkedHashMap<>();
        ItemColorResolver.Occurrences occurrences = new ItemColorResolver.Occurrences();
        double min = Double.POSITIVE_INFINITY;
        double max = Double.NEGATIVE_INFINITY;
        for (List<Object> row : rows) {
            double longitude = row.size() > longitudeIndex && row.get(longitudeIndex) instanceof Number number
                    ? number.doubleValue() : 0;
            double latitude = row.size() > latitudeIndex && row.get(latitudeIndex) instanceof Number number
                    ? number.doubleValue() : 0;
            String seriesName = seriesName(row, seriesIndex, "밀도");
            String pointName = nameIndex >= 0 && row.size() > nameIndex && row.get(nameIndex) != null
                    ? String.valueOf(row.get(nameIndex)) : roundCoordinate(longitude) + ", " + roundCoordinate(latitude);
            double intensity = valueIndex >= 0 && row.size() > valueIndex && row.get(valueIndex) instanceof Number number
                    ? number.doubleValue() : 1;
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("name", pointName);
            point.put("value", List.of(longitude, latitude, intensity));
            List<Object> dimensions = List.of(roundCoordinate(longitude), roundCoordinate(latitude));
            int occurrence = occurrences.next("geoscatter", seriesName, dimensions);
            Object itemColor = itemColors.color("geoscatter", seriesName, dimensions, occurrence);
            dataBySeries.computeIfAbsent(seriesName, ignored -> new ArrayList<>())
                    .add(withItemColor(point, itemColor, "color", false));
            min = Math.min(min, intensity);
            max = Math.max(max, intensity);
        }
        if (dataBySeries.isEmpty()) dataBySeries.put("밀도", new ArrayList<>());
        if (Double.isInfinite(min)) { min = 0; max = 1; }
        if (min == max) max = min + 1;

        applyPointGeo(o, opt, dataBySeries.size() > 1, true);
        Map<String, Object> mapOptions = map(opt.get("map"));
        List<Map<String, Object>> series = new ArrayList<>();
        List<Map<String, Object>> targets = new ArrayList<>();
        int index = 0;
        for (Map.Entry<String, List<Object>> entry : dataBySeries.entrySet()) {
            String id = "__chartsdk_geo_heatmap_" + index;
            Map<String, Object> heatmap = new LinkedHashMap<>();
            heatmap.put("id", id);
            heatmap.put("type", "heatmap");
            heatmap.put("coordinateSystem", "geo");
            heatmap.put("name", entry.getKey());
            heatmap.put("pointSize", number(mapOptions.get("heatmapPointSize"), 20));
            heatmap.put("blurSize", number(mapOptions.get("heatmapBlurSize"), 30));
            heatmap.put("minOpacity", doubleNumber(mapOptions.get("heatmapMinOpacity"), 0));
            heatmap.put("maxOpacity", doubleNumber(mapOptions.get("heatmapMaxOpacity"), 1));
            heatmap.put("data", entry.getValue());
            applySeriesEmphasis(heatmap, opt, "heatmap");
            series.add(heatmap);
            targets.add(Map.of("seriesId", id, "dimension", 2));
            index++;
        }
        if (series.size() <= 1) o.remove("legend");
        o.put("visualMap", visualMap(min, max, opt, targets));
        o.put("series", series);
        applyMapViewportMetadata(o, opt);
    }

    private void applyPointGeo(Map<String, Object> option, Map<String, Object> opt,
                               boolean includeLegend, boolean includeVisualMap) {
        Map<String, Object> boundary = map(map(opt.get("map")).get("boundary"));
        Map<String, Object> geo = new LinkedHashMap<>();
        geo.put("map", mapName(opt));
        geo.put("roam", Boolean.TRUE.equals(map(opt.get("map")).get("roam")));
        geo.put("clip", true);
        geo.putAll(nonCartesianInsets(opt, includeLegend, includeVisualMap));
        geo.put("label", Map.of("show", false));
        boolean boundaryHidden = Boolean.FALSE.equals(boundary.get("show"));
        if (boundaryHidden) {
            geo.put("show", false);
        } else {
            Map<String, Object> itemStyle = new LinkedHashMap<>();
            putIfNotNull(itemStyle, "areaColor", boundary.get("areaColor"));
            putIfNotNull(itemStyle, "borderColor", boundary.get("borderColor"));
            if (boundary.get("borderWidth") instanceof Number) {
                itemStyle.put("borderWidth", clampDouble(boundary.get("borderWidth"), 0, 20, 5));
            }
            if (!itemStyle.isEmpty()) geo.put("itemStyle", itemStyle);
        }
        // 배경 행정구역은 좌표 데이터와 별개의 장식이므로 hover 강조를 차단한다.
        geo.put("emphasis", Map.of("disabled", true));
        option.put("geo", geo);
    }

    private void applyPointLabel(Map<String, Object> series, Map<String, Object> opt) {
        Map<String, Object> label = textStyle(typography(opt).dataLabel(), fontFamilyStack(opt, "dataLabel"));
        boolean shown = Boolean.TRUE.equals(opt.get("dataLabel"));
        label.put("show", shown);
        label.put("formatter", "{b}");
        if (shown) putLabelRotation(label, opt);
        series.put("label", label);
        applyLabelLayout(series, opt);
    }

    private void applyEffectScatter(Map<String, Object> series, Map<String, Object> opt) {
        Map<String, Object> config = map(opt.get("geoscatter"));
        series.put("showEffectOn", string(config.get("showEffectOn"), "render"));
        series.put("rippleEffect", Map.of(
                "scale", doubleNumber(config.get("rippleScale"), 2.5),
                "period", doubleNumber(config.get("ripplePeriod"), 4),
                "brushType", string(config.get("rippleBrushType"), "fill")
        ));
    }

    private static String seriesName(List<Object> row, int seriesIndex, String fallback) {
        if (seriesIndex < 0 || row.size() <= seriesIndex || row.get(seriesIndex) == null) return fallback;
        String value = String.valueOf(row.get(seriesIndex));
        return value.isBlank() ? "미분류" : value;
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
        return visualMap(min, max, opt, List.of());
    }

    /** ECharts 6.1 seriesTargets로 여러 지도 계열의 색상 차원을 한 visualMap에 연결한다. */
    private Map<String, Object> visualMap(double min, double max, Map<String, Object> opt,
                                          List<Map<String, Object>> seriesTargets) {
        List<Object> palette = ColorResolver.orderedPalette(opt);
        Object top = palette.isEmpty() ? null : palette.get(0);
        boolean continuousPalette = number(map(opt.get("colorTheme")).get("version"), 0) == 2;
        Typography typography = typography(opt);
        LayoutMetrics metrics = layoutMetrics(typography, opt);
        Map<String, Object> vm = new LinkedHashMap<>();
        vm.put("min", min);
        vm.put("max", max);
        vm.put("calculable", true);
        vm.put("orient", "horizontal");
        vm.put("left", "center");
        // 제목이 하단이면 visualMap 을 제목 위로 올려 겹침 방지(규칙 1의 map/heatmap 변형).
        vm.put("bottom", titleAtBottom(opt) ? metrics.titleHeight() : 0);
        vm.put("textStyle", textStyle(typography.legend(), fontFamilyStack(opt, "legend")));
        if (seriesTargets != null && !seriesTargets.isEmpty()) vm.put("seriesTargets", seriesTargets);
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

    private record BoxplotSummary(List<Double> box, List<Double> outliers) {}

    /** 1.5 × IQR 수염과 범위 밖 이상치를 계산한다. */
    private static BoxplotSummary boxplotSummary(List<Double> values) {
        List<Double> s = new ArrayList<>(values);
        s.sort(Double::compare);
        if (s.isEmpty()) return new BoxplotSummary(List.of(0d, 0d, 0d, 0d, 0d), List.of());
        double q1 = quantile(s, 0.25);
        double median = quantile(s, 0.5);
        double q3 = quantile(s, 0.75);
        double iqr = q3 - q1;
        double lowerFence = q1 - 1.5 * iqr;
        double upperFence = q3 + 1.5 * iqr;
        List<Double> inliers = s.stream().filter(value -> value >= lowerFence && value <= upperFence).toList();
        List<Double> outliers = s.stream().filter(value -> value < lowerFence || value > upperFence).toList();
        return new BoxplotSummary(
                List.of(inliers.isEmpty() ? q1 : inliers.get(0), q1, median, q3,
                        inliers.isEmpty() ? q3 : inliers.get(inliers.size() - 1)),
                outliers
        );
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
        LayoutMetrics metrics = layoutMetrics(typography, opt);
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

    /** grid가 없는 원형·지도 계열도 제목·범례·색상 범례가 플롯을 가리지 않도록 박스 여백을 준다. */
    private Map<String, Object> nonCartesianInsets(
            Map<String, Object> opt,
            boolean includeLegend,
            boolean includeVisualMap) {
        LayoutMetrics metrics = layoutMetrics(typography(opt), opt);
        int top = hasTitle(opt) && "top".equals(string(opt.get("titleV"), "top"))
                ? metrics.titleHeight()
                : 0;
        int bottom = titleAtBottom(opt) ? metrics.titleHeight() : 0;
        if (includeLegend) {
            Map<String, Object> legend = map(opt.get("legend"));
            boolean shown = !legend.isEmpty() && !Boolean.FALSE.equals(legend.get("show"));
            String position = string(legend.get("position"), "bottom");
            if (shown && "top".equals(position)) top += metrics.legendHeight();
            if (shown && "bottom".equals(position)) bottom += metrics.legendHeight();
        }
        if (includeVisualMap) bottom += metrics.visualMapHeight();
        Map<String, Object> insets = new LinkedHashMap<>();
        insets.put("top", top);
        insets.put("bottom", bottom);
        return insets;
    }

    private void applyAxes(Map<String, Object> o, Map<String, Object> opt, boolean scatter, boolean horizontal, List<Object> categories) {
        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));
        int axisFontSize = typography(opt).axis();
        String axisFontFamily = fontFamilyStack(opt, "axis");

        Map<String, Object> categoryAxis = new LinkedHashMap<>();
        categoryAxis.put("type", "category");
        categoryAxis.put("data", categories);

        Map<String, Object> valueAxis = new LinkedHashMap<>();
        valueAxis.put("type", "log".equals(string(yCfg.get("scale"), "value")) ? "log" : "value");

        if (scatter) {
            // 분포: X·Y 모두 수치축, data 없음. (데이터는 [x,y] 쌍)
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("type", "log".equals(string(xCfg.get("scale"), "value")) ? "log" : "value");
            decorateAxis(x, xCfg, true, true, true, axisFontSize, axisFontFamily);
            decorateAxis(valueAxis, yCfg, false, false, false, axisFontSize, axisFontFamily);
            o.put("xAxis", x);
            o.put("yAxis", valueAxis);
            return;
        }

        // 가로 막대에서는 범주축이 실제 Y축이므로 라벨을 기울이지 않는다.
        decorateAxis(categoryAxis, xCfg, !horizontal, true, !horizontal, axisFontSize, axisFontFamily);
        decorateAxis(valueAxis, yCfg, false, false, horizontal, axisFontSize, axisFontFamily);

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

    /** 축 공통 장식: 제목·물리적 위치, 세로쓰기/rotate(카테고리), splitLine, min/max(수동), 단위 포맷터. */
    private void decorateAxis(Map<String, Object> axis, Map<String, Object> cfg,
                              boolean rulesAsX, boolean logicalIsX, boolean physicalIsX,
                              int fontSize, String fontFamily) {
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
        if (Boolean.TRUE.equals(cfg.get("verticalLabels"))) {
            // JSON에는 formatter 함수를 담을 수 없으므로 논리 축 역할만 전달하고,
            // Admin/SDK가 렌더 직전에 글자 단위 줄바꿈 formatter로 복원한다.
            axis.put("__chartsdkVerticalLabel", logicalIsX ? "x" : "y");
        }
        if (logicalIsX && cfg.get("rotate") instanceof Number rotate && rotate.intValue() != 0) {
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
        applyAxisTypography(axis, fontSize, fontFamily);
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

    private void applyAxisTypography(Map<String, Object> axis, int fontSize, String fontFamily) {
        Map<String, Object> label = new LinkedHashMap<>(map(axis.get("axisLabel")));
        label.put("fontSize", fontSize);
        putIfNotNull(label, "fontFamily", fontFamily);
        axis.put("axisLabel", label);
        axis.put("nameTextStyle", textStyle(fontSize, fontFamily));
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
        int bubbleCandidate = scatter && "bubble".equals(variant)
                ? columnIndex(columns, string(scatterCfg.get("bubbleField"), null))
                : -1;
        int bubbleIdx = bubbleCandidate > 1 ? bubbleCandidate : -1;
        int bubbleBaseSize = scatterCfg.get("symbolSize") instanceof Number n ? n.intValue() : 10;
        double bubbleMin = Double.POSITIVE_INFINITY;
        double bubbleMax = Double.NEGATIVE_INFINITY;
        if (bubbleIdx >= 0) {
            for (List<Object> row : dataRows) {
                Double size = row.size() > bubbleIdx ? finiteDouble(row.get(bubbleIdx)) : null;
                if (size == null) continue;
                bubbleMin = Math.min(bubbleMin, size);
                bubbleMax = Math.max(bubbleMax, size);
            }
        }

        // 100% 정규화(누적 막대): 카테고리(행)별 합으로 나눠 각 카테고리 스택이 100%가 되게 한다.
        double[] catTotals = (stacked && Boolean.TRUE.equals(barCfg.get("normalize"))) ? rowTotals(columns, dataRows) : null;

        List<Map<String, Object>> series = new ArrayList<>();
        for (int c = 1; c < columns.size(); c++) {
            if (c == bubbleIdx) continue;
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
                    if (bubbleIdx >= 0) {
                        Object size = r.size() > bubbleIdx ? r.get(bubbleIdx) : null;
                        Map<String, Object> bubblePoint = new LinkedHashMap<>();
                        bubblePoint.put("value", java.util.Arrays.asList(x, y, size));
                        bubblePoint.put("symbolSize", scaledBubbleSize(
                                size, bubbleMin, bubbleMax, bubbleBaseSize
                        ));
                        itemValue = bubblePoint;
                    } else {
                        itemValue = java.util.Arrays.asList(x, y);
                    }
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
            if ("line".equals(seriesType)) applyVariantDelta(s, variant, lineCfg);
            applyLabel(s, opt, true);
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

    private int scaledBubbleSize(Object value, double min, double max, int fallback) {
        Double numeric = finiteDouble(value);
        if (numeric == null || !Double.isFinite(min) || !Double.isFinite(max) || max == min) return fallback;
        double ratio = Math.max(0, Math.min(1, (numeric - min) / (max - min)));
        return (int) Math.round(6 + 22 * Math.sqrt(ratio));
    }

    private boolean movingAverageEnabled(Map<String, Object> opt) {
        return Boolean.TRUE.equals(map(map(opt.get("analysis")).get("movingAverage")).get("enabled"));
    }

    private boolean isTemporalColumn(Map<String, Object> column) {
        String type = string(column.get("type"), "").toLowerCase();
        return type.contains("date") || type.contains("time");
    }

    private List<List<Object>> sortRowsByTime(List<List<Object>> rows) {
        List<List<Object>> sorted = new ArrayList<>(rows);
        sorted.sort((left, right) -> {
            Long leftTime = temporalSortKey(left.isEmpty() ? null : left.get(0));
            Long rightTime = temporalSortKey(right.isEmpty() ? null : right.get(0));
            if (leftTime == null && rightTime == null) return 0;
            if (leftTime == null) return 1;
            if (rightTime == null) return -1;
            return Long.compare(leftTime, rightTime);
        });
        return sorted;
    }

    private Long temporalSortKey(Object value) {
        if (value instanceof Date date) return date.getTime();
        if (value instanceof Instant instant) return instant.toEpochMilli();
        if (value instanceof OffsetDateTime dateTime) return dateTime.toInstant().toEpochMilli();
        if (value instanceof ZonedDateTime dateTime) return dateTime.toInstant().toEpochMilli();
        if (value instanceof LocalDateTime dateTime) return dateTime.toInstant(ZoneOffset.UTC).toEpochMilli();
        if (value instanceof LocalDate date) return date.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
        if (value instanceof LocalTime time) return time.toNanoOfDay() / 1_000_000;
        if (value instanceof Number number && Double.isFinite(number.doubleValue())) return number.longValue();
        if (!(value instanceof String text) || text.isBlank()) return null;

        String normalized = text.trim();
        try {
            return Instant.parse(normalized).toEpochMilli();
        } catch (DateTimeParseException ignored) {
            // 다음 ISO 날짜/시간 표현을 시도한다.
        }
        try {
            return OffsetDateTime.parse(normalized).toInstant().toEpochMilli();
        } catch (DateTimeParseException ignored) {
            // 다음 표현을 시도한다.
        }
        try {
            return LocalDateTime.parse(normalized.replace(' ', 'T')).toInstant(ZoneOffset.UTC).toEpochMilli();
        } catch (DateTimeParseException ignored) {
            // 다음 표현을 시도한다.
        }
        try {
            return LocalDate.parse(normalized).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli();
        } catch (DateTimeParseException ignored) {
            // 마지막으로 시간 단독 값을 시도한다.
        }
        try {
            return LocalTime.parse(normalized).toNanoOfDay() / 1_000_000;
        } catch (DateTimeParseException ignored) {
            return null;
        }
    }

    private void applyMovingAverage(Map<String, Object> option,
                                    List<Map<String, Object>> series,
                                    Map<String, Object> opt,
                                    List<Map<String, Object>> columns,
                                    List<List<Object>> rows) {
        if (series.isEmpty() || columns.size() < 2) return;
        Map<String, Object> config = map(map(opt.get("analysis")).get("movingAverage"));
        int seriesIndex = clampInt(number(config.get("seriesIndex"), 0), 0, columns.size() - 2);
        int period = clampInt(number(config.get("period"), 3), 2, 100);
        int valueIndex = seriesIndex + 1;

        List<Object> averages = new ArrayList<>();
        boolean hasAverage = false;
        for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
            if (rowIndex < period - 1) {
                averages.add(null);
                continue;
            }
            double sum = 0;
            boolean completeWindow = true;
            for (int offset = rowIndex - period + 1; offset <= rowIndex; offset++) {
                List<Object> row = rows.get(offset);
                Double observation = row.size() > valueIndex ? finiteDouble(row.get(valueIndex)) : null;
                if (observation == null) {
                    completeWindow = false;
                    break;
                }
                sum += observation;
            }
            if (!completeWindow) {
                averages.add(null);
                continue;
            }
            averages.add(sum / period);
            hasAverage = true;
        }
        if (!hasAverage) return;

        Map<String, Object> sourceSeries = series.get(seriesIndex);
        Object sourceColor = map(sourceSeries.get("lineStyle")).get("color");
        if (sourceColor == null) sourceColor = sourceSeries.get("color");
        if (sourceColor == null) sourceColor = map(sourceSeries.get("itemStyle")).get("color");

        Map<String, Object> averageSeries = new LinkedHashMap<>();
        averageSeries.put("id", MOVING_AVERAGE_SERIES_ID + "_" + seriesIndex);
        averageSeries.put("type", "line");
        String sourceName = string(columns.get(valueIndex).get("name"), "");
        String averageName = sourceName + " · " + period + "기간 이동평균";
        averageSeries.put("name", averageName);
        averageSeries.put("data", averages);
        averageSeries.put("showSymbol", false);
        averageSeries.put("symbol", "none");
        averageSeries.put("smooth", false);
        averageSeries.put("connectNulls", false);
        Map<String, Object> lineStyle = new LinkedHashMap<>();
        lineStyle.put("width", 2);
        lineStyle.put("type", "dashed");
        if (sourceColor != null) {
            lineStyle.put("color", sourceColor);
            averageSeries.put("color", sourceColor);
            averageSeries.put("itemStyle", Map.of("color", sourceColor));
        }
        averageSeries.put("lineStyle", lineStyle);
        if (sourceSeries.get("yAxisIndex") != null) averageSeries.put("yAxisIndex", sourceSeries.get("yAxisIndex"));
        averageSeries.put("z", 4);
        applySeriesEmphasis(averageSeries, opt, "line");

        List<String> originalSeriesNames = new ArrayList<>();
        for (Map<String, Object> item : series) {
            String name = string(item.get("name"), "");
            if (!name.isEmpty() && !originalSeriesNames.contains(name)) originalSeriesNames.add(name);
        }
        series.add(averageSeries);

        Map<String, Object> displayNames = mutableMap(
                option.get(FieldDisplayNameResolver.SERIES_DISPLAY_NAMES_KEY)
        );
        String sourceDisplayName = string(displayNames.get(sourceName), "");
        if (!sourceDisplayName.isEmpty()) {
            displayNames.put(averageName, sourceDisplayName + " · " + period + "기간 이동평균");
            option.put(FieldDisplayNameResolver.SERIES_DISPLAY_NAMES_KEY, displayNames);
        }

        // 이동평균은 applyLegend 가 이미 만든 범례의 data 만 조정한다. 범례 자체를 새로 만들면
        // "legend 생략 = 기본 표시" 계약을 우회해 없던 범례가 생긴다.
        if (Boolean.FALSE.equals(config.get("showInLegend")) && option.containsKey("legend")) {
            Map<String, Object> legend = new LinkedHashMap<>(map(option.get("legend")));
            if (!Boolean.FALSE.equals(legend.get("show"))) {
                legend.put("data", originalSeriesNames);
                option.put("legend", legend);
            }
        }
    }

    /**
     * 값 축 기준선·범위와 목표점을 선택 계열의 marker로 조립한다.
     * marker를 계열에 한 번만 붙이므로 다중 계열에서도 같은 선이 중복 렌더되지 않고,
     * 선택 계열의 yAxisIndex를 그대로 따라 조합 차트·이중 축에서도 축 의미가 유지된다.
     */
    private void applyAnalysisAnnotations(List<Map<String, Object>> series, Map<String, Object> opt,
                                          boolean horizontal, boolean numericX) {
        if (series.isEmpty()) return;
        Map<String, Object> annotations = map(map(opt.get("analysis")).get("annotations"));
        String valueAxisKey = horizontal ? "xAxis" : "yAxis";

        for (Map<String, Object> raw : mapItems(annotations.get("lines"))) {
            Double value = finiteDouble(raw.get("value"));
            if (value == null) continue;
            Map<String, Object> target = markerSeries(series, raw.get("seriesIndex"));
            Map<String, Object> markLine = mutableMap(target.get("markLine"));
            markLine.putIfAbsent("silent", true);
            markLine.putIfAbsent("symbol", List.of("none", "none"));
            List<Object> data = mutableList(markLine.get("data"));
            String name = annotationName(raw.get("name"));

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", name);
            item.put(valueAxisKey, value);
            item.put("lineStyle", Map.of(
                    "color", markerColor(raw.get("color"), "#E53935"),
                    "type", markerLineType(raw.get("lineType")),
                    "width", clampDouble(raw.get("lineWidth"), 1, 8, 2)
            ));
            item.put("label", Map.of(
                    "show", !Boolean.FALSE.equals(raw.get("showLabel")),
                    "formatter", annotationValueLabel(name, value),
                    "position", "insideEndTop"
            ));
            data.add(item);
            markLine.put("data", data);
            target.put("markLine", markLine);
        }

        for (Map<String, Object> raw : mapItems(annotations.get("ranges"))) {
            Double first = finiteDouble(raw.get("min"));
            Double second = finiteDouble(raw.get("max"));
            if (first == null || second == null) continue;
            double min = Math.min(first, second);
            double max = Math.max(first, second);
            Map<String, Object> target = markerSeries(series, raw.get("seriesIndex"));
            Map<String, Object> markArea = mutableMap(target.get("markArea"));
            markArea.putIfAbsent("silent", true);
            List<Object> data = mutableList(markArea.get("data"));
            String name = annotationName(raw.get("name"));

            Map<String, Object> start = new LinkedHashMap<>();
            start.put("name", name);
            start.put(valueAxisKey, min);
            start.put("itemStyle", Map.of(
                    "color", markerColor(raw.get("color"), "#FFB000"),
                    "opacity", clampDouble(raw.get("opacity"), 0.05, 0.6, 0.16)
            ));
            start.put("label", Map.of(
                    "show", !Boolean.FALSE.equals(raw.get("showLabel")),
                    "formatter", annotationRangeLabel(name, min, max),
                    "position", "insideTop"
            ));
            data.add(List.of(start, Map.of(valueAxisKey, max)));
            markArea.put("data", data);
            target.put("markArea", markArea);
        }

        for (Map<String, Object> raw : mapItems(annotations.get("targets"))) {
            Double targetValue = finiteDouble(raw.get("value"));
            Object xValue = numericX ? finiteDouble(raw.get("xValue")) : categoryValue(raw.get("xValue"));
            if (targetValue == null || xValue == null) continue;
            Map<String, Object> target = markerSeries(series, raw.get("seriesIndex"));
            Map<String, Object> markPoint = mutableMap(target.get("markPoint"));
            markPoint.putIfAbsent("silent", true);
            List<Object> data = mutableList(markPoint.get("data"));
            String name = annotationName(raw.get("name"));
            String color = markerColor(raw.get("color"), "#D81B60");

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", name);
            item.put("value", targetValue);
            item.put("coord", horizontal
                    ? List.of(targetValue, xValue)
                    : List.of(xValue, targetValue));
            item.put("symbol", markerSymbol(raw.get("symbol")));
            item.put("symbolSize", clampDouble(raw.get("symbolSize"), 12, 80, 42));
            item.put("itemStyle", Map.of("color", color));
            item.put("label", Map.of(
                    "show", !Boolean.FALSE.equals(raw.get("showLabel")),
                    "formatter", annotationValueLabel(name, targetValue),
                    "position", "top",
                    "color", color
            ));
            data.add(item);
            markPoint.put("data", data);
            target.put("markPoint", markPoint);
        }
    }

    private Map<String, Object> markerSeries(List<Map<String, Object>> series, Object value) {
        int requested = value instanceof Number n && Double.isFinite(n.doubleValue())
                ? (int) Math.floor(n.doubleValue())
                : 0;
        return series.get(Math.max(0, Math.min(series.size() - 1, requested)));
    }

    private List<Map<String, Object>> mapItems(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        List<Map<String, Object>> items = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?>)) continue;
            items.add(map(item));
            if (items.size() >= MAX_ANALYSIS_ANNOTATIONS_PER_KIND) break;
        }
        return items;
    }

    private Map<String, Object> mutableMap(Object value) {
        return new LinkedHashMap<>(map(value));
    }

    private List<Object> mutableList(Object value) {
        return value instanceof List<?> list ? new ArrayList<>(list) : new ArrayList<>();
    }

    private Double finiteDouble(Object value) {
        if (value instanceof Number n && Double.isFinite(n.doubleValue())) return n.doubleValue();
        if (value instanceof String text && !text.isBlank()) {
            try {
                double parsed = Double.parseDouble(text);
                return Double.isFinite(parsed) ? parsed : null;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private Object categoryValue(Object value) {
        if (value instanceof Number n && Double.isFinite(n.doubleValue())) return n;
        if (value instanceof String text && !text.isBlank()) return text;
        return null;
    }

    private String annotationName(Object value) {
        String name = value instanceof String text ? text.trim() : "";
        return name.length() > 80 ? name.substring(0, 80) : name;
    }

    private String annotationValueLabel(String name, double value) {
        return name.isEmpty() ? displayNumber(value) : name + ": " + displayNumber(value);
    }

    private String annotationRangeLabel(String name, double min, double max) {
        String range = displayNumber(min) + "–" + displayNumber(max);
        return name.isEmpty() ? range : name + ": " + range;
    }

    private String displayNumber(double value) {
        return value == Math.rint(value) ? String.valueOf((long) value) : String.valueOf(value);
    }

    private String markerColor(Object value, String fallback) {
        if (value instanceof String text && text.matches("#[0-9A-Fa-f]{6}")) return text.toUpperCase();
        return fallback;
    }

    private String markerLineType(Object value) {
        return "solid".equals(value) || "dotted".equals(value) ? String.valueOf(value) : "dashed";
    }

    private String markerSymbol(Object value) {
        return "diamond".equals(value) || "circle".equals(value) ? String.valueOf(value) : "pin";
    }

    private double clampDouble(Object value, double min, double max, double fallback) {
        Double numeric = finiteDouble(value);
        return numeric == null ? fallback : Math.max(min, Math.min(max, numeric));
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

    private void applyLabel(Map<String, Object> s, Map<String, Object> opt, boolean allowRotate) {
        boolean shown = Boolean.TRUE.equals(opt.get("dataLabel"));
        Map<String, Object> label = textStyle(typography(opt).dataLabel(), fontFamilyStack(opt, "dataLabel"));
        label.put("show", shown);
        if (shown) {
            String position = string(opt.get("labelPosition"), null);
            if (position != null) label.put("position", position);
            if (allowRotate) putLabelRotation(label, opt);
            applyLabelLayout(s, opt);
        }
        s.put("label", label);
    }

    /** 0°는 ECharts 기본값이므로 저장 계약에는 있어도 렌더 옵션에서는 생략한다. */
    private void putLabelRotation(Map<String, Object> label, Map<String, Object> opt) {
        if (opt.get("labelRotate") instanceof Number rotate && rotate.doubleValue() != 0) {
            label.put("rotate", rotate);
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
        s.putAll(nonCartesianInsets(opt, true, false));

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

        Map<String, Object> label = textStyle(typography(opt).dataLabel(), fontFamilyStack(opt, "dataLabel"));
        // ECharts 원형 시리즈는 라벨 기본값이 true이므로, 꺼진 상태도 반드시 false로 명시한다.
        // variant와 위치는 라벨의 모양만 정하며 표시 여부를 암묵적으로 켜면 안 된다.
        boolean labelShown = Boolean.TRUE.equals(opt.get("dataLabel"));
        label.put("show", labelShown);
        if (labelShown) putLabelRotation(label, opt);
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
    /**
     * chart-options/display.ts와 같은 계약. 요소별로 독립 판정한다 —
     * 저장된 px가 숫자면 그 요소만 직접 지정이고, 없으면 논리 캔버스 기본값 × 전체 배율을 쓴다.
     */
    private Typography typography(Map<String, Object> opt) {
        Map<String, Object> display = map(opt.get("display"));
        Map<String, Object> typography = map(opt.get("typography"));
        String preset = string(display.get("preset"), "standard");
        int scale = clampInt(number(typography.get("scale"), 100), 80, 150);

        int titleBase;
        int bodyBase;
        switch (preset) {
            // 세로 프리셋은 대응하는 가로 프리셋과 면적이 같으므로 같은 자동 글꼴 단계를 쓴다.
            case "small", "smallPortrait" -> { titleBase = 14; bodyBase = 10; }
            case "large", "largePortrait" -> { titleBase = 22; bodyBase = 14; }
            case "hd", "hdPortrait" -> { titleBase = 24; bodyBase = 15; }
            case "fhd", "fhdPortrait" -> { titleBase = 26; bodyBase = 16; }
            case "standardPortrait" -> { titleBase = 18; bodyBase = 12; }
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
        return new Typography(
                elementFont(typography.get("titleFontSize"), titleBase, scale, 10, 48),
                elementFont(typography.get("legendFontSize"), bodyBase, scale, 8, 32),
                elementFont(typography.get("axisFontSize"), bodyBase, scale, 8, 32),
                elementFont(typography.get("dataLabelFontSize"), bodyBase, scale, 8, 32),
                elementFont(typography.get("tooltipFontSize"), bodyBase, scale, 8, 32));
    }

    private int elementFont(Object stored, int autoBase, int scale, int min, int max) {
        if (stored instanceof Number n && Double.isFinite(n.doubleValue())) {
            return clampInt((int) Math.round(n.doubleValue()), min, max);
        }
        return scaledFont(autoBase, scale, min, max);
    }

    /**
     * 글꼴(패밀리) 선택 → CSS font-family 스택. chart-options/display.ts의 FONT_FAMILY_STACKS와 같은 문자열이다.
     * 기본은 null 을 반환해 아무 것도 내보내지 않는다 — 기존 차트의 렌더 결과를 그대로 유지하기 위함이다.
     */
    private String fontFamilyStack(Map<String, Object> opt, String element) {
        Map<String, Object> typography = map(opt.get("typography"));
        Object family = typography.containsKey(element + "FontFamily")
                ? typography.get(element + "FontFamily")
                : typography.get("fontFamily");
        return switch (string(family, "default")) {
            case "pretendard" -> "'ChartSDK Pretendard',sans-serif";
            case "notoSansKr" -> "'ChartSDK Noto Sans KR',sans-serif";
            default -> null;
        };
    }

    private Map<String, Object> textStyle(int fontSize, String fontFamily) {
        Map<String, Object> style = new LinkedHashMap<>();
        style.put("fontSize", fontSize);
        putIfNotNull(style, "fontFamily", fontFamily);
        return style;
    }

    /** 기본 640×360, 100%, 가로 제목에서 26/24/36px가 되어 기존 차트 외형을 유지한다. */
    private LayoutMetrics layoutMetrics(Typography typography, Map<String, Object> opt) {
        int titleHeight = (int) Math.ceil(typography.title() * 1.2) * titleLineCount(opt) + 4;
        int legendHeight = (int) Math.ceil(typography.legend() * 1.25) + 9;
        return new LayoutMetrics(titleHeight, legendHeight, legendHeight + 12);
    }

    private int scaledFont(int base, int scale, int min, int max) {
        return clampInt((int) Math.round(base * scale / 100.0), min, max);
    }

    private static int number(Object value, int fallback) {
        return value instanceof Number n && Double.isFinite(n.doubleValue()) ? (int) Math.round(n.doubleValue()) : fallback;
    }

    private static double doubleNumber(Object value, double fallback) {
        return value instanceof Number n && Double.isFinite(n.doubleValue()) ? n.doubleValue() : fallback;
    }

    private static int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    // ── deep merge & 헬퍼 ────────────────────────────────
    private static final List<String> TYPOGRAPHY_ELEMENT_SIZE_KEYS = List.of(
            "titleFontSize", "legendFontSize", "axisFontSize", "dataLabelFontSize", "tooltipFontSize");
    private static final List<String> TYPOGRAPHY_ELEMENT_FAMILY_KEYS = List.of(
            "titleFontFamily", "legendFontFamily", "axisFontFamily", "dataLabelFontFamily", "tooltipFontFamily");

    /**
     * 폐기된 typography.mode 일괄 게이트를 요소별 auto/px 계약으로 옮긴다(chart-options 미러).
     * 구 UX 는 '자동'으로 되돌려도 직전 px 를 남겼으므로 mode=auto 저장분의 잔존 px 는 사용자 의도가 아니다.
     */
    private void migrateLegacyTypographyMode(Map<String, Object> next) {
        if (!(next.get("typography") instanceof Map<?, ?>)) return;
        Map<String, Object> typography = new LinkedHashMap<>(map(next.get("typography")));
        if (!typography.containsKey("mode")) return;
        if (!"custom".equals(typography.get("mode"))) TYPOGRAPHY_ELEMENT_SIZE_KEYS.forEach(typography::remove);
        typography.remove("mode");
        next.put("typography", typography);
    }

    /** 현재 지원하는 세 저장값 외에는 기본으로 정규화한다(chart-options 미러). */
    private String normalizeStoredFontFamily(Object value) {
        String family = string(value, "default");
        return "pretendard".equals(family) || "notoSansKr".equals(family) ? family : "default";
    }

    private void migrateLegacyTypographyFontFamily(Map<String, Object> next) {
        if (!(next.get("typography") instanceof Map<?, ?>)) return;
        Map<String, Object> typography = new LinkedHashMap<>(map(next.get("typography")));
        boolean hasLegacyGlobal = typography.containsKey("fontFamily");
        String legacy = hasLegacyGlobal ? normalizeStoredFontFamily(typography.get("fontFamily")) : null;
        for (String key : TYPOGRAPHY_ELEMENT_FAMILY_KEYS) {
            if (typography.containsKey(key)) typography.put(key, normalizeStoredFontFamily(typography.get(key)));
            else if (hasLegacyGlobal) typography.put(key, legacy);
        }
        typography.remove("fontFamily");
        next.put("typography", typography);
    }

    /**
     * 제거된 지도 계열별 스타일을 colorMap과 포인트 공통 외형으로 승격한다(chart-options 미러).
     */
    private void migrateLegacyGeoSeriesStyles(Map<String, Object> next, String chartType) {
        if (!(next.get("geoSeriesStyles") instanceof Map<?, ?>)) return;
        Map<String, Object> styles = map(next.get("geoSeriesStyles"));
        Map<String, Object> colorMap = new LinkedHashMap<>(map(next.get("colorMap")));
        Map<String, Object> point = new LinkedHashMap<>(map(next.get("geoscatter")));
        List<String> pointKeys = List.of(
                "opacity", "borderColor", "borderWidth", "symbol", "symbolSize",
                "showEffectOn", "rippleScale", "ripplePeriod", "rippleBrushType");

        for (Map.Entry<String, Object> entry : styles.entrySet()) {
            Map<String, Object> style = map(entry.getValue());
            Object color = style.get("color");
            if (!colorMap.containsKey(entry.getKey()) && color instanceof String value && !value.isBlank()) {
                colorMap.put(entry.getKey(), value);
            }
            if ("geoscatter".equals(chartType)) {
                for (String key : pointKeys) {
                    if (!point.containsKey(key) && style.get(key) != null) point.put(key, style.get(key));
                }
            }
        }

        if (!colorMap.isEmpty()) next.put("colorMap", colorMap);
        if ("geoscatter".equals(chartType) && !point.isEmpty()) next.put("geoscatter", point);
        next.remove("geoSeriesStyles");
    }

    private Map<String, Object> migrateLegacyInteractionOptions(Map<String, Object> options, String chartType) {
        Map<String, Object> next = deepMerge(new LinkedHashMap<>(), options);
        if ("map".equals(chartType) && (next.get("variant") == null || "basic".equals(next.get("variant")))) {
            next.put("variant", "map");
        }
        if ("geoscatter".equals(chartType) && (next.get("variant") == null || "basic".equals(next.get("variant")))) {
            next.put("variant", "scatter");
        }
        migrateLegacyTypographyMode(next);
        migrateLegacyTypographyFontFamily(next);
        migrateLegacyGeoSeriesStyles(next, chartType);
        if (next.get("tooltip") instanceof Map<?, ?>) {
            Map<String, Object> tooltip = new LinkedHashMap<>(map(next.get("tooltip")));
            if ("auto".equals(tooltip.get("trigger"))) tooltip.put("trigger", "item");
            tooltip.remove("contentMode");
            tooltip.remove("template");
            next.put("tooltip", tooltip);
        }
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
        tooltip.remove("contentMode");
        tooltip.remove("template");
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
