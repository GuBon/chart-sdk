package com.chartsdk;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class ChartsdkApplication {

    public static void main(String[] args) {
        SpringApplication.run(ChartsdkApplication.class, args);
    }
}
