# 차트 솔루션 API 계약서 (API Contract)

**문서 버전:** v3.4 — 수동 캐시 갱신의 소유자 범위 검사 명시 (2026-07-28)
**관련 문서:** PRD v3.2, 화면설계서 v3.7, 노코드 SQL 생성규칙 v2.8, 다중데이터소스_페더레이션_설계
**범위:** MVP. 인증(로그인)은 제외하되, 임베드 토큰 검증은 포함한다.
**Base URL:** `/api/v1`

---

## 0. 공통 규약

- 요청/응답 본문은 JSON, UTF-8.
- 시간은 ISO 8601 (`2026-06-10T12:00:00Z`).
- 에러 응답은 모든 엔드포인트에서 동일한 형태를 쓴다. 서버는 DTO + Bean Validation으로 요청 본문을 검증하고, `ApiExceptionHandler`가 검증 실패·JSON 파싱 실패·DB 무결성 오류·예상 밖 오류를 아래 공통 envelope으로 변환한다.
- 모든 Admin API는 인증 컨텍스트의 `userId`로 자동 스코프한다. 클라이언트는 `ownerId`를 보내지 않는다. 응답에도 기본적으로 `ownerId`를 노출하지 않는다. 단, 현재 개발 프로필의 `DevelopmentCurrentUserProvider`는 사용자 컨텍스트를 주입하지 않아 `owner_id`가 `null`인 개발 동작을 허용한다. 이는 배포 전 인증 연동과 함께 제거해야 하는 명시적 차이이며 운영 계약으로 간주하지 않는다.
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
| 409 | MATERIALIZED_VIEW_NOT_POPULATED | 아직 갱신되지 않은 물리화 뷰를 조회 |
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
6. **캐시 확인 (PRD 7.7)**: `live`면 항상 실행 / `ttl`이면 `mc_chart_cache.computed_at + ttl` 이내일 때 캐시를 사용하고 만료 후 첫 요청이 transaction advisory lock 안에서 동기 재계산하며 경쟁 요청만 정의 버전이 같은 stale을 반환 / `manual`이면 저장된 캐시 사용(단일 소스 누락·손상 시 self-heal)
7. (캐시 미스 시) 해당 데이터소스의 커넥션 풀에서 읽기 전용 실행 (타임아웃·행 제한) 후 캐시 갱신
8. 결과 + chart_type + options를 ECharts option JSON으로 조립해 반환 (방식 A) — `computedAt` 포함

모든 `/api/**` 응답은 `Cache-Control: no-store`다. 브라우저 HTTP 캐시가 `live/ttl/manual` 정책을 우회하지 않으며 서버의 `mc_chart_cache`가 결과 캐시의 단일 진실원이다.

JWT 페이로드: { "userId": 7, "jti": 42, "iat": ..., "exp": ..., "v": 1 } — 차트 정보 없음(jti = mc_user_token.id). TOKEN_CHART_MISMATCH 에러 코드는 폐기.

### 응답 200 — ECharts option 통째 (방식 A)

