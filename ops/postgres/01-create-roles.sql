\set ON_ERROR_STOP on

-- Passwords are intentionally not stored in source control. Set them with the
-- platform secret manager after this bootstrap (ALTER ROLE ... PASSWORD ...).
DO $block$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chartsdk_migrator') THEN
        CREATE ROLE chartsdk_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chartsdk_app') THEN
        CREATE ROLE chartsdk_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
END
$block$;

ALTER ROLE chartsdk_migrator NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE chartsdk_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
