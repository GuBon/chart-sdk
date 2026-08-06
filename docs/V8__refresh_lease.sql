-- Short, expiring coordination lease. No transaction is held while a customer query runs.
CREATE TABLE mc_chart_refresh_lease (
    chart_id           BIGINT      PRIMARY KEY REFERENCES mc_chart(id) ON DELETE CASCADE,
    definition_version INTEGER     NOT NULL,
    lease_token        UUID        NOT NULL,
    expires_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_mc_chart_refresh_lease_expiry
    ON mc_chart_refresh_lease(expires_at);

-- The expensive sample loader runs outside a transaction. Only this lease row is coordinated.
CREATE TABLE mc_sample_cache_build_lease (
    fingerprint CHAR(64)    PRIMARY KEY,
    lease_token UUID        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    CONSTRAINT chk_mc_sample_build_fingerprint CHECK (fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_mc_sample_cache_build_lease_expiry
    ON mc_sample_cache_build_lease(expires_at);
