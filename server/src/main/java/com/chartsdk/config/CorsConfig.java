package com.chartsdk.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
public class CorsConfig {
    private final List<String> adminOrigins;

    public CorsConfig(@Value("${chartsdk.cors.admin-origins:http://localhost:3000,http://localhost:3100,http://localhost:3001}")
                      List<String> adminOrigins) {
        this.adminOrigins = adminOrigins;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration admin = new CorsConfiguration();
        admin.setAllowedOrigins(adminOrigins);
        admin.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        admin.setAllowedHeaders(List.of("Content-Type", "X-CSRF-TOKEN", "X-Requested-With"));
        admin.setAllowCredentials(true);

        CorsConfiguration embed = new CorsConfiguration();
        embed.setAllowedOriginPatterns(List.of("*"));
        embed.setAllowedMethods(List.of("GET", "OPTIONS"));
        embed.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        embed.setAllowCredentials(false);

        CorsConfiguration maps = new CorsConfiguration();
        maps.setAllowedOriginPatterns(List.of("*"));
        maps.setAllowedMethods(List.of("GET", "OPTIONS"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/v1/charts/data", embed);
        source.registerCorsConfiguration("/api/**", admin);
        // 지도(map) 차트의 공개 GeoJSON 자산 — 임베드 호스트(SDK)가 교차 출처로 fetch 하므로 CORS 허용.
        source.registerCorsConfiguration("/maps/**", maps);
        return source;
    }
}
