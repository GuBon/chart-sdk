package com.chartsdk.web;

import com.chartsdk.config.OptionDefaults;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 스캐폴딩 헬스체크 — 부팅 + 옵션 기본값 SSOT 로딩까지 검증한다. */
@RestController
public class HealthController {

    private final OptionDefaults defaults;

    public HealthController(OptionDefaults defaults) {
        this.defaults = defaults;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "chartTypes", defaults.byType().keySet());
    }
}
