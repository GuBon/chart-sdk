package com.chartsdk.web;

import com.chartsdk.embed.EmbedChartService;
import com.chartsdk.token.EmbedPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
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
                                    HttpServletRequest request) {
        Object principal = request.getAttribute(EmbedTokenInterceptor.PRINCIPAL_ATTRIBUTE);
        if (!(principal instanceof EmbedPrincipal embedPrincipal)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Bearer token is required.");
        }
        return embedCharts.data(chartId, embedPrincipal);
    }
}
