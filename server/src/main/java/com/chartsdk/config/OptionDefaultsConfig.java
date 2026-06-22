package com.chartsdk.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

/**
 * 옵션 기본값 SSOT 로더.
 * chart-options 가 생성한 defaults.json(빌드 시 chart-defaults.json 으로 포함)을 읽는다.
 * 기본값을 Java 에 중복 정의하지 않기 위한 단일 소스 — 옵션 추가 시 레지스트리만 고치면 된다.
 */
@Configuration
public class OptionDefaultsConfig {

    @Bean
    public OptionDefaults optionDefaults(ObjectMapper mapper) throws IOException {
        try (InputStream in = new ClassPathResource("chart-defaults.json").getInputStream()) {
            Map<String, Map<String, Object>> byType = mapper.readValue(
                    in,
                    mapper.getTypeFactory().constructMapType(Map.class, String.class, Map.class));
            return new OptionDefaults(byType);
        }
    }
}
