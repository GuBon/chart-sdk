package com.chartsdk.config;

import com.chartsdk.web.EmbedKeyInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    private final EmbedKeyInterceptor embedKeyInterceptor;

    public WebMvcConfig(EmbedKeyInterceptor embedKeyInterceptor) {
        this.embedKeyInterceptor = embedKeyInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(embedKeyInterceptor).addPathPatterns("/api/v1/charts/data");
    }
}
