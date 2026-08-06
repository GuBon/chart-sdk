-- ============================================
-- V1__init.sql (v5.0 — 개인 사용자 스코프 확정 + UI 전수 매핑 + 1인 1활성 토큰, 2026-06-23)
-- 사용자 토큰 · 노코드 빌더 · 다중 데이터소스 · 결과 캐시
-- 규칙: 모든 객체(테이블·인덱스·제약·트리거·함수)는 mc_ 접두사 — Type B(기존 운영 DB 설치) 이름 충돌 방지
-- 시간: TIMESTAMPTZ 통일 (API 계약 ISO 8601 UTC와 정합)
-- 저장 전략(하이브리드): 엔티티·관계·조회/정렬 대상 = 정규화 컬럼 / 끝없이 느는 시각화 옵션·빌더 구성 = JSONB
--   (옵션 추가 시 마이그레이션 불필요 — Metabase·Grafana 동일 전략). 전 UI 요소 매핑은 docs/데이터모델_화면저장_매핑.md 참조.
-- v4 변경: chart_type 4종(원형·분포 활성), datasource 연결테스트 상태 영속화, 캐시 썸네일, 목록 정렬·검색 인덱스
-- v4.1 변경(2026-06-19): 1인 1활성 토큰 모델 확정 — mc_user_token.label 제거(다중 토큰 식별 불필요), 활성 토큰 부분 유니크 인덱스 추가
-- v5.1 문서 갱신(2026-06-29): 제품요구사항 v1.8 / 인터페이스 계약 v1.6 / 데이터모델 화면저장 매핑 v1.3.
--   DDL 변경은 없고, builder_config JSONB의 `agg:"none"` 원본값 튜플 모드를 모든 차트 타입에서 사용한다.
-- v5.0 변경(2026-06-23): 개인 사용자 스코프 확정 (제품요구사항 v1.7 / 인터페이스 계약 v1.5 / 데이터모델 화면저장 매핑 v1.2)
--   ① mc_datasource.owner_id 도입 — 데이터소스명은 사용자별 유니크(owner_id, name)
--   ② mc_chart 가 다른 사용자의 데이터소스를 참조하지 못하도록 (datasource_id, owner_id) 복합 FK 추가
--   ③ updated_at 은 애플리케이션이 아니라 DB 트리거(mc_touch_updated_at)로 강제 — 갱신 누락 방지
--   ④ pg_trgm GIN 검색 인덱스 활성화 — S1 이름·설명 ILIKE 검색 최적화
--   ※ owner_id 는 로그인 구현 전까지 NULL 허용(인증 컨텍스트에서 자동 주입). 노코드 신기능(표본추출 sample·stddev·none 원본값 모드)은
--     builder_config JSONB 가 그대로 수용하므로 스키마 변경 없음. chart_type 4종(bar/line/pie/scatter)이 원형·분포 대분류를 커버.
--     none + sample은 sampling v6 ROW_SAMPLE로 허용하고, none + 집계 혼합만 앱/서버에서 금지한다. joins[] + sample은 RESULT_RANDOM으로 실행한다.
--     기존 고객 DB의 TABLE/VIEW/MATERIALIZED VIEW를 읽기 원본으로 지원하되, 앱은 고객 DB 객체를 생성·수정·갱신하지 않는다.
-- ============================================

-- 표본·검색 최적화용 표준 contrib. Type B(기존 운영 DB)에서는 설치 전 CREATE EXTENSION 권한을 확인한다(PRD 7장).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- updated_at 자동 갱신 트리거 함수 — UPDATE 시 현재 시각으로 강제(애플리케이션 누락 방지, PRD 9장)
CREATE OR REPLACE FUNCTION mc_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 사용자 (인증 구현은 추후 — 구조만 선행)
CREATE TABLE mc_user (
    id              BIGSERIAL    PRIMARY KEY,
    username        VARCHAR(100) NOT NULL,           -- 임시 로그인 ID (추후 SSO 식별자로 전환)
    password_hash   VARCHAR(200),                    -- 임시 자체 로그인용. SSO 전환 시 미사용(NULL)
    display_name    VARCHAR(100),
    role            VARCHAR(20)  NOT NULL DEFAULT 'member',
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_mc_user_username       UNIQUE (username),
    CONSTRAINT chk_mc_user_role          CHECK (role IN ('admin', 'member')),
    CONSTRAINT chk_mc_user_username_blank CHECK (btrim(username) <> '')  -- NOT NULL 은 빈 문자열을 막지 못한다
);