```json
{
  "chartId": 12,
  "computedAt": "2026-06-12T09:00:00Z",
  "sampling": {
    "version": 6,
    "approximate": true,
    "method": "RESULT_RANDOM",
    "mode": "manual",
    "requestedMethod": "auto",
    "sizeTarget": 10000,
    "seed": 48291,
    "valueMode": "sample",
    "sampleSize": 10000,
    "sampledRowCount": 9998,
    "groups": [{ "key": "의류", "sampleCount": 500 }],
    "estimates": [{ "series": "sum_amount", "aggregate": "sum", "treatment": "SAMPLE_AGGREGATE" }],
    "warnings": ["RESULT_RANDOM_SAMPLE", "SAMPLE_AGGREGATE_ONLY"]
  },
  "approximate": true,
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
- `builderConfig.sample`을 사용한 차트는 sampling v6를 포함한다. 서버가 실행 방법을 `INDEX_RANDOM|RESULT_RANDOM|SYSTEM|FULL_SCAN` 중 결정한다. `RESULT_RANDOM`은 VIEW 또는 JOIN+WHERE 조회 결과에서 행을 뽑는 방식이다. 100% 또는 작은 물리 테이블의 FULL_SCAN은 `{approximate:false,method:"FULL_SCAN",valueMode:"exact"}`이다. 표본 실행의 `valueMode`는 `sample`이다. `sampledRowCount`는 표본에 들어온 실제 입력 행 수이고 API의 `rowCount`는 결과 그룹 수다. `groups`는 화면에 표시된 그룹별 표본 수다.
- `estimates`는 시리즈별 계산 해석을 제공한다: SUM/COUNT=`SAMPLE_AGGREGATE`, AVG/STDDEV/VARIANCE=`SAMPLE_ESTIMATE`, MIN/MAX=`OBSERVED_EXTREME`, COUNT DISTINCT=`OBSERVED_DISTINCT`, 정확 실행은 모두 `EXACT`. SUM·COUNT는 외삽하지 않은 `표본 합계`·`표본 개수`이며 `SAMPLE_AGGREGATE_ONLY` 경고를 함께 보낸다. 독립행 무작위 표본인 INDEX_RANDOM·RESULT_RANDOM의 AVG에는 가능한 그룹에 95% 오차 요약을 제공하고, STDDEV/VARIANCE의 `intervals[]`는 `{key,sampleCount,estimate,lower95,upper95,relativeErrorPct?}` 그룹별 구간이다. 분산 계열 구간에는 `STDDEV_CI_NORMALITY_ASSUMED` 경고가 항상 따라간다.
- `sampling`이 정식 계약이며 `approximate`·`sampleRate`는 구버전 클라이언트를 위한 하위 호환 별칭이다. Admin과 SDK는 정확/추정을 구분하고 경고를 표시한다.

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
2. 읽기 전용 계정으로 실행, 타임아웃(기본 10초). `chartType`이 없으면 데이터 점검용으로 최대 1,000행, `chartType`이 있으면 실제 차트 계약에 따라 전체 결과
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

`mode:"aggregate"`의 실제 차트 결과에는 고정 행 제한을 적용하지 않는다. 표본 미지정 시 조건·집계 결과 전체를 반환하며, 결과를 줄이는 유일한 제품 기능은 사용자가 명시한 `sample`이다. `mode:"rows"` 원본 데이터 미리보기만 최대 1,000행으로 제한한다.

`builderConfig.joins[]`(생성규칙 11장) 지정 시 다중 테이블 조인(`inner`/`left`, N개). 조인이 있으면 모든 컬럼 참조는 qualified `"테이블.컬럼"`. `sample`을 함께 지정하면 JOIN과 WHERE를 적용한 행 집합을 모집단 CTE로 만들고, 그 결과에서 `RESULT_RANDOM` 표본을 뽑은 뒤 집계한다. 앱은 이 기능을 위해 고객 DB에 VIEW/MATERIALIZED VIEW를 생성하지 않는다.

`builderConfig.yAxis[].agg = "none"` 은 모든 차트 타입에서 지원되는 원본값 튜플 모드다. 이 모드에서는 SELECT가 X축 컬럼과 Y축 원본 컬럼을 그대로 반환하고 `GROUP BY`를 만들지 않는다. 막대/선은 `x,value`, 원형은 `name,value`, 산점도는 `[x,y]`, 기본 영역 지도는 `region,value`로 변환된다. 단 한 요청 안에서 `none`과 집계(`sum`/`avg` 등)는 섞을 수 없다. `sample`을 지정하면 집계 대신 선택된 원본 행만 반환하고 sampling v6의 처리 방식은 `ROW_SAMPLE`이다.

`mode` (선택, 기본 `"aggregate"`):
- `"aggregate"` — 차트 실행 (생성규칙 6장). S2 [실행] 버튼 → [실행 결과] 탭. 단일 물리 테이블은 조건에 따라 INDEX_RANDOM/SYSTEM/FULL_SCAN을, VIEW와 조인은 RESULT_RANDOM을 사용한다. 레거시 `method:"system"`/`rate`는 물리 관계의 `TABLESAMPLE SYSTEM` 경로를 고정한다. SUM·COUNT는 선택된 표본의 값을 그대로 반환하고, `agg:"none"`은 선택된 원본 행을 그대로 반환한다. 응답은 sampling v6와 하위 호환 `approximate`·`sampleRate`를 함께 보낸다.
- `"rows"` — 집계·GROUP BY 없이 `SELECT * + JOIN + WHERE(조건 동일 바인딩) + LIMIT 1000` (생성규칙 3B장). S2 [원본 데이터] 탭 — 집계 이전의 세부 데이터 확인용. [실행] 때 중복 호출하지 않고 사용자가 탭을 처음 열 때 지연 호출한다. 표본 추출은 무시한다.

`chartType:"geoscatter"`의 `mode:"aggregate"`는 이름과 달리 원본 좌표 튜플을 반환하는 전용 경로다. `geoPoint` 미지정 또는 `{mode:"columns"}`이면 기존 `xAxis=경도`, `yAxis[0]=위도`, 선택 `yAxis[1]=크기`를 사용한다. `{mode:"spatial",spatialColumn:"location",sizeColumn?:"weight"}`이면 카탈로그가 확인한 SRID 지정 `geometry/geography(Point, SRID)`를 WGS84로 변환해 내부 열 `__chartsdk_longitude`, `__chartsdk_latitude`, 선택 `__chartsdk_size`로 반환한다. 공간 모드는 단일 데이터소스(같은 소스 내 JOIN 가능) 전용이며 표본 추출을 함께 쓰지 않는다.

두 좌표 방식도 다른 차트와 같은 전체 결과 계약을 사용해 JOIN·WHERE 조건에 맞는 좌표를 전부 반환하고 `truncated:false`로 응답한다. 숫자 컬럼 방식은 다중 데이터소스도 지원하지만 공간 컬럼 방식은 DuckDB의 PostGIS 확장 계약이 없으므로 여러 데이터소스 JOIN에서 400으로 거부한다. 기존 쿼리 타임아웃과 DuckDB 메모리 상한은 유지한다. `mode:"rows"`와 관계 미리보기의 1,000행 제한은 바뀌지 않는다.

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
응답 200: `{ "option": { ... } }` — 받은 `rows`에 `chartType`·`options`만 다시 적용해 ECharts option을 조립한다(**SQL 미실행**, 1·2A와 동일한 운영 Java 변환기). S2에서 **데이터에 영향 없는 옵션 변경**(색·범례·라벨·축 등) 시 호출 — 옵션 변경마다 집계 SQL을 재실행해 운영 DB를 때리지 않기 위함(PRD 7.7). `rows`는 직전 `run-builder`의 전체 결과를 클라이언트가 보관했다가 그대로 전달한다. 클라이언트는 디바운스(약 150~250ms) 후 호출해 응답을 `setOption` 한다. MSW의 TypeScript 변환기는 프론트 테스트 전용 미러이며 운영 API 계약에는 포함되지 않는다.
- `options.display`·`options.typography` 변경도 데이터와 무관하므로 2B를 사용한다. 서버는 논리 설계 크기에 맞는 글꼴과 제목·범례·grid·visualMap 여백을 다시 조립한다. Admin의 화면 맞춤/zoom과 데이터·노코드·옵션 패널 접힘은 렌더러 로컬 상태라 요청에 포함하지 않는다.
- 데이터 구성(테이블·축·조건·정렬·묶기)이 바뀌면 2B가 아니라 **2A `run-builder` 재호출**(rows 갱신 + option 재조립). `options.sortOrder`(표시 정렬)는 rows 재정렬만이라 2B로 충분하다.

---

## 3. 차트 CRUD (Admin)

### 3.1 목록 — S1

```
GET /api/v1/charts?q={검색어}&type={대분류}&datasourceId={id}&schema={schema}&relation={relation}&sort={정렬}&page={page}&pageSize={pageSize}
```

모든 파라미터는 선택이며, 항상 **현재 사용자 소유(`owner_id`) 범위**로 먼저 좁힌 뒤 적용한다.

| 파라미터 | 값 | 설명 |
|---|---|---|
| `q` | 문자열 | 이름·설명 부분일치(ILIKE). DB는 `pg_trgm` GIN 인덱스로 최적화 |
| `type` | `bar`\|`line`\|`pie`\|`scatter` | 대분류(`chart_type`) 필터. 미지정 시 전체 |
| `datasourceId` | 정수 | 데이터소스 참조 필터. 기준 관계뿐 아니라 `mc_chart_datasource`에 기록된 조인 보조 소스도 포함. 미지정 시 전체 |
| `schema` | 문자열 | `datasourceId`와 함께 스키마 범위의 관련 차트를 조회. `builder_config.table`과 `joins[].table`을 모두 포함 |
| `relation` | 문자열 | `schema`·`datasourceId`와 함께 관계 범위의 관련 차트를 조회. 기준 관계와 조인 관계를 모두 포함하며 `schema` 미지정 시 `public` |
| `sort` | `updated_desc`(기본)\|`updated_asc`\|`name_asc`\|`name_desc` | 정렬 |
| `page` | 1 이상의 정수 | 페이지 번호. 기본 1 |
| `pageSize` | 1~60 정수 | 페이지 크기. 기본 12 |

- 인덱스: `idx_mc_chart_owner_updated(owner_id, updated_at DESC)`가 owner 범위 + 기본 정렬을 담당한다. 데이터소스 필터는 `mc_chart_datasource`의 PK `(chart_id,datasource_id)`를 이용한 `EXISTS`로 조인 보조 소스까지 찾는다. 스키마·관계 필터는 `builder_config.table`과 `builder_config.joins[].table` JSONB 참조를 함께 조회한다.

응답 200:

```json
{
  "charts": [
    { "id": 12, "name": "월별 매출", "description": "영업부 매출을 월 단위로 집계", "chartType": "bar", "datasourceId": 2, "mainTable": { "datasourceId": 2, "datasourceName": "sales-db", "schema": "public", "name": "sales" }, "updatedAt": "2026-06-10T09:30:00Z" },
    { "id": 13, "name": "일별 방문자", "description": null, "chartType": "line", "datasourceId": 1, "mainTable": { "datasourceId": 1, "datasourceName": "analytics-db", "schema": "public", "name": "sales" }, "updatedAt": "2026-06-09T14:00:00Z" }
  ]
}
```

`mainTable`은 `builder_config.table`과 현재 `mc_datasource.name`에서 파생한 읽기 전용 메타데이터이며 별도 컬럼이 아니다. `datasourceId`는 실행·관계 식별용, `datasourceName`은 URL 표시용이다. Admin은 이를 이용해 정식 편집 경로 `/data/{datasourceName}/{schema}/{relation}/{chartId}`를 만든다. 메인 관계를 알 수 없는 SQL 차트는 `mainTable:null`과 `/charts/{id}`를 사용한다.

Admin 데이터 탐색 경로는 `/data/{datasourceName}`, `/data/{datasourceName}/{schema}`, `/data/{datasourceName}/{schema}/{relation}` 순서이며 각 경로의 기본 화면은 그 범위의 차트 목록이다. 데이터소스·스키마·관계 범위는 모두 기준 관계와 조인 관계 참조를 포함하고 같은 검색·종류·정렬·페이지네이션 UI를 사용한다. 메타데이터는 각 경로의 `?view=schema`, `?view=relations`, `?view=columns` 탭에서 탐색하며 `/data/{datasourceName}/{schema}/{relation}/{chartId}`는 차트 편집 경로다. 이름은 한 URL 구간으로 UTF-8 퍼센트 인코딩한다. `tables`, `charts` 같은 중간 명사는 상위 문맥과 중복되므로 두지 않는다. 경로는 화면 문맥이고, 저장·실행 권위는 계속 숫자 `datasourceId`, `builder_config.table`, `mc_chart_datasource`에 있다. 데이터소스 이름을 수정하면 새 이름이 새 정식 URL이 되며 배포 전 정책상 구 이름 리다이렉트는 두지 않는다.

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
  "mainTable": { "datasourceId": 1, "datasourceName": "analytics-db", "schema": "public", "name": "sales" },
  "defineMode": "builder",
  "sqlQuery": "SELECT category, SUM(amount) AS total FROM sales GROUP BY category",
  "builderConfig": { "table": "sales", "xAxis": "category", "xAxisBucket": null, "yAxis": [{ "column": "amount", "agg": "sum" }], "where": [], "orderBy": null, "sample": null },
  "chartType": "bar",
  "options": { "display": { "preset": "standard", "width": 640, "height": 360 }, "typography": { "mode": "auto", "scale": 100 }, "colorMode": "palette", "xAxis": { "title": "카테고리" }, "yAxis": { "title": "매출" }, "legend": { "show": true } },
  "refreshMode": "ttl",
  "cacheTtlSeconds": 3600,
  "createdAt": "2026-06-01T10:00:00Z",
  "updatedAt": "2026-06-10T09:30:00Z"
}
```

