package com.chartsdk.converter;

import com.chartsdk.config.OptionDefaults;
import com.chartsdk.query.QueryRows;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
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
    private final OptionDefaults defaults;

    public ChartOptionConverter(OptionDefaults defaults) {
        this.defaults = defaults;
    }

    public Map<String, Object> convert(QueryRows rows, String chartType, Map<String, Object> options) {
        Map<String, Object> opt = deepMerge(defaults.forType(chartType), options == null ? Map.of() : options);
        String variant = string(opt.get("variant"), "basic");

        List<Map<String, Object>> columns = rows.columns();
        List<List<Object>> dataRows = applySort(rows.rows(), string(opt.get("sortOrder"), "none"));
        List<Object> categories = new ArrayList<>();
        for (List<Object> r : dataRows) categories.add(r.isEmpty() ? null : r.get(0));

        Map<String, Object> o = new LinkedHashMap<>();
        applyTitle(o, opt);
        applyColor(o, opt);
        applyLegend(o, opt);
        applyTooltip(o, opt, chartType);

        if ("pie".equals(chartType)) {
            o.put("series", List.of(buildPieSeries(opt, variant, dataRows)));
            return o;
        }

        boolean horizontal = "bar".equals(chartType) && "horizontal".equals(variant);
        boolean scatter = "scatter".equals(chartType);
        applyGrid(o, opt);
        applyAxes(o, opt, scatter, horizontal, categories);
        o.put("series", buildCartesianSeries(opt, chartType, variant, columns, dataRows, horizontal, scatter));
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
        switch (position) {
            case "top" -> { l.put("top", 0); l.put("orient", "horizontal"); }
            case "left" -> { l.put("left", 0); l.put("orient", "vertical"); }
            case "right" -> { l.put("right", 0); l.put("orient", "vertical"); }
            default -> { l.put("bottom", 0); l.put("orient", "horizontal"); }
        }
        if (Boolean.TRUE.equals(legend.get("scroll"))) l.put("type", "scroll");
        o.put("legend", l);
    }

    private void applyTooltip(Map<String, Object> o, Map<String, Object> opt, String chartType) {
        Map<String, Object> tooltip = map(opt.get("tooltip"));
        Map<String, Object> t = new LinkedHashMap<>();
        boolean itemDefault = "pie".equals(chartType) || "scatter".equals(chartType);
        t.put("trigger", string(tooltip.get("trigger"), itemDefault ? "item" : "axis"));
        String axisPointer = string(tooltip.get("axisPointer"), null);
        if (axisPointer != null) t.put("axisPointer", Map.of("type", axisPointer));
        o.put("tooltip", t);
    }

    // ── 그리드·축 ────────────────────────────────────────
    private void applyGrid(Map<String, Object> o, Map<String, Object> opt) {
        Map<String, Object> grid = map(opt.get("grid"));
        Map<String, Object> g = new LinkedHashMap<>(presetGrid(string(grid.get("preset"), "normal")));
        g.put("containLabel", grid.getOrDefault("containLabel", true));
        o.put("grid", g);
    }

    private Map<String, Object> presetGrid(String preset) {
        return switch (preset) {
            case "compact" -> Map.of("left", 8, "right", 8, "top", 32, "bottom", 24);
            case "loose" -> Map.of("left", 48, "right", 48, "top", 64, "bottom", 64);
            default -> Map.of("left", 24, "right", 24, "top", 48, "bottom", 40);
        };
    }

    private void applyAxes(Map<String, Object> o, Map<String, Object> opt, boolean scatter, boolean horizontal, List<Object> categories) {
        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));

        Map<String, Object> categoryAxis = new LinkedHashMap<>();
        categoryAxis.put("type", "category");
        categoryAxis.put("data", categories);

        Map<String, Object> valueAxis = new LinkedHashMap<>();
        valueAxis.put("type", "log".equals(string(yCfg.get("scale"), "value")) ? "log" : "value");

        if (scatter) {
            // 분포: X·Y 모두 수치축, data 없음. (데이터는 [x,y] 쌍)
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("type", "log".equals(string(xCfg.get("scale"), "value")) ? "log" : "value");
            decorateAxis(x, xCfg, true);
            decorateAxis(valueAxis, yCfg, false);
            o.put("xAxis", x);
            o.put("yAxis", valueAxis);
            return;
        }

        decorateAxis(categoryAxis, xCfg, true);
        decorateAxis(valueAxis, yCfg, false);

        if (horizontal) {
            o.put("xAxis", valueAxis);
            o.put("yAxis", categoryAxis);
            return;
        }
        o.put("xAxis", categoryAxis);
        // 이중축(@yAxis.second): 두 번째 값축 추가 (시리즈는 2번째부터 yAxisIndex=1)
        if (Boolean.TRUE.equals(yCfg.get("secondAxis"))) {
            Map<String, Object> second = new LinkedHashMap<>(valueAxis);
            o.put("yAxis", List.of(valueAxis, second));
        } else {
            o.put("yAxis", valueAxis);
        }
    }

    /** 축 공통 장식: name, rotate(카테고리), splitLine, min/max(수동), 단위 포맷터. */
    private void decorateAxis(Map<String, Object> axis, Map<String, Object> cfg, boolean isX) {
        String title = string(cfg.get("title"), "");
        if (!title.isEmpty()) axis.put("name", title);
        if (cfg.containsKey("splitLine")) axis.put("splitLine", Map.of("show", Boolean.TRUE.equals(cfg.get("splitLine"))));
        if (isX && cfg.get("rotate") instanceof Number rotate && rotate.intValue() != 0) {
            axis.put("axisLabel", new LinkedHashMap<>(Map.of("rotate", rotate)));
        }
        if (!isX && "manual".equals(string(cfg.get("rangeMode"), "auto"))) {
            if (cfg.get("min") != null) axis.put("min", cfg.get("min"));
            if (cfg.get("max") != null) axis.put("max", cfg.get("max"));
        }
        if (!isX) {
            String unit = string(cfg.get("unit"), "");
            if (!unit.isEmpty()) {
                @SuppressWarnings("unchecked")
                Map<String, Object> label = (Map<String, Object>) axis.computeIfAbsent("axisLabel", k -> new LinkedHashMap<>());
                label.put("formatter", "{value}" + unit);
            }
        }
    }

    // ── 시리즈 (직교) ────────────────────────────────────
    private List<Map<String, Object>> buildCartesianSeries(Map<String, Object> opt, String chartType, String variant,
                                                           List<Map<String, Object>> columns, List<List<Object>> dataRows,
                                                           boolean horizontal, boolean scatter) {
        Map<String, Object> barCfg = map(opt.get("bar"));
        Map<String, Object> lineCfg = map(opt.get("line"));
        Map<String, Object> scatterCfg = map(opt.get("scatter"));
        Map<String, Object> seriesTypes = map(opt.get("seriesTypes")); // 혼합(combo): 시리즈명 → "bar"/"line"
        boolean stacked = "stacked".equals(variant) || "stackedArea".equals(variant);
        boolean secondAxis = !horizontal && !scatter && Boolean.TRUE.equals(map(opt.get("yAxis")).get("secondAxis"));
        boolean individual = "individual".equals(string(opt.get("colorMode"), "palette"));
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
            for (int ri = 0; ri < dataRows.size(); ri++) {
                List<Object> r = dataRows.get(ri);
                Object y = r.size() > col ? r.get(col) : null;
                if (scatter) {
                    Object x = r.isEmpty() ? null : r.get(0);
                    if (bubbleIdx >= 0 && r.size() > bubbleIdx) data.add(java.util.Arrays.asList(x, y, r.get(bubbleIdx)));
                    else data.add(java.util.Arrays.asList(x, y));
                } else if (catTotals != null && y instanceof Number n && catTotals[ri] != 0) {
                    data.add(n.doubleValue() / catTotals[ri]);
                } else {
                    data.add(y);
                }
            }
            s.put("data", data);

            if (stacked) s.put("stack", "total");
            applyVariantDelta(s, variant, lineCfg);
            applyLabel(s, opt);
            if ("bar".equals(seriesType)) applyBar(s, barCfg);
            if ("line".equals(seriesType)) applyLine(s, lineCfg);
            if (scatter && bubbleIdx < 0 && scatterCfg.get("symbolSize") != null) s.put("symbolSize", scatterCfg.get("symbolSize"));
            if (scatter && scatterCfg.get("symbol") != null) s.put("symbol", scatterCfg.get("symbol"));
            if (individual) {
                Object color = ColorResolver.pickColor(opt, colName, c - 1);
                ColorResolver.applySeriesColor(s, seriesType, color);
            } else {
                ColorResolver.applySeriesColor(s, seriesType, ColorResolver.paletteColor(opt, c - 1));
            }
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
            String position = string(opt.get("labelPosition"), null);
            if (position != null) label.put("position", position);
            s.put("label", label);
        }
    }

    private void applyBar(Map<String, Object> s, Map<String, Object> barCfg) {
        putIfNotNull(s, "barWidth", barCfg.get("width"));
        putIfNotNull(s, "barGap", barCfg.get("gap"));
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
    private Map<String, Object> buildPieSeries(Map<String, Object> opt, String variant, List<List<Object>> dataRows) {
        Map<String, Object> pieCfg = map(opt.get("pie"));
        boolean individual = "individual".equals(string(opt.get("colorMode"), "palette"));
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "pie");

        List<Object> data = new ArrayList<>();
        int i = 0;
        for (List<Object> r : dataRows) {
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("name", r.isEmpty() ? "" : r.get(0));
            point.put("value", r.size() > 1 ? r.get(1) : 0);
            if (individual) {
                Object color = ColorResolver.pickColor(opt, String.valueOf(r.isEmpty() ? "" : r.get(0)), i);
                if (color != null) point.put("itemStyle", Map.of("color", color));
            } else {
                Object color = ColorResolver.paletteColor(opt, i);
                if (color != null) point.put("itemStyle", Map.of("color", color));
            }
            data.add(point);
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
        putIfNotNull(label, "position", pieCfg.get("labelPosition"));
        s.put("label", label);
        putIfNotNull(s, "startAngle", pieCfg.get("startAngle"));
        putIfNotNull(s, "minAngle", pieCfg.get("minAngle"));
        return s;
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

    // ── deep merge & 헬퍼 ────────────────────────────────
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
