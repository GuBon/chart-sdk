# 차트 솔루션 API 계약서 (API Contract)

**문서 버전:** v1.6 — v1.5 + 모든 차트 타입의 `agg:"none"` 원본값 튜플 모드, DTO 검증, 저장 시 서버 SQL 재생성 명시
**관련 문서:** PRD v1.8, 화면설계서 v2.5, 노코드 SQL 생성규칙 v1.5
**범위:** MVP. 인증(로그인)은 제외하되, 임베드 토큰 검증은 포함한다.
**Base URL:** `/api/v1`

---

## 0. 공통 규약

- 요청/응답 본문은 JSON, UTF-8.
- 시간은 ISO 8601 (`2026-06-10T12:00:00Z`).
- 에러 응답은 모든 엔드포인트에서 동일한 형태를 쓴다. 서버는 DTO + Bean Validation으로 요청 본문을 검증하고, `ApiExceptionHandler`가 검증 실패·JSON 파싱 실패·DB 무결성 오류·예상 밖 오류를 아래 공통 envelope으로 변환한다.
- 모든 Admin API는 인증 컨텍스트의 `userId`로 자동 스코프한다. 클라이언트는 `ownerId`를 보내지 않는다. 응답에도 기본적으로 `ownerId`를 노출하지 않는다.
- 임베드 API는 토큰의 `userId`를 기준으로 차트를 조회한다. 유효 토큰이어도 다른 사용자의 `chartId`는 404처럼 취급한다.

### 공통 에러 형식

```json
{
  "error": {
    "code": "CHART_NOT_FOUND",
    "message": "차트를 찾을 수 없습니다."
  }
}
```

| HTTP | code | 상황 |
|---|---|---|
| 400 | INVALID_REQUEST | 파라미터 누락/형식 오류 |
| 400 | SQL_NOT_SELECT | SELECT 외 구문 |
| 400 | INVALID_IDENTIFIER · AGG_TYPE_MISMATCH · OP_TYPE_MISMATCH · VALUE_PARSE_ERROR · BUCKET_TYPE_MISMATCH | 노코드 builderConfig 검증 실패 (2A장, 생성규칙 9장) |
| 401 | TOKEN_INVALID | 토큰 서명 불일치/형식 오류 |
| 401 | TOKEN_EXPIRED | 토큰 만료 |
| 401 | TOKEN_REVOKED | 회수된 토큰 (is_active=false) |
| 404 | CHART_NOT_FOUND | 존재하지 않거나 현재 사용자 범위 밖의 chartId |
| 408 | QUERY_TIMEOUT | SQL 실행 타임아웃 |
| 422 | SQL_ERROR | SQL 실행 에러 (DB 에러 메시지 동봉) |
| 500 | INTERNAL_ERROR | 서버 오류 |

---

## 1. 임베드 데이터 조회 (sdk.js → Backend) — 핵심

인수인계서 4페이지의 엔드포인트. S4(임베드 렌더)가 사용한다.

```
GET /api/v1/charts/data?chartId={id}
Authorization: Bearer {임베드 토큰(JWT)}
```

### 처리 순서 (서버) — 사용자 토큰 기반

1. 토큰 서명 검증 → 실패 시 401 TOKEN_INVALID
2. 토큰 만료 검증 → 만료 시 401 TOKEN_EXPIRED
3. 페이로드의 `jti`(= mc_user_token.id)로 PK 단건 조회 → is_active 및 mc_user.is_active 확인 → 401 TOKEN_REVOKED
4. 토큰의 `userId`를 차트 조회 소유자 범위로 사용한다. 차트별 권한 체크는 없지만, 조회 범위는 해당 사용자 소유 차트로 제한한다.
5. mc_chart에서 `owner_id + chartId`로 sql_query + datasource_id + refresh_mode 조회 → 없으면 404
6. **캐시 확인 (PRD 7.7)**: `live`면 항상 실행 / `ttl`이면 mc_chart_cache의 computed_at + ttl 이내일 때 캐시 사용(만료 시 재계산 — 2차부터 stale-while-revalidate) / `manual`이면 항상 캐시 사용
7. (캐시 미스 시) 해당 데이터소스의 커넥션 풀에서 읽기 전용 실행 (타임아웃·행 제한) 후 캐시 갱신
8. 결과 + chart_type + options를 ECharts option JSON으로 조립해 반환 (방식 A) — `computedAt` 포함

