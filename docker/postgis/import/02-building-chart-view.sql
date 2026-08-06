-- Chart-friendly projection for MOLIT GIS integrated building data (Seoul).
-- The raw AL_D010 attributes remain unchanged in gis_building_seoul.

-- PostgreSQL text-to-date casts are STABLE because they depend on DateStyle, so they
-- cannot be used directly by a stored generated column. Parse the fixed ISO source
-- format with immutable primitives and turn malformed/out-of-range source values into NULL.
CREATE OR REPLACE FUNCTION building_demo.safe_iso_date(raw_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
DECLARE
    parsed date;
BEGIN
    IF raw_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR substring(raw_value FROM 1 FOR 4)::integer < 1800 THEN
        RETURN NULL;
    END IF;

    parsed := make_date(
        substring(raw_value FROM 1 FOR 4)::integer,
        substring(raw_value FROM 6 FOR 2)::integer,
        substring(raw_value FROM 9 FOR 2)::integer
    );
    RETURN parsed;
EXCEPTION
    WHEN datetime_field_overflow THEN
        RETURN NULL;
END;
$function$;

-- PointOnSurface is comparatively expensive on 695k polygons. Persist it once during import so
-- chart sampling only reads a point value and never recomputes the polygon operation per request.
ALTER TABLE building_demo.gis_building_seoul
    ADD COLUMN IF NOT EXISTS approved_on_date date
    GENERATED ALWAYS AS (building_demo.safe_iso_date(a13::text)) STORED,
    ADD COLUMN IF NOT EXISTS location_point geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_PointOnSurface(geom)) STORED;

CREATE INDEX IF NOT EXISTS idx_gis_building_seoul_legal_dong
    ON building_demo.gis_building_seoul (a3);

CREATE INDEX IF NOT EXISTS idx_gis_building_seoul_usage
    ON building_demo.gis_building_seoul (a8);

CREATE INDEX IF NOT EXISTS idx_gis_building_seoul_approved_on
    ON building_demo.gis_building_seoul (a13);

CREATE INDEX IF NOT EXISTS idx_gis_building_seoul_approved_on_date
    ON building_demo.gis_building_seoul (approved_on_date);

CREATE INDEX IF NOT EXISTS idx_gis_building_seoul_sigungu_code
    ON building_demo.gis_building_seoul (a23);

DROP VIEW IF EXISTS building_demo.buildings_chart;

CREATE VIEW building_demo.buildings_chart AS
SELECT
    gid AS building_id,
    a0 AS source_feature_id,
    a1 AS gis_building_id,
    a2 AS pnu,
    a3 AS legal_dong_code,
    NULLIF(btrim(a4), '') AS legal_dong_name,
    NULLIF(btrim(a5), '') AS lot_number,
    a8 AS building_use_code,
    COALESCE(NULLIF(btrim(a9), ''), '미상') AS building_use,
    a10 AS structure_code,
    COALESCE(NULLIF(btrim(a11), ''), '미상') AS structure,
    NULLIF(a12, 0) AS building_area_sqm,
    approved_on_date AS approved_on,
    NULLIF(a14, 0) AS gross_floor_area_sqm,
    NULLIF(a15, 0) AS land_area_sqm,
    NULLIF(a16, 0) AS height_m,
    NULLIF(a17, 0) AS building_coverage_pct,
    NULLIF(a18, 0) AS floor_area_ratio_pct,
    a22 AS source_updated_on,
    a23 AS sigungu_code,
    NULLIF(a26, 0) AS ground_floors,
    a27 AS underground_floors,
    geom AS boundary,
    location_point AS location,
    left(a3, 2) AS sido_code
FROM building_demo.gis_building_seoul
-- Exclude two source-coordinate outliers while retaining the raw rows.
WHERE geom && ST_MakeEnvelope(126.7, 37.4, 127.3, 37.75, 4326);

COMMENT ON TABLE building_demo.gis_building_seoul IS
    'Raw MOLIT AL_D010 GIS integrated building data for Seoul, imported from the 2026-07-19 Shapefile';

COMMENT ON COLUMN building_demo.gis_building_seoul.approved_on_date IS
    'Validated ISO approval date normalized once from source field a13';

COMMENT ON COLUMN building_demo.gis_building_seoul.location_point IS
    'Precomputed point-on-surface used by sampled spatial charts';

COMMENT ON VIEW building_demo.buildings_chart IS
    'Chart-friendly Seoul building view with Polygon boundary and derived Point location';

COMMENT ON COLUMN building_demo.buildings_chart.legal_dong_name IS
    'Full legal-dong name from the source';

DO $block$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chartsdk_source_reader') THEN
        REVOKE CREATE ON SCHEMA building_demo FROM chartsdk_source_reader;
        GRANT USAGE ON SCHEMA building_demo TO chartsdk_source_reader;
        GRANT SELECT ON ALL TABLES IN SCHEMA building_demo TO chartsdk_source_reader;
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA building_demo
            GRANT SELECT ON TABLES TO chartsdk_source_reader;
    END IF;
END
$block$;

ANALYZE building_demo.gis_building_seoul;
