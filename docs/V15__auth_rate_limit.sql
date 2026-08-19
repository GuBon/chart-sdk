-- ============================================
-- V15__auth_rate_limit.sql (2026-08-14)
-- 로그인/공개 가입 무차별 대입 방어. 원 IP·아이디 대신 SHA-256 키만 저장한다.
-- ============================================

CREATE TABLE mc_auth_rate_limit (
    key_hash          CHAR(64)    PRIMARY KEY,
    action            VARCHAR(30) NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts          INTEGER     NOT NULL DEFAULT 0,
    blocked_until     TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_mc_auth_rate_limit_attempts CHECK (attempts >= 0)
);

CREATE INDEX idx_mc_auth_rate_limit_updated ON mc_auth_rate_limit(updated_at);