JWT 페이로드: { "userId": 7, "jti": 42, "iat": ..., "exp": ..., "v": 1 } — 차트 정보 없음(jti = mc_user_token.id). TOKEN_CHART_MISMATCH 에러 코드는 폐기.

### 응답 200 — ECharts option 통째 (방식 A)

```json
{
  "chartId": 12,
  "computedAt": "2026-06-12T09:00:00Z",
  "option": {
    "xAxis": { "type": "category", "data": ["의류", "식품", "전자"], "name": "카테고리" },
    "yAxis": { "type": "value", "name": "매출" },
    "legend": { "show": true },
    "series": [
      { "type": "bar", "name": "매출", "data": [500, 300, 420], "itemStyle": { "color": "#5470c6" } }
    ]
  }
}
```

- sdk.js는 `option`을 그대로 `chart.setOption(res.option)` 한다. 클라이언트는 차트 모양을 결정하지 않는다.
- `chart_type`과 `options`(JSONB)의 값이 서버에서 option 조립 시 반영된다.

### 토큰 검증 구현 위치

토큰 검증(1~4)은 단일 필터/인터셉터에 모아 구현한다. 향후 인증 정책 확정 시 수정 지점을 한 곳으로 한정하기 위함이다.

---

## 2. SQL 실행 (Admin S2의 [실행])

차트 저장 전, 에디터의 SQL을 실험 실행한다. 결과는 저장하지 않는다.

```
POST /api/v1/query/run
Content-Type: application/json
```

### 요청

```json
{ "datasourceId": 1, "sql": "SELECT category, SUM(amount) AS total FROM sales GROUP BY category" }
```

### 처리 (서버)

1. SELECT 검증 (그 외 구문 → 400 SQL_NOT_SELECT)
2. 읽기 전용 계정으로 실행, 타임아웃(기본 10초), 행 제한(기본 1000행)
3. 컬럼 메타 + 행 데이터 반환

### 응답 200

```json
{
  "columns": [
    { "name": "category", "type": "varchar" },
    { "name": "total", "type": "numeric" }
  ],
  "rows": [
    ["의류", 500],
    ["식품", 300],
    ["전자", 420]
  ],
  "rowCount": 3,
  "truncated": false,
  "elapsedMs": 42
}
```

### 2A. 노코드 미리보기 실행 (MVP의 S2 [실행])

```
POST /api/v1/query/run-builder
{ "datasourceId": 1, "builderConfig": { ... }, "chartType": "bar", "options": { ... }, "mode": "aggregate" }
```
서버가 builderConfig를 검증(노코드 SQL 생성규칙 9·11장) → SQL+바인딩 생성 → 실행. 응답은 2번과 동일 형태 + "generatedSql" 필드(표시용 리터럴 사본) 포함.

`builderConfig.joins[]`(생성규칙 11장) 지정 시 다중 테이블 조인(`inner`/`left`, N개). 조인이 있으면 모든 컬럼 참조는 qualified `"테이블.컬럼"`. `sample` 과는 동시 사용 불가(11.4)이며, aggregate/rows 모드 모두 실행 전에 400 `INVALID_REQUEST` 로 거부한다. 앱은 조인 표본을 위해 고객 DB에 VIEW/MATERIALIZED VIEW를 생성하지 않는다.

