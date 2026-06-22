import { test, expect } from '@playwright/test';

// S1 차트 목록 — 카드 그리드 · 검색 · 삭제확인.
test.describe('S1 차트 목록', () => {
  test('카드 그리드와 미니 차트, 새 차트 카드가 보인다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('월별 매출', { exact: true })).toBeVisible();
    await expect(page.getByText('일별 방문자', { exact: true })).toBeVisible();
    await expect(page.getByText('새 차트 만들기')).toBeVisible();
    // 미니 ECharts 캔버스
    await expect(page.locator('canvas').first()).toBeVisible();
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
