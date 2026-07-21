# DB 스키마 ↔ UI 요소 전수 매핑

**문서 버전:** v2.6 (2026-07-21 갱신: 데이터소스 이름 기반 URL)
**관련:** Flyway `V1~V4` · PRD v3.1(9장) · API v3.2 · 화면설계서 v3.5 · 다중데이터소스_페더레이션_설계 · `chart-options/optionRegistry.ts`
**목적:** 모든 화면의 모든 UI 요소가 DB의 어디에 사는지 1:1로 매핑해 **누락 0**을 보장한다.

---

## 0. 설계 원칙 (하이브리드)

20년차 관점의 결론: **정규화 컬럼 + JSONB 하이브리드**가 이 도메인의 정답이다.

- **정규화 컬럼** — 엔티티(차트·사용자·토큰·데이터소스), 관계(FK), **조회·정렬·필터·제약 대상** 필드. DB가 보장해야 할 무결성·인덱스 대상.
- **JSONB** — 끝없이 늘어나는 **시각화 옵션(`options`)** 과 **노코드 빌더 구성(`builder_config`)**. 옵션 1개 추가 = 마이그레이션 0 (Metabase·Grafana·Superset 동일 전략). 내용으로 조회·필터하지 않으므로 JSONB GIN 인덱스 불필요.
- **파생/일시** — 저장하지 않는 것을 명시적으로 구분한다("누락"이 아니라 "의도적 미저장").

### 저장 분류 기호
| 기호 | 의미 |
|---|---|
| 📦 | 정규화 컬럼 (테이블.컬럼) |
| 🧩 | JSONB 키 (`options` / `builder_config`) |
| 🔁 | 파생값 (조인·집계·계산 — 저장 안 함) |
| ⏳ | 일시 상태 (세션·실행결과·UI 토글 — 저장 안 함, 의도적) |
| ⚙️ | 액션 (행 INSERT/UPDATE/DELETE 트리거) |

---

## 1. 테이블 5개 (관계)

```
mc_user 1───1 mc_user_token          (1인 1활성 토큰. 회수 시 is_active=false, 사용자 삭제 시 CASCADE)
mc_user 1───∞ mc_datasource          (개인 사용자가 연결 정보를 등록, 사용자 삭제 RESTRICT — 비활성화 우선)
mc_user 1───∞ mc_chart (owner_id)    (개인 사용자 소유 차트, 사용자 삭제 RESTRICT — 비활성화 우선)
mc_datasource 1───∞ mc_chart         (사용 중 소스 삭제 RESTRICT → API 409)
mc_chart 1───1 mc_chart_cache        (차트 삭제 시 CASCADE)
```

| 테이블 | 역할 | 핵심 컬럼 |
|---|---|---|
| `mc_user` | 사용자(개인 스코프의 소유자) | username, password_hash, display_name, role, is_active |
| `mc_user_token` | 사용자 귀속 임베드 토큰(1인 1활성) | id(=JWT jti), user_id, token(원문), expires_at, is_active, **revoked_at/revoked_reason** |
| `mc_datasource` | 개인 사용자별 PostgreSQL 연결 | owner_id, name, host, port, database_name, db_user, db_password_enc, max_pool_size, **last_tested_at/last_test_ok** |
| `mc_chart` | 개인 사용자별 차트 정의 | owner_id, name, description, datasource_id, define_mode, sql_query, **builder_config**(🧩), chart_type, **options**(🧩), refresh_mode, cache_ttl_seconds |
| `mc_chart_cache` | 결과 캐시(대용량 대응) | chart_id(PK), result, computed_at, elapsed_ms, row_count, **thumbnail**, last_error/at |

**v4 신규(굵게)**: `mc_datasource.last_tested_at/last_test_ok`(S5 상태 점 영속), `mc_chart_cache.thumbnail`(S1 썸네일), `chart_type` CHECK 4종(bar/line/pie/scatter), 목록 정렬·검색 인덱스.
**v4.1(2026-06-19)**: 1인 1활성 토큰 모델 확정 — `mc_user_token.label` 제거(다중 토큰 식별 불필요), 활성 토큰 부분 유니크 인덱스(`user_id WHERE is_active`).
**v5.0(2026-06-23)**: 개인 사용자 스코프 확정. `mc_datasource.owner_id`, `mc_chart.owner_id`로 소유 범위를 두고, 차트가 다른 사용자의 데이터소스를 참조하지 못하도록 `(datasource_id, owner_id)` 복합 FK를 둔다. 사용자별 unique(`mc_datasource(owner_id, name)`), `updated_at` DB 트리거, `pg_trgm` GIN 검색 인덱스 활성화.
**v5.1(2026-06-29, 스키마 변경 없음)**: 원본값 튜플 모드는 `builder_config.yAxis[].agg = "none"`으로 JSONB에 저장한다. `mc_chart.sql_query`는 저장 시 서버가 재생성한 GROUP BY 없는 SQL을 보관하므로 별도 컬럼·마이그레이션이 필요 없다.