-- 사용자 임베드 토큰 (사용자에 귀속 — 차트 아님). 1인 1활성 토큰: 사용자당 활성 토큰은 최대 1개 (본인 것만).
-- token은 원문 저장: S3 임베드 모달이 토큰을 선택해 스니펫에 끼우는 동선에 필요.
--   사내 전용 + 메타 DB 접근 통제를 전제로 한 의도적 트레이드오프 (PRD 8.2)
-- ── 임베드 토큰 검증(PRD 9.1) — is_active 단독 확인으로 불충분. 다음을 모두 통과해야 한다 ──
--   1) JWT 서명  2) JWT exp  까지는 DB 없이. 이어서 단건 조회로:
--   SELECT t.id, t.user_id, t.expires_at
--     FROM mc_user_token t JOIN mc_user u ON u.id = t.user_id
--    WHERE t.id = :jti AND t.user_id = :jwt_user_id   -- jti 와 토큰 소유자 일치(탈취 토큰 차단)
--      AND t.is_active = true AND t.expires_at > now() -- 회수·만료 차단(만료는 인덱스로 못 막으므로 쿼리에서)
--      AND u.is_active = true;                          -- 사용자 비활성화 ↔ 토큰만 활성 잔존 케이스 차단
CREATE TABLE mc_user_token (
    id              BIGSERIAL    PRIMARY KEY,        -- = JWT jti 클레임
    user_id         BIGINT       NOT NULL,
    token           TEXT         NOT NULL,           -- JWT 원문 {userId, jti, iat, exp, v}
    expires_at      TIMESTAMPTZ  NOT NULL,           -- 필수 — "무기한" 대신 긴 만료 + 회수로 관리 (PRD 7.4)
    is_active       BOOLEAN      NOT NULL DEFAULT true,  -- 회수 시 false (= "회수됨". 만료는 expires_at 로 별도 판정)
    revoked_at      TIMESTAMPTZ,                     -- 회수 시각 (S7 이력). 활성 토큰은 항상 NULL
    revoked_reason  VARCHAR(30),                     -- 회수 사유: 발급 교체(ROTATED) / 수동(MANUAL) / 사용자 비활성(USER_DISABLED)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_mc_user_token_user FOREIGN KEY (user_id) REFERENCES mc_user(id) ON DELETE CASCADE,
    CONSTRAINT chk_mc_user_token_expiry CHECK (expires_at > created_at),  -- 생성 즉시 만료된 토큰 차단
    -- is_active 와 revoked_at 양방향 일관: 활성=회수시각 없음 / 비활성=회수시각 있음 (이 모델에서 비활성 = 회수됨)
    CONSTRAINT chk_mc_user_token_revocation CHECK (
        (is_active = true  AND revoked_at IS NULL)
        OR (is_active = false AND revoked_at IS NOT NULL)
    ),
    CONSTRAINT chk_mc_user_token_reason CHECK (
        revoked_reason IS NULL OR revoked_reason IN ('ROTATED', 'MANUAL', 'USER_DISABLED')
    )
);
-- 1인 1활성 토큰 강제: 사용자당 활성 토큰 최대 1개 (회수된 과거 행은 이력으로 보존 — 부분 유니크라 중복에 안 걸림). 활성 토큰 조회(S3)도 겸함.
-- ※ 인덱스는 is_active 만 본다(만료 여부는 못 본다 — now()는 immutable 이 아니라 부분 인덱스 predicate 에 쓸 수 없다).
--   따라서 만료됐지만 is_active=true 로 남은 토큰이 새 발급을 막을 수 있으므로, 발급은 반드시 "기존 활성 회수 UPDATE + 새 INSERT"를
--   한 트랜잭션으로 처리한다(ROTATED). 만료 판정은 위 검증 쿼리의 expires_at > now() 가 담당.
CREATE UNIQUE INDEX uq_mc_user_token_active ON mc_user_token(user_id) WHERE is_active;
CREATE INDEX idx_mc_user_token_user ON mc_user_token(user_id);  -- S7 사용자별 토큰 이력 목록(회수·만료 포함)

