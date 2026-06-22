# DB 스키마 ↔ UI 요소 전수 매핑

**문서 버전:** v1.1 (2026-06-18 · 2026-06-19 갱신: 1인 1활성 토큰 모델 — `label` 제거)
**관련:** Flyway `V1__init.sql` v4.1 · PRD v1.6(9장) · API v1.4 · 화면설계서 v2.4 · `chart-options/optionRegistry.ts`
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
mc_user 1───1 mc_user_token        (1인 1활성 토큰. 회수 시 is_active=false, 사용자 삭제 시 CASCADE)
mc_user 1───∞ mc_chart (owner_id)  (사용자 삭제 시 SET NULL)
mc_datasource 1───∞ mc_chart        (사용 중 소스 삭제 RESTRICT → API 409)
mc_chart 1───1 mc_chart_cache       (차트 삭제 시 CASCADE)
```

| 테이블 | 역할 | 핵심 컬럼 |
|---|---|---|
| `mc_user` | 사용자(인증 선행 구조) | username, password_hash, display_name, role, is_active |
| `mc_user_token` | 사용자 귀속 임베드 토큰(1인 1활성) | id(=JWT jti), user_id, token(원문), expires_at, is_active |
| `mc_datasource` | 다중 PostgreSQL 연결 | name, host, port, database_name, db_user, db_password_enc, max_pool_size, **last_tested_at/last_test_ok** |
| `mc_chart` | 차트 정의 | name, description, datasource_id, define_mode, sql_query, **builder_config**(🧩), chart_type, **options**(🧩), owner_id, refresh_mode, cache_ttl_seconds |
| `mc_chart_cache` | 결과 캐시(대용량 대응) | chart_id(PK), result, computed_at, elapsed_ms, row_count, **thumbnail**, last_error/at |

**v4 신규(굵게)**: `mc_datasource.last_tested_at/last_test_ok`(S5 상태 점 영속), `mc_chart_cache.thumbnail`(S1 썸네일), `chart_type` CHECK 4종(bar/line/pie/scatter), 목록 정렬·검색 인덱스.
**v4.1(2026-06-19)**: 1인 1활성 토큰 모델 확정 — `mc_user_token.label` 제거(다중 토큰 식별 불필요), 활성 토큰 부분 유니크 인덱스(`user_id WHERE is_active`).

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
| 검색 입력(이름·설명) | ⏳→📦 | 쿼리 파라미터 `q` → 대상 `mc_chart.name`·`description` (ILIKE) |
| 카드 썸네일 | 📦/⏳ | `mc_chart_cache.thumbnail`(후속) / MVP는 차트종류 일러스트(⏳) |
| 차트명 | 📦 | `mc_chart.name` |
| 설명(1줄) | 📦 | `mc_chart.description` (nullable) |
| 종류 뱃지(막대/선/…) | 📦 | `mc_chart.chart_type` |
| 차트 ID(#12) | 📦 | `mc_chart.id` |
| 수정일 | 📦 | `mc_chart.updated_at` (정렬: idx DESC) |
| 소유자(인증 후) | 🔁 | `mc_chart.owner_id` → `mc_user` |
| 편집/임베드 버튼 | ⚙️ | 화면 전환 |
| 삭제 | ⚙️ | `DELETE mc_chart` (cache CASCADE) |
| 복제(2차) | ⚙️ | `INSERT mc_chart` + 캐시 시드 |
| 빈 상태 | 🔁 | `count(*)=0` |

### S2 · 차트 편집 — 헤더·정의
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 차트명 입력 | 📦 | `mc_chart.name` |
| #id | 📦 | `mc_chart.id` (신규는 미표시) |
| 저장/임베드 버튼 | ⚙️ | `INSERT/UPDATE` + 캐시 시드(7.7) |
| 정의 모드 탭(노코드/SQL) | 📦 | `mc_chart.define_mode` |
| 미저장 이탈 모달 | ⏳ | 클라 dirty 상태 |

### S2 좌측 · 데이터소스·스키마
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 데이터소스 셀렉트 | 📦 | `mc_chart.datasource_id` (목록=🔁 `mc_datasource`) |
| 스키마 트리(테이블·컬럼·타입) | ⏳ | `information_schema` 라이브 조회 — **저장 안 함** |
| 테이블/컬럼 검색 | ⏳ | 클라 필터 |
| 소스변경확인 모달 | ⏳ | 클라 상태 |

### S2 중앙 · 노코드 구성 → `builder_config` (🧩)
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 테이블 | 🧩 | `builder_config.table` |
| X축 컬럼 | 🧩 | `builder_config.xAxis` |
| 묶기(일/주/월) | 🧩 | `builder_config.xAxisBucket` |
| Y축 컬럼+집계(복수) | 🧩 | `builder_config.yAxis[]` (column, agg, alias) |
| 시리즈 나누기(후속) | 🧩 | `builder_config.seriesBy` |
| 조건 행(WHERE, 복수) | 🧩 | `builder_config.where[]` (column, op, value) |
| 정렬(데이터) | 🧩 | `builder_config.orderBy` (target, direction) |
| 행 제한 | 🧩 | `builder_config.limit` |
| 생성된 SQL 보기 | 📦 | `mc_chart.sql_query` (builder에서 서버 재생성) |
| [실행 결과] 탭(집계) | ⏳/🔁 | 미리보기=⏳(run-builder) / 저장 차트=🔁 `mc_chart_cache.result` |
| [원본 데이터] 탭(raw) | ⏳ | run-builder `mode:rows` / schema preview — 저장 안 함 |
| 실행 메타 "N행·Nms" | 🔁 | `mc_chart_cache.row_count`·`elapsed_ms` (또는 ⏳ 미리보기) |

> **정렬 2종 구분**: `builder_config.orderBy`(SQL ORDER BY, 데이터 정렬) ≠ `options.sortOrder`(변환기 시리즈 표시 정렬). 둘 다 보존.

### S2 우측 · 옵션 패널(3존) → `options` (🧩) + 일부 컬럼
미리보기 차트 = ⏳(변환기 산출, 임베드는 캐시 경유). 옵션은 `optionRegistry.ts`와 1:1.

| 존 | UI 요소 | 저장 | 위치 |
|---|---|---|---|
| 공통 | 대분류 | 📦 | `mc_chart.chart_type` |
| 공통 | 중분류(variant) | 🧩 | `options.variant` |
| 공통 | 제목·가로/세로 위치 | 🧩 | `options.title`·`titleH`·`titleV` |
| 공통 | 설명 | 📦 | `mc_chart.description` (option 미반영) |
| 공통 | 색 모드·팔레트·개별색 | 🧩 | `options.colorMode`·`palette`·`colorMap` |
| 공통 | 범례 표시·위치·스크롤 | 🧩 | `options.legend.{show,position,scroll}` |
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

### S3 · 임베드 코드(모달)
| UI 요소 | 저장 | 위치 |
|---|---|---|
| 사용자 토큰 셀렉트(활성) | 🔁 | `mc_user_token` where is_active·미만료 (표시: 사용자·expires_at). 1인 1활성이라 사실상 단일 |
| 스니펫(chart-id + token) | 🔁 | `mc_chart.id` + `mc_user_token.token` 조립 |
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
| 상태(활성/만료/회수됨) | 🔁 | `is_active` + (`expires_at` vs now) 파생 |
| 발급/회수 | ⚙️ | `INSERT` / `UPDATE is_active=false` (발급 = 기존 활성 토큰 회수 후 새 행. 1인 1활성) |
| 새 사용자 인라인 생성 | ⚙️ | `INSERT mc_user`(username, display_name) |
| 회수 확인 모달 | ⏳ | 클라 상태 |

---

## 3. 의도적 미저장(⏳) 목록 — "누락 아님"

다음은 설계상 **저장하지 않는다**(영속화하면 오히려 정합성 깨짐):
- 스키마 트리(테이블·컬럼) — `information_schema` 라이브가 진실. 캐시하면 운영 DB 스키마 변경과 어긋남.
- 미리보기 실행 결과/원본 데이터 — 저장 대상은 "저장된 차트의 캐시"(`mc_chart_cache`)뿐. 빌더 실험 실행은 휘발.
- 로그인 세션 — JWT(무상태). 토큰 검증은 `mc_user_token` PK 조회로 충분.
- 모든 모달·탭·dirty·로딩 상태 — 클라이언트 UI 상태.
- ECharts option / 임베드 스니펫 — 컬럼 값에서 서버가 매 요청 조립(파생).

---

## 4. JSONB 계약 (블랙박스 방지)

JSONB라도 키는 코드 레지스트리로 고정된다 — 임의 키가 아니다.
- `mc_chart.options` ↔ `chart-options/optionRegistry.ts` (`OptionDef.key`) ↔ PRD 9.2. 변환 규칙은 `docs/변환기_매핑스펙_차트옵션.md`.
- `mc_chart.builder_config` ↔ `docs/노코드_SQL생성규칙.md` 2장 스키마. 검증은 생성규칙 9장.
- 검증: 두 JSONB는 **서버에서 화이트리스트 검증 후 저장**(임의 식별자·옵션 차단). DB CHECK가 아니라 애플리케이션 계층 책임(JSONB라 DB CHECK 부적합).

## 5. 인덱스 (실제 쿼리 패턴 기준)

| 인덱스 | 쿼리 |
|---|---|
| `mc_chart(updated_at DESC)` | S1 목록 기본 정렬 |
| `mc_chart(datasource_id)` | 소스 삭제 시 사용 차트 카운트(409) |
| `mc_user_token(user_id) WHERE is_active` (부분 유니크) | 1인 1활성 토큰 강제 + S3 활성 토큰 조회 |
| `mc_user_token(user_id)` | S7 사용자별 토큰 이력 목록(회수·만료 포함) |
| PK `mc_user_token.id` | 임베드 토큰 검증(jti 단건) |
| PK `mc_chart_cache.chart_id` | 임베드 캐시 조회 |
| (선택) `mc_chart` 컬럼별 trigram GIN (name, description 각각) | S1 이름·설명 ILIKE 검색 — `col ILIKE ?`는 컬럼별 인덱스라야 사용(연결식 표현 인덱스는 OR에 안 걸림). 데이터 증가 시 pg_trgm 활성 |

JSONB(`options`·`builder_config`)는 내용 조회·필터가 없어 **인덱스 불필요**.
