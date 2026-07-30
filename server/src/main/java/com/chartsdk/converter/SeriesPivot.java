package com.chartsdk.converter;

import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Long rows (x, series, value) -> wide rows (x, series1, series2, ...). */
public final class SeriesPivot {
    public static final String UNCATEGORIZED = "미분류";

    private SeriesPivot() {
    }

    public static boolean enabled(Map<String, Object> builderConfig) {
        if (builderConfig == null) return false;
        Object value = builderConfig.get("seriesBy");
        return value != null && !String.valueOf(value).isBlank();
    }

    public static QueryRows pivot(QueryRows input, Map<String, Object> builderConfig) {
        if (!enabled(builderConfig)) return input;
        if (input.columns().size() < 3) {
            throw invalid("Series rows must contain X, series, and one value column.");
        }

        LinkedHashMap<Object, LinkedHashMap<String, Object>> cells = new LinkedHashMap<>();
        List<String> encounteredSeries = new ArrayList<>();
        for (List<Object> row : input.rows()) {
            Object x = row.isEmpty() ? null : row.get(0);
            String series = row.size() <= 1 || row.get(1) == null ? UNCATEGORIZED : String.valueOf(row.get(1));
            Object value = row.size() <= 2 ? null : row.get(2);
            LinkedHashMap<String, Object> xCells = cells.computeIfAbsent(x, ignored -> new LinkedHashMap<>());
            if (xCells.containsKey(series)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "DUPLICATE_SERIES_CELL",
                        "The same X/series pair occurs more than once: " + x + " / " + series);
            }
            xCells.put(series, value);
            if (!encounteredSeries.contains(series)) encounteredSeries.add(series);
        }

        String order = builderConfig.get("seriesOrder") == null ? "asc" : String.valueOf(builderConfig.get("seriesOrder"));
        List<String> seriesNames = new ArrayList<>(encounteredSeries);
        if (!"data".equals(order)) {
            Comparator<String> comparator = SeriesPivot::compareSeries;
            seriesNames.sort("desc".equals(order) ? comparator.reversed() : comparator);
        }

        List<Map<String, Object>> columns = new ArrayList<>();
        columns.add(new LinkedHashMap<>(input.columns().get(0)));
        Map<String, Object> valueColumn = input.columns().get(2);
        for (String name : seriesNames) {
            Map<String, Object> column = new LinkedHashMap<>(valueColumn);
            column.put("name", name);
            columns.add(column);
        }

        List<List<Object>> rows = new ArrayList<>();
        for (Map.Entry<Object, LinkedHashMap<String, Object>> entry : cells.entrySet()) {
            List<Object> row = new ArrayList<>();
            row.add(entry.getKey());
            for (String series : seriesNames) row.add(entry.getValue().get(series));
            rows.add(row);
        }
        return new QueryRows(columns, rows, rows.size(), input.truncated(), input.elapsedMs());
    }

    /**
     * 지도 계열은 long-row의 각 행이 실제 지역/좌표 데이터이므로 wide pivot을 하지 않는다.
     * ChartOptionConverter가 __chartsdk_series 열을 기준으로 ECharts series 배열을 직접 조립한다.
     */
    public static QueryRows pivot(QueryRows input, Map<String, Object> builderConfig, String chartType) {
        if ("map".equals(chartType) || "geoscatter".equals(chartType)) return input;
        return pivot(input, builderConfig);
    }

    private static int compareSeries(String left, String right) {
        try {
            return Double.compare(Double.parseDouble(left), Double.parseDouble(right));
        } catch (NumberFormatException ignored) {
            return left.compareToIgnoreCase(right);
        }
    }

    private static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SERIES_CONFIG", message);
    }
}
