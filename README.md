# chartsdk — 임베드 차트 솔루션

웹페이지에 `<div>` 한 줄 + 스크립트로 차트를 렌더하는 임베드 차트 솔루션.
문서의 전체 목록과 영역별 권위는 [`문서 안내`](docs/문서안내.md)를 참조한다. 상세 사건 원문은 [`개발 문제해결 이력`](docs/개발_문제해결_이력.md), 반복 원인·개선·남은 위험은 [`품질개선 종합분석`](docs/품질개선_종합분석.md)에서 확인한다.

## 모노레포 구조

| 패키지 | 스택 | 역할 |
|---|---|---|
| [`chart-options/`](chart-options) | TypeScript | **옵션 SSOT** — 패널·서버 변환기·`options` JSONB가 공유하는 단일 레지스트리. `defaults.json` 산출 |
| [`admin/`](admin) | Next.js | 관리 콘솔 (S1·S2·S3·S5·S7 + S6 골격). API만 호출, DB 직접 접근 없음 |
| [`sdk/`](sdk) | Vanilla TS + ECharts | 임베드 런타임 `sdk.js` — `[data-embed-key]` 스캔 → 데이터 요청 → `setOption` |
| [`server/`](server) | Spring Boot + JPA + Flyway | 메타 DB 소유, SQL 실행 엔진, **ECharts option 단일 변환기(Java)**, 토큰 검증 |

## 경계 원칙

- **변환기는 서버(Java) 단일.** 프론트(admin·sdk)는 받은 option을 `setOption()` 할 뿐 조립하지 않는다.
- **옵션 SSOT는 `chart-options`.** admin은 직접 import, server는 빌드 시 산출된 `defaults.json`을 로드한다.
- server는 `mc_` 접두사 테이블만 소유한다(Type B 안전 요건).
- 노코드 빌더의 `agg:"none"`은 모든 그래프에서 원본값 튜플을 그리는 모드다. 서버는 GROUP BY 없는 SQL을 만들고, 프론트는 no-code UI에서 이를 선택할 수 있어야 한다.
- builder 저장 시 최종 SQL은 서버가 `builderConfig`에서 재생성한다. 클라이언트가 보낸 `sqlQuery`는 표시/상태 값일 뿐 신뢰 경계가 아니다.
- 구현 책임과 공통화 기준은 [`docs/코드구조_안내.md`](docs/코드구조_안내.md)를 따른다. 파일 길이만으로 나누지 않고 변경 이유와 재사용 경계를 기준으로 분리한다.

## 현재 구현 상태

- 백엔드는 `web` 컨트롤러, `chart` 서비스/저장소, `query` SQL 생성/실행, `converter` 옵션 변환으로 분리되어 있다.
- 공통 에러 envelope은 `ApiExceptionHandler`, 임베드 JWT 검증은 `EmbedTokenInterceptor`, 현재 사용자 스코프는 `CurrentUserProvider` 경로로 처리한다.
- 검증 기준은 [`docs/제품요구사항.md`](docs/제품요구사항.md), [`docs/인터페이스_계약서.md`](docs/인터페이스_계약서.md), [`docs/노코드_질의생성_규칙.md`](docs/노코드_질의생성_규칙.md), [`docs/화면설계서.md`](docs/화면설계서.md)의 최신 문서 버전을 따른다.
- 100개 독립 데이터소스·대용량 point 운영 경계와 배포 절차는 [`docs/대용량_운영_설계.md`](docs/대용량_운영_설계.md), 15/30/100 실행법은 [`load-tests/README.md`](load-tests/README.md)를 따른다.

## 개발

```bash
# 필요 도구: Node >= 22, JDK 21
npm install                 # 워크스페이스 의존성
npm run gen:defaults        # chart-options/defaults.json 생성 (server가 로드)
npm run dev                 # sdk.js 빌드·공개 경로 복사 후 admin (Next) 개발 서버
npm run build:sdk           # SDK 번들 + 버전형 웹폰트 생성(sdk/dist/sdk.js, sdk/dist/fonts/v1/)
npm run build               # SDK를 admin/public/sdk.js에 포함한 전체 프론트 production build

# server (별도 빌드)
cd server && ./gradlew bootRun   # Windows PowerShell: .\gradlew.bat bootRun
```

