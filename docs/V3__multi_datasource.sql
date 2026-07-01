-- ============================================
-- V3__multi_datasource.sql (2026-07-01) — 다중 데이터소스 페더레이션 (1차트 = N데이터소스)
--   차트가 참조하는 데이터소스 집합을 N:M 으로 기록. 설계 §4/§12.1.
--   · owner-scope 강제: 참조 소스는 owner 소유여야 한다(앱 검증 + FK).
--   · 삭제 정합(API 409): "이 소스를 쓰는 차트" 역조회를 이 junction 으로 한다(단일·다중 공통).
--   · mc_chart.datasource_id 는 primary(base 소스)로 유지 — 단일 소스 하위호환·목록 필터.
-- ============================================

CREATE TABLE mc_chart_datasource (
    chart_id      BIGINT NOT NULL REFERENCES mc_chart(id)      ON DELETE CASCADE,
    datasource_id BIGINT NOT NULL REFERENCES mc_datasource(id) ON DELETE RESTRICT,
    PRIMARY KEY (chart_id, datasource_id)
);

-- "이 데이터소스를 사용하는 차트" 역조회(삭제 가드) 인덱스
CREATE INDEX idx_mc_chart_ds_datasource ON mc_chart_datasource(datasource_id);

-- 기존(단일 소스) 차트 백필 — primary datasource 를 junction 에 채워 삭제 가드가 즉시 유효하게 한다.
INSERT INTO mc_chart_datasource(chart_id, datasource_id)
SELECT id, datasource_id FROM mc_chart
ON CONFLICT DO NOTHING;
