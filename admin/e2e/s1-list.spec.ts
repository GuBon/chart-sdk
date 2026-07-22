import { test, expect } from '@playwright/test';

// S1 차트 목록 — 카드 그리드 · 검색 · 삭제확인.
test.describe('S1 차트 목록', () => {
  test('카드 그리드와 미니 차트, 새 차트 카드가 보인다', async ({ page }) => {
    let batchPreviewCalls = 0;
    let singlePreviewCalls = 0;
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (path === '/api/v1/charts/previews') batchPreviewCalls += 1;
      if (/\/api\/v1\/charts\/\d+\/preview$/.test(path)) singlePreviewCalls += 1;
    });
    const previews = page.waitForResponse((res) => res.url().includes('/api/v1/charts/previews') && res.status() === 200);
    await page.goto('/');
    await previews;
    await expect(page.getByText('월별 매출', { exact: true })).toBeVisible();
    await expect(page.getByText('일별 방문자', { exact: true })).toBeVisible();
    await expect(page.getByText('새 차트 만들기')).toBeVisible();
    // 저장된 차트 기준 batch preview option이 카드별 ECharts 캔버스로 렌더된다. (시드 13개 → 1페이지 12개)
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toHaveCount(12);
    await expect(page.getByText('preview unavailable')).toBeHidden();
    expect(batchPreviewCalls).toBe(1);
    expect(singlePreviewCalls).toBe(0);
  });

  test('AppBar 검색으로 목록이 필터된다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: '차트 검색' }).fill('방문');
    await expect(page.getByText('일별 방문자', { exact: true })).toBeVisible();
    await expect(page.getByText('월별 매출', { exact: true })).toBeHidden();
  });

  test('카드 삭제 → 확인 모달 → 목록에서 제거된다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('월별 매출', { exact: true })).toBeVisible();
    await page.locator('canvas').first().hover();
    await page.getByRole('button', { name: '삭제' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page.getByText('월별 매출', { exact: true })).toBeHidden();
  });
});

// 시드 13개(막대·선·원형·분포 혼합, ds1/ds2) 기준 — 필터·정렬·페이지네이션.
test.describe('S1 필터·정렬·페이지네이션', () => {
  test('종류 필터로 원형 차트만 남는다', async ({ page }) => {
    await page.goto('/');
    await page.locator('#chart-type-filter').selectOption('pie');
    await expect(page.getByText('분기별 이익', { exact: true })).toBeVisible(); // pie
    await expect(page.getByText('월별 매출', { exact: true })).toBeHidden(); // bar
  });

  test('데이터소스 필터로 해당 소스 차트만 남는다', async ({ page }) => {
    await page.goto('/');
    await page.locator('#chart-datasource-filter').selectOption('analytics-db');
    await expect(page).toHaveURL('/data/analytics-db');
    await expect(page.locator('#chart-datasource-filter')).toHaveValue('analytics-db');
    await expect(page.getByText('일별 방문자', { exact: true })).toBeVisible(); // ds1
    await expect(page.getByText('월별 매출', { exact: true })).toBeHidden(); // ds2
  });

  test('데이터소스 경로에서 검색해도 선택한 소스 범위를 유지한다', async ({ page }) => {
    await page.goto('/data/analytics-db');
    await page.getByRole('textbox', { name: '차트 검색' }).fill('방문');
    await expect(page).toHaveURL('/data/analytics-db?q=%EB%B0%A9%EB%AC%B8');
    await expect(page.locator('#chart-datasource-filter')).toHaveValue('analytics-db');
    await expect(page.getByText('일별 방문자', { exact: true })).toBeVisible();
  });

  test('기존 숫자 ID 필터 주소는 이름 기반 경로로 정규화한다', async ({ page }) => {
    await page.goto('/?datasourceId=1&type=line');
    await expect(page).toHaveURL('/data/analytics-db?type=line');
    await expect(page.locator('#chart-datasource-filter')).toHaveValue('analytics-db');
  });

  test('조건 불일치 시 빈 상태와 필터 초기화가 동작한다', async ({ page }) => {
    await page.goto('/');
    await page.locator('#chart-type-filter').selectOption('pie');
    await expect(page).toHaveURL(/type=pie/);
    await page.locator('#chart-datasource-filter').selectOption('legacy-dw'); // 차트 0
    await expect(page.getByText('조건에 맞는 차트가 없습니다')).toBeVisible();
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await expect(page.getByText('조건에 맞는 차트가 없습니다')).toBeHidden();
    await expect(page.getByText('월별 매출', { exact: true })).toBeVisible(); // 전체 복원
  });

  test('이름 오름차순 정렬은 첫 카드를 바꾸고 URL에 반영된다', async ({ page }) => {
    await page.goto('/');
    await page.locator('#chart-sort').selectOption('name_asc');
    await expect(page).toHaveURL(/sort=name_asc/);
    await expect(page.locator('[data-testid="chart-card-name"]').first()).toHaveText('가격대별 분포');
  });

  test('13개 시드에서 페이지네이션이 동작한다', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="chart-card-name"]')).toHaveCount(12);
    await expect(page.getByText('새 차트 만들기')).toBeVisible();
    await expect(page.getByText('1 / 2')).toBeVisible();
    await expect(page.getByRole('button', { name: '이전' })).toBeDisabled();

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByText('2 / 2')).toBeVisible();
    await expect(page.locator('[data-testid="chart-card-name"]')).toHaveCount(1);
    await expect(page.getByText('새 차트 만들기')).toBeHidden(); // page !== 1 이면 숨김
    await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
  });

  test('마지막 페이지의 유일한 차트를 삭제하면 이전 페이지로 보정된다', async ({ page }) => {
    await page.goto('/?page=2');
    await expect(page.getByText('월별 순이익', { exact: true })).toBeVisible();
    await expect(page.getByText('2 / 2')).toBeVisible();

    await page.locator('canvas').first().hover();
    await page.getByRole('button', { name: '삭제' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();

    // 총 12개 → 1페이지로 보정(page > totalPages)
    await expect(page.getByText('월별 순이익', { exact: true })).toBeHidden();
    await expect(page.getByText('새 차트 만들기')).toBeVisible();
  });

  test('필터를 바꾸면 페이지가 1로 리셋된다', async ({ page }) => {
    await page.goto('/?page=2');
    await expect(page.getByText('월별 순이익', { exact: true })).toBeVisible();
    await page.locator('#chart-type-filter').selectOption('bar');
    await expect(page).toHaveURL(/type=bar/);
    await expect(page).not.toHaveURL(/page=2/);
  });
});