`builderConfig.yAxis[].agg = "none"` 은 모든 차트 타입에서 지원되는 원본값 튜플 모드다. 이 모드에서는 SELECT가 X축 컬럼과 Y축 원본 컬럼을 그대로 반환하고 `GROUP BY`를 만들지 않는다. 막대/선은 `x,value`, 원형은 `name,value`, 분포는 `[x,y]`로 변환된다. 단 한 요청 안에서 `none`과 집계(`sum`/`avg` 등)를 섞을 수 없고, `sample`과도 함께 사용할 수 없다.

`mode` (선택, 기본 `"aggregate"`):
- `"aggregate"` — 집계 실행 (생성규칙 6장). S2 [실행] 버튼 → [실행 결과] 탭. `builderConfig.sample`(표본 추출, 3C) 지정 시 FROM에 TABLESAMPLE 주입 + 응답에 `approximate: true`·`sampleRate` 동봉(합계·개수는 외삽 보정). 표본은 **aggregate에서만** 적용.
- `"rows"` — 집계·GROUP BY 없이 `SELECT * + WHERE(조건 동일 바인딩) + LIMIT 1000` (생성규칙 3B장). S2 [원본 데이터] 탭 — 집계 이전의 세부 데이터 확인용. 자동 호출 허용(단순 조회). 표본 추출은 무시한다.
검증 실패는 400(INVALID_IDENTIFIER / AGG_TYPE_MISMATCH / OP_TYPE_MISMATCH / VALUE_PARSE_ERROR / BUCKET_TYPE_MISMATCH) — DB 에러를 노코드 사용자에게 노출하지 않는다.
2번(raw SQL 실행)은 2차 SQL 탭에서 사용한다.

**`mode:"aggregate"` 응답엔 `option`도 포함한다** — 서버가 `chartType`·`options`로 조립한 ECharts option(방식 A, 1번 임베드와 **동일한 단일 Java 변환기**). S2는 [실행 결과] 표를 `rows`로, **차트 미리보기는 `chart.setOption(option)`** 으로 그린다. 프론트는 option을 조립하지 않는다(TS/Java 이중 변환기 금지). 그래서 요청에 `chartType`·`options`를 함께 보낸다(위 본문).

### 응답 422 (SQL 에러 — 2차 SQL 탭에서 그대로 노출)

```json
{
  "error": {
    "code": "SQL_ERROR",
    "message": "column \"categ\" does not exist",
    "detail": "LINE 1: SELECT categ, SUM(amount)...",
    "position": 8
  }
}
```

### 2B. 옵션만 재조립 — 미리보기 (SQL 재실행 없음)

```
POST /api/v1/charts/preview
{ "chartType": "bar", "options": { ... }, "rows": { "columns": [...], "rows": [...] } }
```
응답 200: `{ "option": { ... } }` — 받은 `rows`에 `chartType`·`options`만 다시 적용해 ECharts option을 조립한다(**SQL 미실행**, 1·2A와 동일한 단일 Java 변환기). S2에서 **데이터에 영향 없는 옵션 변경**(색·범례·라벨·축 등) 시 호출 — 옵션 변경마다 집계 SQL을 재실행해 운영 DB를 때리지 않기 위함(PRD 7.7). `rows`는 직전 `run-builder` 결과를 클라이언트가 보관했다가 그대로 전달(≤1000행, 수십 KB). 클라이언트는 디바운스(약 150~250ms) 후 호출해 응답을 `setOption` 한다.
- 데이터 구성(테이블·축·조건·정렬·묶기)이 바뀌면 2B가 아니라 **2A `run-builder` 재호출**(rows 갱신 + option 재조립). `options.sortOrder`(표시 정렬)는 rows 재정렬만이라 2B로 충분하다.

---

## 3. 차트 CRUD (Admin)

### 3.1 목록 — S1

```
GET /api/v1/charts?q={검색어}&type={대분류}&datasourceId={id}&sort={정렬}
```

