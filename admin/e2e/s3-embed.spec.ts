import { test, expect } from '@playwright/test';

// S3 임베드 코드 모달 — S1 카드 임베드 버튼에서 진입.
test.describe('S3 임베드 코드', () => {
  test.use({ permissions: ['clipboard-write'] });

  test('임베드 버튼 → 붙여넣기 가능한 스니펫 표시·복사·실제 canvas 렌더', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '임베드' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('임베드 코드')).toBeVisible();

    // 토큰 선택 + 스니펫(첫 카드 = 월별 매출 #12)
    await expect(dialog.getByRole('combobox', { name: '사용자 토큰' })).toBeVisible();
    await expect(dialog.getByText(/data-chart-id="12"/)).toBeVisible();
    await expect(dialog.getByText(/sdk\.js/)).toBeVisible();
    await expect(dialog.getByText(/data-api-base="http:\/\/localhost:3100"/)).toBeVisible();

    const code = await dialog.locator('pre').innerText();
    expect(code).toContain('<script src="http://localhost:3100/sdk.js"');
    expect(code).toContain('data-api-base="http://localhost:3100"');

    // 복사 → 피드백
    await dialog.getByRole('button', { name: '복사' }).click();
    await expect(dialog.getByRole('button', { name: '복사되었습니다' })).toBeVisible();

    // 모달에서 받은 HTML만 빈 호스트 문서에 삽입한다. 별도 전역 설정 없이 SDK가 API를 읽고 canvas를 만들어야 한다.
    const sdkResponse = await page.request.get('/sdk.js');
    expect(sdkResponse.ok()).toBe(true);
    await page.setContent(`<!doctype html><html><body>${code}</body></html>`);

    const slot = page.locator('[data-chart-id="12"]');
    await expect(slot).toHaveAttribute('data-chart-rendered', '');
    await expect(slot).not.toHaveAttribute('data-chart-error', '');
    await expect(slot.locator('canvas')).toBeVisible();
  });
});
