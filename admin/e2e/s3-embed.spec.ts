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
    expect(sdkResponse.headers()['cache-control']).toBe('public, max-age=0, must-revalidate');
    const fontCssResponse = await page.request.get('/fonts/v1/chartsdk-fonts.css');
    expect(fontCssResponse.ok()).toBe(true);
    expect(fontCssResponse.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    const fontCss = await fontCssResponse.text();
    expect(fontCss).toContain("font-family: 'ChartSDK Pretendard'");
    expect(fontCss).toContain("font-family: 'ChartSDK Noto Sans KR'");
    expect((await page.request.get('/fonts/v1/pretendard/PretendardVariable.subset.91.woff2')).ok()).toBe(true);
    expect((await page.request.get('/fonts/v1/noto-sans-kr/noto-sans-kr-latin-wght-normal.woff2')).ok()).toBe(true);
    const embeddedData = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/charts/data'
      && response.request().method() === 'GET');
    await page.setContent(`<!doctype html><html><body>${code}</body></html>`);
    const embeddedPayload = await (await embeddedData).json();
    expect(embeddedPayload.option.dataZoom).toMatchObject([{
      type: 'inside',
      xAxisIndex: [0],
      filterMode: 'filter',
    }]);

    const slot = page.locator('[data-chart-id="12"]');
    await expect(slot).toHaveAttribute('data-chart-rendered', '');
    await expect(slot).not.toHaveAttribute('data-chart-error', '');
    const canvas = slot.locator('canvas');
    await expect(canvas).toBeVisible();

    // 응답 옵션 존재 여부뿐 아니라 실제 임베드 canvas 위 휠 입력이 화면을 확대하는지도 확인한다.
    await page.waitForTimeout(800);
    const beforeZoom = await canvas.screenshot();
    await canvas.hover();
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(500);
    const afterZoom = await canvas.screenshot();
    expect(afterZoom.equals(beforeZoom)).toBe(false);
  });

  test('클립보드 접근이 거부되면 코드를 선택하고 수동 복사 안내를 표시한다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '임베드' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('pre')).not.toBeEmpty();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('clipboard blocked')) },
      });
    });

    await dialog.getByRole('button', { name: '복사' }).click();
    await expect(dialog.getByRole('alert')).toContainText('자동 복사에 실패했습니다');
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selected).toContain('data-chart-id=');
  });
});