모든 파라미터는 선택이며, 항상 **현재 사용자 소유(`owner_id`) 범위**로 먼저 좁힌 뒤 적용한다.

| 파라미터 | 값 | 설명 |
|---|---|---|
| `q` | 문자열 | 이름·설명 부분일치(ILIKE). DB는 `pg_trgm` GIN 인덱스로 최적화 |
| `type` | `bar`\|`line`\|`pie`\|`scatter` | 대분류(`chart_type`) 필터. 미지정 시 전체 |
| `datasourceId` | 정수 | 데이터소스 필터. 미지정 시 전체 |
| `sort` | `updated_desc`(기본)\|`updated_asc`\|`name_asc`\|`name_desc` | 정렬 |

- 인덱스: `idx_mc_chart_owner_updated(owner_id, updated_at DESC)`가 owner 범위 + 기본 정렬을 담당한다. `type`·`datasourceId` 필터와 이름 정렬은 owner 범위가 개인 스코프라 소량이므로 인덱스 스캔 후 필터/정렬로 처리한다(전용 인덱스 불요).

응답 200:

```json
{
  "charts": [
    { "id": 12, "name": "월별 매출", "description": "영업부 매출을 월 단위로 집계", "chartType": "bar", "datasourceId": 2, "updatedAt": "2026-06-10T09:30:00Z" },
    { "id": 13, "name": "일별 방문자", "description": null, "chartType": "line", "datasourceId": 1, "updatedAt": "2026-06-09T14:00:00Z" }
  ]
}
```

### 3.2 단건 조회 — S2 진입

```
GET /api/v1/charts/{id}
```

응답 200:

```json
{
  "id": 12,
  "name": "월별 매출",
  "description": "영업부 매출을 월 단위로 집계",
  "datasourceId": 1,
  "defineMode": "builder",
  "sqlQuery": "SELECT category, SUM(amount) AS total FROM sales GROUP BY category",
  "builderConfig": { "table": "sales", "xAxis": "category", "xAxisBucket": null, "yAxis": [{ "column": "amount", "agg": "sum" }], "where": [], "orderBy": null, "sample": null },
  "chartType": "bar",
  "options": { "colorMode": "palette", "xAxis": { "title": "카테고리" }, "yAxis": { "title": "매출" }, "legend": { "show": true } },
  "refreshMode": "ttl",
  "cacheTtlSeconds": 3600,
  "createdAt": "2026-06-01T10:00:00Z",
  "updatedAt": "2026-06-10T09:30:00Z"
}
```

- S2 진입 시 이 응답으로 노코드 상태를 복원한다: `datasourceId`(소스 선택) + `builderConfig`(폼) + `chartType`/`options`(우측 패널). `description`은 nullable.
- `options` 키는 단일 레지스트리 `chart-options/optionRegistry.ts`(= PRD 9.2)를 따른다 — 중첩 점경로(`xAxis.title`·`yAxis.title`·`legend.show`·`legend.position` 등). 위 예시는 대표 키만 표기한 것이며, 누락 키는 레지스트리 기본값으로 채워진다(변환기 매핑 스펙 참조).

### 3.3 생성/수정 — S2 [저장]

```
POST /api/v1/charts          (생성)
PUT  /api/v1/charts/{id}     (수정)
```

요청:

```json
{
  "name": "월별 매출",
  "description": "영업부 매출을 월 단위로 집계",
  "datasourceId": 1,
  "defineMode": "builder",
  "sqlQuery": "SELECT category, SUM(amount) AS total FROM sales GROUP BY category",
  "builderConfig": { "table": "sales", "xAxis": "category", "xAxisBucket": null, "yAxis": [{ "column": "amount", "agg": "sum" }], "where": [], "orderBy": null, "sample": null },
  "chartType": "bar",
  "options": { "colorMode": "palette", "xAxis": { "title": "카테고리" }, "yAxis": { "title": "매출" }, "legend": { "show": true } },
  "refreshMode": "ttl",
  "cacheTtlSeconds": 3600
}
```

