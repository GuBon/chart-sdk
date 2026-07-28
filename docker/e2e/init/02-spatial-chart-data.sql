\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS geometry_demo;

-- 실백엔드 브라우저 E2E가 쓰는 최소 PostGIS 표본.
-- 운영 지도와 같은 kr-sigungu GeoJSON을 적재하되 50k 포인트 표본은 만들지 않아 CI 기동 시간을 줄인다.
CREATE TABLE geometry_demo.korea_sigungu_statistics (
    region_code       text    NOT NULL,
    region_name       text    NOT NULL,
    region_name_eng   text,
    sido_name         text    NOT NULL,
    sigungu_name      text    NOT NULL,
    base_year         integer NOT NULL,
    population        bigint  NOT NULL,
    statistic_value   numeric(8, 1) NOT NULL,
    boundary          geometry(MultiPolygon, 4326) NOT NULL,
    PRIMARY KEY (region_code, base_year)
);

WITH document AS (
    SELECT pg_read_file('/docker-entrypoint-initdb.d/kr-sigungu.json')::jsonb AS body
), source_features AS (
    SELECT feature,
           row_number() OVER (ORDER BY feature -> 'properties' ->> 'code')::bigint AS rn
      FROM document
      CROSS JOIN LATERAL jsonb_array_elements(body -> 'features') AS feature
), normalized AS (
    SELECT feature -> 'properties' ->> 'code' AS region_code,
           feature -> 'properties' ->> 'name' AS region_name,
           feature -> 'properties' ->> 'name_eng' AS region_name_eng,
           split_part(feature -> 'properties' ->> 'name', ' ', 1) AS sido_name,
           regexp_replace(feature -> 'properties' ->> 'name', '^[^ ]+ ', '') AS sigungu_name,
           rn,
           ST_Multi(
               ST_Force2D(
                   ST_SetSRID(ST_GeomFromGeoJSON((feature -> 'geometry')::text), 4326)
               )
           )::geometry(MultiPolygon, 4326) AS boundary
      FROM source_features
)
INSERT INTO geometry_demo.korea_sigungu_statistics (
    region_code,
    region_name,
    region_name_eng,
    sido_name,
    sigungu_name,
    base_year,
    population,
    statistic_value,
    boundary
)
SELECT region_code,
       region_name,
       region_name_eng,
       sido_name,
       sigungu_name,
       2026,
       50000 + ((rn * 7919) % 950000),
       round(12.5 + ((rn * 137) % 875)::numeric / 10, 1),
       boundary
  FROM normalized;

CREATE INDEX idx_e2e_korea_sigungu_boundary
    ON geometry_demo.korea_sigungu_statistics USING gist (boundary);

CREATE ROLE chartsdk_reader LOGIN PASSWORD 'chartsdk-reader';
GRANT CONNECT ON DATABASE chartsdk_e2e TO chartsdk_reader;
GRANT USAGE ON SCHEMA geometry_demo TO chartsdk_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA geometry_demo TO chartsdk_reader;

ANALYZE geometry_demo.korea_sigungu_statistics;
