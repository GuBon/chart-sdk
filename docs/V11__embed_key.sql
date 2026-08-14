-- ============================================
-- V11__embed_key.sql (2026-08-13)
-- 차트 임베드 키: (사용자, 차트) 쌍에 묶인 불투명 식별자.
--
-- 배경(전수감사 Critical #2): 기존 임베드 스니펫은 chartId 원문 + 사용자 단위 JWT 를 노출해
-- 유효 토큰 하나로 chartId 를 바꿔가며 타 사용자 차트를 열거할 수 있었다. 임베드 키는
-- 차트 식별자를 코드에서 제거하고, 키 자체를 (user_id, chart_id) 에 서버측 바인딩한다.
--
-- 키 원문/해시는 저장하지 않는다. 키 문자열은 `cek1_<id>_<HMAC-SHA256(sig)>` 로,
-- 서버 비밀키(chartsdk.embed.key-secret)로 id 에서 언제든 재파생한다.
--   · DB 가 유출돼도 비밀키 없이는 키를 위조/복원할 수 없다 (mc_user_token 의 원문 저장
--     트레이드오프(PRD 8.2)를 임베드 경로에서 제거).
--   · 키 원문은 발급 응답에서만 한 번 보여주며, S3 모달 재진입 시에는 상태 메타데이터만 제공한다.
--   · 회수는 행 단위 is_active=false 로 즉시 반영된다 (HMAC 단독 방식과 달리 개별 무효화 가능).
--
-- 검증(서빙) 순서 — EmbedKeyInterceptor 한 곳:
--   1) `cek1_<id>_<sig>` 구문 + HMAC 서명 (DB 불요 — 위조 키는 DB 조회 비용을 만들지 않는다)
--   2) id 단건 조회: 행 없음/회수/사용자 비활성 → 401 TOKEN_REVOKED, 만료 → 401 TOKEN_EXPIRED
--   3) 키에 바인딩된 chart_id 로만 차트를 서빙 — 클라이언트는 chartId 를 보낼 수 없다.
-- ============================================

CREATE TABLE mc_embed_key (
    id              BIGSERIAL    PRIMARY KEY,        -- 키 문자열의 <id> 부분 (HMAC 서명 대상)
    user_id         BIGINT       NOT NULL,           -- 발급 대상 사용자 — 차트 소유자 범위 검증에 사용
    chart_id        BIGINT       NOT NULL,           -- 이 키가 서빙할 유일한 차트 (클라이언트 지정 불가)
    expires_at      TIMESTAMPTZ  NOT NULL,           -- 필수 — "무기한" 대신 긴 만료 + 회수로 관리 (mc_user_token 과 동일 정책)
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  VARCHAR(30),                     -- 재발급 교체(ROTATED) / 수동(MANUAL) / 사용자 비활성(USER_DISABLED)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- 사용자/차트 삭제 시 키도 소멸 — 서명이 유효해도 행이 없으면 401 TOKEN_REVOKED 로 수렴한다.
    CONSTRAINT fk_mc_embed_key_user  FOREIGN KEY (user_id)  REFERENCES mc_user(id)  ON DELETE CASCADE,
    CONSTRAINT fk_mc_embed_key_chart FOREIGN KEY (chart_id) REFERENCES mc_chart(id) ON DELETE CASCADE,
    CONSTRAINT chk_mc_embed_key_expiry CHECK (expires_at > created_at),
    -- is_active 와 revoked_at 양방향 일관 (mc_user_token 과 동일 모델: 비활성 = 회수됨)
    CONSTRAINT chk_mc_embed_key_revocation CHECK (
        (is_active = true  AND revoked_at IS NULL)
        OR (is_active = false AND revoked_at IS NOT NULL)
    ),
    CONSTRAINT chk_mc_embed_key_reason CHECK (
        revoked_reason IS NULL OR revoked_reason IN ('ROTATED', 'MANUAL', 'USER_DISABLED')
    )
);

-- (사용자, 차트) 쌍당 활성 키 최대 1개 — 재발급은 "기존 활성 회수 UPDATE + 새 INSERT" 한 트랜잭션(ROTATED).
-- 만료 판정은 인덱스가 못 하므로(now() 는 부분 인덱스 predicate 불가) 검증 쿼리의 expires_at > now() 가 담당.
CREATE UNIQUE INDEX uq_mc_embed_key_active ON mc_embed_key(user_id, chart_id) WHERE is_active;
CREATE INDEX idx_mc_embed_key_chart ON mc_embed_key(chart_id);  -- S3 모달: 차트별 키 목록
CREATE INDEX idx_mc_embed_key_user  ON mc_embed_key(user_id);   -- 사용자 비활성화 시 일괄 회수 경로
