-- V14 이후 로그인 전 생성된 owner_id IS NULL 데이터를 한 사용자에게 귀속할 때 사용하는 운영 템플릿.
-- 실행 전 아래 :owner_id 를 실제 mc_user.id로 치환하고, 조회 결과를 반드시 검토한다.
-- 여러 사용자에게 나눠야 한다면 전체 UPDATE를 실행하지 말고 id 조건을 추가해 묶음별로 수행한다.

BEGIN;

-- 1) 대상 확인. username_normalized까지 확인한 뒤 owner_id 값을 정한다.
SELECT id, username, username_normalized, role, is_active
  FROM mc_user
 ORDER BY id;

-- 2) 데이터소스를 먼저 귀속해야 차트의 복합 FK가 통과한다.
UPDATE mc_datasource
   SET owner_id = :owner_id
 WHERE owner_id IS NULL;

UPDATE mc_chart
   SET owner_id = :owner_id
 WHERE owner_id IS NULL;

UPDATE mc_chart_datasource link
   SET owner_id = chart.owner_id
  FROM mc_chart chart
 WHERE chart.id = link.chart_id
   AND link.owner_id IS NULL;

-- 3) 미귀속 행이 0인지, 교차 소유 연결이 0인지 확인한다.
SELECT
    (SELECT count(*) FROM mc_datasource WHERE owner_id IS NULL) AS unowned_datasources,
    (SELECT count(*) FROM mc_chart WHERE owner_id IS NULL) AS unowned_charts,
    (SELECT count(*) FROM mc_chart_datasource WHERE owner_id IS NULL) AS unowned_links;

SELECT count(*) AS cross_owner_links
  FROM mc_chart_datasource link
  JOIN mc_chart chart ON chart.id = link.chart_id
  JOIN mc_datasource source ON source.id = link.datasource_id
 WHERE link.owner_id IS DISTINCT FROM chart.owner_id
    OR link.owner_id IS DISTINCT FROM source.owner_id;

-- 검증 결과가 모두 0일 때만 COMMIT으로 바꿔 실행한다.
ROLLBACK;
