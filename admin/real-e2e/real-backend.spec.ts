import { expect, test, type Page } from '@playwright/test';

const DATASOURCE_NAME = 'real-postgis-e2e';
const CHART_NAME = '실백엔드 시군구 지도';

async function openDataRefresh(page: Page) {
  const dataTab = page
    .getByRole('tablist', { name: '시각화 옵션 분류' })
    .getByRole('tab', { name: '데이터', exact: true });
  await dataTab.click();
  const section = page.locator('section').filter({
    has: page.getByRole('button', { name: '데이터 갱신', exact: true }),
  });
  const toggle = section.getByRole('button', { name: '데이터 갱신', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  return section.getByTestId('option-action-refreshNow');
}

test('MSW 없이 가입·로그인→등록→지도 저장·재진입→임베드→캐시 갱신을 관통한다', async ({ page, context }) => {
  await page.goto('/signup');
  await page.getByLabel('아이디').fill('real-e2e-owner');
  await page.getByLabel(/비밀번호 \(최소/).fill('real-e2e-password-2026');
  await page.getByLabel('비밀번호 확인').fill('real-e2e-password-2026');
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?registered=1$/);
  await page.getByLabel('아이디').fill('real-e2e-owner');
  await page.getByLabel('비밀번호').fill('real-e2e-password-2026');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/datasources');
  await page.getByRole('button', { name: '데이터소스 추가', exact: true }).first().click();
  const datasourceDialog = page.getByRole('dialog', { name: '데이터소스 추가' });
  await datasourceDialog.getByPlaceholder('analytics-db').fill(DATASOURCE_NAME);
  await datasourceDialog.getByPlaceholder('db.internal').fill('localhost');
  await datasourceDialog.getByPlaceholder('5432').fill('56432');
  await datasourceDialog.getByPlaceholder('analytics', { exact: true }).fill('chartsdk_e2e');
  await datasourceDialog.getByPlaceholder('reader').fill('chartsdk_reader');
  await datasourceDialog.locator('input[type="password"]').fill('chartsdk-reader');
  await datasourceDialog.getByRole('button', { name: '연결 테스트', exact: true }).click();
  await expect(datasourceDialog.getByText(/연결 성공/)).toBeVisible();
  await datasourceDialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('link', { name: DATASOURCE_NAME, exact: true })).toBeVisible();

  await page.goto('/charts/new');
  await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: DATASOURCE_NAME });
  await page.getByTestId('schema-sidebar').getByPlaceholder('검색', { exact: true }).fill('korea_sigungu_statistics');
  await page.locator('aside').first()
    .getByRole('button', { name: /korea_sigungu_statistics.*geometry_demo/ })
    .click();

  await page.getByRole('button', { name: '영역 지도', exact: true }).click();
  await page.getByRole('combobox', { name: '지도 경계 방식' }).selectOption('spatial');
  await page.getByRole('combobox', { name: '공간 Polygon 컬럼' }).selectOption('boundary');
  await page.getByRole('combobox', { name: '영역 이름 컬럼' }).selectOption('region_name');
  await page.getByRole('combobox', { name: '영역 값 컬럼' }).selectOption('population');
  await page.getByRole('button', { name: '실행', exact: true }).click();
  await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '__chartsdk_area_name' })).toBeVisible();

  await page.getByPlaceholder('차트 이름').fill(CHART_NAME);
  await page.locator('header').first().getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('저장되었습니다')).toBeVisible();
  await expect(page).toHaveURL(/\/charts\/real-postgis-e2e\/geometry_demo\/korea_sigungu_statistics\/\d+$/);
  const chartPath = new URL(page.url()).pathname;
  const chartId = Number(new URL(page.url()).pathname.split('/').at(-1));
  expect(chartId).toBeGreaterThan(0);

  await page.goto(chartPath);
  await expect(page.getByPlaceholder('차트 이름')).toHaveValue(CHART_NAME);
  await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '__chartsdk_area_name' })).toBeVisible();

  const refreshAction = await openDataRefresh(page);
  const refreshResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/charts/${chartId}/refresh`);
  await refreshAction.getByRole('button', { name: '지금 갱신', exact: true }).click();
  expect((await refreshResponse).status()).toBe(200);
  await expect(page.getByText('데이터를 갱신했습니다')).toBeVisible();
  await expect(refreshAction).toContainText('마지막 계산');
  await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

  await page.goto(chartPath);
  await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  await page.locator('header').first().getByRole('button', { name: '임베드 코드', exact: true }).click();
  const embedDialog = page.getByRole('dialog', { name: '임베드 코드' });
  // 새 차트에는 아직 임베드 키가 없다 — 소유자가 자신의 차트 키를 발급한다.
  await embedDialog.getByRole('button', { name: '임베드 키 발급', exact: true }).click();
  const snippet = await embedDialog.locator('pre').innerText();
  expect(snippet).toContain('data-embed-key="cek1_');
  expect(snippet).toContain('data-api-base="http://localhost:8082"');
  // 임베드 코드 노출 표면 계약: 차트 식별자가 코드에 없어야 한다.
  expect(snippet).not.toContain('data-chart-id');

  const embedPage = await context.newPage();
  await embedPage.goto('http://localhost:3001/embed-host.html');
  const embedDataResponse = embedPage.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/charts/data'
    && response.request().method() === 'GET');
  await embedPage.setContent(`
    <!doctype html>
    <html lang="ko">
      <body>
        <main style="width: 800px">
          <div style="width: 800px; height: 500px">${snippet}</div>
        </main>
      </body>
    </html>
  `);
  expect((await embedDataResponse).status()).toBe(200);
  const embeddedChart = embedPage.locator('[data-embed-key]');
  await expect(embeddedChart).toHaveAttribute('data-chart-rendered', '');
  await expect(embeddedChart.locator('canvas')).toBeVisible();
  await expect(embeddedChart.getByText(/데이터 기준/)).toBeVisible();
  await embedPage.close();
});
