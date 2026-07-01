# 노코드 → SQL 생성 규칙 설계서

**문서 버전:** v1.6 — 다중 스키마 지원. 테이블 식별자를 스키마 한정(`"schema"."table"`)으로 생성하고, 빌더가 스키마를 명시하지 않으면 public 으로 간주(하위호환). 고객 DB 의 public 외 사용자 스키마(예: tandanji) 업무 테이블도 조회 가능
**관련 문서:** PRD v1.9 (7.3·7.7), API 계약서 v1.7 (builderConfig·schema), 화면설계서 v2.5 (S2 노코드 탭)
**대상 DB:** PostgreSQL 고정

---

## 1. 원칙

1. 노코드는 SQL 생성기다. 생성된 SQL은 기존 실행 파이프라인(SELECT 검증 → 읽기 전용 실행 → 변환기)을 그대로 통과한다. 별도 실행 경로를 만들지 않는다.
2. 식별자(테이블·컬럼)는 바인딩이 불가능하므로 화이트리스트 검증으로 통제한다: information_schema에 실재하는 이름만 허용하고, 통과한 식별자는 큰따옴표로 감싼다. 테이블은 스키마 한정 `"schema"."table"` 로 감싸며, 빌더가 스키마를 명시하지 않으면 `public` 으로 간주한다(스키마 없는 기존 차트의 하위호환). 생성 SQL은 `public` 도 명시해 `search_path` 의존(동명 테이블 오선택)을 제거한다. **단 본 문서의 예시는 가독성을 위해 `public` 스키마 접두를 생략해 표기한다** — 실제 생성 SQL은 `"public"."sales"` 처럼 스키마를 명시한다.
3. 값(WHERE 비교값)은 SQL 문자열에 절대 삽입하지 않는다. 전부 PreparedStatement `?` 바인딩.
4. 생성 SQL의 첫 SELECT 컬럼은 항상 X축이다 — ECharts 변환기 컨벤션("첫 컬럼 = X축, 나머지 = 시리즈")과 구조적으로 일치시킨다.
5. 생성 SQL은 사용자가 항상 확인할 수 있게 한다(S2 "생성된 SQL 보기" — 기본 접힘, 헤더 클릭 시 펼침). 블랙박스를 만들지 않는다.

## 2. builderConfig 스키마

