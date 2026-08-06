import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const datasourceIds = (__ENV.DATASOURCE_IDS || __ENV.DATASOURCE_ID || '1')
  .split(',').map((value) => Number(value.trim())).filter(Number.isFinite);
const sampleSize = Number(__ENV.SAMPLE_SIZE || 10_000);
const schemaName = __ENV.SCHEMA_NAME || 'public';
const tableName = __ENV.TABLE_NAME || 'load_points';
const xColumn = __ENV.X_COLUMN || 'x_value';
const yColumn = __ENV.Y_COLUMN || 'y_value';
const authToken = __ENV.AUTH_TOKEN || '';
const expectLarge = (__ENV.EXPECT_LARGE || 'true').toLowerCase() === 'true';
const expectedSampleMethod = (__ENV.EXPECT_SAMPLE_METHOD || '').trim().toUpperCase();
const expectedPopulationMin = Number(__ENV.EXPECT_POPULATION_MIN || sampleSize + 1);
const stageDuration = __ENV.STAGE_DURATION || '2m';
const burstDuration = __ENV.BURST_DURATION || '1m';
const gap = __ENV.STAGE_GAP || '15s';
const peakStartMs = durationMs(stageDuration) + durationMs(gap);
const burstStartMs = peakStartMs + durationMs(stageDuration) + durationMs(gap);

const unexpectedFailures = new Rate('query_unexpected_failures');
const finalBusy = new Rate('query_final_busy');
const contractFailures = new Counter('point_contract_failures');
const queryDuration = new Trend('query_capacity_duration', true);

export const options = {
  scenarios: {
    normal_15: {
      executor: 'constant-vus', vus: 15, duration: stageDuration,
      exec: 'normal', gracefulStop: '15s', tags: { stage: 'normal_15' },
    },
    peak_30: {
      executor: 'constant-vus', vus: 30, duration: stageDuration,
      startTime: `${peakStartMs}ms`, exec: 'peak', gracefulStop: '15s',
      tags: { stage: 'peak_30' },
    },
    burst_100: {
      executor: 'constant-vus', vus: 100, duration: burstDuration,
      startTime: `${burstStartMs}ms`,
      exec: 'burst', gracefulStop: '30s', tags: { stage: 'burst_100' },
    },
  },
  thresholds: {
    'query_unexpected_failures{stage:normal_15}': ['rate<0.01'],
    'query_unexpected_failures{stage:peak_30}': ['rate<0.03'],
    'query_unexpected_failures{stage:burst_100}': ['rate<0.05'],
    'query_final_busy{stage:normal_15}': ['rate<0.01'],
    'query_final_busy{stage:peak_30}': ['rate<0.05'],
    'query_final_busy{stage:burst_100}': ['rate<0.50'],
    'query_capacity_duration{stage:normal_15}': ['p(95)<5000'],
    'query_capacity_duration{stage:peak_30}': ['p(95)<8000'],
    point_contract_failures: ['count==0'],
  },
};

export function setup() {
  if (!datasourceIds.length) throw new Error('DATASOURCE_IDS must contain at least one numeric ID.');
  if ((__ENV.REQUIRE_100_DATASOURCES || 'false').toLowerCase() === 'true'
      && new Set(datasourceIds).size < 100) {
    throw new Error('REQUIRE_100_DATASOURCES=true requires 100 distinct DATASOURCE_IDS.');
  }
  if (expectedSampleMethod && !['INDEX_RANDOM', 'RESULT_RANDOM', 'RESERVOIR_RANDOM', 'SYSTEM'].includes(expectedSampleMethod)) {
    throw new Error(`Unsupported EXPECT_SAMPLE_METHOD: ${expectedSampleMethod}`);
  }
  if (!Number.isFinite(expectedPopulationMin) || expectedPopulationMin <= sampleSize) {
    throw new Error('EXPECT_POPULATION_MIN must be greater than SAMPLE_SIZE.');
  }
  const health = http.get(`${baseUrl}/actuator/health`, { tags: { operation: 'health' } });
  if (!check(health, { 'server is ready': (response) => response.status === 200 })) {
    throw new Error(`Server health check failed with HTTP ${health.status}.`);
  }
}

export function normal() { runIteration('normal_15'); }
export function peak() { runIteration('peak_30'); }
export function burst() { runIteration('burst_100'); }

function runIteration(stage) {
  const datasourceId = datasourceIds[(__VU - 1) % datasourceIds.length];
  const rawMode = __ITER % 10 === 0;
  const payload = JSON.stringify({
    datasourceId,
    chartType: 'scatter',
    mode: rawMode ? 'rows' : 'aggregate',
    options: {},
    builderConfig: {
      table: { datasourceId, schema: schemaName, name: tableName },
      joins: [], where: [], xAxis: xColumn,
      yAxis: [{ column: yColumn, agg: 'none' }],
      sample: { mode: 'auto', size: sampleSize, seed: 48291 },
    },
  });
  const attempt = postWithBusyRetry(payload, stage);
  const response = attempt.response;
  const busy = isQueryBusy(response);
  const accepted = response.status >= 200 && response.status < 300;
  finalBusy.add(busy, { stage });
  unexpectedFailures.add(!accepted && !(stage === 'burst_100' && busy), { stage });
  queryDuration.add(attempt.elapsedMs, { stage });

  let body;
  try { body = response.json(); } catch (_) { body = null; }
  check(response, {
    'success or bounded burst rejection': () => accepted || (stage === 'burst_100' && busy),
  });
  if (!accepted || !body) return;
  if (rawMode) {
    if (!(body.rowCount <= 1000)) contractFailures.add(1, { contract: 'raw_preview_1000' });
    return;
  }
  if (expectLarge) {
    let valid = body.rowCount <= sampleSize
      && body.sampling?.version === 9
      && body.sampling?.approximate === true;
    if (expectedSampleMethod) valid = valid && body.sampling?.method === expectedSampleMethod;
    if (expectedSampleMethod === 'RESERVOIR_RANDOM') {
      valid = valid
        && body.rowCount === sampleSize
        && body.sampling?.sampleSize === sampleSize
        && body.sampling?.populationCount >= expectedPopulationMin;
    }
    if (!valid) contractFailures.add(1, { contract: 'auto_point_v9' });
  }
}

function postWithBusyRetry(payload, stage) {
  const startedAt = Date.now();
  const params = {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    tags: { operation: 'run_builder', stage },
    timeout: '40s',
  };
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = http.post(`${baseUrl}/api/v1/query/run-builder`, payload, params);
    if (!isQueryBusy(response)) return { response, elapsedMs: Date.now() - startedAt };
    sleep((0.1 * (2 ** attempt)) + Math.random() * 0.1);
  }
  return { response, elapsedMs: Date.now() - startedAt };
}

function isQueryBusy(response) {
  if (response.status !== 503) return false;
  try { return response.json('code') === 'QUERY_BUSY'; } catch (_) { return false; }
}

function durationMs(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error(`Unsupported duration: ${value}`);
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return Number(match[1]) * factors[match[2]];
}
