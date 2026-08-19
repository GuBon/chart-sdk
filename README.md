# chartsdk — 임베드 차트 솔루션

웹페이지에 `<div>` 한 줄 + 스크립트로 차트를 렌더하는 임베드 차트 솔루션.

> `docs/` 안의 화면설계서·인터페이스 계약서 등 `.md`/`.html` 설계 문서는 작성자 개인 작업 기록이라 저장소에 올리지 않는다(로컬 전용, `.gitignore` 처리). Flyway 마이그레이션(`docs/V*.sql`, `docs/afterMigrate__*.sql`)은 빌드가 실제로 읽으므로 계속 코드와 함께 추적한다.

## 빠른 시작

```bash
# 0) 필요 도구: Docker, Node >= 22, JDK 21
git clone <이 저장소> && cd chartsdk

# 1) DB — 로컬 PostgreSQL과 충돌하지 않도록 5433에 컨테이너로 띄운다
docker compose up -d
# chartsol(메타 DB)의 기본 테이블(mc_user 등)은 이 시점에 이미 만들어져 있다.

# 2) 프론트 의존성 + 옵션 SSOT 산출물
npm install
npm run gen:defaults

# 3) 서버 기동 — 최초 부팅 시 Flyway가 남은 마이그레이션(V2~V17)을 자동 적용한다.
#    수동으로 SQL을 실행할 필요는 없다. 접속 정보 기본값이 위 docker-compose 설정과 이미 일치하므로
#    별도 .env 설정 없이 바로 뜬다. Windows PowerShell은 .\gradlew.bat 사용.
cd server && ./gradlew bootRun
# 부팅 확인: GET http://localhost:8080/health → {"status":"ok", ...}

# 4) 관리 콘솔(새 터미널) — 기본은 MSW 목 데이터로 뜬다. 방금 띄운 실제 서버(DB)에 붙이려면
#    admin/.env.local 을 만든다.
cat > admin/.env.local <<'EOF'
NEXT_PUBLIC_API_BASE=http://localhost:8080
NEXT_PUBLIC_ENABLE_MSW=false
EOF
npm run dev   # http://localhost:3000
```