```json
{
  "table": "sales",
  "xAxis": "category",
  "xAxisBucket": null,
  "yAxis": [
    { "column": "amount", "agg": "sum",   "alias": "총매출" },
    { "column": "id",     "agg": "count", "alias": "건수" }
  ],
  "where": [
    { "column": "dept",   "op": "eq",  "value": "영업" },
    { "column": "amount", "op": "gte", "value": 1000 },
    { "column": "date",   "op": "between", "value": ["2026-01-01", "2026-06-30"] }
  ],
  "orderBy": { "target": "y0", "direction": "desc" },
  "limit": 1000,
  "sample": { "rate": 10 }
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| table | ✓ | base 테이블. 스키마 한정 시 `"schema.table"`(미지정 → public). 추가 테이블은 `joins[]` 로 조인 (11장) |
| joins | — | 테이블 조인 배열 (11장). N개 체인, `inner`/`left`. 지정 시 모든 컬럼 참조는 qualified `"테이블.컬럼"`(테이블 부분은 bare 이름 — 스키마는 테이블 선언에서 해석) |
| xAxis | ✓ | X축 컬럼 1개 (조인 시 qualified) |
| xAxisBucket | — | `"day"` \| `"week"` \| `"month"` \| null. X축이 날짜 타입일 때만 허용. 지정 시 DATE_TRUNC로 묶어 집계 (3A장) |
| yAxis | ✓ (1개 이상) | 값 컬럼 + 집계. `agg:"none"`이면 원본값 튜플 모드. 복수면 다중 시리즈 |
| yAxis[].alias | — | 시리즈 표시명. 미지정 시 자동 생성 ("sum_amount") |
| where | — | 조건 배열. 전부 AND 결합 (MVP: OR 미지원) |
| orderBy | — | target: "x" 또는 "y{인덱스}". 미지정 시 ORDER BY 없음 |
| limit | — | 미지정 시 시스템 기본(1000) 강제 |
| sample | — | `{ rate }` 표본 비율(%, 1~100). 지정 시 FROM에 TABLESAMPLE SYSTEM 주입 (3C장). **집계 모드 전용** — rows 모드는 무시. **JOIN·원본값 튜플(`agg:"none"`)과 동시 사용 불가** (11.4) |

## 3. 집계(agg) 템플릿

| agg | 생성 SQL | 허용 컬럼 타입 |
|---|---|---|
| sum | SUM("col") | 숫자 |
| avg | AVG("col") | 숫자 |
| stddev | STDDEV("col") | 숫자 |
| count | COUNT("col") | 모든 타입 |
| count_distinct | COUNT(DISTINCT "col") | 모든 타입 |
| min | MIN("col") | 숫자·날짜·문자 |
| max | MAX("col") | 숫자·날짜·문자 |
| none | "col" | 모든 차트 타입의 원본값 튜플 모드. GROUP BY 없는 원본 행 조회 |

- `none`은 모든 차트 타입에서 사용할 수 있다. 막대/선은 X/Y 원본 튜플, 원형은 name/value 원본 튜플, 분포는 `[x,y]` 원본 점으로 해석한다.
- 한 builderConfig 안에서 `none`과 집계(`sum`/`avg`/`count` 등)는 섞을 수 없다. 모든 yAxis가 `none`이거나 모두 집계여야 한다.
- `none` 원본값 모드는 `GROUP BY`를 만들지 않고, `sample`과 함께 사용할 수 없다.
- scatter는 여전히 모든 yAxis가 `none`이어야 하며 X축은 숫자 타입이어야 한다.

- 컬럼 타입은 information_schema.columns의 data_type으로 판정한다. 타입 불일치(문자 컬럼에 sum 등)는 생성 단계에서 400 거부 — 실행까지 가지 않는다.
- alias는 AS "별칭"으로 감싼다. 별칭도 식별자이므로 큰따옴표 escape(내부 큰따옴표는 "" 로 치환) 적용.

## 3A. 날짜 버킷팅(xAxisBucket) 템플릿 — MVP 포함

X축이 날짜 타입일 때 일/주/월 단위로 묶어 집계한다. "월별 매출" 등 시계열 차트의 대표 경로.

| xAxisBucket | 생성 SQL (SELECT 첫 컬럼) | 비고 |
|---|---|---|
| null (기본) | "col" | 원본 값 그대로 GROUP BY |
| day | DATE_TRUNC('day', "col") AS "col" | |
| week | DATE_TRUNC('week', "col") AS "col" | ISO 주 시작(월요일) |
| month | DATE_TRUNC('month', "col") AS "col" | |

- 버킷 지정 시 GROUP BY와 ORDER BY는 위치 참조(`GROUP BY 1`)를 사용한다 — DATE_TRUNC 식을 반복하지 않는다.
- 검증: xAxis 컬럼의 data_type이 date/timestamp 계열이 아니면 400 BUCKET_TYPE_MISMATCH. 생성 전에 차단한다.
- UI 규칙(화면설계서 4.1): X축 컬럼이 날짜 타입일 때만 "묶기" 셀렉트를 노출한다. 날짜 컬럼 선택 시 기본값은 month(월).
- 라벨 포맷(서버 변환기): 버킷 결과(timestamp)를 ECharts 카테고리 라벨로 변환할 때 month → `YYYY-MM`, week → `YYYY-MM-DD`(주 시작일), day → `YYYY-MM-DD`.

## 3B. 원본 데이터 모드 (mode: "rows") — MVP 포함

S2 하단 [원본 데이터] 탭이 사용한다(API 계약 2A). 집계 이전의 세부 데이터를 보여준다.

```sql
SELECT * FROM "table"
WHERE (조건 — 4장과 동일한 ? 바인딩)
LIMIT 1000
```

- 집계·GROUP BY·xAxisBucket·orderBy는 무시한다. 테이블·조건의 식별자/값 검증(9장)은 동일하게 적용.
- LIMIT은 시스템 행 제한(1000) 고정. UI는 세로 스크롤로 표시하고, 초과 시 truncated 안내.
- 단순 조회이므로 자동 호출이 허용된다(집계 모드는 명시적 실행만).

## 3C. 표본 추출 (sample) — 대용량 근사 집계, MVP 포함

몇 GB 테이블 전체를 스캔하지 않고 일부 표본만 읽어 평균·표준편차 등을 **근사**한다. `builderConfig.sample = { rate }`(비율 %, 1~100) 지정 시 FROM 뒤에 `TABLESAMPLE`을 주입한다.

```sql
SELECT "category", AVG("amount") AS "avg_amount"
FROM "sales" TABLESAMPLE SYSTEM (10)
GROUP BY "category"
LIMIT 1000
```

- **방식은 SYSTEM 고정** — 디스크 블록 단위로 랜덤 선택해 **선택된 블록만 읽는다**(전체 스캔 회피 = 기능 목적). 행 단위 균일 표본(BERNOULLI)은 전체를 읽어야 해 목적과 충돌하므로 제공하지 않는다.
- **크기 = 비율(%)만.** TABLESAMPLE이 퍼센트를 인자로 받기 때문. 절대 행 수 지정은 확장(tsm_system_rows) 의존이거나 `ORDER BY random()` 풀스캔이라 비채택.
- **집계 모드 전용.** rows(3B)·schema preview·원본값 튜플 모드(`agg:"none"`)에는 적용하지 않는다.
- **JOIN과 동시 사용 금지.** 조인 결과 표본이 필요한 경우에도 앱은 고객 DB에 VIEW/MATERIALIZED VIEW를 생성하지 않는다. 고객이 직접 관리하는 읽기 전용 VIEW/테이블을 별도 데이터소스로 등록해야 한다.
- **집계별 정확도(서버 변환기 책임):** avg·stddev는 표본값 그대로, sum·count는 비율로 **외삽(`÷ rate%`)**. min·max·count_distinct는 표본에서 부정확하며 단순 외삽이 무의미하므로 근사 결과임을 명시(UI "근사치" 배지). 응답 `approximate: true`, `sampleRate` 동봉.
- **랜덤성:** REPEATABLE 미지정 시 실행마다 다른 표본 → 값이 흔들린다. 결과 캐싱(PRD 7.7)과 결합하면 캐시 수명 동안 고정된다. (씨드 고정은 후속.)
- 검증: rate가 1~100 범위 밖이면 400 INVALID_REQUEST (9장). `joins[]` 또는 `agg:"none"` 과 `sample` 이 함께 들어오면 SQL 생성 전에 400 INVALID_REQUEST 로 차단하며, 생성기가 `TABLESAMPLE`을 조용히 생략해서는 안 된다.

## 4. WHERE 연산자(op) 목록

| op | 생성 SQL | value 형태 | 비고 |
|---|---|---|---|
| eq | "col" = ? | 단일 | |
| neq | "col" <> ? | 단일 | |
| gt / gte | "col" > ? / >= ? | 단일 | 숫자·날짜 |
| lt / lte | "col" < ? / <= ? | 단일 | 숫자·날짜 |
| contains | "col" ILIKE ? | 단일 | 바인딩 값 = '%' \|\| 입력 \|\| '%' 로 서버가 조립. 입력의 %, _ 는 escape |
| starts_with | "col" ILIKE ? | 단일 | 값 = 입력 + '%' (escape 동일) |
| in | "col" IN (?, ?, ...) | 배열 | 배열 길이만큼 ? 생성 (빈 배열은 400) |
| between | "col" BETWEEN ? AND ? | [from, to] | |
| is_null / is_not_null | "col" IS NULL / IS NOT NULL | 없음 | 바인딩 없음 |

- 모든 조건은 AND로 결합. OR·괄호 그룹은 후속(필요 시 where를 그룹 배열로 확장 — JSONB라 스키마 영향 없음).
- LIKE 계열의 와일드카드 조립은 서버가 한다. 사용자 입력에 %를 그대로 두면 의도치 않은 패턴 매칭이 되므로 escape 후 서버가 %를 붙인다.

## 5. 값 타입 처리 (바인딩 시)

컬럼의 data_type 기준으로 입력값을 변환해 바인딩한다.

| 컬럼 타입군 | 입력 → 바인딩 | 실패 시 |
|---|---|---|
| 숫자 (int/numeric 등) | 문자열 → 숫자 파싱 후 setLong/setBigDecimal | 400 "숫자가 아닙니다" |
| 날짜 (date/timestamp) | ISO 8601 파싱 → setDate/setTimestamp | 400 "날짜 형식(YYYY-MM-DD)" |
| 불리언 | true/false → setBoolean | 400 |
| 문자 (varchar/text) | 그대로 setString | — |

- 변환 실패는 생성/실행 전에 400으로 반환 — DB 에러로 흘려보내지 않는다(노코드 사용자는 DB 에러를 해석할 수 없다).

## 6. 생성 알고리즘 (의사코드)

```
generate(config, datasourceId):
  schema = loadSchema(datasourceId)                      # information_schema 캐시
  assertExists(schema, config.table)                     # 식별자 화이트리스트
  assertExists(schema, config.table, config.xAxis)
  assertBucketCompatible(config.xAxis, config.xAxisBucket)  # 날짜 타입만 (3A장)
  for y in config.yAxis: assertExists + assertTypeCompatible(y)
  for w in config.where: assertExists + assertOpCompatible(w)
  allNone = every y.agg == "none"
  anyNone = any y.agg == "none"
  if anyNone and !allNone: reject AGG_TYPE_MISMATCH
  if allNone and config.sample: reject INVALID_REQUEST
  if chartType == "scatter": assert allNone + numeric xAxis

  xCol = config.xAxisBucket
       ? "DATE_TRUNC('" + config.xAxisBucket + "', " + quote(xAxis) + ") AS " + quote(xAxis)
       : quote(xAxis)
  select = [ xCol ]
        + [ aggTemplate(y) + " AS " + quote(aliasOf(y)) for y in yAxis ]
  whereSql, binds = buildWhere(config.where)             # ? 와 바인딩 값 목록 생성
  orderSql = buildOrder(config.orderBy)                  # x → 1번 컬럼, y{i} → (i+2)번 별칭

  sql = "SELECT " + join(select)
      + " FROM " + qualify(table)   # "schema"."table" (스키마 미지정 → public). 예시는 public 생략 표기
      + (!allNone && config.sample ? " TABLESAMPLE SYSTEM (" + clamp(config.sample.rate, 1, 100) + ")" : "")  # 표본 추출(3C)
      + (whereSql ? " WHERE " + whereSql : "")
      + (!allNone ? " GROUP BY " + (config.xAxisBucket ? "1" : quote(xAxis)) : "")
      + (orderSql ? " ORDER BY " + orderSql : "")
      + " LIMIT " + min(config.limit ?? 1000, 1000)
  return (sql, binds)
