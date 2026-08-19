-- ============================================
-- V14__ownership_invariants.sql (2026-08-14)
-- 로그인 사용자별 차트/데이터소스 격리의 DB 불변식.
-- 기존 NULL 소유 데이터는 운영자가 귀속 대상을 정하기 전까지 NULL로 보존한다.
-- ============================================

ALTER TABLE mc_chart
    ADD CONSTRAINT uq_mc_chart_id_owner UNIQUE (id, owner_id);

ALTER TABLE mc_chart_datasource
    ADD COLUMN owner_id BIGINT;

UPDATE mc_chart_datasource link
   SET owner_id = chart.owner_id
  FROM mc_chart chart
 WHERE chart.id = link.chart_id;

ALTER TABLE mc_chart_datasource
    ADD CONSTRAINT fk_mc_chart_datasource_chart_owner
        FOREIGN KEY (chart_id, owner_id) REFERENCES mc_chart(id, owner_id) ON DELETE CASCADE,
    ADD CONSTRAINT fk_mc_chart_datasource_source_owner
        FOREIGN KEY (datasource_id, owner_id) REFERENCES mc_datasource(id, owner_id) ON DELETE RESTRICT;

CREATE INDEX idx_mc_chart_datasource_owner ON mc_chart_datasource(owner_id);
