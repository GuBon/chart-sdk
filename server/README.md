# chartsdk-server (Spring Boot)

메타 DB 소유 · SQL 실행 엔진 · ECharts option **단일 변환기(Java)** · 토큰 검증.
Admin/SDK 는 이 서버의 API 만 호출한다. (API 계약서 v3.4)

## 패키지 계획 (구현 진행에 따라 채움)

```
com.chartsdk
├─ config/      설정·빈 (OptionDefaultsConfig: defaults.json SSOT 로드, WebMvcConfig)
├─ web/         얇은 REST 컨트롤러 · DTO · 공통 예외 처리 · EmbedTokenInterceptor
├─ auth/        현재 사용자 공급자(CurrentUserProvider)와 개발용 구현
├─ chart/       차트 CRUD·저장 검증·캐시 시드 오케스트레이션 (ChartService/Repository)
├─ datasource/  데이터소스·동적 커넥션 풀 (mc_datasource, HikariCP)
├─ token/       사용자 임베드 토큰·JWT 검증 (mc_user_token, 1인 1활성)
├─ query/       SQL 실행 엔진(검증·읽기전용·타임아웃·행제한) + 노코드 SQL 생성기 + 식별자/리터럴 유틸
├─ converter/   (rows, chartType, options) → ECharts option 단일 변환기 (방식 A)
└─ cache/       수동 결과 스냅샷 (mc_chart_cache, 갱신 모드 manual/live)
```

## 현재 구현 메모

- builder 저장은 클라이언트 `sqlQuery`를 신뢰하지 않고 서버가 `builderConfig`에서 SQL을 재생성·검증·리터럴화해 저장한다.
- 노코드 `agg:"none"` 원본값 튜플 모드는 bar/line/pie/scatter/map에서 동작한다. 이 모드는 GROUP BY를 사용하지 않으며, sample을 켜면 선택된 원본 행만 반환한다.
- 막대·선의 `builderConfig.seriesBy`는 두 번째 그룹 차원으로 SQL을 만들고 `SeriesPivot`에서 다중 시리즈로 전개한다.
- PostGIS Polygon/Point와 geometry/geography SRID 변환, 저장 스냅샷 preview, live single-flight와 수동 refresh가 구현돼 있다.
- 임베드 토큰 검증은 `EmbedTokenInterceptor`에서 끝내고, `EmbedController`는 검증된 principal만 사용한다.
- 요청 바디는 핵심 API별 record DTO + Bean Validation으로 받으며, `ApiExceptionHandler`가 공통 에러 envelope을 만든다.

## 빌드 입력 (단일 소스 — 중복 정의 금지)

빌드 시 `processResources` 가 리소스로 복사한다 (build.gradle.kts):

| 입력 | 원본 | 리소스 | 용도 |
|---|---|---|---|
| 스키마 DDL | `../docs/V1__init.sql` | `db/migration/V1__init.sql` | Flyway 마이그레이션 |
| 옵션 기본값 | `../chart-options/defaults.json` | `chart-defaults.json` | 변환기 `withDefaults` |

> 옵션 기본값은 먼저 루트에서 `npm run gen:defaults` 로 생성해야 한다.

## 실행

- JDK 17.
- Gradle Wrapper가 저장소에 포함돼 있다. macOS/Linux는 `./gradlew bootRun`, Windows PowerShell은 `.\gradlew.bat bootRun`을 사용한다.
- DB 연결: 환경변수 `DATABASE_URL` · `DATABASE_USER` · `DATABASE_PASSWORD` (기본값은 `application.yml` 참조).
- 운영 Flyway 분리: `SPRING_FLYWAY_URL` · `SPRING_FLYWAY_USER` · `SPRING_FLYWAY_PASSWORD`. 미설정 시 runtime datasource 재사용.
- Flyway 이력 테이블: `public.mc_flyway_schema_history`. 기존 `public.flyway_schema_history`는 첫 부팅에서 이력을 보존한 채 자동으로 이름을 변경한다.
- 레거시 datasource 비밀번호: `DATASOURCE_PASSWORD_MIGRATE_LEGACY_ON_STARTUP=true`로 1회 변환 후
  미암호화 0건을 확인하고 `DATASOURCE_PASSWORD_ALLOW_LEGACY_PLAINTEXT=false`로 전환한다.
- 쿼리 timeout 기본값: preview/catalog/explain 10초, chart/sample/federation 30초.
  운영 조정은 `QUERY_TIMEOUT_{PREVIEW|CATALOG|EXPLAIN|CHART|SAMPLE|FEDERATION}_SECONDS`를 사용한다.
- 부팅 검증: `GET /health` → `{ "status": "ok", "chartTypes": [...] }`. `chartTypes`는 `defaults.json`의 현재 8개 대분류를 반환하므로 배열 순서에 의존하지 않는다.
