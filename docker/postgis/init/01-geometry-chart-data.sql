\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS geometry_demo;

CREATE TABLE IF NOT EXISTS geometry_demo.parcel_boundaries_10k (
    id                 bigint PRIMARY KEY,
    parcel_code        text        NOT NULL UNIQUE,
    parcel_name        text        NOT NULL,
    district           text        NOT NULL,
    land_use           text        NOT NULL,
    assessed_value     numeric     NOT NULL,
    area_sqm           numeric     NOT NULL,
    observed_on        date        NOT NULL,
    boundary           geometry(Polygon, 3857) NOT NULL,
    centroid           geometry(Point, 3857) NOT NULL,
    boundary_geography geography(Polygon, 4326) NOT NULL,
    centroid_geography geography(Point, 4326) NOT NULL
);

WITH cells AS (
    SELECT i,
           126.0 + ((i - 1) % 100) * 0.025 AS min_lon,
           34.0 + ((i - 1) / 100) * 0.025 AS min_lat
      FROM generate_series(1, 10000) AS i
), shapes AS (
    SELECT i,
           ST_MakeEnvelope(min_lon, min_lat, min_lon + 0.020, min_lat + 0.020, 4326) AS boundary_wgs84
      FROM cells
)
INSERT INTO geometry_demo.parcel_boundaries_10k (
    id,
    parcel_code,
    parcel_name,
    district,
    land_use,
    assessed_value,
    area_sqm,
    observed_on,
    boundary,
    centroid,
    boundary_geography,
    centroid_geography
)
SELECT i,
       'P-' || lpad(i::text, 5, '0'),
       U&'\D14C\C2A4\D2B8 \D544\C9C0 ' || lpad(i::text, 5, '0'),
       U&'\AD6C\C5ED-' || lpad((((i - 1) / 100) + 1)::text, 3, '0'),
       (ARRAY[
           U&'\C8FC\AC70',
           U&'\C0C1\C5C5',
           U&'\ACF5\C5C5',
           U&'\B18D\C9C0',
           U&'\B179\C9C0'
       ])[((i - 1) % 5) + 1],
       100000000 + i * 125000,
       120 + (i % 380),
       DATE '2025-01-01' + ((i - 1) % 365),
       ST_Transform(boundary_wgs84, 3857),
       ST_Transform(ST_PointOnSurface(boundary_wgs84), 3857),
       boundary_wgs84::geography,
       ST_PointOnSurface(boundary_wgs84)::geography
  FROM shapes
ON CONFLICT (id) DO UPDATE SET
    parcel_code = EXCLUDED.parcel_code,
    parcel_name = EXCLUDED.parcel_name,
    district = EXCLUDED.district,
    land_use = EXCLUDED.land_use,
    assessed_value = EXCLUDED.assessed_value,
    area_sqm = EXCLUDED.area_sqm,
    observed_on = EXCLUDED.observed_on,
    boundary = EXCLUDED.boundary,
    centroid = EXCLUDED.centroid,
    boundary_geography = EXCLUDED.boundary_geography,
    centroid_geography = EXCLUDED.centroid_geography;

CREATE INDEX IF NOT EXISTS idx_parcel_boundaries_10k_boundary
    ON geometry_demo.parcel_boundaries_10k USING gist (boundary);
CREATE INDEX IF NOT EXISTS idx_parcel_boundaries_10k_centroid
    ON geometry_demo.parcel_boundaries_10k USING gist (centroid);
CREATE INDEX IF NOT EXISTS idx_parcel_boundaries_10k_boundary_geography
    ON geometry_demo.parcel_boundaries_10k USING gist (boundary_geography);
CREATE INDEX IF NOT EXISTS idx_parcel_boundaries_10k_centroid_geography
    ON geometry_demo.parcel_boundaries_10k USING gist (centroid_geography);
CREATE INDEX IF NOT EXISTS idx_parcel_boundaries_10k_district
    ON geometry_demo.parcel_boundaries_10k (district);
CREATE INDEX IF NOT EXISTS idx_parcel_boundaries_10k_land_use
    ON geometry_demo.parcel_boundaries_10k (land_use);

COMMENT ON TABLE geometry_demo.parcel_boundaries_10k IS
    'ChartSDK geometry/geography 지도 차트 검증용 10,000개 가상 필지';
COMMENT ON COLUMN geometry_demo.parcel_boundaries_10k.boundary IS
    '동적 지도 경계 테스트용 geometry Polygon, EPSG:3857';
COMMENT ON COLUMN geometry_demo.parcel_boundaries_10k.centroid IS
    '지도 포인트 테스트용 geometry Point, EPSG:3857';

ANALYZE geometry_demo.parcel_boundaries_10k;
