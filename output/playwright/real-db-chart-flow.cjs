const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..', '..');
const adminDir = path.join(root, 'admin');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const nodeBin = process.execPath;
const baseUrl = 'http://localhost:3100';
const apiBase = 'http://127.0.0.1:8080';

function waitForHttp(url, timeoutMs = 120000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${url}`));
        else setTimeout(tick, 500);
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    tick();
  });
}

async function main() {
  const next = spawn(nodeBin, [nextBin, 'dev', '-p', '3100'], {
    cwd: adminDir,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_BASE: apiBase,
      NEXT_PUBLIC_ENABLE_MSW: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let nextOutput = '';
  next.stdout.on('data', (chunk) => {
    nextOutput += chunk.toString();
  });
  next.stderr.on('data', (chunk) => {
    nextOutput += chunk.toString();
  });

  let browser;
  let page;
  try {
    await waitForHttp(baseUrl);

    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const apiCalls = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/v1/')) apiCalls.push(`${response.status()} ${url.replace(apiBase, '')}`);
    });

    await page.goto(`${baseUrl}/datasources`, { waitUntil: 'networkidle' });
    const dsRow = page.locator('tr').filter({ hasText: 'local-user-db' });
    await dsRow.waitFor({ state: 'visible', timeout: 15000 });
    if (!(await dsRow.textContent()).includes('5432')) throw new Error('Datasource row did not show port 5432');

    const testResponsePromise = page.waitForResponse((r) => r.url().includes('/api/v1/datasources/test') && r.request().method() === 'POST');
    await dsRow.locator('button').first().click();
    const testResponse = await testResponsePromise;
    const testJson = await testResponse.json();
    if (!testJson.ok) throw new Error(`Datasource connection test failed: ${testJson.message}`);

    await page.goto(`${baseUrl}/charts/new`, { waitUntil: 'networkidle' });
    await page.locator('select').first().selectOption({ label: 'local-user-db' });
    await page.waitForResponse((r) => r.url().includes('/api/v1/schema/tables') && r.status() === 200);

    await page.locator('button').filter({ hasText: 'sales' }).first().click();
    await page.waitForResponse((r) => r.url().includes('/api/v1/schema/tables/sales/preview') && r.status() === 200);

    await page.locator('select').filter({ has: page.locator('option[value="category"]') }).first().selectOption('category');
    await page.locator('button').filter({ hasText: '+' }).nth(1).click();
    await page.locator('select').nth(3).selectOption('amount');

    const runResponses = [];
    page.on('response', async (r) => {
      if (r.url().includes('/api/v1/query/run-builder') && r.request().method() === 'POST') runResponses.push(r);
    });
    await page.locator('section button').first().click();
    await page.waitForFunction(() => document.querySelector('[data-testid="chart-preview"] canvas'));
    await page.locator('[data-testid="chart-preview"] canvas').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByText('food', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    if (runResponses.length < 2) throw new Error(`Expected aggregate and raw query calls, got ${runResponses.length}`);

    const chartName = `PW Real Sales ${Date.now()}`;
    await page.locator('header input').first().fill(chartName);
    const saveResponsePromise = page.waitForResponse((r) => r.url().endsWith('/api/v1/charts') && r.request().method() === 'POST');
    await page.locator('header button').nth(1).click();
    const saveResponse = await saveResponsePromise;
    const saved = await saveResponse.json();
    if (!saved.id || saved.name !== chartName) throw new Error('Saved chart response did not contain expected chart');
    await page.getByText(`#${saved.id}`).waitFor({ state: 'visible', timeout: 15000 });

    await page.screenshot({ path: path.join(__dirname, 'real-db-chart-flow.png'), fullPage: true });
    await browser.close();

    console.log(JSON.stringify({
      ok: true,
      datasource: testJson.message,
      chartId: saved.id,
      chartName: saved.name,
      apiCalls,
      screenshot: path.join(__dirname, 'real-db-chart-flow.png'),
    }, null, 2));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(__dirname, 'real-db-chart-flow-failure.png'), fullPage: true }).catch(() => {});
      const html = await page.content().catch(() => '');
      require('fs').writeFileSync(path.join(__dirname, 'real-db-chart-flow-failure.html'), html);
    }
    if (nextOutput) console.error(nextOutput);
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (process.platform === 'win32') {
      spawnSync('C:\\Windows\\System32\\taskkill.exe', ['/PID', String(next.pid), '/T', '/F'], { stdio: 'ignore' });
    } else if (!next.killed) {
      next.kill('SIGTERM');
    }
    if (nextOutput && process.env.DEBUG_NEXT_OUTPUT) {
      console.error(nextOutput);
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