### 개인 VS Code 탐색기 설정(선택)

단위 테스트는 대상 모듈 옆에 두는 방식(`foo.ts` / `foo.test.ts`)으로 관리한다. 파일 목록을 간결하게 보려면 프로젝트에 `.vscode/settings.json`을 만들지 말고, VS Code에서 `Preferences: Open User Settings (JSON)`을 열어 다음 설정을 개인 환경에만 추가한다.

```json
"explorer.fileNesting.enabled": true,
"explorer.fileNesting.expand": false,
"explorer.fileNesting.patterns": {
  "*.ts": "${capture}.test.ts, ${capture}.spec.ts",
  "*.tsx": "${capture}.test.tsx, ${capture}.spec.tsx"
}
```

이 설정은 운영 파일 아래에 관련 테스트 파일을 접어서 표시하며, 프로젝트 파일이나 Git에는 포함하지 않는다.

## 테스트

```bash
npm run test:unit             # 워크스페이스 단위 테스트(admin + sdk)
cd server && ./gradlew test   # 서버 단위(DB 불요)
cd .. && npm run test:parity  # Java/TS 8종 전체 option snapshot을 새로 생성해 비교
npm run test:e2e              # 프론트 E2E (Playwright + MSW, 자체 dev 서버 :3100)
npm run test:e2e:real         # Admin→Spring→PostGIS→임베드 키→SDK 실백엔드 E2E
cd server && ./gradlew integrationTest   # 서버 통합(실 DB 필요)
```

계층·수치·라이브 스위프 절차는 [`docs/테스트_전략.md`](docs/테스트_전략.md)가 단일 관리한다.

## 서드파티 고지

차트 테마는 프로젝트에 직접 포함한 **ColorBrewer 2.0**의 정성형·순차형·발산형 팔레트 35개를 사용한다. 상세 출처와 라이선스는
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)를 참조한다.

## Docker PostgreSQL

로컬 PostgreSQL이 5432를 쓰는 환경을 피하기 위해 Docker DB는 `localhost:5433`으로 노출한다.

```bash
docker compose up -d
```

초기 컨테이너 생성 시 다음이 자동 구성된다.

| DB | 용도 |
|---|---|
| `chartsol` | `mc_` 메타 테이블, 차트/토큰/데이터소스 저장 |
| `chartsol_user` | 노코드 빌더가 조회할 샘플 업무 데이터 |

서버 로컬 실행 기본값은 Docker DB 기준이다.

### PostGIS 공간 차트 데모 데이터

```bash
docker compose --profile spatial-test up -d
```

위 프로필은 `localhost:55433`의 `chartsdk_spatial_test` DB와 Admin용 `postgis-geometry-test` 데이터소스를 준비한다. `geometry_demo.parcel_boundaries_10k`에는 10,000개의 가상 필지가 들어 있다.

`geometry_demo.korea_sigungu_statistics`에는 2026-07-20 행정구역 체계의 시·군·구 경계 253개와 2024~2026년 가상 통계가 들어 있다. 경계 좌표의 공식 원본 기준일은 SGIS 2025-06-30이며, 이후 전남광주통합특별시와 인천광역시 개편 경계는 공식 하위 경계를 합쳐 반영했다. `region_name`은 지도 매칭용 결합 이름이고, `sido_name`과 `sigungu_name`은 시·도/시·군·구 분석용 분리 컬럼이다. 상세 출처와 가공 내역은 [`chart-options/maps/LICENSE.md`](chart-options/maps/LICENSE.md)를 따른다.