- S2 진입 시 이 응답으로 노코드 상태를 복원한다: `datasourceId`(소스 선택) + `builderConfig`(폼) + `chartType`/`options`(우측 패널). `description`은 nullable.
- `options` 키는 단일 레지스트리 `chart-options/optionRegistry.ts`(= PRD 9.2)를 따른다 — 중첩 점경로(`display.preset`·`typography.mode`·`xAxis.title`·`legend.position` 등). 위 예시는 대표 키만 표기한 것이며, 누락 키는 레지스트리 기본값으로 채워진다(변환기 매핑 스펙 참조). `display`는 저장·응답되는 논리 설계 기준이지 SDK 호스트 DOM의 width/height 명령이 아니다.

S2는 정의 조회와 함께 저장 결과 단건 미리보기를 요청한다.

```
GET /api/v1/charts/{id}/preview
```

응답은 `{ chartId, computedAt, columns, rows, rowCount, truncated, elapsedMs, option, sampling? }`이다. `columns/rows`는 마지막 저장 캐시의 집계 결과이며 편집기의 [실행 결과]와 옵션 재조립에 사용한다. 따라서 저장된 차트는 진입 직후 별도 `POST /query/run-builder` 없이 결과 표와 우측 차트를 복원한다. 캐시 조회·갱신 정책은 임베드와 같은 `ChartComputeService.serve()`를 따른다.

