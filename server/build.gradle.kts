plugins {
    java
    id("org.springframework.boot") version "3.5.16"
    id("io.spring.dependency-management") version "1.1.6"
}

group = "com.chartsdk"
version = "0.1.0"

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

repositories { mavenCentral() }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.session:spring-session-jdbc")
    implementation("org.bouncycastle:bcprov-jdk18on:1.84")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("org.apache.commons:commons-math3:3.6.1") // 카이제곱 분위수: 표준편차·분산 95% 추정 구간
    runtimeOnly("org.postgresql:postgresql")
    implementation("org.duckdb:duckdb_jdbc:1.5.4.0") // 다중 소스 페더레이션 엔진(설계 §3). 네이티브 lib 번들

    runtimeOnly("io.micrometer:micrometer-registry-prometheus")
    runtimeOnly("net.logstash.logback:logstash-logback-encoder:8.0") // prod 프로파일 JSON 로그
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
}

// 단위 테스트(*Test) — DB 불요·결정적. CI·기본 검증 대상.
tasks.test {
    useJUnitPlatform()
    filter { excludeTestsMatching("*IT") }
}

// 통합 테스트(*IT) — 실 DB(5433 메타·15432 tandanji) 필요. 단위에서 분리해 CI·로컬 DX 를 안정화.
// 별도 sourceSet 없이 test sourceSet 의 컴파일 산출물·classpath 를 재사용한다.
tasks.register<Test>("integrationTest") {
    description = "실 DB 의존 통합 테스트(*IT) 실행"
    group = "verification"
    useJUnitPlatform()
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    filter { includeTestsMatching("*IT") }
    shouldRunAfter(tasks.test)
}

// 서버(Java)와 MSW mock(TS)이 같은 레이아웃·표본 계산 계약 fixture를 각각 검증한다.
tasks.processTestResources {
    from("../chart-options") { include("*-contract-cases.json") }
}

// 단일 소스 입력 — 빌드 시 리소스로 복사 (Java/서버에 중복 정의하지 않는다)
//  1) 스키마 DDL: docs/V1__init.sql → classpath:db/migration (Flyway)
//  2) 옵션 기본값: chart-options/defaults.json → classpath:chart-defaults.json
//     (먼저 `npm run gen:defaults` 로 생성해야 한다)
tasks.processResources {
    // 모든 Flyway 마이그레이션(V1, V2, …)을 복사 — docs 가 마이그레이션의 단일 소스
    from("../docs") { include("V*__*.sql"); into("db/migration") }
    from("../docs") { include("afterMigrate__*.sql"); into("db/migration") }
    from("../chart-options/defaults.json") { rename { "chart-defaults.json" } }
    // 지도(map) 차트 GeoJSON — Spring 정적 리소스로 서빙(GET /maps/*.json). chart-options 가 단일 원본.
    from("../chart-options/maps") { include("*.json"); into("static/maps") }
}

val verifyFlywayResources by tasks.registering {
    description = "Verify that every Flyway source migration is packaged without modification."
    group = "verification"
    dependsOn(tasks.processResources)

    doLast {
        val sourceDirectory = file("../docs")
        val packagedDirectory = layout.buildDirectory.dir("resources/main/db/migration").get().asFile
        val requiredMigration = "V17__admin_audit_log.sql"
        val requiredCallback = "afterMigrate__runtime_grants.sql"
        val migrationPattern = Regex("V[0-9]+__.+\\.sql")

        val sources = sourceDirectory.listFiles()
            ?.filter { it.isFile && migrationPattern.matches(it.name) }
            ?.sortedBy { it.name }
            ?: emptyList()
        val packaged = packagedDirectory.listFiles()
            ?.filter { it.isFile && migrationPattern.matches(it.name) }
            ?.sortedBy { it.name }
            ?: emptyList()

        check(sources.any { it.name == requiredMigration }) {
            "Required Flyway migration is missing: docs/$requiredMigration"
        }
        check(sources.map { it.name } == packaged.map { it.name }) {
            "Flyway source and packaged migration lists differ. " +
                "source=${sources.map { it.name }}, packaged=${packaged.map { it.name }}"
        }
        sources.zip(packaged).forEach { (source, resource) ->
            check(source.readBytes().contentEquals(resource.readBytes())) {
                "Packaged Flyway migration differs from source: ${source.name}"
            }
        }

        val callbackSource = sourceDirectory.resolve(requiredCallback)
        val callbackResource = packagedDirectory.resolve(requiredCallback)
        check(callbackSource.isFile && callbackResource.isFile) {
            "Required Flyway callback is missing: $requiredCallback"
        }
        check(callbackSource.readBytes().contentEquals(callbackResource.readBytes())) {
            "Packaged Flyway callback differs from source: $requiredCallback"
        }
    }
}

tasks.named("check") { dependsOn(verifyFlywayResources) }
tasks.named("bootJar") { dependsOn(verifyFlywayResources) }