```

- quote(name): 큰따옴표로 감싸고 내부 " 는 "" 로 escape. 단 화이트리스트를 통과한 이름만 여기까지 온다(이중 방어).
- qualify(table): 테이블을 `"schema"."table"` 로 한정한다(스키마 미지정 → public). 컬럼 참조는 `"schema"."table"."column"` 으로 한정된다. 조인 시 컬럼 참조의 테이블 부분은 bare 이름으로 표기하되, 같은 이름 테이블이 서로 다른 스키마로 한 쿼리에 동시에 등장하면 모호하므로 거부한다(조용한 오선택 방지).
- 생성 결과 (sql, binds)는 기존 SQL 실행 엔진에 그대로 전달. 실행 엔진은 노코드/수기 SQL을 구분하지 않는다(수기 SQL은 binds가 빈 목록일 뿐).

## 7. 생성 예시

### 예시 1 — 기본 (단일 시리즈)
```json
{ "table": "sales", "xAxis": "category",
  "yAxis": [{ "column": "amount", "agg": "sum" }] }
```
```sql
SELECT "category", SUM("amount") AS "sum_amount"
FROM "sales"
GROUP BY "category"
LIMIT 1000
```

### 예시 2 — 다중 시리즈 + 조건 + 정렬
```json
{ "table": "sales", "xAxis": "month",
  "yAxis": [{ "column": "amount", "agg": "sum", "alias": "매출" },
            { "column": "id", "agg": "count", "alias": "건수" }],
  "where": [{ "column": "dept", "op": "eq", "value": "영업" },
            { "column": "date", "op": "between", "value": ["2026-01-01","2026-06-30"] }],
  "orderBy": { "target": "x", "direction": "asc" } }
