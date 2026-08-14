package com.chartsdk.web;

import com.chartsdk.embed.EmbedChartService;
import com.chartsdk.token.EmbedKeyPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 임베드 데이터 서빙. chartId 파라미터는 받지 않는다 — 서빙할 차트는 검증된 임베드 키의 바인딩에서만 나온다. */
@RestController
@RequestMapping("/api/v1/charts")
public class EmbedController {
    private final EmbedChartService embedCharts;

    public EmbedController(EmbedChartService embedCharts) {
        this.embedCharts = embedCharts;
    }

    @GetMapping("/data")
    public Map<String, Object> data(HttpServletRequest request) {
        Object principal = request.getAttribute(EmbedKeyInterceptor.PRINCIPAL_ATTRIBUTE);
        if (!(principal instanceof EmbedKeyPrincipal embedPrincipal)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_INVALID", "Bearer embed key is required.");
        }
        return embedCharts.data(embedPrincipal);
    }
}