-- 데이터 소스 (다중 PostgreSQL 연결, 개인 사용자 소유)
CREATE TABLE mc_datasource (
    id              BIGSERIAL    PRIMARY KEY,
    owner_id        BIGINT,                          -- 등록한 개인 사용자 (로그인 구현 전 NULL 허용, 인증 컨텍스트 자동 주입)
    name            VARCHAR(100) NOT NULL,           -- 표시명 (예: "analytics-db") — S2 셀렉트 식별자. 사용자별 유니크
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
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),  -- 갱신은 DB 트리거(mc_touch_updated_at) 책임
    -- mc_chart 의 (datasource_id, owner_id) 복합 FK 가 참조할 타겟 (소유자 일치 강제용). 일반 UNIQUE 라 PG 버전 무관.
    CONSTRAINT uq_mc_datasource_id_owner UNIQUE (id, owner_id),
    CONSTRAINT chk_mc_datasource_port CHECK (port BETWEEN 1 AND 65535),
    CONSTRAINT chk_mc_datasource_pool CHECK (max_pool_size BETWEEN 1 AND 50),
    CONSTRAINT chk_mc_datasource_name_blank     CHECK (btrim(name) <> ''),
    CONSTRAINT chk_mc_datasource_host_blank     CHECK (btrim(host) <> ''),
    CONSTRAINT chk_mc_datasource_database_blank CHECK (btrim(database_name) <> ''),
    CONSTRAINT chk_mc_datasource_db_user_blank  CHECK (btrim(db_user) <> ''),
    -- 연결 테스트 상태 일관: 미테스트(둘 다 NULL) 또는 테스트됨(둘 다 NOT NULL). (tested_at NULL, ok=true) 모순 차단
    CONSTRAINT chk_mc_datasource_test_state CHECK (
        (last_tested_at IS NULL AND last_test_ok IS NULL)
        OR (last_tested_at IS NOT NULL AND last_test_ok IS NOT NULL)
    ),
    CONSTRAINT fk_mc_datasource_owner FOREIGN KEY (owner_id) REFERENCES mc_user(id) ON DELETE RESTRICT  -- 소유자 삭제는 비활성화 우선(차단)
);
CREATE TRIGGER trg_mc_datasource_touch BEFORE UPDATE ON mc_datasource
    FOR EACH ROW EXECUTE FUNCTION mc_touch_updated_at();
-- 데이터소스명은 사용자별 유니크. PG15+ 의 UNIQUE NULLS NOT DISTINCT 대신 부분 유니크 인덱스 2개로 구현 —
-- Type B(기존 운영 DB) 의 PostgreSQL 버전을 솔루션이 통제할 수 없으므로 PG9.5+ 호환 문법만 사용한다.
CREATE UNIQUE INDEX uq_mc_datasource_owner_name      ON mc_datasource(owner_id, name) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX uq_mc_datasource_null_owner_name ON mc_datasource(name)            WHERE owner_id IS NULL;  -- 로그인 전 단일 사용자: 동명 차단

