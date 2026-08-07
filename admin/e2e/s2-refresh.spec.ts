import { expect, test, type Page } from '@playwright/test';

async function openDataRefresh(page: Page) {
  const dataTab = page
    .getByRole('tablist', { name: '시각화 옵션 분류' })
    .getByRole('tab', { name: '데이터', exact: true });
  await dataTab.click();
  await expect(dataTab).toHaveAttribute('aria-selected', 'true');

  const section = page.locator('section').filter({
    has: page.getByRole('button', { name: '데이터 갱신', exact: true }),
  });
  const sectionToggle = section.getByRole('button', { name: '데이터 갱신', exact: true });
  if (await sectionToggle.getAttribute('aria-expanded') !== 'true') await sectionToggle.click();
  return section.getByTestId('option-action-refreshNow');
}

test.describe('S2 저장 차트 스냅샷 갱신', () => {
  test('데이터 탭은 수동·항상 최신 조회만 제공하고 저장된 live 모드를 복원한다', async ({ page }) => {
    // 24 = mocks/seed.ts LIVE_REFRESH_CHART_ID('월별 순이익') — 시드에서 유일한 live 차트.
    await page.goto('/charts/analytics-db/public/sales/24');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await openDataRefresh(page);

    await expect(page.getByRole('button', { name: '수동', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '항상 최신 조회', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '캐시 사용', exact: true })).toHaveCount(0);
    await expect(page.getByText('캐시 유효 시간', { exact: true })).toHaveCount(0);
  });

  test('지금 갱신은 스냅샷 재계산 뒤 preview를 다시 읽고 마지막 계산 시각을 표시한다', async ({ page }) => {
    await page.goto('/charts/sales-db/public/sales/12');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await expect(page.getByTestId('chart-design-canvas').getByText(/데이터 기준/)).toBeVisible();
    const action = await openDataRefresh(page);
    await expect(action).toContainText('마지막 계산');

    const refreshRequest = page.waitForRequest((request) =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/charts/12/refresh');
    const previewRequest = page.waitForRequest((request) =>
      request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/charts/12/preview');

    await action.getByRole('button', { name: '지금 갱신', exact: true }).click();
    await refreshRequest;
    await previewRequest;

    await expect(page.getByText('데이터를 갱신했습니다')).toBeVisible();
    await expect(action).toContainText('마지막 계산');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('데이터 기준 시각 토글은 편집기 미리보기 캡션을 실제로 숨긴다', async ({ page }) => {
    await page.goto('/charts/sales-db/public/sales/12');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    const canvas = page.getByTestId('chart-design-canvas');
    await expect(canvas.getByText(/데이터 기준/)).toBeVisible();
    await openDataRefresh(page);

    const toggle = page.getByRole('switch', { name: '데이터 기준 시각 표시' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const hiddenCaptionPreview = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options?.showComputedAt === false;
    });
    await toggle.click();
    await hiddenCaptionPreview;
    await expect(canvas.getByText(/데이터 기준/)).toHaveCount(0);
  });

  test('갱신 결과에 새 자동 계열 색상이 생겨도 편집기를 미저장 상태로 만들지 않는다', async ({ page }) => {
    await page.goto('/charts/sales-db/public/sales/12');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const response = await originalFetch(input, init);
        if (method.toUpperCase() !== 'GET' || !url.endsWith('/api/v1/charts/12/preview') || !response.ok) {
          return response;
        }
        const payload = await response.clone().json();
        payload.option.__chartsdkAutoColorMap = {
          ...(payload.option.__chartsdkAutoColorMap ?? {}),
          'refresh-added-series': '#123456',
        };
        return new Response(JSON.stringify(payload), {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/json' },
        });
      };
    });

    const action = await openDataRefresh(page);
    await action.getByRole('button', { name: '지금 갱신', exact: true }).click();

    await expect(page.getByText('데이터를 갱신했습니다')).toBeVisible();
    await expect(action.getByRole('button', { name: '지금 갱신', exact: true })).toBeEnabled();
    await expect(action).not.toContainText('변경사항을 저장한 뒤 갱신하세요.');
  });

  test('신규·수정 중 차트는 저장 전 갱신을 막고 서버 오류를 인라인으로 안내한다', async ({ page }) => {
    await page.goto('/charts/new');
    let action = await openDataRefresh(page);
    await expect(action.getByRole('button', { name: '지금 갱신', exact: true })).toBeDisabled();
    await expect(action).toContainText('차트를 저장한 뒤 갱신할 수 있습니다.');

    await page.goto('/charts/sales-db/public/sales/12');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('저장 전 변경');
    action = await openDataRefresh(page);
    await expect(action.getByRole('button', { name: '지금 갱신', exact: true })).toBeDisabled();
    await expect(action).toContainText('변경사항을 저장한 뒤 갱신하세요.');

    await page.reload();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/api/v1/charts/12/refresh')) {
          return Promise.resolve(new Response(
            JSON.stringify({ error: { code: 'REFRESH_FAILED', message: '테스트 갱신 실패' } }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          ));
        }
        return originalFetch(input, init);
      };
    });
    action = await openDataRefresh(page);
    await action.getByRole('button', { name: '지금 갱신', exact: true }).click();
    await expect(action.getByRole('alert')).toHaveText('테스트 갱신 실패');
    await expect(action.getByRole('status')).toContainText('마지막 계산');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });
});
