# chartsdk — 사내 임베드 차트 솔루션

웹페이지에 `<div>` 한 줄 + 스크립트로 차트를 렌더하는 사내 전용 임베드 차트 솔루션.
설계 문서는 [`docs/`](docs/) 참조 (PRD·화면설계서·API 계약서·노코드 SQL 생성규칙·변환기 매핑 스펙·DB 매핑).

## 모노레포 구조

| 패키지 | 스택 | 역할 |
|---|---|---|
| [`chart-options/`](chart-options) | TypeScript | **옵션 SSOT** — 패널·서버 변환기·`options` JSONB가 공유하는 단일 레지스트리. `defaults.json` 산출 |
| [`admin/`](admin) | Next.js | 관리 콘솔 (S1·S2·S3·S5·S7 + S6 골격). API만 호출, DB 직접 접근 없음 |
| [`sdk/`](sdk) | Vanilla TS + ECharts | 임베드 런타임 `sdk.js` — `[data-chart-id]` 스캔 → 데이터 요청 → `setOption` |
| [`server/`](server) | Spring Boot + JPA + Flyway | 메타 DB 소유, SQL 실행 엔진, **ECharts option 단일 변환기(Java)**, 토큰 검증 |

## 경계 원칙

- **변환기는 서버(Java) 단일.** 프론트(admin·sdk)는 받은 option을 `setOption()` 할 뿐 조립하지 않는다.
- **옵션 SSOT는 `chart-options`.** admin은 직접 import, server는 빌드 시 산출된 `defaults.json`을 로드한다.
- server는 `mc_` 접두사 테이블만 소유한다(Type B 안전 요건).
- 노코드 빌더의 `agg:"none"`은 모든 그래프에서 원본값 튜플을 그리는 모드다. 서버는 GROUP BY 없는 SQL을 만들고, 프론트는 no-code UI에서 이를 선택할 수 있어야 한다.
- builder 저장 시 최종 SQL은 서버가 `builderConfig`에서 재생성한다. 클라이언트가 보낸 `sqlQuery`는 표시/상태 값일 뿐 신뢰 경계가 아니다.

## 현재 구현 상태

- 백엔드는 `web` 컨트롤러, `chart` 서비스/저장소, `query` SQL 생성/실행, `converter` 옵션 변환으로 분리되어 있다.
- 공통 에러 envelope은 `ApiExceptionHandler`, 임베드 JWT 검증은 `EmbedTokenInterceptor`, 현재 사용자 스코프는 `CurrentUserProvider` 경로로 처리한다.
- 검증 기준 문서는 PRD v1.8, API 계약서 v1.6, 노코드 SQL 생성규칙 v1.5, 화면설계서 v2.5를 따른다.

## 개발

```bash
# 필요 도구: Node >= 22, JDK 17
npm install                 # 워크스페이스 의존성
npm run gen:defaults        # chart-options/defaults.json 생성 (server가 로드)
npm run dev                 # admin (Next) 개발 서버
npm run build:sdk           # sdk.js 번들

# server (별도 빌드)
cd server && gradle bootRun   # 또는 IntelliJ 임포트
```

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

```bash
DATABASE_URL=jdbc:postgresql://localhost:5433/chartsol
DATABASE_USER=postgres
DATABASE_PASSWORD=0218
CHARTSDK_EMBED_JWT_SECRET=dev-chartsol-embed-secret-change-me
NEXT_PUBLIC_API_BASE=http://localhost:8080
NEXT_PUBLIC_ENABLE_MSW=false
```

임베드 SDK가 호출하는 차트 데이터 API는 `GET /api/v1/charts/data?chartId={id}`이다. 상세 계약은 [`docs/임베드_API명세서.md`](docs/임베드_API명세서.md)를 따른다. 운영 배포에서는 `CHARTSDK_EMBED_JWT_SECRET`을 강한 랜덤 값으로 교체해야 한다.
