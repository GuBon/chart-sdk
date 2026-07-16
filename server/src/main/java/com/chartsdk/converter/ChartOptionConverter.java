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
    // 레이아웃 예약 높이(px) — 제목·범례·visualMap 이 같은 모서리에 쌓일 때 서로 겹치지 않도록 grid 여백을 가산한다.
    // ECharts 는 title/legend/grid/visualMap 을 자동 배치하지 않으므로(각자 독립 좌표) 조립자가 조정한다. mock 변환기와 값 일치 필수.
    private static final int TITLE_H = 26;
    private static final int LEGEND_H = 24;
    private static final int VISUALMAP_H = 36;

    private final OptionDefaults defaults;

    public ChartOptionConverter(OptionDefaults defaults) {
        this.defaults = defaults;
    }

    private static boolean hasTitle(Map<String, Object> opt) {
        return !string(opt.get("title"), "").isEmpty();
    }

    private static boolean titleAtBottom(Map<String, Object> opt) {
        return hasTitle(opt) && "bottom".equals(string(opt.get("titleV"), "top"));
    }

    public Map<String, Object> convert(QueryRows rows, String chartType, Map<String, Object> options) {
        Map<String, Object> opt = deepMerge(defaults.forType(chartType), options == null ? Map.of() : options);
        String variant = string(opt.get("variant"), "basic");

        List<Map<String, Object>> columns = rows.columns();
        List<List<Object>> dataRows = applySort(rows.rows(), string(opt.get("sortOrder"), "none"));
        List<Object> categories = new ArrayList<>();
        for (List<Object> r : dataRows) categories.add(r.isEmpty() ? null : r.get(0));

        Map<String, Object> o = new LinkedHashMap<>();
        // 배경: 임베드가 어떤 호스트 페이지(다크 포함) 위에서도 자기완결적으로 보이도록 불투명 기본(흰색).
        // 저장된 옵션에 backgroundColor 가 있으면 그 값을 쓴다(차트별 설정). SDK 는 data-chart-background 로 재정의 가능.
        o.put("backgroundColor", string(opt.get("backgroundColor"), "#ffffff"));
        applyTitle(o, opt);
        applyColor(o, opt);
        applyLegend(o, opt);
        applyTooltip(o, opt, chartType);

        // 신규 유형은 직교 폴스루를 타지 않고 전용 조립(축·시리즈 형태가 다르다).
        if ("boxplot".equals(chartType)) { buildBoxplot(o, opt, columns, dataRows); return o; }
        if ("heatmap".equals(chartType)) { buildHeatmap(o, opt, columns, dataRows); return o; }
        if ("map".equals(chartType)) { buildMap(o, opt, dataRows); return o; }
        if ("geoscatter".equals(chartType)) { buildGeoScatter(o, opt, columns, dataRows); return o; }

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
        // 제목이 같은 모서리(상/하)에 있으면 범례를 제목 다음 줄로 밀어 겹침 방지(규칙 1). 좌/우 범례는 제목과 축이 달라 무관.
        boolean titleTop = hasTitle(opt) && "top".equals(string(opt.get("titleV"), "top"));
        boolean titleBottom = titleAtBottom(opt);
        switch (position) {
            case "top" -> { l.put("top", titleTop ? TITLE_H : 0); l.put("orient", "horizontal"); }
            case "left" -> { l.put("left", 0); l.put("orient", "vertical"); }
            case "right" -> { l.put("right", 0); l.put("orient", "vertical"); }
            default -> { l.put("bottom", titleBottom ? TITLE_H : 0); l.put("orient", "horizontal"); }
        }
        // 상·하 범례는 항상 scroll 로 단일행을 보장해야 LEGEND_H=24 예약 높이가 실제 레이아웃과 일치한다.
        // 좌·우는 기존 T2 토글을 존중한다.
        boolean horizontal = "top".equals(position) || "bottom".equals(position);
        if (horizontal || Boolean.TRUE.equals(legend.get("scroll"))) l.put("type", "scroll");
        o.put("legend", l);
    }

    private void applyTooltip(Map<String, Object> o, Map<String, Object> opt, String chartType) {
        Map<String, Object> tooltip = map(opt.get("tooltip"));
        Map<String, Object> t = new LinkedHashMap<>();
        boolean itemDefault = "pie".equals(chartType) || "scatter".equals(chartType) || "boxplot".equals(chartType);
        // heatmap·map·geoscatter 는 항목(셀/지역/포인트) 단위 hover 만 의미 → trigger 를 item 으로 고정(공통 zone 잔존 'axis' 클램프).
        boolean itemForced = "heatmap".equals(chartType) || "map".equals(chartType) || "geoscatter".equals(chartType);
        t.put("trigger", itemForced ? "item" : string(tooltip.get("trigger"), itemDefault ? "item" : "axis"));
        String axisPointer = string(tooltip.get("axisPointer"), null);
        if (axisPointer != null && !itemForced) t.put("axisPointer", Map.of("type", axisPointer));
        // 임베드 방어: 툴팁(HTML div)을 차트 컨테이너 안으로 제한 — 호스트의 overflow:hidden 클리핑·좌표 어긋남 차단.
        t.put("confine", true);
        o.put("tooltip", t);
    }

    // ── 신규: 상자수염·히트맵·지도 ────────────────────────
    /** 상자수염: 카테고리(0열)별로 값(1열)을 모아 5수 요약([min,Q1,median,Q3,max])을 계산. 전용 축(직교 폴스루의 이중축 오염 회피). */
    private void buildBoxplot(Map<String, Object> o, Map<String, Object> opt, List<Map<String, Object>> columns, List<List<Object>> rows) {
        LinkedHashMap<String, List<Double>> groups = new LinkedHashMap<>();
        for (List<Object> r : rows) {
            String cat = r.isEmpty() ? "" : String.valueOf(r.get(0));
            if (r.size() > 1 && r.get(1) instanceof Number n) {
                groups.computeIfAbsent(cat, k -> new ArrayList<>()).add(n.doubleValue());
            }
        }
        List<Object> cats = new ArrayList<>(groups.keySet());
        List<Object> data = new ArrayList<>();
        for (List<Double> vs : groups.values()) data.add(fiveNumberSummary(vs));

        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));
        Map<String, Object> xAxis = new LinkedHashMap<>();
        xAxis.put("type", "category");
        xAxis.put("data", cats);
        xAxis.put("boundaryGap", true);
        decorateAxis(xAxis, xCfg, true);
        Map<String, Object> yAxis = new LinkedHashMap<>();
        yAxis.put("type", "log".equals(string(yCfg.get("scale"), "value")) ? "log" : "value");
        decorateAxis(yAxis, yCfg, false);

        applyGrid(o, opt);
        o.put("xAxis", xAxis);
        o.put("yAxis", yAxis);

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "boxplot");
        s.put("name", columns.size() > 1 ? string(columns.get(1).get("name"), "분포") : "분포");
        s.put("data", data);
        Object color = ColorResolver.paletteColor(opt, 0);
        if (color != null) {
            Map<String, Object> itemStyle = new LinkedHashMap<>();
            itemStyle.put("color", color);
            itemStyle.put("borderColor", color);
            s.put("itemStyle", itemStyle);
        }
        o.put("series", List.of(s));
    }

    /** 히트맵: X=카테고리(행), Y=값 시리즈 컬럼명, 값=집계값 → data [xIdx, yIdx, value] + visualMap. */
    private void buildHeatmap(Map<String, Object> o, Map<String, Object> opt, List<Map<String, Object>> columns, List<List<Object>> rows) {
        List<Object> cats = new ArrayList<>();
        for (List<Object> r : rows) cats.add(r.isEmpty() ? null : r.get(0));
        List<Object> yNames = new ArrayList<>();
        for (int c = 1; c < columns.size(); c++) yNames.add(string(columns.get(c).get("name"), "series" + c));

        List<Object> data = new ArrayList<>();
        double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
        for (int xi = 0; xi < rows.size(); xi++) {
            List<Object> r = rows.get(xi);
            for (int c = 1; c < columns.size(); c++) {
                double v = (r.size() > c && r.get(c) instanceof Number n) ? n.doubleValue() : 0;
                data.add(List.of(xi, c - 1, v));
                if (v < min) min = v;
                if (v > max) max = v;
            }
        }
        if (Double.isInfinite(min)) { min = 0; max = 1; }
        if (min == max) max = min + 1;

        Map<String, Object> xCfg = map(opt.get("xAxis"));
        Map<String, Object> yCfg = map(opt.get("yAxis"));
        Map<String, Object> xAxis = new LinkedHashMap<>();
        xAxis.put("type", "category");
        xAxis.put("data", cats);
        xAxis.put("splitArea", Map.of("show", true));
        decorateAxis(xAxis, xCfg, true);
        Map<String, Object> yAxis = new LinkedHashMap<>();
        yAxis.put("type", "category");
        yAxis.put("data", yNames);
        yAxis.put("splitArea", Map.of("show", true));
        String yTitle = string(yCfg.get("title"), "");
        if (!yTitle.isEmpty()) yAxis.put("name", yTitle);

        Map<String, Object> grid = new LinkedHashMap<>(presetGrid(string(map(opt.get("grid")).get("preset"), "normal")));
        grid.put("containLabel", map(opt.get("grid")).getOrDefault("containLabel", true));
        applyMargins(grid, opt, false); // 제목만 가산(heatmap 은 범례 제거) — 규칙 2
        // 하단 visualMap 공간 확보. visualMap 은 titleAtBottom 이면 이미 TITLE_H 만큼 올라가 있으므로 그 위에 쌓는다.
        grid.put("bottom", ((Number) grid.get("bottom")).intValue() + VISUALMAP_H);
        o.remove("legend"); // heatmap 은 visualMap 이 범례 대체 (공통 zone 잔존 legend 제거)
        o.put("grid", grid);
        o.put("xAxis", xAxis);
        o.put("yAxis", yAxis);
        o.put("visualMap", visualMap(min, max, opt));

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "heatmap");
        s.put("name", "값");
        s.put("data", data);
        s.put("label", Map.of("show", Boolean.TRUE.equals(opt.get("dataLabel"))));
        o.put("series", List.of(s));
    }

    /** 지도: 지역명(0열)별 값(1열) → series map(map.name: kr-sido|kr-sigungu) data {name,value} + visualMap. 축·범례 없음. */
    private void buildMap(Map<String, Object> o, Map<String, Object> opt, List<List<Object>> rows) {
        List<Object> data = new ArrayList<>();
        double min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
        for (List<Object> r : rows) {
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("name", r.isEmpty() ? "" : String.valueOf(r.get(0)));
            double v = (r.size() > 1 && r.get(1) instanceof Number n) ? n.doubleValue() : 0;
            point.put("value", v);
            data.add(point);
            if (v < min) min = v;
            if (v > max) max = v;
        }
        if (Double.isInfinite(min)) { min = 0; max = 1; }
        if (min == max) max = min + 1;

        o.remove("legend"); // 지도는 visualMap 이 범례 대체
        o.put("visualMap", visualMap(min, max, opt));

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "map");
        s.put("map", mapName(opt));
        s.put("roam", Boolean.TRUE.equals(map(opt.get("map")).get("roam")));
        s.put("label", Map.of("show", Boolean.TRUE.equals(opt.get("dataLabel"))));
        applyLabelLayout(s, opt);
        s.put("emphasis", Map.of("label", Map.of("show", true)));
        s.put("data", data);
        o.put("series", List.of(s));
    }

    /**
     * 지도 포인트: 경도(0열)·위도(1열)(+선택 크기값 2열) → geo 좌표계 + scatter (공식 effectScatter-map 예제 구조).
     * JSON 전송이라 symbolSize 콜백 불가 → 크기값이 있으면 포인트별 symbolSize 를 계산해 데이터 항목에 넣는다(6~28px sqrt).
     */
    private void buildGeoScatter(Map<String, Object> o, Map<String, Object> opt, List<Map<String, Object>> columns, List<List<Object>> rows) {
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
        for (List<Object> r : rows) {
            double lng = (r.size() > 0 && r.get(0) instanceof Number n) ? n.doubleValue() : 0;
            double lat = (r.size() > 1 && r.get(1) instanceof Number n) ? n.doubleValue() : 0;
            if (!hasSize || Double.isInfinite(sMin)) {
                data.add(List.of(lng, lat));
                continue;
            }
            double v = (r.size() > 2 && r.get(2) instanceof Number n) ? n.doubleValue() : 0;
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("value", List.of(lng, lat, v));
            point.put("symbolSize", sMax == sMin ? base : (int) Math.round(6 + 22 * Math.sqrt((v - sMin) / (sMax - sMin))));
            data.add(point);
        }

        o.remove("legend"); // 단일 포인트 시리즈 — 범례 무의미
        Map<String, Object> geo = new LinkedHashMap<>();
        geo.put("map", mapName(opt));
        geo.put("roam", Boolean.TRUE.equals(map(opt.get("map")).get("roam")));
        geo.put("label", Map.of("show", false));
        geo.put("itemStyle", Map.of("areaColor", "#f3f4f6", "borderColor", "#d1d5db"));
        geo.put("emphasis", Map.of("itemStyle", Map.of("areaColor", "#e5e7eb"), "label", Map.of("show", false)));
        o.put("geo", geo);

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "scatter");
        s.put("coordinateSystem", "geo");
        s.put("name", columns.size() > 1 ? string(columns.get(1).get("name"), "포인트") : "포인트");
        s.put("symbolSize", base);
        Object color = ColorResolver.paletteColor(opt, 0);
        if (color != null) s.put("itemStyle", Map.of("color", color));
        s.put("data", data);
        o.put("series", List.of(s));
    }

    /** map.name 옵션(kr-sido|kr-sigungu) — 화이트리스트 밖 값은 kr-sido 로 폴백(등록 자산만 허용). */
    private String mapName(Map<String, Object> opt) {
        String name = string(map(opt.get("map")).get("name"), "kr-sido");
        return "kr-sigungu".equals(name) ? "kr-sigungu" : "kr-sido";
    }

    /** heatmap·map 공용 연속 visualMap — 팔레트[0]을 고강도색으로. */
    private Map<String, Object> visualMap(double min, double max, Map<String, Object> opt) {
        Object top = ColorResolver.paletteColor(opt, 0);
        Map<String, Object> vm = new LinkedHashMap<>();
        vm.put("min", min);
        vm.put("max", max);
        vm.put("calculable", true);
        vm.put("orient", "horizontal");
        vm.put("left", "center");
        // 제목이 하단이면 visualMap 을 제목 위로 올려 겹침 방지(규칙 1의 map/heatmap 변형).
        vm.put("bottom", titleAtBottom(opt) ? TITLE_H : 0);
        vm.put("inRange", Map.of("color", List.of("#f7f7f7", top != null ? top : "#5470C6")));
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
    private void applyGrid(Map<String, Object> o, Map<String, Object> opt) {
        Map<String, Object> grid = map(opt.get("grid"));
        Map<String, Object> g = new LinkedHashMap<>(presetGrid(string(grid.get("preset"), "normal")));
        g.put("containLabel", grid.getOrDefault("containLabel", true));
        applyMargins(g, opt, true); // 제목·범례 스택만큼 top/bottom 가산(규칙 2)
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

    /** grid 의 top/bottom 에 제목(TITLE_H)·범례(LEGEND_H) 예약 높이를 같은 모서리별로 가산한다.
     *  includeLegend=false 는 범례를 제거하는 유형(heatmap 등)에서 범례 가산을 건너뛸 때. */
    private void applyMargins(Map<String, Object> g, Map<String, Object> opt, boolean includeLegend) {
        int top = ((Number) g.get("top")).intValue();
        int bottom = ((Number) g.get("bottom")).intValue();
        boolean titleTop = hasTitle(opt) && "top".equals(string(opt.get("titleV"), "top"));
        if (titleTop) top += TITLE_H;
        if (titleAtBottom(opt)) bottom += TITLE_H;
        if (includeLegend) {
            Map<String, Object> legend = map(opt.get("legend"));
            boolean shown = !legend.isEmpty() && !Boolean.FALSE.equals(legend.get("show"));
            String pos = string(legend.get("position"), "bottom");
            if (shown && "top".equals(pos)) top += LEGEND_H;
            if (shown && "bottom".equals(pos)) bottom += LEGEND_H;
        }
        g.put("top", top);
        g.put("bottom", bottom);
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
