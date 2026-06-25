-- ============================================
-- V2__integrity.sql (2026-06-25) — 데이터 정합성 보강
--   ① mc_chart.version           : 낙관적 동시성 제어(G3) + 캐시 정의 버전(G2)의 단일 소스
--   ② mc_chart_cache.definition_version : 이 캐시가 어느 정의(version)로 계산됐는지 — 정의≠데이터 탐지
-- 규칙: 기존 행은 DEFAULT/백필로 정합 상태 유지(version=0, 캐시 definition_version=0).
-- ============================================

-- 낙관적 락 + 정의 버전 (저장마다 1 증가). 기존 행은 0.
ALTER TABLE mc_chart ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- 캐시가 계산된 시점의 차트 정의 버전. NULL = 미상(보수적으로 stale 취급).
ALTER TABLE mc_chart_cache ADD COLUMN IF NOT EXISTS definition_version INTEGER;

-- 기존 캐시는 현재 정의(version=0)로 간주해 불필요한 즉시 재계산을 피한다.
UPDATE mc_chart_cache SET definition_version = 0 WHERE definition_version IS NULL;