가입은 `/signup`에서 아이디·비밀번호만으로 공개적으로 할 수 있다. 최초 관리자를 만드는 절차는 [아래](#docker-postgresql)를 참조한다.
`admin/.env.local`을 만들지 않으면 Next.js가 기본값(`NEXT_PUBLIC_ENABLE_MSW`가 `false`가 아니고 `NEXT_PUBLIC_API_BASE`가 없으면 목 모드)으로 MSW 목 백엔드를 띄운다 — 실제 DB 없이 화면만 빠르게 볼 때 유용하다.

## 모노레포 구조

| 패키지 | 스택 | 역할 |
|---|---|---|
| [`chart-options/`](chart-options) | TypeScript | **옵션 SSOT** — 패널·서버 변환기·`options` JSONB가 공유하는 단일 레지스트리. `defaults.json` 산출 |
| [`admin/`](admin) | Next.js | 사용자 콘솔 + 관리자 사용자·전체 차트 화면. API만 호출, DB 직접 접근 없음 |
| [`sdk/`](sdk) | Vanilla TS + ECharts | 임베드 런타임 `sdk.js` — `[data-embed-key]` 스캔 → 데이터 요청 → `setOption` |
| [`server/`](server) | Spring Boot + JPA + Flyway | 메타 DB 소유, 세션 인증, SQL 실행 엔진, **ECharts option 단일 변환기(Java)**, 임베드 키 검증 |

## 경계 원칙

- **변환기는 서버(Java) 단일.** 프론트(admin·sdk)는 받은 option을 `setOption()` 할 뿐 조립하지 않는다.
- **옵션 SSOT는 `chart-options`.** admin은 직접 import, server는 빌드 시 산출된 `defaults.json`을 로드한다.
- server는 `mc_` 접두사 테이블만 소유한다(Type B 안전 요건).
- 노코드 빌더의 `agg:"none"`은 모든 그래프에서 원본값 튜플을 그리는 모드다. 서버는 GROUP BY 없는 SQL을 만들고, 프론트는 no-code UI에서 이를 선택할 수 있어야 한다.
- builder 저장 시 최종 SQL은 서버가 `builderConfig`에서 재생성한다. 클라이언트가 보낸 `sqlQuery`는 표시/상태 값일 뿐 신뢰 경계가 아니다.
- 구현 책임과 공통화 기준: 파일 길이만으로 나누지 않고 변경 이유와 재사용 경계를 기준으로 분리한다.

## 현재 구현 상태

- 백엔드는 `web` 컨트롤러, `chart` 서비스/저장소, `query` SQL 생성/실행, `converter` 옵션 변환으로 분리되어 있다.
- 공통 에러 envelope은 `ApiExceptionHandler`, 차트별 `cek1_*` 검증은 `EmbedKeyInterceptor`, 현재 사용자 스코프는 `CurrentUserProvider` 경로로 처리한다.
- 검증 기준(제품요구사항·인터페이스 계약·노코드 질의생성 규칙·화면설계)은 개인 설계 문서(로컬)를 따른다.
- 100개 독립 데이터소스·대용량 point 운영 경계와 배포 절차도 개인 설계 문서(로컬)를 따른다. 15/30/100 부하 실행법은 [`load-tests/README.md`](load-tests/README.md)를 참조한다.

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

계층·수치·라이브 스위프 절차는 개인 테스트 전략 문서(로컬)가 단일 관리한다. 현재 정의된 테스트 수는 위 명령을 직접 실행해 확인한다.

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
| `chartsol` | `mc_` 메타 테이블, 사용자/세션/차트/임베드 키/데이터소스 저장 |
| `chartsol_user` | 노코드 빌더가 조회할 샘플 업무 데이터 |

컨테이너 생성 시 실행되는 초기화 SQL(`docker/postgres/init/*`, `docs/V1__init.sql`)은 `chartsol`의 **기본 스키마**만 만든다. 나머지 마이그레이션(V2~V17 — 인증·세션·소유권·관리자 감사 로그 등)은 수동 실행할 필요가 없다. `chartsdk-server`가 처음 뜰 때 Flyway가 `docs/V*.sql`을 버전 순서대로 자동 적용하고, 이후 부팅부터는 이미 적용된 버전을 건너뛴다. 스키마가 꼬였다고 의심되면 `docker compose down -v`로 볼륨을 지우고 `docker compose up -d`부터 다시 시작한다(로컬 데이터는 사라진다).

서버 로컬 실행 기본값(`application.yml`)이 이미 위 Docker 접속 정보(`localhost:5433`, `postgres`/`0218`)와 일치하므로, 아래 env 블록은 **로컬 개발에는 설정할 필요가 없다** — 운영 배포 시 실제 값으로 교체해서 쓰는 참고용이다. `.env`를 자동으로 읽어들이는 로더는 없으므로(Java·Gradle 어느 쪽도 dotenv 플러그인을 쓰지 않는다), 운영에서는 배포 플랫폼의 환경변수로 직접 주입한다.

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
CHARTSDK_EMBED_KEY_SECRET=dev-chartsol-embed-key-secret-change-me
NEXT_PUBLIC_API_BASE=http://localhost:8080
NEXT_PUBLIC_ENABLE_MSW=false
ADMIN_CORS_ORIGINS=http://localhost:3000,http://localhost:3100,http://localhost:3001
FORWARD_HEADERS_STRATEGY=none
```

Admin 로그인은 JWT를 사용하지 않는다. 서버가 PostgreSQL에 8시간 세션을 저장하고 브라우저에는
HttpOnly 세션 ID 쿠키만 전달한다. 회원가입은 공개이며 아이디·비밀번호·비밀번호 확인만 받는다.
최초 관리자는 가입 후 DB 소유자 계정으로 역할을 한 번 승격하고 다시 로그인한다.

```sql
UPDATE mc_user
   SET role = 'admin', auth_version = auth_version + 1
 WHERE username_normalized = '<NFKC + Unicode strip + Locale.ROOT 소문자화한 아이디>';
```

로그인 전 생성된 `owner_id IS NULL` 차트·데이터소스는 로그인 사용자에게 자동 노출되지 않는다.
귀속 대상을 정한 뒤 [`docs/legacy_owner_backfill.sql`](docs/legacy_owner_backfill.sql)을 검토해 실행한다.

운영에서는 메타 DB runtime과 Flyway 계정을 분리한다. `chartsdk_app`은 `mc_*` DML만 수행하고,
`chartsdk_migrator`가 Flyway를 실행한다. Flyway 이력도 동일한 네임스페이스 원칙에 따라
`mc_flyway_schema_history`에 저장한다. 별도 Flyway 설정을 생략하면 로컬·테스트 호환을 위해 runtime datasource를 재사용한다.

```bash
DATABASE_USER=chartsdk_app
DATABASE_PASSWORD=<runtime-secret>
DATABASE_URL=jdbc:postgresql://db.internal:5432/chartsol
SPRING_FLYWAY_USER=chartsdk_migrator
SPRING_FLYWAY_PASSWORD=<migration-secret>
SPRING_FLYWAY_URL=jdbc:postgresql://db.internal:5432/chartsol
CHARTSDK_EMBED_KEY_SECRET=<32바이트 이상의 강한 랜덤 값>
DATASOURCE_ENC_KEY=<32바이트 이상의 강한 랜덤 값>
DATASOURCE_PASSWORD_ALLOW_LEGACY_PLAINTEXT=false
SPRING_PROFILES_ACTIVE=prod
```

`prod` 프로필은 로그인 쿠키를 `__Host-chartsdk-session; Secure; HttpOnly; SameSite=Lax; Path=/`로
고정하고 CSRF 토큰을 별도의 `__Host-chartsdk-csrf` Secure/HttpOnly 쿠키에 저장한다. CSRF 발급은
DB 로그인 세션을 만들지 않는다. 운영 필수 DB 접속정보·임베드 HMAC 키·데이터소스 암호화 키가 없거나
저장소의 개발 기본값이면 데이터소스/Flyway가 시작되기 전에 기동을 중단한다. TLS 종단 뒤에서도
애플리케이션이 HTTPS 요청으로 인식하도록 배포 플랫폼의 forwarded-header 설정을 함께 확인한다.

### 운영 DB 권한 분리 적용 순서

Role 부트스트랩 SQL은 [`ops/postgres/`](ops/postgres)에 있다(비밀번호는 SQL에 넣지 않고 배포 플랫폼 secret으로 설정).

1. `ops/postgres/01-create-roles.sql` 실행 — `chartsdk_migrator`(Flyway·DDL), `chartsdk_app`(런타임 DML) role 생성
2. 두 계정 비밀번호를 secret manager에 설정
3. 위 `SPRING_FLYWAY_*`/`DATABASE_*` 분리 값으로 배포해 최신 Flyway 버전이 적용됐는지 확인
4. `ops/postgres/02-chartsol-runtime-grants.sql` 실행 — `mc_*`에만 런타임 권한 부여, Flyway 이력 테이블 권한은 회수
5. 제한된 role로 smoke/E2E를 돌려 확인한 뒤, 애플리케이션 환경에서 `postgres` 슈퍼유저 자격증명을 제거

고객 데이터소스의 평문 비밀번호를 암호화로 전환할 때는 무중단 순서를 따른다: 먼저 `DATASOURCE_PASSWORD_ALLOW_LEGACY_PLAINTEXT=true`·`DATASOURCE_PASSWORD_MIGRATE_LEGACY_ON_STARTUP=true`로 배포해 기존 값을 자동 변환하고, `SELECT count(*) FROM mc_datasource WHERE db_password_enc NOT LIKE 'v1:%'`가 0임을 확인한 뒤 두 플래그를 `false`로 되돌린다.

S3 모달이 주는 `<div> + <script>`를 호스트 HTML에 그대로 붙이면 된다. Admin의 dev/build가 SDK 번들과 선택형 웹폰트를 `/sdk.js`, `/fonts/{assetVersion}/`로 자동 배포하고, 스니펫의 `data-api-base`가 SDK에 `NEXT_PUBLIC_API_BASE`를 전달한다. SDK는 chartId 없이 `GET /api/v1/charts/data`를 호출하며, Bearer 임베드 키의 서버측 바인딩으로 차트를 결정한다. API 응답은 브라우저에 저장하지 않고 PostgreSQL 결과 캐시를 단일 진실원으로 사용한다. 운영 배포에서는 `sdk.js`와 `fonts/`를 같은 디렉터리 계층에 함께 배포하고, 다른 출처의 페이지가 임베드한다면 폰트 응답의 CORS와 호스트 CSP `font-src`에 SDK 출처를 허용해야 한다. 버전형 폰트는 1년 `immutable`, 고정 파일명 `sdk.js`는 매 배포 재검증한다. 또한 `CHARTSDK_EMBED_KEY_SECRET`을 강한 랜덤 값으로 교체해야 한다. 임베드 데이터 API는 쿠키 없이 Bearer `cek1_*`만 사용하는 공개 CORS 경계이고, 쿠키를 쓰는 Admin API는 동일 출처 운영을 기본으로 한다.

### 임베드 코드를 직접 붙여 확인하기

1. 백엔드(`:8080`)와 Admin(`npm run dev`, `:3000`)을 실행한다.
2. [`admin/public/embed-host.html`](admin/public/embed-host.html)의 `임베드 코드 붙여넣기 시작/끝` 주석 사이에 S3에서 복사한 코드를 직접 붙여 넣고 저장한다.
3. `http://localhost:3000/embed-host.html`을 열거나 새로고침한다.

별도 정적 서버는 필요 없다. Next.js가 `admin/public`의 호스트 페이지와 빌드된 `/sdk.js`를 모두 `:3000`에서 제공한다.
