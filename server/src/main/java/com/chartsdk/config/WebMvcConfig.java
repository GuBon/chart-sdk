package com.chartsdk.config;

import com.chartsdk.web.EmbedTokenInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    private final EmbedTokenInterceptor embedTokenInterceptor;

    public WebMvcConfig(EmbedTokenInterceptor embedTokenInterceptor) {
        this.embedTokenInterceptor = embedTokenInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(embedTokenInterceptor).addPathPatterns("/api/v1/charts/data");
    }
}
