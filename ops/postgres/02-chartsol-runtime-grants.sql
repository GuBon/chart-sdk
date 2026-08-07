\set ON_ERROR_STOP on
\connect chartsol

-- Run once as the current database owner after Flyway succeeds.
REVOKE CONNECT ON DATABASE chartsol FROM PUBLIC;
GRANT CONNECT ON DATABASE chartsol TO chartsdk_migrator;
GRANT CONNECT ON DATABASE chartsol TO chartsdk_app;

GRANT USAGE, CREATE ON SCHEMA public TO chartsdk_migrator;
REVOKE CREATE ON SCHEMA public FROM chartsdk_app;
GRANT USAGE ON SCHEMA public TO chartsdk_app;

ALTER FUNCTION public.mc_touch_updated_at() OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_flyway_schema_history OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_user OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_user_token OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_datasource OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_chart OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_chart_cache OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_chart_datasource OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_data_display_name OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_sample_row_cache OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_chart_refresh_lease OWNER TO chartsdk_migrator;
ALTER TABLE public.mc_sample_cache_build_lease OWNER TO chartsdk_migrator;

ALTER SEQUENCE public.mc_user_id_seq OWNER TO chartsdk_migrator;
ALTER SEQUENCE public.mc_user_token_id_seq OWNER TO chartsdk_migrator;
ALTER SEQUENCE public.mc_datasource_id_seq OWNER TO chartsdk_migrator;
ALTER SEQUENCE public.mc_chart_id_seq OWNER TO chartsdk_migrator;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.mc_user,
    public.mc_user_token,
    public.mc_datasource,
    public.mc_chart,
    public.mc_chart_cache,
    public.mc_chart_datasource,
    public.mc_data_display_name,
    public.mc_sample_row_cache,
    public.mc_chart_refresh_lease,
    public.mc_sample_cache_build_lease
TO chartsdk_app;

GRANT USAGE, SELECT ON SEQUENCE
    public.mc_user_id_seq,
    public.mc_user_token_id_seq,
    public.mc_datasource_id_seq,
    public.mc_chart_id_seq
TO chartsdk_app;

REVOKE ALL ON TABLE public.mc_flyway_schema_history FROM chartsdk_app;

-- Future mc_* grants are applied by docs/afterMigrate__runtime_grants.sql.
-- Do not use broad default table privileges: they would also expose Flyway history.
