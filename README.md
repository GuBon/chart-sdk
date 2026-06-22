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