목록용 `GET /charts/previews?ids=...`는 최대 60개 카드 응답이므로 `option`과 표시 메타데이터만 반환하고 `columns/rows/elapsedMs`는 포함하지 않는다.

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
  "options": { "display": { "preset": "standard", "width": 640, "height": 360 }, "typography": { "mode": "auto", "scale": 100 }, "colorMode": "palette", "xAxis": { "title": "카테고리" }, "yAxis": { "title": "매출" }, "legend": { "show": true } },
  "refreshMode": "ttl",
  "cacheTtlSeconds": 3600
}
```

응답 201(생성)/200(수정): 3.2와 동일 형태. 저장 성공 시 서버는 쿼리를 1회 실행해 mc_chart_cache에 시드한다(PRD 7.7).

저장 시 서버가 최종 실행 SQL을 확정한다.
- `defineMode:"builder"`: 클라이언트가 보낸 `sqlQuery`는 신뢰하지 않는다. 서버가 `builderConfig`로 SQL을 다시 생성·검증·1회 실행한 뒤, 표시용 리터럴 SQL을 `mc_chart.sql_query`에 저장한다.
- `defineMode:"sql"`: `sqlQuery`는 SELECT/WITH 계열만 허용하고, 저장 전 1회 실행 검증을 통과해야 한다.

### 3.5 결과 캐시 수동 갱신 — S2 [지금 갱신]

```
POST /api/v1/charts/{id}/refresh
```

응답 200:

```json
{
  "chartId": 12,
  "computedAt": "2026-07-27T09:15:00Z",
  "rowCount": 5,
  "elapsedMs": 42,
  "sampling": null,
  "approximate": false,
  "sampleRate": null
}
```

서버는 캐시 유효 여부와 무관하게 즉시 한 번 재계산하고 `mc_chart_cache`를 교체한다. `sampling`이 있으면 `approximate`·`sampleRate`는 호환용 별칭으로 같은 의미를 보존한다.

**인가:** 재계산을 시작하기 전에 조회 경로와 **같은** 소유자 범위 검사를 통과해야 하며, 범위를 벗어나면 재계산을 시작하지 않고 `404 CHART_NOT_FOUND`를 반환한다(트러블슈팅 M10). 재계산 계층(`ChartComputeService`)은 임베드 서빙·저장 시드와 공유하므로 owner 개념을 갖지 않는다 — 인가는 이 HTTP 진입점의 책임이다. 단, 로그인 도입 전에는 차트가 `owner_id NULL`로 저장되고 범위 조건에 `OR owner_id IS NULL` 탈출구가 남아 있어 실질 격리는 아직 성립하지 않는다.

Admin은 저장된 최신 정의에서만 버튼을 활성화한다. 호출 순서는 `POST /charts/{id}/refresh` 성공 → `GET /charts/{id}/preview` 재조회 → 결과 표·차트 option·`computedAt` 교체다. 새 차트 또는 저장되지 않은 변경이 있으면 호출하지 않고 저장 안내를 표시한다. POST는 성공했지만 preview 재조회가 실패하면 캐시 갱신 성공과 화면 동기화 실패를 구분해 알린다.

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

### 5.1 관계(TABLE·VIEW·MATERIALIZED VIEW)/컬럼 목록

```
GET /api/v1/schema/tables?datasourceId={id}
```

응답 200:

```json
{
  "tables": [
    {
      "schema": "public",
      "name": "sales",
      "relationType": "TABLE",
      "estimatedRowCount": 500000000,
      "columns": [
        { "name": "id", "type": "bigint" },
        { "name": "category", "type": "varchar" },
        { "name": "amount", "type": "numeric" },
        { "name": "date", "type": "date" }
      ]
    },
    { "schema": "analytics", "name": "sales_summary", "relationType": "VIEW", "columns": [ { "name": "category", "type": "varchar" }, { "name": "amount", "type": "numeric" } ] },
    { "schema": "analytics", "name": "monthly_sales_mv", "relationType": "MATERIALIZED_VIEW", "populated": true, "estimatedRowCount": 120, "columns": [ { "name": "month", "type": "date" }, { "name": "amount", "type": "numeric" } ] }
  ]
}
```

- 서버는 현재 사용자 소유 데이터소스에 연결해 `pg_catalog.pg_class/pg_attribute`를 조회한다. 읽기 권한이 있는 일반 테이블·파티션 테이블·VIEW·MATERIALIZED VIEW를 모두 반환하고, 시스템 스키마(`pg_catalog`·`information_schema`·`pg_toast` 등)와 `mc_` 접두사 관계(솔루션 메타 테이블)는 제외한다. 카탈로그 조회와 차트 실행은 모두 읽기 전용이며 고객 DB 객체를 생성·갱신하지 않는다.
- `relationType`은 `TABLE|VIEW|MATERIALIZED_VIEW`다. 물리화 뷰의 `populated:false`는 `REFRESH MATERIALIZED VIEW`가 필요한 상태이므로 선택 UI에서 비활성화하고, 직접 미리보기 요청도 409 `MATERIALIZED_VIEW_NOT_POPULATED`로 거부한다.
- `estimatedRowCount`는 PostgreSQL `pg_class.reltuples`의 계획용 추정치로 TABLE·MATERIALIZED VIEW에만 제공될 수 있다. 정확한 행 수가 아니며 표본 계획과 직접 지정 UI의 "전체 약 N행 중" 안내에만 사용한다. VIEW·조인 결과 크기는 미리 전체 COUNT하지 않으며 실행 후 실제 표본 수와 집계별 유효 표본 수를 정확도 계산에 사용한다.
- `schema`는 관계의 소속 스키마다. `public` 외 사용자 스키마(예: `analytics`)의 업무 관계도 노출된다. 클라이언트는 식별자를 비-public 일 때만 `"schema.name"`으로 한정해 `builderConfig.table`/`joins[].table`에 담는다(미지정 → public).

### 5.2 관계 원본 데이터 조회 (최대 1,000행)

```
GET /api/v1/schema/tables/{tableName}/preview?datasourceId={id}&schema={schema}
```

응답 200: 2번(query/run)과 동일 형태 (`columns` + `rows`, 최대 1,000행 + `truncated`).

- 서버 내부적으로 `SELECT * FROM "{schema}"."{tableName}" LIMIT 1000`을 읽기 전용으로 실행(시스템 행 제한과 동일). `schema` 미지정 시 `public`. 관계명·스키마는 위 카탈로그 존재 여부로 검증한다(임의 문자열 주입 차단).
- S2 좌측 패널에서 TABLE·VIEW·갱신 완료 MATERIALIZED VIEW를 클릭하면 [원본 데이터] 탭에 표시한다. UI는 세로 스크롤하고, 초과 시 "1,000행까지 표시"를 안내한다. 조건이 구성된 뒤에는 2A의 `mode:"rows"`가 이 역할을 대신한다(조건 적용 원본).

---

## 6. 구현 메모

- 1번(임베드 데이터)과 2번(SQL 실행)은 같은 "SQL 실행 엔진"(읽기 전용, 타임아웃, 행 제한, SELECT 검증)을 공유한다. 한 곳에 구현한다.
- ECharts option 조립(방식 A)의 운영 권위는 서버 Java 변환기다: (rows, chartType, options) → option JSON. MSW 테스트 미러와 서버의 레이아웃 결과는 `chart-options/layout-contract-cases.json` 공용 fixture를 양쪽 테스트가 소비해 일치시킨다.
- CORS: sdk.js가 외부 사내 페이지에서 호출하므로, 임베드 데이터 엔드포인트(1번)는 사내 도메인 범위에서 CORS 허용이 필요하다.
 
---

## 부록. 현재 구현 반영 - 차트 목록/미리보기

Admin S1 차트 목록은 서버 페이지네이션을 기준으로 동작한다.

```
GET /api/v1/charts?q={검색어}&type={bar|line|pie|scatter}&datasourceId={id}&schema={schema}&relation={relation}&sort={sort}&page={page}&pageSize={pageSize}
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

응답은 `{ "previews": {}, "errors": {} }` 형태이며, 각 preview의 `option`은 서버 변환기가 조립한 ECharts option이다. Admin 목록 카드는 이 option을 그대로 `setOption()` 하고, 클라이언트는 목록 카드용 더미 데이터를 만들지 않는다. 편집 화면은 rows까지 포함하는 단건 `/charts/{id}/preview` 계약을 사용한다.
