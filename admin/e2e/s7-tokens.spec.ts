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

  test('새 사용자를 인라인 생성해 즉시 토큰을 발급한다', async ({ page }) => {
    await page.goto('/tokens');
    await page.getByRole('button', { name: '토큰 발급' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /새 사용자 만들기/ }).click();
    await dialog.getByPlaceholder('username').fill('new.user');
    await dialog.getByPlaceholder('표시명').fill('새사용자');
    await dialog.getByRole('button', { name: '발급', exact: true }).click();
    await expect(page.getByText('토큰을 발급했습니다')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'new.user' })).toBeVisible();
  });

  test('재발급하면 새 토큰이 생기고 활성은 1인 1개로 유지된다', async ({ page }) => {
    await page.goto('/tokens');
    await expect(page.locator('tbody tr')).toHaveCount(4);
    await expect(page.locator('tbody').getByText('활성', { exact: true })).toHaveCount(2); // kim·lee

    await page.getByRole('row').filter({ hasText: 'kim.gy' }).getByRole('button', { name: '재발급' }).click();
    await expect(page.getByText('토큰을 재발급했습니다')).toBeVisible();

    await expect(page.locator('tbody tr')).toHaveCount(5); // 토큰 1개 추가
    await expect(page.locator('tbody').getByText('활성', { exact: true })).toHaveCount(2); // 구 토큰 회수 → 총량 유지
  });

  test('만료·회수된 토큰 행에는 회수·재발급 버튼이 없다', async ({ page }) => {
    await page.goto('/tokens');
    const parkRow = page.getByRole('row').filter({ hasText: 'park.jw' }); // 만료
    await expect(parkRow.getByRole('button', { name: '회수' })).toHaveCount(0);
    await expect(parkRow.getByRole('button', { name: '재발급' })).toHaveCount(0);
  });
});
