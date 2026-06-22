-- ============================================
-- V1__init.sql (v4.1 — UI 전수 매핑 + 1인 1활성 토큰, 2026-06-19)
-- 사용자 토큰 · 노코드 빌더 · 다중 데이터소스 · 결과 캐시
-- 규칙: 모든 객체(테이블·인덱스·제약)는 mc_ 접두사 — Type B(기존 운영 DB 설치) 이름 충돌 방지
-- 시간: TIMESTAMPTZ 통일 (API 계약 ISO 8601 UTC와 정합)
-- 저장 전략(하이브리드): 엔티티·관계·조회/정렬 대상 = 정규화 컬럼 / 끝없이 느는 시각화 옵션·빌더 구성 = JSONB
--   (옵션 추가 시 마이그레이션 불필요 — Metabase·Grafana 동일 전략). 전 UI 요소 매핑은 docs/DB스키마_UI매핑.md 참조.
-- v4 변경: chart_type 4종(원형·분포 활성), datasource 연결테스트 상태 영속화, 캐시 썸네일, 목록 정렬·검색 인덱스
-- v4.1 변경(2026-06-19): 1인 1활성 토큰 모델 확정 — mc_user_token.label 제거(다중 토큰 식별 불필요), 활성 토큰 부분 유니크 인덱스 추가
-- ============================================

-- 사용자 (인증 구현은 추후 — 구조만 선행)
CREATE TABLE mc_user (
    id              BIGSERIAL    PRIMARY KEY,
    username        VARCHAR(100) NOT NULL,           -- 임시 로그인 ID (추후 SSO 식별자로 전환)
    password_hash   VARCHAR(200),                    -- 임시 자체 로그인용. SSO 전환 시 미사용(NULL)
    display_name    VARCHAR(100),
    role            VARCHAR(20)  NOT NULL DEFAULT 'member',
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_mc_user_username UNIQUE (username),
    CONSTRAINT chk_mc_user_role    CHECK (role IN ('admin', 'member'))
);

-- 사용자 임베드 토큰 (사용자에 귀속 — 차트 아님). 1인 1활성 토큰: 사용자당 활성 토큰은 최대 1개 (본인 것만).
-- 검증 경로: JWT의 jti(= 본 테이블 PK)로 단건 조회 → is_active 확인 (PRD 9.1)
-- token은 원문 저장: S3 임베드 모달이 토큰을 선택해 스니펫에 끼우는 동선에 필요.
--   사내 전용 + 메타 DB 접근 통제를 전제로 한 의도적 트레이드오프 (PRD 8.2)
CREATE TABLE mc_user_token (
    id              BIGSERIAL    PRIMARY KEY,        -- = JWT jti 클레임
    user_id         BIGINT       NOT NULL,
    token           TEXT         NOT NULL,           -- JWT 원문 {userId, jti, iat, exp, v}
    expires_at      TIMESTAMPTZ  NOT NULL,           -- 필수 — "무기한" 대신 긴 만료 + 회수로 관리 (PRD 7.4)
    is_active       BOOLEAN      NOT NULL DEFAULT true,  -- 회수 시 false
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_mc_user_token_user FOREIGN KEY (user_id) REFERENCES mc_user(id) ON DELETE CASCADE
);
-- 1인 1활성 토큰 강제: 사용자당 활성 토큰 최대 1개 (회수된 과거 행은 이력으로 보존 — 부분 유니크라 중복에 안 걸림). 활성 토큰 조회(S3)도 겸함.
CREATE UNIQUE INDEX uq_mc_user_token_active ON mc_user_token(user_id) WHERE is_active;
CREATE INDEX idx_mc_user_token_user ON mc_user_token(user_id);  -- S7 사용자별 토큰 이력 목록(회수·만료 포함)

-- 데이터 소스 (다중 PostgreSQL 연결)
CREATE TABLE mc_datasource (
    id              BIGSERIAL    PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,           -- 표시명 (예: "analytics-db") — S2 셀렉트 식별자
    host            VARCHAR(255) NOT NULL,
    port            INTEGER      NOT NULL DEFAULT 5432,
    database_name   VARCHAR(100) NOT NULL,
    db_user         VARCHAR(100) NOT NULL,           -- 읽기 전용 계정 권장
    db_password_enc TEXT         NOT NULL,           -- AES-GCM: base64(IV || ciphertext || tag), 키는 .env
    max_pool_size   INTEGER      NOT NULL DEFAULT 5, -- 이 소스의 HikariCP 커넥션 상한 (운영 DB 보호) — S5 추가모달 '고급 설정'
    last_tested_at  TIMESTAMPTZ,                     -- 마지막 연결 테스트 시각 (S5 목록 상태 점)
    last_test_ok    BOOLEAN,                         -- 마지막 연결 테스트 성공 여부 (NULL=미테스트 / true=연결됨 / false=연결 실패) — S5 상태 점
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),  -- 갱신은 애플리케이션(JPA @PreUpdate) 책임
    CONSTRAINT uq_mc_datasource_name UNIQUE (name),
    CONSTRAINT chk_mc_datasource_port CHECK (port BETWEEN 1 AND 65535),
    CONSTRAINT chk_mc_datasource_pool CHECK (max_pool_size BETWEEN 1 AND 50)
);

