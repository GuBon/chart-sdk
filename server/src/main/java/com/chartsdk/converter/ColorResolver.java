package com.chartsdk.converter;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class ColorResolver {
    private ColorResolver() {
    }

    static List<Object> orderedPalette(Map<String, Object> opt) {
        if (!(opt.get("palette") instanceof List<?> palette) || palette.isEmpty()) return List.of();
        int start = paletteStart(opt.get("paletteActiveIndex"), palette.size());
        if (start == 0) return new ArrayList<>(palette);
        List<Object> ordered = new ArrayList<>();
        ordered.addAll(palette.subList(start, palette.size()));
        ordered.addAll(palette.subList(0, start));
        return ordered;
    }

    static Object pickColor(Map<String, Object> opt, String name, int index) {
        Map<String, Object> colorMap = map(opt.get("colorMap"));
        if (colorMap.get(name) != null) return colorMap.get(name);
        return paletteColor(opt, index);
    }

    static Object paletteColor(Map<String, Object> opt, int index) {
        List<Object> palette = orderedPalette(opt);
        if (!palette.isEmpty()) {
            return palette.get(index % palette.size());
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    static void applySeriesColor(Map<String, Object> series, String chartType, Object color) {
        if (color == null) return;
        series.put("color", color);
        Map<String, Object> itemStyle = series.get("itemStyle") instanceof Map<?, ?> existing
                ? new LinkedHashMap<>((Map<String, Object>) existing)
                : new LinkedHashMap<>();
        itemStyle.put("color", color);
        series.put("itemStyle", itemStyle);
        if ("line".equals(chartType)) {
            Map<String, Object> lineStyle = series.get("lineStyle") instanceof Map<?, ?> existing
                    ? new LinkedHashMap<>((Map<String, Object>) existing)
                    : new LinkedHashMap<>();
            lineStyle.put("color", color);
            series.put("lineStyle", lineStyle);
        }
    }

    private static int paletteStart(Object value, int size) {
        if (size <= 0) return 0;
        if (value instanceof Number n) return Math.floorMod(n.intValue(), size);
        try {
            return value == null ? 0 : Math.floorMod(Integer.parseInt(String.valueOf(value)), size);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }
}
