\set ON_ERROR_STOP on

CREATE ROLE chartsdk_source_reader LOGIN PASSWORD 'chartsdk-source-reader' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE CONNECT ON DATABASE chartsdk_spatial_test FROM PUBLIC;
GRANT CONNECT ON DATABASE chartsdk_spatial_test TO postgres, chartsdk_source_reader;

DO $block$
DECLARE
    source_schema record;
BEGIN
    FOR source_schema IN
        SELECT nspname
          FROM pg_namespace
         WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
           AND nspname NOT LIKE 'pg_temp%'
           AND nspname NOT LIKE 'pg_toast_temp%'
    LOOP
        EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM chartsdk_source_reader', source_schema.nspname);
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO chartsdk_source_reader', source_schema.nspname);
        EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO chartsdk_source_reader', source_schema.nspname);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I GRANT SELECT ON TABLES TO chartsdk_source_reader',
            source_schema.nspname);
    END LOOP;
END
$block$;
