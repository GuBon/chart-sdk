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
        List<Object> ordered = new ArrayList<>();
        if (start == 0) {
            ordered.addAll(palette);
        } else {
            ordered.addAll(palette.subList(start, palette.size()));
            ordered.addAll(palette.subList(0, start));
        }
        if (Boolean.TRUE.equals(opt.get("paletteReversed"))) java.util.Collections.reverse(ordered);
        return ordered;
    }

    static Object pickColor(Map<String, Object> opt, String name, int index) {
        Map<String, Object> colorMap = map(opt.get("colorMap"));
        if (colorMap.get(name) != null) return colorMap.get(name);
        Map<String, Object> autoColorMap = map(opt.get("autoColorMap"));
        if (autoColorMap.get(name) != null) return autoColorMap.get(name);
        return paletteColor(opt, index);
    }

    static Map<String, Object> resolveSeriesColors(Map<String, Object> opt, List<String> names) {
        Map<String, Object> resolved = new LinkedHashMap<>(map(opt.get("autoColorMap")));
        List<Object> palette = orderedPalette(opt);
        java.util.Set<String> used = new java.util.LinkedHashSet<>();
        resolved.values().forEach(value -> used.add(String.valueOf(value).toUpperCase()));
        for (int index = 0; index < names.size(); index++) {
            String name = names.get(index);
            if (resolved.get(name) != null) continue;
            String color = index < palette.size() ? String.valueOf(palette.get(index)).toUpperCase() : null;
            if (color == null || used.contains(color)) color = generatedColor(name, index, used);
            resolved.put(name, color);
            used.add(color);
        }
        return resolved;
    }

    static Object paletteColor(Map<String, Object> opt, int index) {
        List<Object> palette = orderedPalette(opt);
        if (!palette.isEmpty()) {
            if (index < palette.size()) return palette.get(index);
            return generatedColor("series-index-" + index, index, java.util.Set.of());
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

    private static String generatedColor(String name, int index, java.util.Set<String> used) {
        int attempt = 0;
        String color;
        do {
            long hash = fnv1a(name + ":" + attempt);
            double hue = (hash + Math.round(index * 137.508)) % 360;
            double saturation = 62 + ((hash >>> 9) % 19);
            double lightness = 38 + ((hash >>> 17) % 23);
            color = hslToHex(hue, saturation, lightness);
            attempt++;
        } while (used.contains(color) && attempt < 720);
        return color;
    }

    private static long fnv1a(String value) {
        long hash = 0x811c9dc5L;
        for (int i = 0; i < value.length(); i++) {
            hash ^= value.charAt(i);
            hash = (hash * 0x01000193L) & 0xffffffffL;
        }
        return hash;
    }

    private static String hslToHex(double hue, double saturation, double lightness) {
        double sat = saturation / 100.0;
        double light = lightness / 100.0;
        double c = (1 - Math.abs(2 * light - 1)) * sat;
        double x = c * (1 - Math.abs((hue / 60.0) % 2 - 1));
        double m = light - c / 2;
        double r = 0, g = 0, b = 0;
        if (hue < 60) { r = c; g = x; }
        else if (hue < 120) { r = x; g = c; }
        else if (hue < 180) { g = c; b = x; }
        else if (hue < 240) { g = x; b = c; }
        else if (hue < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return String.format("#%02X%02X%02X", channel(r + m), channel(g + m), channel(b + m));
    }

    private static int channel(double value) {
        return Math.max(0, Math.min(255, (int) Math.round(value * 255)));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }
}
