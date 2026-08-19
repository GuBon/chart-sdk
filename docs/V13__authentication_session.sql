-- ============================================
-- V13__authentication_session.sql (2026-08-14)
-- 공개 회원가입 + 서버 저장형 로그인 세션 기반.
-- 브라우저에는 무작위 세션 ID만 HttpOnly 쿠키로 전달하고 인증 상태는 PostgreSQL에 저장한다.
-- ============================================

ALTER TABLE mc_user
    ADD COLUMN username_normalized VARCHAR(100),
    ADD COLUMN auth_version BIGINT NOT NULL DEFAULT 1;

UPDATE mc_user
   SET username = btrim(username),
       username_normalized = lower(btrim(username));

ALTER TABLE mc_user
    ALTER COLUMN username_normalized SET NOT NULL,
    ADD CONSTRAINT chk_mc_user_username_normalized_blank
        CHECK (btrim(username_normalized) <> '');

CREATE UNIQUE INDEX uq_mc_user_username_normalized
    ON mc_user(username_normalized);

-- spring.session.jdbc.table-name=mc_session 과 일치한다. 식별자를 인용하지 않아
-- Spring Session의 대문자 SQL 식별자도 PostgreSQL에서 같은 소문자 객체로 해석된다.
CREATE TABLE mc_session (
    primary_id                 CHAR(36)     NOT NULL,
    session_id                 CHAR(36)     NOT NULL,
    creation_time              BIGINT       NOT NULL,
    last_access_time           BIGINT       NOT NULL,
    max_inactive_interval      INTEGER      NOT NULL,
    expiry_time                BIGINT       NOT NULL,
    principal_name             VARCHAR(100),
    CONSTRAINT pk_mc_session PRIMARY KEY (primary_id)
);

CREATE UNIQUE INDEX uq_mc_session_id ON mc_session(session_id);
CREATE INDEX idx_mc_session_expiry ON mc_session(expiry_time);
CREATE INDEX idx_mc_session_principal ON mc_session(principal_name);

CREATE TABLE mc_session_attributes (
    session_primary_id         CHAR(36)     NOT NULL,
    attribute_name             VARCHAR(200) NOT NULL,
    attribute_bytes            BYTEA        NOT NULL,
    CONSTRAINT pk_mc_session_attributes PRIMARY KEY (session_primary_id, attribute_name),
    CONSTRAINT fk_mc_session_attributes_session
        FOREIGN KEY (session_primary_id) REFERENCES mc_session(primary_id) ON DELETE CASCADE
);
