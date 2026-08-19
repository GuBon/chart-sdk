-- ============================================
-- V17__admin_audit_log.sql (2026-08-18)
-- 관리자 사용자 변경 감사 이력. 비밀번호·세션 ID·임베드 키 원문은 저장하지 않는다.
-- ============================================

CREATE TABLE mc_admin_audit_log (
    id              BIGSERIAL    PRIMARY KEY,
    actor_user_id   BIGINT       NOT NULL,
    action          VARCHAR(50)  NOT NULL,
    target_type     VARCHAR(30)  NOT NULL,
    target_id       BIGINT       NOT NULL,
    details         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    request_id      VARCHAR(100),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_mc_admin_audit_actor
        FOREIGN KEY (actor_user_id) REFERENCES mc_user(id) ON DELETE RESTRICT,
    CONSTRAINT chk_mc_admin_audit_action_blank CHECK (btrim(action) <> ''),
    CONSTRAINT chk_mc_admin_audit_target_type_blank CHECK (btrim(target_type) <> '')
);

CREATE INDEX idx_mc_admin_audit_target
    ON mc_admin_audit_log(target_type, target_id, created_at DESC);
CREATE INDEX idx_mc_admin_audit_actor
    ON mc_admin_audit_log(actor_user_id, created_at DESC);