-- 차트 정의 (개인 사용자 소유)
CREATE TABLE mc_chart (
    id              BIGSERIAL    PRIMARY KEY,
    owner_id        BIGINT,                          -- 작성자 (로그인 구현 전 NULL 허용, 인증 컨텍스트 자동 주입)
    name            VARCHAR(200) NOT NULL,
    description     VARCHAR(500),                    -- S1 카드 1줄 표시·검색용 (PRD v1.3)
    datasource_id   BIGINT       NOT NULL,           -- 어느 DB에서 뽑는가 (차트 1개 = 소스 1개)
    define_mode     VARCHAR(10)  NOT NULL DEFAULT 'builder',  -- 새 차트는 항상 노코드 시작 (v2.2)
    sql_query       TEXT         NOT NULL,           -- 실행 SQL. builder 모드면 저장 시 서버가 builder_config에서 재생성(일관성 보장)
    builder_config  JSONB,                           -- 노코드 상태 (builder 모드만, 복원용). joins·sample·stddev·none(모든 차트 원본값 튜플) 등 신규 키는 마이그레이션 0. joins+sample·none+sample 허용, none+집계 혼합만 앱 검증.
    chart_type      VARCHAR(20)  NOT NULL,           -- 대분류만 (4종 활성: bar/line/pie/scatter). 소분류·외형은 options.variant + options JSONB

    options         JSONB        NOT NULL DEFAULT '{}',
    refresh_mode    VARCHAR(10)  NOT NULL DEFAULT 'ttl',  -- 'live'(매 요청) | 'ttl'(주기 캐시) | 'manual'(정적 — 저장/수동 갱신 시만 계산)
    cache_ttl_seconds INTEGER    NOT NULL DEFAULT 3600,   -- ttl 모드의 캐시 유효 시간
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),  -- 갱신은 DB 트리거(mc_touch_updated_at) 책임
    CONSTRAINT chk_mc_chart_type        CHECK (chart_type IN ('bar', 'line', 'pie', 'scatter')),  -- 4대분류 활성 (후속 차트는 추가 시 확장)
    CONSTRAINT chk_mc_chart_define_mode CHECK (define_mode IN ('sql', 'builder')),
    CONSTRAINT chk_mc_chart_refresh     CHECK (refresh_mode IN ('live', 'ttl', 'manual')),
    CONSTRAINT chk_mc_chart_ttl         CHECK (cache_ttl_seconds > 0),                                  -- 0/음수 TTL 방지
    CONSTRAINT chk_mc_chart_name_blank  CHECK (btrim(name) <> ''),
    CONSTRAINT chk_mc_chart_sql_blank   CHECK (btrim(sql_query) <> ''),                                 -- 빈 SQL 차단 (매핑 문서 S2 약속 이행)
    CONSTRAINT chk_mc_chart_options_obj CHECK (jsonb_typeof(options) = 'object'),                       -- 설정은 객체만 ([] · "str" 차단)
    CONSTRAINT chk_mc_chart_builder_obj CHECK (builder_config IS NULL OR jsonb_typeof(builder_config) = 'object'),
    CONSTRAINT chk_mc_chart_builder     CHECK (define_mode <> 'builder' OR builder_config IS NOT NULL),  -- 노코드 차트는 복원용 builder_config 필수 (SQL 전환 시 NULL 허용)
    CONSTRAINT fk_mc_chart_datasource   FOREIGN KEY (datasource_id) REFERENCES mc_datasource(id) ON DELETE RESTRICT,  -- 존재성 보장 + 삭제는 API 409 경고 경유 (API 4A)
    -- 소유자 일치 강제(INSERT/UPDATE 시): 차트가 다른 사용자의 데이터소스를 참조하지 못한다 (PRD 9장).
    -- owner_id NULL(로그인 전)이면 MATCH SIMPLE 로 미검증 — 존재성·삭제정책(RESTRICT)은 위 단일 FK 담당. 본 복합 FK 는 삭제에 관여 안 함(NO ACTION 명시).
    CONSTRAINT fk_mc_chart_datasource_owner FOREIGN KEY (datasource_id, owner_id) REFERENCES mc_datasource(id, owner_id) ON DELETE NO ACTION,
    CONSTRAINT fk_mc_chart_owner        FOREIGN KEY (owner_id) REFERENCES mc_user(id) ON DELETE RESTRICT  -- 작성자 삭제는 비활성화 우선(차단)
);
CREATE TRIGGER trg_mc_chart_touch BEFORE UPDATE ON mc_chart
    FOR EACH ROW EXECUTE FUNCTION mc_touch_updated_at();