| 차트 | 공간 컬럼 | 이름/값 컬럼 |
|---|---|---|
| 동적 Polygon 지도 | `boundary` (`geometry(Polygon,3857)`) 또는 `boundary_geography` | `parcel_name` / `assessed_value` |
| 포인트 지도 | `centroid` (`geometry(Point,3857)`) 또는 `centroid_geography` | 크기값 `area_sqm` |

`district`, `land_use`, `observed_on`은 필터·집계 검증에 사용할 수 있다. 공간 데이터 초기화 SQL은 [`docker/postgis/init`](docker/postgis/init) 아래에 실행 순서대로 있다.

```bash
DATABASE_URL=jdbc:postgresql://localhost:5433/chartsol
DATABASE_USER=postgres
DATABASE_PASSWORD=0218
CHARTSDK_EMBED_JWT_SECRET=dev-chartsol-embed-secret-change-me
CHARTSDK_EMBED_KEY_SECRET=dev-chartsol-embed-key-secret-change-me
NEXT_PUBLIC_API_BASE=http://localhost:8080
NEXT_PUBLIC_ENABLE_MSW=false
```

운영에서는 메타 DB runtime과 Flyway 계정을 분리한다. `chartsdk_app`은 `mc_*` DML만 수행하고,
`chartsdk_migrator`가 Flyway를 실행한다. Flyway 이력도 동일한 네임스페이스 원칙에 따라
`mc_flyway_schema_history`에 저장한다. 별도 Flyway 설정을 생략하면 로컬·테스트 호환을 위해 runtime datasource를 재사용한다.

```bash
DATABASE_USER=chartsdk_app
DATABASE_PASSWORD=<runtime-secret>
SPRING_FLYWAY_USER=chartsdk_migrator
SPRING_FLYWAY_PASSWORD=<migration-secret>
SPRING_FLYWAY_URL=jdbc:postgresql://db.internal:5432/chartsol
```

운영 적용 순서와 평문 datasource 비밀번호 전환은 [`docs/운영_데이터베이스_권한과_비밀번호전환.md`](docs/운영_데이터베이스_권한과_비밀번호전환.md)를 따른다.

S3 모달이 주는 `<div> + <script>`를 호스트 HTML에 그대로 붙이면 된다. Admin의 dev/build가 SDK 번들과 선택형 웹폰트를 `/sdk.js`, `/fonts/{assetVersion}/`로 자동 배포하고, 스니펫의 `data-api-base`가 SDK에 `NEXT_PUBLIC_API_BASE`를 전달한다. SDK는 chartId 없이 `GET /api/v1/charts/data`를 호출하며, Bearer 임베드 키의 서버측 바인딩으로 차트를 결정한다. API 응답은 브라우저에 저장하지 않고 PostgreSQL 결과 캐시를 단일 진실원으로 사용한다. 상세 계약은 [`docs/인터페이스_계약서.md`](docs/인터페이스_계약서.md)를 따른다. 운영 배포에서는 `sdk.js`와 `fonts/`를 같은 디렉터리 계층에 함께 배포하고, 다른 출처의 페이지가 임베드한다면 폰트 응답의 CORS와 호스트 CSP `font-src`에 SDK 출처를 허용해야 한다. 버전형 폰트는 1년 `immutable`, 고정 파일명 `sdk.js`는 매 배포 재검증한다. 또한 `CHARTSDK_EMBED_KEY_SECRET`을 강한 랜덤 값으로 교체하고 실제 호스트 도메인을 서버 CORS 허용 목록에 등록해야 한다.

### 임베드 코드를 직접 붙여 확인하기

1. 백엔드(`:8080`)와 Admin(`npm run dev`, `:3000`)을 실행한다.
2. [`admin/public/embed-host.html`](admin/public/embed-host.html)의 `임베드 코드 붙여넣기 시작/끝` 주석 사이에 S3에서 복사한 코드를 직접 붙여 넣고 저장한다.
3. `http://localhost:3000/embed-host.html`을 열거나 새로고침한다.

별도 정적 서버는 필요 없다. Next.js가 `admin/public`의 호스트 페이지와 빌드된 `/sdk.js`를 모두 `:3000`에서 제공한다.
