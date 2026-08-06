package com.chartsdk.query;

import com.chartsdk.cache.SamplingMetadata;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Restores expected geo-heatmap intensity after uniform point sampling. */
public final class GeoHeatmapSamplingWeights {
    private static final String VALUE_COLUMN = "__chartsdk_point_value";

    private GeoHeatmapSamplingWeights() {
    }

    public static QueryRows apply(QueryRows rows, String chartType, Map<String, Object> config,
                                  SamplingMetadata sampling) {
        if (!isSampledGeoHeatmap(chartType, config, sampling)) return rows;
        double probability = inclusionProbability(sampling);
        if (!(probability > 0 && probability < 1)) return rows;

        int valueIndex = columnIndex(rows.columns(), VALUE_COLUMN);
        List<Map<String, Object>> columns = new ArrayList<>(rows.columns());
        if (valueIndex < 0) {
            valueIndex = columns.size();
            Map<String, Object> valueColumn = new LinkedHashMap<>();
            valueColumn.put("name", VALUE_COLUMN);
            valueColumn.put("type", "double precision");
            columns.add(valueColumn);
        }

        double weight = 1.0 / probability;
        List<List<Object>> weightedRows = new ArrayList<>(rows.rows().size());
        for (List<Object> source : rows.rows()) {
            List<Object> weighted = new ArrayList<>(source);
            while (weighted.size() <= valueIndex) weighted.add(null);
            Object value = weighted.get(valueIndex);
            weighted.set(valueIndex, value instanceof Number number ? number.doubleValue() * weight : weight);
            weightedRows.add(weighted);
        }
        return new QueryRows(List.copyOf(columns), List.copyOf(weightedRows),
                rows.rowCount(), rows.truncated(), rows.elapsedMs());
    }

    private static boolean isSampledGeoHeatmap(String chartType, Map<String, Object> config,
                                               SamplingMetadata sampling) {
        return "map".equals(chartType)
                && config != null
                && "heatmap".equals(String.valueOf(config.get("geoSeriesType")))
                && sampling != null
                && sampling.approximate();
    }

    private static double inclusionProbability(SamplingMetadata sampling) {
        if ("SYSTEM".equals(sampling.method()) && sampling.rate() != null) {
            return sampling.rate() / 100.0;
        }
        Long population = sampling.populationCount() != null && sampling.populationCount() > 0
                ? sampling.populationCount() : sampling.populationEstimate();
        if (population != null && population > 0
                && sampling.sampleSize() != null && sampling.sampleSize() > 0) {
            return Math.min(1.0, sampling.sampleSize() / (double) population);
        }
        return 1.0;
    }

    private static int columnIndex(List<Map<String, Object>> columns, String name) {
        for (int i = 0; i < columns.size(); i++) {
            if (name.equals(String.valueOf(columns.get(i).get("name")))) return i;
        }
        return -1;
    }
}
