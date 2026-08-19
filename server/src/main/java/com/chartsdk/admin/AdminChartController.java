package com.chartsdk.admin;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/charts")
public class AdminChartController {
    private final AdminChartQueryService charts;

    public AdminChartController(AdminChartQueryService charts) {
        this.charts = charts;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) Long ownerId,
                                    @RequestParam(required = false) String q,
                                    @RequestParam(required = false) String type,
                                    @RequestParam(required = false) Integer page,
                                    @RequestParam(required = false) Integer pageSize) {
        return charts.list(ownerId, q, type, page, pageSize);
    }

    @GetMapping("/{chartId}")
    public Map<String, Object> detail(@PathVariable long chartId) {
        return charts.detail(chartId);
    }

    @GetMapping("/{chartId}/preview")
    public Map<String, Object> preview(@PathVariable long chartId) {
        return charts.preview(chartId);
    }
}