-- 차트 정의
CREATE TABLE mc_chart (
    id              BIGSERIAL    PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    description     VARCHAR(500),                    -- S1 카드 1줄 표시·검색용 (PRD v1.3)
    datasource_id   BIGINT       NOT NULL,           -- 어느 DB에서 뽑는가 (차트 1개 = 소스 1개)
    define_mode     VARCHAR(10)  NOT NULL DEFAULT 'builder',  -- 새 차트는 항상 노코드 시작 (v2.2)
    sql_query       TEXT         NOT NULL,           -- 실행 SQL. builder 모드면 저장 시 서버가 builder_config에서 재생성(일관성 보장)
    builder_config  JSONB,                           -- 노코드 상태 (builder 모드만, 복원용)
    chart_type      VARCHAR(20)  NOT NULL,           -- 대분류만 (4종 활성: bar/line/pie/scatter). 소분류·외형은 options.variant + options JSONB

    options         JSONB        NOT NULL DEFAULT '{}',
    owner_id        BIGINT,                          -- 작성자 (로그인 구현 전 NULL 허용)
    refresh_mode    VARCHAR(10)  NOT NULL DEFAULT 'ttl',  -- 'live'(매 요청) | 'ttl'(주기 캐시) | 'manual'(정적 — 저장/수동 갱신 시만 계산)
    cache_ttl_seconds INTEGER    NOT NULL DEFAULT 3600,   -- ttl 모드의 캐시 유효 시간
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),  -- 갱신은 애플리케이션 책임
    CONSTRAINT chk_mc_chart_type        CHECK (chart_type IN ('bar', 'line', 'pie', 'scatter')),  -- 4대분류 활성 (후속 차트는 추가 시 확장)
    CONSTRAINT chk_mc_chart_define_mode CHECK (define_mode IN ('sql', 'builder')),
    CONSTRAINT chk_mc_chart_refresh     CHECK (refresh_mode IN ('live', 'ttl', 'manual')),
    CONSTRAINT chk_mc_chart_ttl         CHECK (cache_ttl_seconds > 0),                                  -- 0/음수 TTL 방지
    CONSTRAINT chk_mc_chart_builder     CHECK (define_mode <> 'builder' OR builder_config IS NOT NULL),  -- 노코드 차트는 복원용 builder_config 필수 (SQL 전환 시 NULL 허용)
    CONSTRAINT fk_mc_chart_datasource   FOREIGN KEY (datasource_id) REFERENCES mc_datasource(id) ON DELETE RESTRICT,  -- 삭제는 API 409 경고 경유 (API 4A)
    CONSTRAINT fk_mc_chart_owner        FOREIGN KEY (owner_id) REFERENCES mc_user(id) ON DELETE SET NULL
);
CREATE INDEX idx_mc_chart_datasource ON mc_chart(datasource_id);   -- 소스 삭제 시 사용 차트 수 카운트(409)
CREATE INDEX idx_mc_chart_updated_at ON mc_chart(updated_at DESC);  -- S1 목록 기본 정렬(updated_at DESC, API 3.1)
-- S1 검색(API 3.1): 쿼리는 `name ILIKE '%q%' OR description ILIKE '%q%'`.
-- 데이터 증가 시 trigram GIN 권장 — 단 `col ILIKE ?`는 컬럼별 인덱스라야 사용된다.
--   (연결식 표현 인덱스 `(name||description)`는 OR 조건에 안 걸린다 — 표현식이 쿼리와 동일해야만 사용됨.)
-- pg_trgm은 표준 contrib이나 Type B(기존 운영 DB)에서 EXTENSION 권한이 없을 수 있어 선택 적용(미적용 시 소규모는 seq scan).
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX idx_mc_chart_name_trgm ON mc_chart USING gin (name        gin_trgm_ops);
-- CREATE INDEX idx_mc_chart_desc_trgm ON mc_chart USING gin (description gin_trgm_ops);

-- 차트 결과 캐시 (대용량 대응 — 임베드 요청이 매번 운영 DB 집계를 때리지 않게)
-- 행 제한 1000행 덕에 결과가 수십 KB 수준 → 별도 인프라(Redis) 없이 메타 DB에 저장 (Type A/B 배포 단순성 유지)
-- 갱신 규칙: S2 저장 시 시드, ttl 모드는 만료 시 재계산(stale-while-revalidate), 동일 차트 재계산 중복 실행 방지
CREATE TABLE mc_chart_cache (
    chart_id      BIGINT       PRIMARY KEY,
    result        JSONB        NOT NULL,           -- columns + rows (변환기 입력 형태) — 항상 "마지막 성공" 결과
    computed_at   TIMESTAMPTZ  NOT NULL,
    elapsed_ms    INTEGER,
    row_count     INTEGER,
    thumbnail     TEXT,                            -- S1 카드 썸네일(선택, base64/경로). MVP는 차트종류 일러스트 → NULL. 후속(PRD 12). 주의: 임베드 핫패스는 result만 SELECT(thumbnail 미로딩)
    last_error    TEXT,                            -- 백그라운드 재계산 실패 시 기록. 성공 캐시(result)는 유지 — 임베드는 계속 동작
    last_error_at TIMESTAMPTZ,
    CONSTRAINT fk_mc_chart_cache_chart FOREIGN KEY (chart_id) REFERENCES mc_chart(id) ON DELETE CASCADE
);
