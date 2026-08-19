package com.chartsdk.admin;

import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.chart.ChartDefinition;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.converter.FieldDisplayNameResolver;
import com.chartsdk.converter.SeriesPivot;
import com.chartsdk.web.ApiException;
import org.springframework.http.HttpStatus;
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

    public Map<String, Object> detail(long chartId) {
        return charts.detail(chartId);
    }

    /**
     * 관리자 열람은 저장된 스냅샷만 보여준다. 소유자 서빙 경로({@code serve})를 재사용하면 live 차트는 열 때마다,
     * manual 차트도 스냅샷이 없으면 다른 테넌트의 데이터소스에 SQL 을 실행하고 그 캐시까지 덮어쓴다 —
     * 읽기 전용 콘솔이 고객 DB 부하와 부작용을 만들 수 없도록 재계산을 시작하지 않는다.
     */
    public Map<String, Object> preview(long chartId) {
        ChartDefinition chart = charts.previewDefinition(chartId);
        CachedChartRows rows = compute.storedSnapshot(chart.id(), chart.version(), chart.sampling())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SNAPSHOT_NOT_FOUND",
                        "저장된 미리보기 스냅샷이 없습니다. 관리자 화면은 고객 데이터베이스를 조회하지 않습니다."));
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
