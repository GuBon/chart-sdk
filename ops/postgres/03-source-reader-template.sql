\set ON_ERROR_STOP on

-- Run in a customer/source database as its administrator. This role can read
-- every current non-system relation, including raw and quality tables, but
-- cannot write or create objects. Set its login password outside this file.
DO $block$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chartsdk_source_reader') THEN
        CREATE ROLE chartsdk_source_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
END
$block$;

DO $block$
DECLARE
    source_schema record;
    source_owner record;
BEGIN
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO chartsdk_source_reader', current_database());

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

        FOR source_owner IN
            SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner_name
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = source_schema.nspname
               AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        LOOP
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO chartsdk_source_reader',
                source_owner.owner_name, source_schema.nspname);
        END LOOP;
    END LOOP;
END
$block$;
