\set ON_ERROR_STOP on

SELECT 'CREATE DATABASE chartsol_user'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'chartsol_user')
\gexec

\connect chartsol_user

CREATE TABLE IF NOT EXISTS sales (
    id       integer PRIMARY KEY,
    category text    NOT NULL,
    amount   numeric NOT NULL,
    dept     text    NOT NULL,
    date     date    NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id         integer PRIMARY KEY,
    name       text      NOT NULL,
    created_at timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
    id         integer PRIMARY KEY,
    path       text      NOT NULL,
    visited_at timestamp NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id       integer PRIMARY KEY,
    name     text    NOT NULL,
    category text    NOT NULL,
    price    numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id      integer PRIMARY KEY,
    sale_id integer NOT NULL REFERENCES sales(id),
    prod_id integer NOT NULL REFERENCES products(id),
    amount  numeric NOT NULL,
    status  text    NOT NULL
);

CREATE TABLE IF NOT EXISTS regional_population (
    region     text    NOT NULL,
    year       integer NOT NULL CHECK (year BETWEEN 2012 AND 2015),
    population bigint NOT NULL CHECK (population >= 0),
    PRIMARY KEY (region, year)
);

INSERT INTO sales(id, category, amount, dept, date) VALUES
    (1, 'food', 1200, 'sales', '2026-01-15'),
    (2, 'goods', 800, 'sales', '2026-02-15'),
    (3, 'electronics', 1500, 'planning', '2026-03-15'),
    (4, 'books', 600, 'planning', '2026-04-15'),
    (5, 'living', 900, 'ops', '2026-05-15')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products(id, name, category, price) VALUES
    (1, 'basic food', 'food', 120),
    (2, 'daily goods', 'living', 90),
    (3, 'book set', 'books', 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orders(id, sale_id, prod_id, amount, status) VALUES
    (1, 1, 1, 1200, 'paid'),
    (2, 2, 2, 800, 'paid'),
    (3, 3, 1, 1500, 'ready'),
    (4, 4, 3, 600, 'paid'),
    (5, 5, 2, 900, 'paid')
ON CONFLICT (id) DO NOTHING;

-- 계열 차트 데모 데이터: X=지역, Y=인구수, 계열=연도.
-- 과거 통계값은 유지하되 지역명은 2026-07-20 현재 지도 자산과 일치시킨다.
DELETE FROM regional_population
 WHERE region IN ('광주광역시', '전라남도', '강원도', '전라북도');

INSERT INTO regional_population(region, year, population) VALUES
    ('서울특별시', 2012, 10442426), ('서울특별시', 2013, 10388055), ('서울특별시', 2014, 10369593), ('서울특별시', 2015, 10297138),
    ('전남광주통합특별시', 2012, 3378834), ('전남광주통합특별시', 2013, 3380082), ('전남광주통합특별시', 2014, 3381664), ('전남광주통합특별시', 2015, 3381195),
    ('부산광역시', 2012, 3573533),  ('부산광역시', 2013, 3564319),  ('부산광역시', 2014, 3557716),  ('부산광역시', 2015, 3559780),
    ('대구광역시', 2012, 2505644),  ('대구광역시', 2013, 2501588),  ('대구광역시', 2014, 2493264),  ('대구광역시', 2015, 2487829),
    ('인천광역시', 2012, 2843981),  ('인천광역시', 2013, 2879782),  ('인천광역시', 2014, 2902608),  ('인천광역시', 2015, 2925815),
    ('대전광역시', 2012, 1524583),  ('대전광역시', 2013, 1532811),  ('대전광역시', 2014, 1531809),  ('대전광역시', 2015, 1518775),
    ('울산광역시', 2012, 1147256),  ('울산광역시', 2013, 1156480),  ('울산광역시', 2014, 1166377),  ('울산광역시', 2015, 1173534),
    ('세종특별자치시', 2012, 113117), ('세종특별자치시', 2013, 122153), ('세종특별자치시', 2014, 156125), ('세종특별자치시', 2015, 210884),
    ('경기도', 2012, 12320982),     ('경기도', 2013, 12549345),     ('경기도', 2014, 12786851),     ('경기도', 2015, 13026526),
    ('강원특별자치도', 2012, 1551531), ('강원특별자치도', 2013, 1542263), ('강원특별자치도', 2014, 1544442), ('강원특별자치도', 2015, 1549507),
    ('충청북도', 2012, 1565628),    ('충청북도', 2013, 1572732),    ('충청북도', 2014, 1578933),    ('충청북도', 2015, 1583952),
    ('충청남도', 2012, 2028777),    ('충청남도', 2013, 2047631),    ('충청남도', 2014, 2062273),    ('충청남도', 2015, 2077649),
    ('전북특별자치도', 2012, 1873341), ('전북특별자치도', 2013, 1872965), ('전북특별자치도', 2014, 1871560), ('전북특별자치도', 2015, 1869711),
    ('경상북도', 2012, 2698353),    ('경상북도', 2013, 2699440),    ('경상북도', 2014, 2700794),    ('경상북도', 2015, 2702826),
    ('경상남도', 2012, 3319314),    ('경상남도', 2013, 3333820),    ('경상남도', 2014, 3350257),    ('경상남도', 2015, 3364702),
    ('제주특별자치도', 2012, 583284), ('제주특별자치도', 2013, 593806), ('제주특별자치도', 2014, 607346), ('제주특별자치도', 2015, 624395)
ON CONFLICT (region, year) DO UPDATE SET population = EXCLUDED.population;

COMMENT ON TABLE regional_population IS
    '계열 차트 데모용 2012~2015 지역별 인구수. 지역명은 2026-07-20 지도 자산 기준';

INSERT INTO users(id, name, created_at) VALUES
    (1, 'Kim', '2026-01-01'),
    (2, 'Lee', '2026-02-01'),
    (3, 'Park', '2026-03-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO visits(id, path, visited_at) VALUES
    (1, '/', '2026-01-01'),
    (2, '/pricing', '2026-01-02'),
    (3, '/docs', '2026-01-03')
ON CONFLICT (id) DO NOTHING;

\connect chartsol

INSERT INTO mc_user(username, display_name, role)
SELECT 'local.user', 'Local User', 'member'
WHERE NOT EXISTS (SELECT 1 FROM mc_user WHERE username = 'local.user');

INSERT INTO mc_datasource(
    name,
    host,
    port,
    database_name,
    db_user,
    db_password_enc,
    max_pool_size,
    last_tested_at,
    last_test_ok
)
SELECT
    'docker-user-db',
    'localhost',
    5433,
    'chartsol_user',
    'postgres',
    '0218',
    5,
    now(),
    true
WHERE NOT EXISTS (
    SELECT 1 FROM mc_datasource WHERE owner_id IS NULL AND name = 'docker-user-db'
);

INSERT INTO mc_datasource(
    name,
    host,
    port,
    database_name,
    db_user,
    db_password_enc,
    max_pool_size,
    last_tested_at,
    last_test_ok
)
SELECT
    'postgis-geometry-test',
    'localhost',
    55433,
    'chartsdk_spatial_test',
    'postgres',
    '0218',
    5,
    now(),
    true
WHERE NOT EXISTS (
    SELECT 1 FROM mc_datasource WHERE owner_id IS NULL AND name = 'postgis-geometry-test'
);

INSERT INTO mc_user_token(user_id, token, expires_at, is_active)
SELECT u.id, 'dev-local-token', now() + interval '365 days', true
FROM mc_user u
WHERE u.username = 'local.user'
  AND NOT EXISTS (
      SELECT 1 FROM mc_user_token t WHERE t.user_id = u.id AND t.is_active = true
  );

INSERT INTO mc_chart(
    name,
    description,
    datasource_id,
    define_mode,
    sql_query,
    builder_config,
    chart_type,
    options,
    refresh_mode,
    cache_ttl_seconds
)
SELECT
    'Local Sales',
    'Docker chartsol_user sales sample',
    d.id,
    'builder',
    'SELECT category, SUM(amount) AS sum_amount FROM sales GROUP BY category',
    '{"table":"sales","joins":[],"xAxis":"category","xAxisBucket":null,"yAxis":[{"column":"amount","agg":"sum"}],"where":[],"orderBy":null,"sample":null}'::jsonb,
    'bar',
    '{"legend":{"show":true}}'::jsonb,
    'ttl',
    3600
FROM mc_datasource d
WHERE d.name = 'docker-user-db'
  AND NOT EXISTS (SELECT 1 FROM mc_chart WHERE name = 'Local Sales');
