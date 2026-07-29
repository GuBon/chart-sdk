-- Chart-friendly projection for MOLIT GIS integrated building data (Seoul).
-- The raw AL_D010 attributes remain unchanged in gis_building_seoul.

CREATE INDEX IF NOT EXISTS idx_gis_building_seoul_legal_dong
    ON building_demo.gis_building_seoul (a3);

CREATE INDEX IF NOT EXISTS idx_gis_building_seoul_usage
    ON building_demo.gis_building_seoul (a8);

CREATE INDEX IF NOT EXISTS idx_gis_building_seoul_approved_on
    ON building_demo.gis_building_seoul (a13);

CREATE OR REPLACE VIEW building_demo.buildings_chart AS
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
    CASE
        WHEN a13 ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         AND a13 BETWEEN '1800-01-01' AND CURRENT_DATE::text
        THEN a13::date
    END AS approved_on,
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
    ST_PointOnSurface(geom)::geometry(Point, 4326) AS location,
    left(a3, 2) AS sido_code,
    NULLIF(split_part(btrim(a4), ' ', 1), '') AS sido_name,
    NULLIF(split_part(btrim(a4), ' ', 2), '') AS sigungu_name,
    NULLIF(split_part(btrim(a4), ' ', 3), '') AS eupmyeondong_name,
    NULLIF(btrim(a4), '') AS legal_dong_full_name
FROM building_demo.gis_building_seoul
-- Exclude two source-coordinate outliers while retaining the raw rows.
WHERE geom && ST_MakeEnvelope(126.7, 37.4, 127.3, 37.75, 4326);

COMMENT ON TABLE building_demo.gis_building_seoul IS
    'Raw MOLIT AL_D010 GIS integrated building data for Seoul, imported from the 2026-07-19 Shapefile';

COMMENT ON VIEW building_demo.buildings_chart IS
    'Chart-friendly Seoul building view with normalized administrative names, Polygon boundary, and derived Point location';

COMMENT ON COLUMN building_demo.buildings_chart.legal_dong_name IS
    'Original full legal-dong name retained for compatibility; prefer the normalized administrative-name columns';

COMMENT ON COLUMN building_demo.buildings_chart.legal_dong_full_name IS
    'Full legal-dong path from the source, for example 서울특별시 종로구 숭인동';

ANALYZE building_demo.gis_building_seoul;
