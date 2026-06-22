# 노코드 → SQL 생성 규칙 설계서

**문서 버전:** v1.1 — 날짜 버킷팅(xAxisBucket) MVP 편입, 시리즈 분할(breakout) 확장 예약 (2026-06-12 갱신)
**관련 문서:** PRD v1.6 (7.3), API 계약서 v1.4 (builderConfig), 화면설계서 v2.4 (S2 노코드 탭)
**대상 DB:** PostgreSQL 고정

---

## 1. 원칙

1. 노코드는 SQL 생성기다. 생성된 SQL은 기존 실행 파이프라인(SELECT 검증 → 읽기 전용 실행 → 변환기)을 그대로 통과한다. 별도 실행 경로를 만들지 않는다.
2. 식별자(테이블·컬럼)는 바인딩이 불가능하므로 화이트리스트 검증으로 통제한다: information_schema에 실재하는 이름만 허용하고, 통과한 식별자는 큰따옴표로 감싼다.
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
  "limit": 1000
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| table | ✓ | 단일 테이블 (MVP: JOIN 미지원) |
| xAxis | ✓ | X축 컬럼 1개 |
| xAxisBucket | — | `"day"` \| `"week"` \| `"month"` \| null. X축이 날짜 타입일 때만 허용. 지정 시 DATE_TRUNC로 묶어 집계 (3A장) |
| yAxis | ✓ (1개 이상) | 값 컬럼 + 집계. 복수면 다중 시리즈 |
| yAxis[].alias | — | 시리즈 표시명. 미지정 시 자동 생성 ("sum_amount") |
| where | — | 조건 배열. 전부 AND 결합 (MVP: OR 미지원) |
| orderBy | — | target: "x" 또는 "y{인덱스}". 미지정 시 ORDER BY 없음 |
| limit | — | 미지정 시 시스템 기본(1000) 강제 |

## 3. 집계(agg) 템플릿

| agg | 생성 SQL | 허용 컬럼 타입 |
|---|---|---|
| sum | SUM("col") | 숫자 |
| avg | AVG("col") | 숫자 |
| count | COUNT("col") | 모든 타입 |
| count_distinct | COUNT(DISTINCT "col") | 모든 타입 |
| min | MIN("col") | 숫자·날짜·문자 |
| max | MAX("col") | 숫자·날짜·문자 |

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

  xCol = config.xAxisBucket
       ? "DATE_TRUNC('" + config.xAxisBucket + "', " + quote(xAxis) + ") AS " + quote(xAxis)
       : quote(xAxis)
  select = [ xCol ]
        + [ aggTemplate(y) + " AS " + quote(aliasOf(y)) for y in yAxis ]
  whereSql, binds = buildWhere(config.where)             # ? 와 바인딩 값 목록 생성
  orderSql = buildOrder(config.orderBy)                  # x → 1번 컬럼, y{i} → (i+2)번 별칭

  sql = "SELECT " + join(select)
      + " FROM " + quote(table)
      + (whereSql ? " WHERE " + whereSql : "")
      + " GROUP BY " + (config.xAxisBucket ? "1" : quote(xAxis))
      + (orderSql ? " ORDER BY " + orderSql : "")
      + " LIMIT " + min(config.limit ?? 1000, 1000)
  return (sql, binds)
```

- quote(name): 큰따옴표로 감싸고 내부 " 는 "" 로 escape. 단 화이트리스트를 통과한 이름만 여기까지 온다(이중 방어).
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

모두 SQL 생성 전에 차단한다. 노코드 사용자는 DB 에러를 보지 않는 것이 목표다(SQL 모드는 반대로 DB 에러를 그대로 노출 — 사용자층이 다르다).

## 10. MVP 범위 밖 (확장 예약)

- 시리즈 분할 (breakout, 카테고리로 시리즈 나누기) — **1순위 확장.** "부서별 월 매출을 선 여러 개로" 같은 요구. builderConfig에 `seriesBy`(두 번째 그룹 차원) 필드를 추가하고, 생성 SQL은 `GROUP BY x, seriesBy` 2차원이 된다. 서버 변환기에 피벗 단계가 추가된다: rows(x, seriesBy, 값) → x별로 seriesBy 값을 컬럼으로 전개 → "첫 컬럼=X, 나머지=시리즈" 컨벤션의 입력 형태로 변환. 즉 변환기를 (rows → [피벗] → series 조립) 단계 구조로 두면 피벗 단계만 끼우면 된다. UI는 노코드 폼에 "시리즈 나누기" 행으로 자리만 표기(비활성).
- 차트 대분류 확장(원형·분포) — 원형: yAxis 1개 제약 검증 추가. 분포(산점도): 집계 `none`(GROUP BY 없이 원본 행) + X축 숫자 타입 허용이 필요 — 3장 agg 표와 6장 생성 알고리즘의 확장 지점. 소분류(variant)는 시각화 전용이라 SQL 생성에 영향 없음
- JOIN (테이블 2개 이상) — builderConfig에 joins[] 추가로 확장 가능. 우회: 운영 DB에 읽기 전용 뷰를 만들어 데이터소스로 등록하면 단일 테이블 제약이 완화된다
- OR / 조건 그룹 — where를 중첩 그룹 구조로 확장
- HAVING (집계 결과 필터)
- 쿼리 파라미터 {{}} 와의 결합 (파라미터 설계 확정 후)

(날짜 버킷팅은 v1.1에서 MVP로 편입 — 3A장)
