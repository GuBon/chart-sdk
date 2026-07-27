package com.chartsdk.converter;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class ItemColorResolver {
    private static final Pattern HEX6 = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final Pattern HEX3 = Pattern.compile("^#[0-9a-fA-F]{3}$");
    private static final Set<String> KINDS = Set.of(
            "cartesian", "scatter", "pie", "boxplot", "heatmap", "map", "geoscatter"
    );
    private static final Map<String, String> SINGLE_SERIES_KEYS = Map.of(
            "pie", "__pie__",
            "boxplot", "__boxplot__",
            "heatmap", "__heatmap__",
            "map", "__map__",
            "geoscatter", "__geoscatter__"
    );

    private final Map<Key, String> colors;

    private ItemColorResolver(Map<Key, String> colors) {
        this.colors = colors;
    }

    static ItemColorResolver from(Map<String, Object> options) {
        Map<Key, String> colors = new LinkedHashMap<>();
        Object raw = options.get("itemColorOverrides");
        if (!(raw instanceof List<?> overrides)) return new ItemColorResolver(colors);
        for (Object candidate : overrides) {
            if (!(candidate instanceof Map<?, ?> item)) continue;
            String kind = item.get("kind") instanceof String value && KINDS.contains(value) ? value : null;
            String seriesName = item.get("seriesName") instanceof String value ? value : null;
            String color = item.get("color") instanceof String value ? normalizeHex(value) : null;
            if (kind == null || seriesName == null || color == null || !(item.get("dimensions") instanceof List<?> dimensions)) {
                continue;
            }
            colors.put(key(kind, seriesName, dimensions, occurrence(item.get("occurrence"))), color);
        }
        return new ItemColorResolver(colors);
    }

    Object color(String kind, String displayedSeriesName, List<?> dimensions, int occurrence) {
        return colors.get(key(kind, seriesKey(kind, displayedSeriesName), dimensions, occurrence));
    }

    /** 동일 identity(kind·시리즈·dimensions)의 등장 순번을 0부터 세는 시리즈 단위 카운터. */
    static final class Occurrences {
        private final Map<Key, Integer> seen = new HashMap<>();

        int next(String kind, String displayedSeriesName, List<?> dimensions) {
            Key base = key(kind, seriesKey(kind, displayedSeriesName), dimensions, 0);
            return seen.merge(base, 1, Integer::sum) - 1;
        }
    }

    static String seriesKey(String kind, String displayedSeriesName) {
        return SINGLE_SERIES_KEYS.getOrDefault(kind, displayedSeriesName == null ? "" : displayedSeriesName);
    }

    /** 클라이언트 normalizeHexColor 와 동일 계약 — 6자리 그대로, 3자리 축약형은 확장, 그 외 null. */
    private static String normalizeHex(String value) {
        String trimmed = value.trim();
        if (HEX6.matcher(trimmed).matches()) return trimmed.toUpperCase(Locale.ROOT);
        if (!HEX3.matcher(trimmed).matches()) return null;
        StringBuilder expanded = new StringBuilder("#");
        for (int i = 1; i < trimmed.length(); i++) expanded.append(trimmed.charAt(i)).append(trimmed.charAt(i));
        return expanded.toString().toUpperCase(Locale.ROOT);
    }

    private static Key key(String kind, String seriesName, List<?> dimensions, int occurrence) {
        List<String> canonicalDimensions = new ArrayList<>(dimensions.size());
        for (Object dimension : dimensions) canonicalDimensions.add(canonicalDimension(dimension));
        return new Key(kind, seriesName, List.copyOf(canonicalDimensions), Math.max(0, occurrence));
    }

    private static int occurrence(Object value) {
        return value instanceof Number number ? Math.max(0, number.intValue()) : 0;
    }

    private static String canonicalDimension(Object value) {
        if (value == null) return "null:";
        if (value instanceof Number number) {
            try {
                BigDecimal decimal = new BigDecimal(String.valueOf(number)).stripTrailingZeros();
                if (decimal.compareTo(BigDecimal.ZERO) == 0) decimal = BigDecimal.ZERO;
                return "number:" + decimal.toPlainString();
            } catch (NumberFormatException ignored) {
                return "number:" + number;
            }
        }
        return "string:" + value;
    }

    private record Key(String kind, String seriesName, List<String> dimensions, int occurrence) {
    }
}
