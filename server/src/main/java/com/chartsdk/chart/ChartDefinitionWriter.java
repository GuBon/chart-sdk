package com.chartsdk.chart;

import com.chartsdk.web.ApiException;
import com.chartsdk.web.dto.ChartSaveRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Set;

/**
 * Persists only ChartSDK metadata. Customer datasource queries must be completed before entering
 * this service so a slow external query never holds a metadata-database transaction open.
 */
@Service
public class ChartDefinitionWriter {
    private final ChartRepository charts;

    public ChartDefinitionWriter(ChartRepository charts) {
        this.charts = charts;
    }

    @Transactional
    public SavedChart create(Long ownerId, ChartSaveRequest input, Set<Long> datasourceIds) {
        long id = charts.create(ownerId, input);
        charts.setChartDatasources(ownerId, id, datasourceIds);
        return new SavedChart(id, 0);
    }

    @Transactional
    public SavedChart update(Long ownerId, long id, ChartSaveRequest input, Set<Long> datasourceIds) {
        Integer version = charts.update(ownerId, id, input);
        if (version == null) {
            if (charts.exists(ownerId, id)) {
                throw new ApiException(HttpStatus.CONFLICT, "VERSION_CONFLICT",
                        "Chart was modified elsewhere; reload and retry.");
            }
            throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
        }
        charts.setChartDatasources(ownerId, id, datasourceIds);
        return new SavedChart(id, version);
    }

    @Transactional
    public long duplicate(Long ownerId, long sourceId) {
        long copyId = charts.duplicate(ownerId, sourceId);
        charts.copyChartDatasources(copyId, sourceId);
        charts.copyCache(copyId, sourceId);
        return copyId;
    }

    public record SavedChart(long id, int version) {
    }
}
