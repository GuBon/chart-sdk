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
