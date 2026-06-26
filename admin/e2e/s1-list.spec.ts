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
    // 저장된 차트 기준 batch preview option이 카드별 ECharts 캔버스로 렌더된다.
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toHaveCount(5);
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
