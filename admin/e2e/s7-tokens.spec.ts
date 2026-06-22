import { test, expect } from '@playwright/test';

// S7 토큰 관리 — 목록(상태 뱃지) · 발급 · 회수.
test.describe('S7 토큰 관리', () => {
  test('사용자별 토큰 목록과 상태 뱃지가 보인다', async ({ page }) => {
    await page.goto('/tokens');
    await expect(page.getByText('kim.gy')).toBeVisible();
    await expect(page.getByText('park.jw')).toBeVisible();
    await expect(page.locator('tbody').getByText('만료', { exact: true })).toBeVisible();
    await expect(page.getByText('회수됨')).toBeVisible();
  });

  test('토큰 발급 모달 → 발급 완료 토스트', async ({ page }) => {
    await page.goto('/tokens');
    await page.getByRole('button', { name: '토큰 발급' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '발급', exact: true }).click();
    await expect(page.getByText('토큰을 발급했습니다')).toBeVisible();
  });

  test('토큰 회수 → 확인 모달 → 회수 토스트', async ({ page }) => {
    await page.goto('/tokens');
    await page.getByRole('button', { name: '회수' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '회수', exact: true }).click();
    await expect(page.getByText('토큰을 회수했습니다')).toBeVisible();
  });
});
