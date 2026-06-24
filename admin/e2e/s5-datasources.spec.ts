import { expect, test } from '@playwright/test';

test.describe('S5 데이터소스 관리', () => {
  test.afterEach(async ({ context }) => {
    await context.close();
  });

  test('목록과 연결 상태, 연결 테스트가 동작한다', async ({ page }) => {
    await page.goto('/datasources');

    await expect(page.getByRole('heading', { name: '데이터소스' })).toBeVisible();
    const analyticsRow = page.getByRole('row').filter({ hasText: 'analytics-db' });
    await expect(analyticsRow).toBeVisible();
    await expect(analyticsRow.getByText('db.internal : 5432')).toBeVisible();
    await expect(analyticsRow.getByText('연결됨')).toBeVisible();

    await analyticsRow.getByRole('button', { name: '연결 테스트' }).click();
    await expect(analyticsRow.getByText('연결됨')).toBeVisible();
  });

  test('추가 모달은 생성 시 비밀번호를 요구하고 저장 후 목록에 반영한다', async ({ page }) => {
    await page.goto('/datasources');

    await page.getByRole('button', { name: '데이터소스 추가' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('analytics-db').fill('reporting-db');
    await dialog.getByPlaceholder('db.internal').fill('reporting.internal');
    await dialog.getByRole('textbox', { name: 'analytics', exact: true }).fill('reporting');
    await dialog.getByPlaceholder('reader').fill('readonly');
    await expect(dialog.getByRole('button', { name: '저장' })).toBeDisabled();

    await dialog.locator('input[type="password"]').fill('secret');
    await expect(dialog.getByRole('button', { name: '저장' })).toBeEnabled();
    await dialog.getByRole('button', { name: '저장' }).click();

    await expect(page.getByText('reporting-db')).toBeVisible();
    await expect(page.getByText('reporting.internal : 5432')).toBeVisible();
  });

  test('사용 중인 데이터소스 삭제는 409 경고를 인라인으로 보여준다', async ({ page }) => {
    await page.goto('/datasources');

    const row = page.getByRole('row').filter({ hasText: 'analytics-db' });
    await row.getByRole('button', { name: '삭제' }).click();
    await expect(page.getByText('데이터소스를 삭제할까요?')).toBeVisible();

    await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
    await expect(page.getByText('이 데이터소스를 사용하는 차트 3개가 있습니다.')).toBeVisible();
  });
});