응답 201(생성)/200(수정): 3.2와 동일 형태. 저장 성공 시 서버는 쿼리를 1회 실행해 mc_chart_cache에 시드한다(PRD 7.7).

저장 시 서버가 최종 실행 SQL을 확정한다.
- `defineMode:"builder"`: 클라이언트가 보낸 `sqlQuery`는 신뢰하지 않는다. 서버가 `builderConfig`로 SQL을 다시 생성·검증·1회 실행한 뒤, 표시용 리터럴 SQL을 `mc_chart.sql_query`에 저장한다.
- `defineMode:"sql"`: `sqlQuery`는 SELECT/WITH 계열만 허용하고, 저장 전 1회 실행 검증을 통과해야 한다.

### 3.5 결과 캐시 수동 갱신 — S2 [지금 갱신] (2차)

```
POST /api/v1/charts/{id}/refresh
```

응답 200: `{ "chartId": 12, "computedAt": "...", "rowCount": 5, "elapsedMs": 42 }` — 즉시 재계산 후 캐시 갱신. manual 모드 차트의 데이터 갱신 수단.

### 3.6 차트 복제 — S1 카드 액션 (2차)

```
POST /api/v1/charts/{id}/duplicate
```

응답 201: 3.2와 동일 형태. 이름은 "{원본명} (사본)", 캐시는 원본 결과로 시드(재실행 없음). 임베드 chart-id는 새 id — 원본 임베드에 영향 없음.

### 3.4 삭제 — S1 삭제 확인

```
DELETE /api/v1/charts/{id}
```

응답 204. 사용자 토큰은 차트와 무관하므로 유지된다. 삭제된 chartId로의 임베드 요청은 404 CHART_NOT_FOUND — 임베드된 페이지에서 차트가 표시되지 않음(S1 모달에서 경고).

---

## 4. 사용자 임베드 토큰 (S7 토큰 관리)

### 4.1 발급
```
POST /api/v1/users/{userId}/tokens
```
요청(선택): { "expiresInDays": 365 }
응답 201: { "tokenId", "token", "userId", "expiresAt", "isActive": true }

- **1인 1활성 토큰**: 사용자당 활성 토큰은 최대 1개다(DB: `mc_user_token(user_id) WHERE is_active` 부분 유니크). 재발급 시 서버는 **기존 활성 토큰을 먼저 회수(is_active=false)한 뒤 새 행을 INSERT**한다 — 순서가 뒤집히면 부분 유니크 제약을 일시 위반한다. 회수·만료된 과거 행은 이력으로 보존된다.
- 토큰의 조회 범위는 해당 사용자 소유 차트 전체다. 차트별 권한은 MVP 범위 밖이다.

### 4.2 목록
```
GET /api/v1/tokens          (전체)  /  GET /api/v1/users/{userId}/tokens
```

### 4.3 회수
```
DELETE /api/v1/tokens/{tokenId}
```
응답 204. is_active=false. 해당 사용자의 모든 임베드가 무효화됨.

### 4.4 사용자 (인증 구현 전 수동 관리)
```
POST /api/v1/users  { "username", "displayName" }   → 201
GET  /api/v1/users                                   → 200 목록
```
로그인/세션 API는 인증 구현 시 추가(임시 자체 → SSO 교체. 임베드 검증과 무관).

## 4A. 데이터소스 (S5)

```
GET    /api/v1/datasources                  → 목록 (비밀번호 미포함)
POST   /api/v1/datasources                  → 등록 { name, host, port, databaseName, dbUser, dbPassword }
PUT    /api/v1/datasources/{id}             → 수정 (dbPassword는 전달 시에만 변경)
DELETE /api/v1/datasources/{id}             → 삭제 (사용 중 차트 존재 시 409 + 차트 수 반환)
POST   /api/v1/datasources/test             → 연결 테스트 { host, port, ... } → { ok, message }
```
비밀번호는 AES-GCM 암호화 저장, 응답에 절대 미포함. 데이터소스 이름은 사용자별로 유니크하다(`mc_datasource(owner_id, name)`).