```
```sql
SELECT "month", SUM("amount") AS "매출", COUNT("id") AS "건수"
FROM "sales"
WHERE "dept" = ? AND "date" BETWEEN ? AND ?
GROUP BY "month"
ORDER BY 1 ASC
LIMIT 1000
```
바인딩: ["영업", 2026-01-01, 2026-06-30]

### 예시 3 — IN + LIKE
```json
{ "where": [{ "column": "region", "op": "in", "value": ["서울","인천"] },
            { "column": "name", "op": "contains", "value": "마트" }] }
```
```sql
... WHERE "region" IN (?, ?) AND "name" ILIKE ? ...
```
바인딩: ["서울", "인천", "%마트%"]

### 예시 4 — 날짜 버킷팅 (월별 매출)
```json
{ "table": "sales", "xAxis": "date", "xAxisBucket": "month",
  "yAxis": [{ "column": "amount", "agg": "sum", "alias": "매출" }],
  "orderBy": { "target": "x", "direction": "asc" } }
```
```sql
SELECT DATE_TRUNC('month', "date") AS "date", SUM("amount") AS "매출"
FROM "sales"
GROUP BY 1
ORDER BY 1 ASC
LIMIT 1000
```
변환기 라벨: 2026-01, 2026-02, … (month → YYYY-MM)

### 예시 5 — 원본값 튜플(모든 차트 타입)

```json
{ "table": "sales", "xAxis": "year",
  "yAxis": [{ "column": "print", "agg": "none", "alias": "print" }],
  "orderBy": { "target": "x", "direction": "asc" } }
