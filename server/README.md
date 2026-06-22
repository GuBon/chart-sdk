# chartsdk-server (Spring Boot)

메타 DB 소유 · SQL 실행 엔진 · ECharts option **단일 변환기(Java)** · 토큰 검증.
Admin/SDK 는 이 서버의 API 만 호출한다. (API 계약서 v1.4)

## 패키지 계획 (구현 진행에 따라 채움)

```
com.chartsdk
├─ config/      설정·빈 (OptionDefaultsConfig: defaults.json SSOT 로드)
├─ web/         REST 컨트롤러 (charts · datasources · tokens · query · schema · embed)
├─ chart/       차트 CRUD·도메인 (mc_chart)
├─ datasource/  데이터소스·동적 커넥션 풀 (mc_datasource, HikariCP)
├─ token/       사용자 임베드 토큰·JWT 검증 (mc_user_token, 1인 1활성)
├─ query/       SQL 실행 엔진(검증·읽기전용·타임아웃·행제한) + 노코드 SQL 생성기
├─ converter/   (rows, chartType, options) → ECharts option 단일 변환기 (방식 A)
└─ cache/       결과 캐시 (mc_chart_cache, 갱신 모드 live/ttl/manual)
```

## 빌드 입력 (단일 소스 — 중복 정의 금지)

빌드 시 `processResources` 가 리소스로 복사한다 (build.gradle.kts):

| 입력 | 원본 | 리소스 | 용도 |
|---|---|---|---|
| 스키마 DDL | `../docs/V1__init.sql` | `db/migration/V1__init.sql` | Flyway 마이그레이션 |
| 옵션 기본값 | `../chart-options/defaults.json` | `chart-defaults.json` | 변환기 `withDefaults` |

> 옵션 기본값은 먼저 루트에서 `npm run gen:defaults` 로 생성해야 한다.

## 실행

- JDK 17.
- Gradle 래퍼 jar 는 저장소에 포함하지 않았다 — **IntelliJ 로 임포트**하거나, Gradle 설치 후 `gradle wrapper --gradle-version 8.10.2` 를 1회 실행해 `gradlew` 를 생성한다. 이후 `./gradlew bootRun`.
- DB 연결: 환경변수 `DATABASE_URL` · `DATABASE_USER` · `DATABASE_PASSWORD` (기본값은 `application.yml` 참조).
- 부팅 검증: `GET /health` → `{ "status": "ok", "chartTypes": ["bar","line","pie","scatter"] }`
