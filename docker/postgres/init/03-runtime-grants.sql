\set ON_ERROR_STOP on
\connect chartsol

REVOKE CONNECT ON DATABASE chartsol FROM PUBLIC;
GRANT CONNECT ON DATABASE chartsol TO postgres, chartsdk_migrator, chartsdk_app;
GRANT USAGE, CREATE ON SCHEMA public TO chartsdk_migrator;
REVOKE CREATE ON SCHEMA public FROM chartsdk_app;
GRANT USAGE ON SCHEMA public TO chartsdk_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    mc_user, mc_user_token, mc_datasource, mc_chart, mc_chart_cache
TO chartsdk_app;
GRANT USAGE, SELECT ON SEQUENCE
    mc_user_id_seq, mc_user_token_id_seq, mc_datasource_id_seq, mc_chart_id_seq
TO chartsdk_app;

-- Flyway afterMigrate grants only future mc_* objects and excludes its history table.

\connect chartsol_user
REVOKE CONNECT ON DATABASE chartsol_user FROM PUBLIC;
GRANT CONNECT ON DATABASE chartsol_user TO postgres, chartsdk_source_reader;
REVOKE CREATE ON SCHEMA public FROM chartsdk_source_reader;
GRANT USAGE ON SCHEMA public TO chartsdk_source_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO chartsdk_source_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT ON TABLES TO chartsdk_source_reader;
