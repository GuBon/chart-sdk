package com.chartsdk.config;

import java.util.Map;

/**
 * 대분류 → 기본 options 맵. chart-options 의 defaults.json 을 그대로 담는다.
 * 변환기가 누락 옵션을 채울 때(withDefaults, 변환기 매핑 스펙 5장) 사용한다.
 */
public record OptionDefaults(Map<String, Map<String, Object>> byType) {

    /** 해당 대분류의 기본 options (없으면 빈 맵) */
    public Map<String, Object> forType(String chartType) {
        return byType.getOrDefault(chartType, Map.of());
    }
}
