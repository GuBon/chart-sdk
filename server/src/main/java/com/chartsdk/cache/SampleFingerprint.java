package com.chartsdk.cache;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Stable tenant-scoped key for a post-JOIN Bernoulli row sample. */
public final class SampleFingerprint {
    private static final int CONTRACT_VERSION = 4;
    private static final ObjectMapper JSON = new ObjectMapper();

    private SampleFingerprint() {
    }

    public static String of(long primaryDatasourceId, Collection<Long> datasourceIds,
                            Map<String, Object> builderConfig, String chartType) {
        try {
            Map<String, Object> root = new TreeMap<>();
            root.put("version", CONTRACT_VERSION);
            root.put("primaryDatasourceId", primaryDatasourceId);
            root.put("datasourceIds", datasourceIds == null ? List.of() : datasourceIds.stream().sorted().toList());
            root.put("chartType", chartType == null ? "bar" : chartType);
            root.put("population", canonicalPopulation(builderConfig));
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(JSON.writeValueAsBytes(root));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) hex.append(String.format("%02x", value));
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("Cannot fingerprint sample population.", e);
        }
    }

    private static Object canonicalPopulation(Map<String, Object> source) {
        if (source == null) return Map.of();
        Map<String, Object> result = new TreeMap<>();
        for (Map.Entry<String, Object> entry : source.entrySet()) {
            String key = entry.getKey();
            if ("orderBy".equals(key) || "xAxisBucket".equals(key)) continue;
            if ("yAxis".equals(key) && entry.getValue() instanceof List<?> list) {
                List<Object> axes = new ArrayList<>();
                for (Object item : list) {
                    if (!(item instanceof Map<?, ?> axis)) continue;
                    Map<String, Object> projected = new TreeMap<>();
                    if (axis.get("column") != null) projected.put("column", canonical(axis.get("column")));
                    axes.add(projected);
                }
                result.put(key, axes);
            } else if ("geoPoint".equals(key) && entry.getValue() instanceof Map<?, ?> point) {
                Map<String, Object> projected = new TreeMap<>();
                for (Map.Entry<?, ?> item : point.entrySet()) {
                    String pointKey = String.valueOf(item.getKey());
                    if ("colorColumn".equals(pointKey)) continue;
                    projected.put(pointKey, canonical(item.getValue()));
                }
                result.put(key, projected);
            } else {
                result.put(key, canonical(entry.getValue()));
            }
        }
        return result;
    }

    private static Object canonical(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                sorted.put(String.valueOf(entry.getKey()), canonical(entry.getValue()));
            }
            return sorted;
        }
        if (value instanceof List<?> list) return list.stream().map(SampleFingerprint::canonical).toList();
        if (value instanceof Collection<?> collection) {
            return collection.stream().map(SampleFingerprint::canonical)
                    .sorted(Comparator.comparing(String::valueOf)).toList();
        }
        if (value instanceof byte[] bytes) return java.util.Base64.getEncoder().encodeToString(bytes);
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean) return value;
        return String.valueOf(value);
    }
}