```

```sql
SELECT "year", "print" AS "print"
FROM "sales"
ORDER BY 1 ASC
LIMIT 1000
```

막대/선은 각 `year` 행의 `print` 값을 그대로 그린다. 원형은 첫 컬럼을 name, 두 번째 컬럼을 value로 사용한다. 분포는 `[year, print]` 점으로 사용하되 X축이 숫자 타입이어야 한다. `GROUP BY`와 합계/평균 계산은 없다.

## 8. SQL 탭 전환 규칙 (2차 — SQL 탭 구현 시 활성)

- 노코드 → SQL 전환 시: 생성 SQL을 에디터에 로드하되, 바인딩 자리는 사용자가 읽을 수 있게 리터럴로 표시한 사본을 보여준다(예: WHERE "dept" = '영업'). 단 이 사본은 표시용이며, 노코드 모드로 저장된 차트의 실행은 항상 (sql, binds) 경로다.
- SQL을 수정하고 저장하면 define_mode='sql'로 전환, builder_config 폐기(경고 모달). 이후 실행은 수기 SQL 경로(바인딩 없음, SELECT 검증만).
- 단방향: SQL → 노코드 복귀 불가(SQL 파싱 역변환은 만들지 않는다).

## 9. 검증 단계 정리 (실행 전 차단 목록)

| 검증 | 실패 응답 |
|---|---|
| 테이블/컬럼 화이트리스트 (mc_ 테이블 접근 차단 포함) | 400 INVALID_IDENTIFIER |
| 집계-타입 호환 | 400 AGG_TYPE_MISMATCH |
| 버킷-타입 호환 (xAxisBucket은 날짜 타입 컬럼만) | 400 BUCKET_TYPE_MISMATCH |
| 연산자-타입 호환 | 400 OP_TYPE_MISMATCH |
| 값 파싱(숫자/날짜) | 400 VALUE_PARSE_ERROR |
| in 빈 배열, between 길이≠2 | 400 INVALID_REQUEST |
| yAxis 0개 | 400 INVALID_REQUEST |
| pie yAxis 1개 아님 | 400 INVALID_REQUEST |
| scatter xAxis 숫자 타입 아님 | 400 AGG_TYPE_MISMATCH |
| scatter에서 agg가 none 아님 | 400 AGG_TYPE_MISMATCH |
| none과 집계가 한 builderConfig 안에 섞임 | 400 AGG_TYPE_MISMATCH |
| none 원본값 튜플 모드에서 sample 지정 | 400 INVALID_REQUEST |
| 표본 비율 범위(sample.rate 1~100 밖) | 400 INVALID_REQUEST (생성기는 클램프도 적용) |

모두 SQL 생성 전에 차단한다. 노코드 사용자는 DB 에러를 보지 않는 것이 목표다(SQL 모드는 반대로 DB 에러를 그대로 노출 — 사용자층이 다르다).

## 10. MVP 범위 밖 (확장 예약)

- 시리즈 분할 (breakout, 카테고리로 시리즈 나누기) — **1순위 확장.** "부서별 월 매출을 선 여러 개로" 같은 요구. builderConfig에 `seriesBy`(두 번째 그룹 차원) 필드를 추가하고, 생성 SQL은 `GROUP BY x, seriesBy` 2차원이 된다. 서버 변환기에 피벗 단계가 추가된다: rows(x, seriesBy, 값) → x별로 seriesBy 값을 컬럼으로 전개 → "첫 컬럼=X, 나머지=시리즈" 컨벤션의 입력 형태로 변환. 즉 변환기를 (rows → [피벗] → series 조립) 단계 구조로 두면 피벗 단계만 끼우면 된다. UI는 노코드 폼에 "시리즈 나누기" 행으로 자리만 표기(비활성).
- OR / 조건 그룹 — where를 중첩 그룹 구조로 확장
- HAVING (집계 결과 필터)
- 쿼리 파라미터 {{}} 와의 결합 (파라미터 설계 확정 후)

(날짜 버킷팅은 v1.1에서 MVP로 편입 — 3A장 / JOIN 은 v1.4에서 MVP로 편입 — 11장)

## 11. 테이블 조인(JOIN) — MVP 편입 (v1.4)

여러 테이블을 조인해 한 차트를 그린다. `builderConfig.joins[]`(N개 체인). 차트 시각화 목적상 **`inner`/`left` 만** 제공한다 — `full`/`right` 는 미매칭 NULL 행이 X축·집계에 대량 유입돼 차트에 부적합하므로 후속(`right` 는 테이블 순서를 바꾼 `left` 로 흡수).

### 11.1 joins 스키마
```json
{
  "table": "sales",
  "joins": [
    { "table": "orders",   "type": "left",  "on": { "leftColumn": "sales.id",      "rightColumn": "orders.sale_id" } },
    { "table": "products", "type": "inner", "on": { "leftColumn": "orders.prod_id", "rightColumn": "products.id" } }
  ]
}
```
| 필드 | 설명 |
|---|---|
| table | 조인 대상 테이블 (단일, MVP: 서브쿼리 미지원) |
| type | `inner` \| `left` |
| on.leftColumn | qualified `"테이블.컬럼"`. **base 또는 앞서 조인된 테이블**의 컬럼만 허용(체인/스타 — 끊긴 조인 차단) |
| on.rightColumn | qualified `"테이블.컬럼"`. 반드시 `on.table` 자신의 컬럼 |

- **소프트 상한 5개**(성능·fan-out 가드). 초과는 UI 경고(생성기는 차단하지 않음).

### 11.2 컬럼 참조 — qualified 규칙
- 조인이 **있으면** 모든 컬럼 참조(`xAxis`·`yAxis[].column`·`where[].column`·`on`)는 qualified `"테이블.컬럼"`.
- 조인이 **없으면** 기존 unqualified `"컬럼"` 그대로(하위호환 — base 테이블 암묵). 기존 차트 마이그레이션 0.
- 조인 시 unqualified 컬럼은 **모호성으로 400 거부**.

### 11.3 생성 템플릿
```sql
SELECT "products"."category", SUM("orders"."amount") AS "sum_amount"
FROM "sales"
LEFT JOIN "orders" ON "sales"."id" = "orders"."sale_id"
INNER JOIN "products" ON "orders"."prod_id" = "products"."id"
GROUP BY "products"."category"
LIMIT 1000
```
- `FROM "base"` 뒤에 `joins` **순서대로** `[INNER|LEFT] JOIN "table" ON "a"."x" = "b"."y"`.
- SELECT·GROUP BY·ORDER BY·WHERE 의 식별자는 전부 `"테이블"."컬럼"` qualified quote. 별칭은 두지 않는다(테이블명 그대로 — 단순·명확).
- 비-public 스키마 테이블은 FROM·JOIN·컬럼 모두 스키마 한정된다 — 예: `FROM "tandanji"."events" INNER JOIN "tandanji"."users" ON "tandanji"."events"."user_id" = "tandanji"."users"."id"`. 위 예시는 public 스키마라 접두를 생략했다(실제로는 `"public"."sales"` 처럼 명시).
- `xAxisBucket` 지정 시 첫 컬럼은 `DATE_TRUNC('month', "t"."col") AS "col"`, GROUP BY 는 위치 참조(`1`) 유지.

### 11.4 검증 (9장 확장)
| 검증 | 실패 응답 |
|---|---|
| 조인 테이블/ON 컬럼 화이트리스트 | 400 INVALID_IDENTIFIER |
| ON 좌·우 컬럼 타입 호환(조인 키 타입 일치) | 400 JOIN_KEY_TYPE_MISMATCH |
| 체인 규칙 위반(leftColumn 테이블이 base·앞선 조인에 없음) | 400 INVALID_JOIN_CHAIN |
| 조인 시 unqualified 컬럼(모호) | 400 INVALID_IDENTIFIER |
| 동명 테이블이 서로 다른 스키마로 한 쿼리에 동시 등장(예: base `tandanji.events` + join `public.events`) | 400 INVALID_IDENTIFIER (조용한 오선택 방지) |
| `sample`(TABLESAMPLE) + JOIN 동시 사용 | 400 INVALID_REQUEST (표본은 base 블록만 → 조인 결과 왜곡) |

### 11.5 fan-out 주의
1:N 조인 후 `SUM`/`COUNT` 는 기준 행이 증식되어 **중복 집계**된다. MVP 는 UI 경고("1:N 조인 시 합계가 중복될 수 있음 — 고유 개수 권장")로 안내하고, 자동 `COUNT(DISTINCT)` 보정은 후속.

### 11.6 FK 자동 추론 (후속 — 백엔드)
`information_schema.key_column_usage` 로 조인 후보 테이블·ON 컬럼을 추천한다(노코드 UX 핵심). MVP(mock)는 스키마의 FK 힌트로 대체.