---

## 2. 화면별 전수 매핑

### 공통 · 상단 바(GNB)
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 로고·솔루션명 | ⏳ | 앱 상수 |
| 데이터소스/토큰 관리 링크 | ⏳ | 내비(정적) |
| 사용자 아바타(인증 후) | 🔁 | `mc_user.display_name` |

### S1 · 차트 목록
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 검색 입력(이름·설명) | ⏳→📦 | 쿼리 파라미터 `q` → 대상 `mc_chart.name`·`description` (사용자 범위 `owner_id` + ILIKE, pg_trgm GIN) |
| 종류 필터(막대/선/원형/분포) | ⏳→📦 | 쿼리 파라미터 `type` → `mc_chart.chart_type` (owner 범위 내 필터) |
| 데이터소스 필터 | ⏳→📦 | 쿼리 파라미터 `datasourceId` → `mc_chart_datasource` 존재 여부. 기준 관계와 조인 보조 소스를 모두 포함 |
| 정렬(수정일·이름) | ⏳→📦 | 쿼리 파라미터 `sort` → `mc_chart.updated_at`·`name` (기본 updated_at DESC, idx_mc_chart_owner_updated) |
| 카드 썸네일 | 📦/⏳ | `mc_chart_cache.thumbnail`(후속) / MVP는 차트종류 일러스트(⏳) |
| 차트명 | 📦 | `mc_chart.name` |
| 설명(1줄) | 📦 | `mc_chart.description` (nullable) |
| 종류 뱃지(막대/선/…) | 📦 | `mc_chart.chart_type` |
| 차트 ID(#12) | 📦 | `mc_chart.id` |
| 개인 소유 범위 | 📦/🔁 | `mc_chart.owner_id` (인증 컨텍스트에서 자동 주입, UI 직접 입력 없음) |
| 수정일 | 📦 | `mc_chart.updated_at` (정렬: idx DESC) |
| 소유자(인증 후) | 📦/🔁 | `mc_chart.owner_id` → `mc_user` |
| 편집/임베드 버튼 | ⚙️ | 화면 전환 |
| 데이터 탐색·편집 URL | 🔁 | `mc_datasource.name` + `mc_chart.builder_config.table` → `/data/{datasourceName}/{schema}/{relation}/{chartId}`. 내부 실행·관계 키는 계속 `datasourceId`, 데이터소스 차트 범위는 `mc_chart_datasource`; 별도 컬럼·마이그레이션 없음 |
| 삭제 | ⚙️ | `DELETE mc_chart` (cache CASCADE) |
| 복제(2차) | ⚙️ | `INSERT mc_chart` + 캐시 시드 |
| 빈 상태 | 🔁 | `count(*)=0` |

### S2 · 차트 편집 — 헤더·정의
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 차트명 입력 | 📦 | `mc_chart.name` |
| #id | 📦 | `mc_chart.id` (신규는 미표시) |
| 저장/임베드 버튼 | ⚙️ | `INSERT/UPDATE` + 캐시 시드(7.7) |
| 노코드 구성 내부 정의 모드 탭(노코드/SQL) | 📦 | `mc_chart.define_mode` |
| 미저장 이탈 모달 | ⏳ | 클라 dirty 상태 |

### S2 좌측 · 데이터소스·스키마
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 데이터소스 셀렉트 | 📦 | `mc_chart.datasource_id` (목록=🔁 현재 사용자 소유 `mc_datasource`) |
| 스키마 트리(관계·컬럼·타입) | ⏳ | `pg_catalog` 라이브 조회 — **저장 안 함**. TABLE·VIEW·MATERIALIZED VIEW의 `relationType`, 물리화 뷰 `populated`, 물리 관계 `estimatedRowCount`를 API에서 파생한다. 시스템 스키마·`mc_` 제외, `public` 외 사용자 스키마는 배지로 구분(식별자 `"schema.name"` 한정) |
| 테이블/컬럼 검색 | ⏳ | 클라 필터 |
| 소스변경확인 모달 | ⏳ | 클라 상태 |

### S2 중앙 · 노코드 구성 → `builder_config` (🧩)
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 원본 관계(base) | 🧩 | `builder_config.table` — TABLE·VIEW·MATERIALIZED VIEW를 같은 구조로 저장. 관계 종류·갱신 상태는 실행 시 카탈로그에서 다시 확인 |
| 테이블 조인(복수) | 🧩 | `builder_config.joins[]` (table, type=inner/left, on) — 생성규칙 11장. 조인 시 컬럼은 qualified |
| X축 컬럼 | 🧩 | `builder_config.xAxis` (조인 시 `"테이블.컬럼"`) |
| 묶기(일/주/월) | 🧩 | `builder_config.xAxisBucket` |
| Y축 컬럼+집계(복수) | 🧩 | `builder_config.yAxis[]` (column, agg, alias). `agg="none"`이면 모든 차트 타입의 원본값 튜플 모드 |
| 시리즈 나누기(후속) | 🧩 | `builder_config.seriesBy` |
| 조건 행(WHERE, 복수) | 🧩 | `builder_config.where[]` (column, op, value) |
| 정렬(데이터) | 🧩 | `builder_config.orderBy` (target, direction) |
| 행 제한 | 🧩 | `builder_config.limit` |
| 표본 추출(토글+자동/갯수+다시 뽑기) | 🧩 | `builder_config.sample={mode,size?,method?,rate?,seed}`. 물리 테이블은 INDEX_RANDOM/SYSTEM/FULL_SCAN, VIEW·JOIN+WHERE 결과는 RESULT_RANDOM. sampling v6 실행 통계·집계별 의미·그룹별 신뢰구간은 캐시 result JSONB에 저장한다. `agg="none"`과 동시 저장/실행만 금지하며 JOIN과는 함께 저장한다. JSONB라 스키마 마이그레이션 없음 |
| 지도 포인트 좌표 방식 | 🧩 | `builder_config.geoPoint={mode:"columns"}` 또는 `{mode:"spatial",spatialColumn,sizeColumn?}`. 공간 타입은 pg_catalog에서 파생하고 좌표값은 실행 시 변환하므로 별도 DB 컬럼·마이그레이션 없음 |
| 생성된 SQL 보기 | 📦 | `mc_chart.sql_query` (builder에서 서버 재생성·리터럴화, 빈 문자열 DB CHECK 차단) |
| [실행 결과] 탭(집계) | ⏳/🔁 | 미리보기=⏳(run-builder) / 저장 차트=🔁 `mc_chart_cache.result`; sample 설정이 있으면 sampling v6(스펙 `mode/requestedMethod/rate?/sizeTarget?/seed` + 실행 `method/valueMode/sampleSize/sampledRowCount/groups/estimates[].treatment/intervals/warnings`) 보존. 캐시 스키마는 JSONB라 DDL 변경 없음 |
| [원본 데이터] 탭(raw) | ⏳ | 기준 관계 클릭=schema preview, 구성 변경 후 탭 열기=run-builder `mode:rows` 지연 호출. [실행]과 동시 중복 조회하지 않으며 저장 안 함 |
| 실행 메타 "N행·Nms" | 🔁 | `mc_chart_cache.row_count`·`elapsed_ms` (또는 ⏳ 미리보기) |

> **정렬 2종 구분**: `builder_config.orderBy`(SQL ORDER BY, 데이터 정렬) ≠ `options.sortOrder`(변환기 시리즈 표시 정렬). 둘 다 보존.

### S2 우측 · 옵션 패널(3존) → `options` (🧩) + 일부 컬럼
미리보기 차트 = ⏳(변환기 산출, 임베드는 캐시 경유). 옵션은 `optionRegistry.ts`와 1:1.

| 존 | UI 요소 | 저장 | 위치 |
|---|---|---|---|
| 공통 | 대분류 | 📦 | `mc_chart.chart_type` |
| 공통 | 중분류(variant) | 🧩 | `options.variant` |
| 공통 | 제목·가로/세로 위치 | 🧩 | `options.title`·`titleH`·`titleV` |
| 공통 | 논리 설계 크기 | 🧩 | `options.display.{preset,width,height}`. preset은 small/standard/large/hd/fhd/custom이며 실제 임베드 DOM 크기를 강제하지 않음 |
| 공통 | 글꼴 모드·배율·요소별 크기 | 🧩 | `options.typography.{mode,scale,titleFontSize,legendFontSize,axisFontSize,dataLabelFontSize,tooltipFontSize}` |
| 공통 | 설명 | 📦 | `mc_chart.description` (option 미반영) |
| 공통 | 색 모드·팔레트·개별색 | 🧩 | `options.colorMode`·`palette`·`colorMap` |
| 공통 | 범례 표시·위치·스크롤 | 🧩 | `options.legend.{show,position,scroll}` (`scroll`은 좌·우 전용, 상·하는 변환기가 한 줄 scroll 자동 적용) |
| 공통 | 툴팁 트리거·값포맷·축지시선 | 🧩 | `options.tooltip.{trigger,valueFormat,axisPointer}` |
| 공통 | 데이터 라벨·라벨위치·정렬 | 🧩 | `options.dataLabel`·`labelPosition`·`sortOrder` |
| 공통 | 갱신 모드 | 📦 | `mc_chart.refresh_mode` |
| 공통 | 주기(TTL) | 📦 | `mc_chart.cache_ttl_seconds` |
| 공통 | 지금 갱신 | ⚙️ | `POST /charts/{id}/refresh` → 캐시 갱신 |
| 공통 | 기준시각 표시 | 🧩 | `options.showComputedAt` |
| 축 | 여백 잘림방지·프리셋 | 🧩 | `options.grid.{containLabel,preset}` |
| 축 | X축 제목·회전·격자선·범위·스케일 | 🧩 | `options.xAxis.{title,rotate,splitLine,min,max,scale}` |
| 축 | Y축 제목·단위·포맷·범위·스케일·격자선·2번째축 | 🧩 | `options.yAxis.{title,unit,format,rangeMode,min,max,scale,splitLine,secondAxis}` |
| 전용 | 막대 너비·간격·둥근모서리·100%정규화·배경막대 | 🧩 | `options.bar.*` |
| 전용 | 선 굵기·종류·점·결측연결·영역투명도 | 🧩 | `options.line.*` |
| 전용 | 원형 도넛두께·라벨위치·시작각·최소각 | 🧩 | `options.pie.*` |
| 전용 | 분포 점모양·크기·버블컬럼 | 🧩 | `options.scatter.*` |
| 후속 | 확장예약(markLine·dataZoom·toolbox·visualMap·그라데이션) | 🧩 | 구현 시 `options`에 키 추가(마이그레이션 0) |

> **편집기 전용 로컬 상태:** 데이터 패널 접힘, 노코드 구성·결과 접힘, 시각화 옵션 접힘, 좌·우 폭, 결과·옵션 높이는 브라우저 `localStorage`에만 저장한다. 화면 맞춤/너비 맞춤/100%·zoom과 전체 화면 포커스 상태도 `mc_chart`나 API에 저장하지 않는다. 반면 `options.display`는 자동 글꼴·레이아웃의 설계 기준이므로 차트 정의에 저장한다.

### S3 · 임베드 코드(모달)
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 사용자 토큰 셀렉트(활성) | 🔁 | `mc_user_token` where is_active·미만료 (표시: 사용자·expires_at). 1인 1활성이라 사실상 단일 |
| 스니펫(chart-id + token + API base) | 🔁 | `mc_chart.id` + `mc_user_token.token` + 배포 환경의 `NEXT_PUBLIC_API_BASE` 조립. SDK 자산은 `NEXT_PUBLIC_SDK_SRC` 또는 Admin `/sdk.js` |
| 복사 | ⚙️ | 클립보드 |
| 토큰 없음 상태 | 🔁 | 활성 토큰 count=0 |

### S4 · 임베드 렌더(런타임)
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 차트(ECharts option) | 🔁 | 변환기 산출 (캐시 `result` 경유) |
| "데이터 기준 {시각}" 캡션 | 📦 | `mc_chart_cache.computed_at` + `options.showComputedAt` |
| 로딩/에러 상태 | ⏳ | 런타임 |

### S5 · 데이터소스 관리
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 이름/호스트/포트/DB명/계정 | 📦 | `mc_datasource.{name,host,port,database_name,db_user}` |
| 개인 소유 범위 | 📦/🔁 | `mc_datasource.owner_id` (인증 컨텍스트에서 자동 주입, 이름 유니크는 `(owner_id, name)`) |
| 비밀번호 | 📦 | `mc_datasource.db_password_enc` (AES-GCM, 응답 미포함) |
| 상태 점(연결됨/실패) | 📦 | `mc_datasource.last_test_ok`·`last_tested_at` (신규) |
| 연결 테스트 | ⚙️ | 테스트 후 `last_test_*` 기록 |
| 커넥션 상한(고급 설정) | 📦 | `mc_datasource.max_pool_size` |
| 수정/삭제 | ⚙️ | `UPDATE`(비번 전달 시만 갱신) / `DELETE`(RESTRICT→409) |
| 사용 중 차트 N개 경고 | 🔁 | `count mc_chart by datasource_id` |
| 빈 상태 | 🔁 | count=0 |

### S6 · 로그인(임시 골격)
| UI 요소 | 저장 | 위치 |
|---|---|---|
| ID/PW | 📦 | `mc_user.username`·`password_hash` (SSO 전환 시 password_hash 미사용) |
| 세션 | ⏳ | JWT (저장 안 함) |
| 실패 메시지 | ⏳ | 런타임 |

### S7 · 토큰 관리
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 사용자 | 📦 | `mc_user.username`·`display_name` |
| 토큰 미리보기 | 📦/🔁 | `mc_user_token.token` (앞부분만 표시) |
| 발급일 | 📦 | `mc_user_token.created_at` |
| 만료 | 📦 | `mc_user_token.expires_at` |
| 상태(활성/만료/회수됨) | 🔁/📦 | `is_active`·`revoked_reason` + (`expires_at` vs now) 파생. 회수됨=`is_active=false`(+`revoked_at`), 만료=`expires_at<now` |
| 발급/회수 | ⚙️ | 발급=한 트랜잭션으로 `UPDATE is_active=false, revoked_at=now(), revoked_reason='ROTATED'`(기존 활성) + 새 행 `INSERT`. 수동 회수=`'MANUAL'`. 1인 1활성 |
| 새 사용자 인라인 생성 | ⚙️ | `INSERT mc_user`(username, display_name) |
| 회수 확인 모달 | ⏳ | 클라 상태 |

---

## 3. 의도적 미저장(⏳) 목록 — "누락 아님"

다음은 설계상 **저장하지 않는다**(영속화하면 오히려 정합성 깨짐):
- 스키마 트리(관계·컬럼) — `pg_catalog` 라이브가 진실. 캐시하면 운영 DB 스키마·물리화 뷰 갱신 상태 변경과 어긋남.
- 미리보기 실행 결과/원본 데이터 — 저장 대상은 "저장된 차트의 캐시"(`mc_chart_cache`)뿐. 빌더 실험 실행은 휘발.
- 로그인 세션 — JWT(무상태). 토큰 검증은 `mc_user_token` PK 조회로 충분.
- 모든 모달·탭·dirty·로딩 상태 — 클라이언트 UI 상태.
- ECharts option / 임베드 스니펫 — 컬럼 값에서 서버가 매 요청 조립(파생).

---

## 4. JSONB 계약 (블랙박스 방지)

JSONB라도 키는 코드 레지스트리로 고정된다 — 임의 키가 아니다.
- `mc_chart.options` ↔ `chart-options/optionRegistry.ts` (`OptionDef.key`) ↔ PRD 9.2. 변환 규칙은 `docs/변환기_매핑스펙_차트옵션.md`.
- `mc_chart.builder_config` ↔ `docs/노코드_SQL생성규칙.md` 2장 스키마. 검증은 생성규칙 9장.
- 검증: 두 JSONB는 **서버에서 화이트리스트 검증 후 저장**(임의 식별자·옵션 차단). `agg="none" + sample`, `agg="none" + 집계 혼합` 금지는 DB CHECK가 아니라 애플리케이션 계층 책임(JSONB라 DB CHECK 부적합). `joins[] + sample`은 sampling v6 RESULT_RANDOM의 정상 조합이다.

## 5. 인덱스 (실제 쿼리 패턴 기준)

| 인덱스 | 쿼리 |
|---|---|
| `mc_chart(owner_id, updated_at DESC)` | 사용자 범위 S1 목록 기본 정렬 |
| `mc_chart(datasource_id)` | 소스 삭제 RESTRICT 체크 · 사용 차트 카운트(409). FK 체크는 `WHERE datasource_id=?` 라 단독 인덱스(owner 선두 복합은 미사용) |
| `mc_user_token(user_id) WHERE is_active` (부분 유니크) | 1인 1활성 토큰 강제 + S3 활성 토큰 조회 |
| `mc_user_token(user_id)` | S7 사용자별 토큰 이력 목록(회수·만료 포함) |
| PK `mc_user_token.id` | 임베드 토큰 검증(jti 단건) |
| PK `mc_chart_cache.chart_id` | 임베드 캐시 조회 |
| `mc_chart.name` trigram GIN | S1 이름 ILIKE 검색 |
| `mc_chart.description` trigram GIN | S1 설명 ILIKE 검색 |
| `mc_user(username)` | 사용자명 중복 방지 |
| `mc_datasource(owner_id, name)` | 사용자별 데이터소스 표시명 중복 방지 |

JSONB(`options`·`builder_config`)는 내용 조회·필터가 없어 **인덱스 불필요**.
