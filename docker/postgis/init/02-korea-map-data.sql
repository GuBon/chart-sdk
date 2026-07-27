\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS geometry_demo;

-- 프로젝트에 포함된 실제 시군구 GeoJSON을 DB MultiPolygon으로 적재한다.
CREATE TABLE IF NOT EXISTS geometry_demo.korea_sigungu_statistics (
    region_code      text PRIMARY KEY,
    region_name      text NOT NULL,
    region_name_eng  text,
    base_year        integer,
    boundary_base_date date NOT NULL,
    population       bigint NOT NULL,
    households       bigint NOT NULL,
    statistic_value  numeric(8, 1) NOT NULL,
    growth_rate      numeric(6, 1) NOT NULL,
    boundary         geometry(MultiPolygon, 4326) NOT NULL
);

WITH document AS (
    SELECT pg_read_file('/docker-entrypoint-initdb.d/kr-sigungu.json')::jsonb AS body
), source_features AS (
    SELECT feature
      FROM document
      CROSS JOIN LATERAL jsonb_array_elements(body -> 'features') AS feature
), normalized AS (
    SELECT feature -> 'properties' ->> 'code' AS region_code,
           feature -> 'properties' ->> 'name' AS region_name,
           feature -> 'properties' ->> 'name_eng' AS region_name_eng,
           2024 AS base_year,
           to_date(feature -> 'properties' ->> 'boundary_base_date', 'YYYYMMDD') AS boundary_base_date,
           ST_Multi(
               ST_Force2D(
                   ST_SetSRID(ST_GeomFromGeoJSON((feature -> 'geometry')::text), 4326)
               )
           )::geometry(MultiPolygon, 4326) AS boundary
      FROM source_features
), numbered AS (
    SELECT normalized.*,
           row_number() OVER (ORDER BY region_code)::bigint AS rn
      FROM normalized
)
INSERT INTO geometry_demo.korea_sigungu_statistics (
    region_code,
    region_name,
    region_name_eng,
    base_year,
    boundary_base_date,
    population,
    households,
    statistic_value,
    growth_rate,
    boundary
)
SELECT region_code,
       region_name,
       region_name_eng,
       base_year,
       boundary_base_date,
       50000 + ((rn * 7919) % 950000),
       18000 + ((rn * 3571) % 410000),
       round(12.5 + ((rn * 137) % 875)::numeric / 10, 1),
       round(-6.0 + ((rn * 53) % 121)::numeric / 10, 1),
       boundary
  FROM numbered
ON CONFLICT (region_code) DO UPDATE SET
    region_name = EXCLUDED.region_name,
    region_name_eng = EXCLUDED.region_name_eng,
    base_year = EXCLUDED.base_year,
    boundary_base_date = EXCLUDED.boundary_base_date,
    population = EXCLUDED.population,
    households = EXCLUDED.households,
    statistic_value = EXCLUDED.statistic_value,
    growth_rate = EXCLUDED.growth_rate,
    boundary = EXCLUDED.boundary;

CREATE INDEX IF NOT EXISTS idx_korea_sigungu_statistics_boundary
    ON geometry_demo.korea_sigungu_statistics USING gist (boundary);

-- 위 시군구 경계의 합집합 내부에만 50,000개 Point를 생성한다.
CREATE TABLE IF NOT EXISTS geometry_demo.korea_point_events_50k (
    id                  bigint PRIMARY KEY,
    point_name          text NOT NULL,
    region_name         text,
    category            text NOT NULL,
    metric_value        numeric(8, 1) NOT NULL,
    observed_at         timestamptz NOT NULL,
    location            geometry(Point, 4326) NOT NULL,
    location_geography  geography(Point, 4326) NOT NULL
);

WITH korea AS (
    SELECT ST_UnaryUnion(ST_Collect(boundary)) AS boundary
      FROM geometry_demo.korea_sigungu_statistics
), generated AS (
    SELECT row_number() OVER (ORDER BY dumped.path)::bigint AS id,
           dumped.geom::geometry(Point, 4326) AS location
      FROM korea
      CROSS JOIN LATERAL ST_Dump(
          ST_GeneratePoints(korea.boundary, 51000, 20260721)
      ) AS dumped
), attributed AS (
    SELECT generated.id,
           generated.location,
           region.region_name
      FROM generated
      LEFT JOIN LATERAL (
          SELECT statistics.region_name
            FROM geometry_demo.korea_sigungu_statistics AS statistics
           WHERE statistics.boundary && generated.location
             AND ST_Covers(statistics.boundary, generated.location)
           ORDER BY statistics.region_code
           LIMIT 1
      ) AS region ON true
)
INSERT INTO geometry_demo.korea_point_events_50k (
    id,
    point_name,
    region_name,
    category,
    metric_value,
    observed_at,
    location,
    location_geography
)
SELECT id,
       U&'\AD00\CE21\C9C0\C810-' || lpad(id::text, 5, '0'),
       region_name,
       (ARRAY['A', 'B', 'C', 'D'])[((id - 1) % 4) + 1],
       round(5.0 + ((id * 37) % 960)::numeric / 10, 1),
       timestamptz '2026-01-01 00:00:00+09'
           + (((id - 1) % 525600) * interval '1 minute'),
       location,
       location::geography
  FROM attributed
 WHERE id <= 50000
ON CONFLICT (id) DO UPDATE SET
    point_name = EXCLUDED.point_name,
    region_name = EXCLUDED.region_name,
    category = EXCLUDED.category,
    metric_value = EXCLUDED.metric_value,
    observed_at = EXCLUDED.observed_at,
    location = EXCLUDED.location,
    location_geography = EXCLUDED.location_geography;

DELETE FROM geometry_demo.korea_point_events_50k WHERE id > 50000;

CREATE INDEX IF NOT EXISTS idx_korea_point_events_50k_location
    ON geometry_demo.korea_point_events_50k USING gist (location);
CREATE INDEX IF NOT EXISTS idx_korea_point_events_50k_location_geography
    ON geometry_demo.korea_point_events_50k USING gist (location_geography);
CREATE INDEX IF NOT EXISTS idx_korea_point_events_50k_region_name
    ON geometry_demo.korea_point_events_50k (region_name);

COMMENT ON TABLE geometry_demo.korea_sigungu_statistics IS
    '2026-07-20 행정구역 기준 한국 시군구 경계 253개와 경계별 가상 통계값';
COMMENT ON TABLE geometry_demo.korea_point_events_50k IS
    '실제 한국 경계 내부에 생성한 지도 산점도용 Point 50,000개';

ANALYZE geometry_demo.korea_sigungu_statistics;
ANALYZE geometry_demo.korea_point_events_50k;
