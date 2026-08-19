import { expect, test } from '@playwright/test';

test('관리자는 사용자 현황과 역할 변경을 관리한다', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '사용자 관리' })).toBeVisible();
  await page.getByRole('link', { name: '이서현' }).click();
  await expect(page.getByRole('heading', { name: '이서현' })).toBeVisible();
  await page.getByRole('button', { name: '관리자로 변경' }).click();
  const dialog = page.getByRole('dialog', { name: '변경 확인' });
  await dialog.getByRole('button', { name: '변경', exact: true }).click();
  await expect(page.getByRole('button', { name: '일반 사용자로 변경' })).toBeVisible();
  await expect(page.getByText('차트별 임베드 키 현황')).toBeVisible();
});

test('관리자는 전체 차트를 읽기 전용으로 조회한다', async ({ page }) => {
  await page.goto('/admin/charts');
  await expect(page.getByRole('heading', { name: '전체 차트' })).toBeVisible();
  await page.getByRole('link', { name: '월별 매출' }).click();
  await expect(page.getByText('관리자 읽기 전용')).toBeVisible();
  await expect(page.getByRole('heading', { name: '월별 매출' })).toBeVisible();
  await expect(page.getByRole('button', { name: '저장' })).toHaveCount(0);
  await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
});
