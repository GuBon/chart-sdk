-- Bounded L1 cache for rows selected by Bernoulli after a completed JOIN + WHERE population.
-- The payload contains only generated chart roles (x/y/series/spatial), never source SELECT * rows.
CREATE TABLE mc_sample_row_cache (
    fingerprint            CHAR(64)    PRIMARY KEY,
    primary_datasource_id  BIGINT      NOT NULL REFERENCES mc_datasource(id) ON DELETE CASCADE,
    datasource_ids         JSONB       NOT NULL,
    payload                JSONB       NOT NULL,
    row_count              INTEGER     NOT NULL,
    payload_bytes          BIGINT      NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_mc_sample_row_cache_fingerprint CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_mc_sample_row_cache_datasources CHECK (jsonb_typeof(datasource_ids) = 'array'),
    CONSTRAINT chk_mc_sample_row_cache_payload CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT chk_mc_sample_row_cache_rows CHECK (row_count >= 0),
    CONSTRAINT chk_mc_sample_row_cache_bytes CHECK (payload_bytes > 0)
);

CREATE INDEX idx_mc_sample_row_cache_lru
    ON mc_sample_row_cache(last_accessed_at, fingerprint);
CREATE INDEX idx_mc_sample_row_cache_datasource_lru
    ON mc_sample_row_cache(primary_datasource_id, last_accessed_at, fingerprint);
