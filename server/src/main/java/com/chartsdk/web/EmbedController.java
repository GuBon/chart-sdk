package com.chartsdk.web;

import com.chartsdk.embed.EmbedChartService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/charts")
public class EmbedController {
    private final EmbedChartService embedCharts;

    public EmbedController(EmbedChartService embedCharts) {
        this.embedCharts = embedCharts;
    }

    @GetMapping("/data")
    public Map<String, Object> data(@RequestParam long chartId,
                                    @RequestHeader(value = "Authorization", required = false) String authorization) {
        return embedCharts.data(chartId, authorization);
    }
}
