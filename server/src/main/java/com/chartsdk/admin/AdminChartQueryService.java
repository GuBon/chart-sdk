package com.chartsdk.admin;

import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.chart.ChartDefinition;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.converter.FieldDisplayNameResolver;
import com.chartsdk.converter.SeriesPivot;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class AdminChartQueryService {
    private final AdminChartRepository charts;
    private final ChartComputeService compute;
    private final ChartOptionConverter converter;

    public AdminChartQueryService(AdminChartRepository charts, ChartComputeService compute,
                                  ChartOptionConverter converter) {
        this.charts = charts;
        this.compute = compute;
        this.converter = converter;
    }

    public Map<String, Object> list(Long ownerId, String q, String type, Integer page, Integer pageSize) {
        return charts.list(ownerId, q, type, page, pageSize);
    }

    public Map<String, Object> detail(long chartId) {
        return charts.detail(chartId);
    }

    public Map<String, Object> preview(long chartId) {
        ChartDefinition chart = charts.previewDefinition(chartId);
        CachedChartRows rows = compute.serve(
                chart.id(), chart.refreshMode(), chart.version(), chart.sampling());
        var displayRows = SeriesPivot.pivot(rows.rows(), chart.builderConfig(), chart.chartType());
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("chartId", chart.id());
        response.put("computedAt", rows.computedAt().toString());
        response.put("rowCount", displayRows.rowCount());
        response.put("truncated", rows.rows().truncated());
        response.put("option", converter.convert(
                displayRows, chart.chartType(), chart.options(), chart.builderConfig(), chart.refreshMode()));
        response.put("columns", FieldDisplayNameResolver.displayColumns(
                chart.builderConfig(), displayRows.columns(), chart.builderConfig().get("seriesBy") != null));
        response.put("rows", displayRows.rows());
        response.put("elapsedMs", rows.rows().elapsedMs());
        if (rows.sampling() != null) rows.sampling().putInto(response);
        return response;
    }
}
