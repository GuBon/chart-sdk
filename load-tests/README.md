# 15/30/100 고객 쿼리 용량 검증

이 시나리오는 실제 서버와 고객 DB를 대상으로 다음 세 단계를 순차 실행한다.

- normal: 15 VU, p95 5초 미만, 최종 실패/`QUERY_BUSY` 1% 미만
- peak: 30 VU, p95 8초 미만, 최종 실패 3% 미만, `QUERY_BUSY` 5% 미만
- burst: 100 VU, admission 제어가 서버를 보호하는지 확인. 재시도 후 `QUERY_BUSY` 50% 미만
- 매 10번째 반복은 원본 탐색 `mode=rows`이며 1,000행 상한을 검증한다.
- 나머지는 자동 산점도이며 대형 fixture에서 sampling v9와 `rowCount <= K`를 검증한다.

## 준비

각 고객 DB에 동일한 읽기 전용 fixture(`public.load_points`, `x_value`, `y_value`)를 최소 100만 행으로 준비하고 메타 DB에 등록한다. 100개 독립 데이터소스 경로를 검증할 때는 서로 다른 ID 100개를 전달한다. 운영 자격증명은 스크립트나 저장소에 기록하지 않는다.

```powershell
$env:BASE_URL='http://localhost:8080'
$env:DATASOURCE_IDS='1,2,3'
$env:TABLE_NAME='load_points'
$env:X_COLUMN='x_value'
$env:Y_COLUMN='y_value'
$env:EXPECT_LARGE='true'
k6 run .\load-tests\k6-query-capacity.js
```

## Reservoir fallback 검증

일반적인 최신 통계의 대형 테이블은 `INDEX_RANDOM` 또는 `SYSTEM`으로 계획되므로 reservoir 검증용
fixture는 planner가 작게 판단하고 실제 결과는 큰 상태여야 한다. 운영 테이블의 통계를 변경하지 말고
부하 테스트 전용 테이블을 다음 순서로 만든다.

```sql
CREATE TABLE public.load_points_reservoir (
    id bigint PRIMARY KEY,
    x_value double precision NOT NULL,
    y_value double precision NOT NULL
) WITH (autovacuum_enabled = false);

INSERT INTO public.load_points_reservoir
SELECT n, random(), random() FROM generate_series(1, 5000) AS n;
ANALYZE public.load_points_reservoir;

INSERT INTO public.load_points_reservoir
SELECT n, random(), random() FROM generate_series(5001, 1000000) AS n;
```

테스트 직후 실행하면 planner는 분석 당시 5,000행을 기준으로 `FULL_SCAN`을 선택하고, collector는 실제
10,000행 초과를 확인해 `RESERVOIR_RANDOM`으로 전환한다.

```powershell
$env:TABLE_NAME='load_points_reservoir'
$env:EXPECT_SAMPLE_METHOD='RESERVOIR_RANDOM'
$env:EXPECT_POPULATION_MIN='1000000'
k6 run .\load-tests\k6-query-capacity.js
```

`query_capacity_duration`은 이제 `QUERY_BUSY` 재시도, exponential backoff, jitter를 포함한 최초 요청부터
최종 응답까지의 전체 사용자 대기시간을 측정한다. 테스트가 끝나면 전용 fixture를 제거하거나
autovacuum을 다시 활성화한다.

실제 100개 소스 검증에서는 다음 보호 검사를 함께 켠다.

```powershell
$env:DATASOURCE_IDS='1,2,3,...,100'
$env:REQUIRE_100_DATASOURCES='true'
k6 run .\load-tests\k6-query-capacity.js
```

빠른 smoke는 `$env:STAGE_DURATION='15s'`, `$env:BURST_DURATION='15s'`, `$env:STAGE_GAP='2s'`로 줄일 수 있다. 합격 판정에는 기본 지속시간을 사용하고, 동시에 Prometheus에서 query queue/rejection/timeout, heap/GC, pool pending/registry size, reservoir 활성화를 확인한다.

`QUERY_BUSY` 재시도는 100~400ms exponential backoff와 jitter를 적용한다. 자동 표본 OFF·수동 표본·raw SQL 차트는 이 테스트의 `rowCount <= K` 계약 대상이 아니다.
