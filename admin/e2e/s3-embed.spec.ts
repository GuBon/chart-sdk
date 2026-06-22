import { test, expect } from '@playwright/test';

// S3 임베드 코드 모달 — S1 카드 임베드 버튼에서 진입.
test.describe('S3 임베드 코드', () => {
  test.use({ permissions: ['clipboard-write'] });

  test('임베드 버튼 → 토큰 포함 스니펫 표시 + 복사', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '임베드' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('임베드 코드')).toBeVisible();

    // 토큰 선택 + 스니펫(첫 카드 = 월별 매출 #12)
    await expect(dialog.getByRole('combobox', { name: '사용자 토큰' })).toBeVisible();
    await expect(dialog.getByText(/data-chart-id="12"/)).toBeVisible();
    await expect(dialog.getByText(/sdk\.js/)).toBeVisible();

    // 복사 → 피드백
    await dialog.getByRole('button', { name: '복사' }).click();
    await expect(dialog.getByRole('button', { name: '복사되었습니다' })).toBeVisible();
  });
});
