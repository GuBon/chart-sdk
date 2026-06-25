plugins {
    java
    id("org.springframework.boot") version "3.3.5"
    id("io.spring.dependency-management") version "1.1.6"
}

group = "com.chartsdk"
version = "0.1.0"

java {
    toolchain { languageVersion = JavaLanguageVersion.of(17) }
}

repositories { mavenCentral() }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("org.postgresql:postgresql")
    runtimeOnly("io.micrometer:micrometer-registry-prometheus")
    runtimeOnly("net.logstash.logback:logstash-logback-encoder:8.0") // prod 프로파일 JSON 로그
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.test { useJUnitPlatform() }

// 단일 소스 입력 — 빌드 시 리소스로 복사 (Java/서버에 중복 정의하지 않는다)
//  1) 스키마 DDL: docs/V1__init.sql → classpath:db/migration (Flyway)
//  2) 옵션 기본값: chart-options/defaults.json → classpath:chart-defaults.json
//     (먼저 `npm run gen:defaults` 로 생성해야 한다)
tasks.processResources {
    // 모든 Flyway 마이그레이션(V1, V2, …)을 복사 — docs 가 마이그레이션의 단일 소스
    from("../docs") { include("V*__*.sql"); into("db/migration") }
    from("../chart-options/defaults.json") { rename { "chart-defaults.json" } }
}
