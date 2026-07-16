-- V4: 차트 대분류 확장 — boxplot(상자수염)·heatmap(히트맵)·map(지도)·geoscatter(지도 포인트) 추가.
-- V1 의 chk_mc_chart_type 은 4종 화이트리스트였고 "후속 차트는 추가 시 확장" 전제(V1 L139 주석).
-- 대분류 목록의 SSOT 는 chart-options/optionRegistry.ts MAJOR_TYPES — 이 제약은 그 미러다.

ALTER TABLE mc_chart DROP CONSTRAINT chk_mc_chart_type;
ALTER TABLE mc_chart ADD CONSTRAINT chk_mc_chart_type
    CHECK (chart_type IN ('bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'));
