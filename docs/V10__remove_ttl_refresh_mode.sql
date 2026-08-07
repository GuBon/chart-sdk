-- 차트 갱신 정책을 수동 스냅샷과 항상 최신 조회 두 가지로 단순화한다.
-- 기존 TTL 차트는 고객 데이터소스 부하가 갑자기 증가하지 않도록 manual로 이관한다.

UPDATE mc_chart
   SET refresh_mode = 'manual'
 WHERE refresh_mode = 'ttl';

ALTER TABLE mc_chart DROP CONSTRAINT chk_mc_chart_refresh;
ALTER TABLE mc_chart DROP CONSTRAINT chk_mc_chart_ttl;
ALTER TABLE mc_chart DROP COLUMN cache_ttl_seconds;
ALTER TABLE mc_chart ALTER COLUMN refresh_mode SET DEFAULT 'manual';
ALTER TABLE mc_chart
    ADD CONSTRAINT chk_mc_chart_refresh
    CHECK (refresh_mode IN ('live', 'manual'));