## 5. 스키마 탐색 (S2 좌측 패널)

### 5.1 테이블/컬럼 목록

```
GET /api/v1/schema/tables?datasourceId={id}
```

응답 200:

```json
{
  "tables": [
    {
      "name": "sales",
      "columns": [
        { "name": "id", "type": "bigint" },
        { "name": "category", "type": "varchar" },
        { "name": "amount", "type": "numeric" },
        { "name": "date", "type": "date" }
      ]
    },
    { "name": "users", "columns": [ { "name": "id", "type": "bigint" }, { "name": "name", "type": "varchar" } ] }
  ]
}
```

- 서버는 현재 사용자 소유 데이터소스에 연결해 `information_schema`를 조회한다. `mc_` 접두사 테이블(솔루션 메타 테이블)은 목록에서 제외한다.

### 5.2 테이블 원본 데이터 조회 (최대 1,000행)

```
GET /api/v1/schema/tables/{tableName}/preview?datasourceId={id}
```

응답 200: 2번(query/run)과 동일 형태 (`columns` + `rows`, 최대 1,000행 + `truncated`).

- 서버 내부적으로 `SELECT * FROM {tableName} LIMIT 1000`을 읽기 전용으로 실행(시스템 행 제한과 동일). 테이블명은 `information_schema` 존재 여부로 검증(임의 문자열 주입 차단).
- S2 좌측 패널에서 테이블 클릭 시 [원본 데이터] 탭에 표시 — UI는 세로 스크롤, 초과 시 "1,000행까지 표시" 안내. 조건이 구성된 뒤에는 2A의 `mode:"rows"`가 이 역할을 대신한다(조건 적용 원본).

---

## 6. 구현 메모

- 1번(임베드 데이터)과 2번(SQL 실행)은 같은 "SQL 실행 엔진"(읽기 전용, 타임아웃, 행 제한, SELECT 검증)을 공유한다. 한 곳에 구현한다.
- ECharts option 조립(방식 A)은 서버의 단일 변환기에 둔다: (rows, chartType, options) → option JSON. 차트 종류 추가 시 이 변환기만 확장.
- CORS: sdk.js가 외부 사내 페이지에서 호출하므로, 임베드 데이터 엔드포인트(1번)는 사내 도메인 범위에서 CORS 허용이 필요하다.
 
---

## 부록. 현재 구현 반영 - 차트 목록/미리보기

Admin S1 차트 목록은 서버 페이지네이션을 기준으로 동작한다.

```
GET /api/v1/charts?q={검색어}&type={bar|line|pie|scatter}&datasourceId={id}&sort={sort}&page={page}&pageSize={pageSize}
```

지원 정렬값은 `updated_desc`, `updated_asc`, `name_asc`, `name_desc`이다. 정렬은 클라이언트가 아니라 백엔드 SQL에서 whitelist 기반으로 수행한다. 목록 수가 많아져도 현재 페이지에 필요한 행만 내려받기 위함이다.

응답은 다음 형태다.

```json
{
  "charts": [],
  "page": 1,
  "pageSize": 12,
  "total": 0,
  "totalPages": 1
}
```

목록 카드 미리보기는 카드별 단건 호출 대신 현재 페이지의 차트 id를 batch로 요청한다.

```
GET /api/v1/charts/previews?ids=1,2,3
```

응답은 `{ "previews": {}, "errors": {} }` 형태이며, 각 preview의 `option`은 서버 변환기가 조립한 ECharts option이다. Admin 카드와 편집 미리보기는 이 option을 그대로 `setOption()` 하고, 클라이언트는 목록 카드용 더미 데이터를 만들지 않는다.
