\set ON_ERROR_STOP on

BEGIN;

LOCK TABLE geometry_demo.korea_sigungu_statistics IN SHARE ROW EXCLUSIVE MODE;

-- 지도 매칭용 결합 이름(region_name)은 유지하고 분석/필터용 시도·시군구를 별도 컬럼으로 제공한다.
ALTER TABLE geometry_demo.korea_sigungu_statistics
    ADD COLUMN IF NOT EXISTS sido_name text,
    ADD COLUMN IF NOT EXISTS sigungu_name text;

UPDATE geometry_demo.korea_sigungu_statistics
   SET base_year = COALESCE(base_year, 2024),
       sido_name = split_part(region_name, ' ', 1),
       sigungu_name = regexp_replace(region_name, '^[^ ]+ ', '')
 WHERE base_year IS NULL
    OR sido_name IS DISTINCT FROM split_part(region_name, ' ', 1)
    OR sigungu_name IS DISTINCT FROM regexp_replace(region_name, '^[^ ]+ ', '');

ALTER TABLE geometry_demo.korea_sigungu_statistics
    ALTER COLUMN base_year SET NOT NULL,
    ALTER COLUMN sido_name SET NOT NULL,
    ALTER COLUMN sigungu_name SET NOT NULL;

-- 기존 region_code 단독 PK를 연도별 통계를 수용하는 복합 PK로 승격한다.
DO $$
DECLARE
    primary_key_name text;
BEGIN
    SELECT conname
      INTO primary_key_name
      FROM pg_constraint
     WHERE conrelid = 'geometry_demo.korea_sigungu_statistics'::regclass
       AND contype = 'p';

    IF primary_key_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE geometry_demo.korea_sigungu_statistics DROP CONSTRAINT %I',
            primary_key_name
        );
    END IF;
END
$$;

ALTER TABLE geometry_demo.korea_sigungu_statistics
    ADD CONSTRAINT korea_sigungu_statistics_pkey PRIMARY KEY (region_code, base_year);

-- 원본 데이터가 가상 통계이므로 2024년 값을 기준으로 지역별 결정적 증감률을 적용한다.
-- 같은 초기화 SQL을 다시 실행해도 결과가 바뀌지 않도록 난수는 사용하지 않는다.
WITH baseline AS (
    SELECT statistics.*,
           right(regexp_replace(region_code, '[^0-9]', '', 'g'), 2)::integer AS region_seed
      FROM geometry_demo.korea_sigungu_statistics AS statistics
     WHERE base_year = 2024
), rates AS (
    SELECT baseline.*,
           round(growth_rate + ((region_seed % 5) - 2) * 0.2, 1) AS growth_2025,
           round(growth_rate + ((region_seed % 7) - 3) * 0.15, 1) AS growth_2026
      FROM baseline
), yearly AS (
    SELECT rates.*,
           generated.base_year AS target_year,
           generated.year_growth,
           generated.population_factor,
           generated.household_factor
      FROM rates
      CROSS JOIN LATERAL (
          VALUES
              (
                  2025,
                  growth_2025,
                  1 + growth_2025 / 100.0,
                  1 + (growth_2025 + 0.4) / 100.0
              ),
              (
                  2026,
                  growth_2026,
                  (1 + growth_2025 / 100.0) * (1 + growth_2026 / 100.0),
                  (1 + (growth_2025 + 0.4) / 100.0) * (1 + (growth_2026 + 0.4) / 100.0)
              )
      ) AS generated(base_year, year_growth, population_factor, household_factor)
)
INSERT INTO geometry_demo.korea_sigungu_statistics (
    region_code,
    region_name,
    region_name_eng,
    sido_name,
    sigungu_name,
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
       sido_name,
       sigungu_name,
       target_year,
       boundary_base_date,
       greatest(1000, round(population * population_factor))::bigint,
       greatest(500, round(households * household_factor))::bigint,
       round(statistic_value + (target_year - 2024) * 0.8 + year_growth * 0.25, 1),
       year_growth,
       boundary
  FROM yearly
ON CONFLICT (region_code, base_year) DO UPDATE SET
    region_name = EXCLUDED.region_name,
    region_name_eng = EXCLUDED.region_name_eng,
    sido_name = EXCLUDED.sido_name,
    sigungu_name = EXCLUDED.sigungu_name,
    boundary_base_date = EXCLUDED.boundary_base_date,
    population = EXCLUDED.population,
    households = EXCLUDED.households,
    statistic_value = EXCLUDED.statistic_value,
    growth_rate = EXCLUDED.growth_rate,
    boundary = EXCLUDED.boundary;

CREATE INDEX IF NOT EXISTS idx_korea_sigungu_statistics_year
    ON geometry_demo.korea_sigungu_statistics (base_year);
CREATE INDEX IF NOT EXISTS idx_korea_sigungu_statistics_sido_sigungu_year
    ON geometry_demo.korea_sigungu_statistics (sido_name, sigungu_name, base_year);

COMMENT ON COLUMN geometry_demo.korea_sigungu_statistics.sido_name IS
    '결합 지역명에서 분리한 시·도 이름';
COMMENT ON COLUMN geometry_demo.korea_sigungu_statistics.sigungu_name IS
    '결합 지역명에서 분리한 시·군·구 이름';
COMMENT ON COLUMN geometry_demo.korea_sigungu_statistics.base_year IS
    '통계 기준 연도. 데모 데이터는 2024~2026년을 제공한다.';
COMMENT ON COLUMN geometry_demo.korea_sigungu_statistics.boundary_base_date IS
    '경계 좌표 원본 기준일. 현재 자산은 SGIS 2025-06-30 경계를 사용한다.';
COMMENT ON TABLE geometry_demo.korea_sigungu_statistics IS
    '2026-07-20 행정구역 기준 한국 시군구 경계 253개와 2024~2026년 경계별 가상 통계값';

ANALYZE geometry_demo.korea_sigungu_statistics;

COMMIT;
