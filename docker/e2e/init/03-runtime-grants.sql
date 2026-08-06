\set ON_ERROR_STOP on
\connect chartsdk_e2e

REVOKE CONNECT ON DATABASE chartsdk_e2e FROM PUBLIC;
GRANT CONNECT ON DATABASE chartsdk_e2e TO postgres, chartsdk_app, chartsdk_reader;
REVOKE CREATE ON SCHEMA public FROM chartsdk_app;
GRANT USAGE ON SCHEMA public TO chartsdk_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    mc_user, mc_user_token, mc_datasource, mc_chart, mc_chart_cache
TO chartsdk_app;
GRANT USAGE, SELECT ON SEQUENCE
    mc_user_id_seq, mc_user_token_id_seq, mc_datasource_id_seq, mc_chart_id_seq
TO chartsdk_app;

-- Flyway afterMigrate grants only future mc_* objects and excludes its history table.
