-- ============================================
-- V5__cache_refresh_state.sql (2026-07-29)
-- 재계산 실패 상태와 마지막 성공 결과를 분리한다.
-- 성공 결과가 한 번도 없는 최초 시드 실패도 last_error/last_error_at으로 관측할 수 있도록
-- result/computed_at이 함께 NULL인 error-only 행을 허용한다.
-- ============================================

ALTER TABLE mc_chart_cache ALTER COLUMN result DROP NOT NULL;
ALTER TABLE mc_chart_cache ALTER COLUMN computed_at DROP NOT NULL;

ALTER TABLE mc_chart_cache
    ADD CONSTRAINT chk_mc_chart_cache_success_pair
        CHECK ((result IS NULL AND computed_at IS NULL)
            OR (result IS NOT NULL AND computed_at IS NOT NULL));
