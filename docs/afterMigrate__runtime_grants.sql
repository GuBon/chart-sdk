-- Runtime grants are conditional so migrations also work before production roles are provisioned.
-- Only application-owned mc_* objects are granted; mc_flyway_schema_history remains migration-only.
DO $block$
DECLARE
    relation record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chartsdk_app') THEN
        RETURN;
    END IF;

    REVOKE CREATE ON SCHEMA public FROM chartsdk_app;
    GRANT USAGE ON SCHEMA public TO chartsdk_app;

    FOR relation IN
        SELECT c.relname, c.relkind
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname LIKE 'mc\_%' ESCAPE '\'
           AND c.relname <> 'mc_flyway_schema_history'
           AND c.relkind IN ('r', 'p', 'S')
    LOOP
        IF relation.relkind = 'S' THEN
            EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO chartsdk_app', relation.relname);
        ELSE
            EXECUTE format(
                'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO chartsdk_app',
                relation.relname);
        END IF;
    END LOOP;

    IF to_regclass('public.mc_flyway_schema_history') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.mc_flyway_schema_history FROM chartsdk_app;
    END IF;
END
$block$;