-- S1 목록 조회(API 3.1) 공용: 선두 owner_id 로 사용자 범위를 좁히고 + 기본 정렬(updated_at DESC).
--   종류(chart_type)·데이터소스(datasource_id) 필터와 이름 정렬은 owner 범위가 개인 스코프라 소량 → 인덱스 스캔 후 필터/정렬로 충분(전용 인덱스 불요).
CREATE INDEX idx_mc_chart_owner_updated ON mc_chart(owner_id, updated_at DESC);
CREATE INDEX idx_mc_chart_datasource    ON mc_chart(datasource_id);              -- 소스 삭제 RESTRICT 체크 / 사용 차트 수 카운트(409). 데이터소스 필터에도 활용 가능
-- S1 검색(API 3.1): 쿼리는 `owner_id = ? AND (name ILIKE '%q%' OR description ILIKE '%q%')`.
-- pg_trgm GIN 으로 ILIKE 가속 — `col ILIKE ?`는 컬럼별 인덱스라야 사용된다(연결식 표현 인덱스는 OR 조건에 안 걸림).
CREATE INDEX idx_mc_chart_name_trgm ON mc_chart USING gin (name        gin_trgm_ops);
CREATE INDEX idx_mc_chart_desc_trgm ON mc_chart USING gin (description gin_trgm_ops);

-- 차트 결과 캐시 (대용량 대응 — 임베드 요청이 매번 운영 DB 집계를 때리지 않게)
-- 행 제한 1000행 덕에 결과가 수십 KB 수준 → 별도 인프라(Redis) 없이 메타 DB에 저장 (Type A/B 배포 단순성 유지)
-- 갱신 규칙: S2 저장 시 시드, ttl 모드는 만료 시 재계산(stale-while-revalidate). 캐시 쓰기는 INSERT ... ON CONFLICT (chart_id) DO UPDATE 로 원자화.
--   ※ 동시 재계산 중복 방지는 스키마가 보장하지 못한다(PK 충돌은 쓰기 경합만 직렬화할 뿐 중복 "계산"은 막지 못함). 애플리케이션 책임 — 권장 흐름:
--     1) SELECT pg_try_advisory_xact_lock(chart_id) 로 락 시도  2) 획득한 요청만 데이터소스 재조회
--     3) 캐시 UPSERT  4) 트랜잭션 종료와 함께 락 자동 해제  5) 락 실패 요청은 기존 stale 캐시를 그대로 반환.
-- 표본 추출(sample) 차트는 result 에 approximate·sampleRate 가 함께 직렬화되어 임베드도 근사치 배지를 표시할 수 있다.
CREATE TABLE mc_chart_cache (
    chart_id      BIGINT       PRIMARY KEY,
    result        JSONB        NOT NULL,           -- columns + rows (변환기 입력 형태) — 항상 "마지막 성공" 결과
    computed_at   TIMESTAMPTZ  NOT NULL,
    elapsed_ms    INTEGER,
    row_count     INTEGER,
    thumbnail     TEXT,                            -- S1 카드 썸네일(선택, base64/경로). MVP는 차트종류 일러스트 → NULL. 후속(PRD 12). 주의: 임베드 핫패스는 result만 SELECT(thumbnail 미로딩)
    last_error    TEXT,                            -- 백그라운드 재계산 실패 시 기록. 성공 캐시(result)는 유지 — 임베드는 계속 동작
    last_error_at TIMESTAMPTZ,
    CONSTRAINT fk_mc_chart_cache_chart FOREIGN KEY (chart_id) REFERENCES mc_chart(id) ON DELETE CASCADE,
    CONSTRAINT chk_mc_chart_cache_result_obj  CHECK (jsonb_typeof(result) = 'object'),       -- {columns, rows} 객체만
    CONSTRAINT chk_mc_chart_cache_elapsed     CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
    CONSTRAINT chk_mc_chart_cache_row_count   CHECK (row_count IS NULL OR row_count >= 0),
    CONSTRAINT chk_mc_chart_cache_error_state CHECK (last_error IS NULL OR last_error_at IS NOT NULL)  -- 에러 메시지가 있으면 발생 시각도 있어야
);
