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

  test('데이터소스에서 스키마·관계·관련 차트까지 계층적으로 탐색한다', async ({ page }) => {
    await page.goto('/datasources');

    await page.getByRole('link', { name: 'analytics-db' }).click();
    await expect(page).toHaveURL('/data/analytics-db');
    await expect(page.getByRole('heading', { name: 'analytics-db' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '이 데이터소스를 사용하는 차트' })).toBeVisible();

    await page.getByRole('link', { name: 'public' }).click();
    await expect(page).toHaveURL('/data/analytics-db/public');
    const search = page.getByRole('textbox', { name: '관계 검색' });
    await search.fill('users');
    await expect(page.getByRole('link', { name: 'users' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'sales' })).toHaveCount(0);
    await search.clear();

    await page.getByRole('link', { name: 'sales' }).click();
    await expect(page).toHaveURL('/data/analytics-db/public/sales');
    await expect(page.getByRole('heading', { name: 'sales', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '컬럼명' })).toBeVisible();
    const visitorChart = page.locator('div.group').filter({ hasText: '일별 방문자' });
    await expect(visitorChart).toBeVisible();
    await expect(visitorChart.getByRole('link', { name: '편집' }))
      .toHaveAttribute('href', '/data/analytics-db/public/sales/13');
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

  test('수정 모달은 기존 값을 채우고 비밀번호 없이 저장할 수 있다', async ({ page }) => {
    await page.goto('/datasources');
    const row = page.getByRole('row').filter({ hasText: 'analytics-db' });
    await row.getByRole('button', { name: '수정' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('데이터소스 수정')).toBeVisible();
    await expect(dialog.getByPlaceholder('변경 시에만 입력')).toBeVisible();
    // edit 모드는 비밀번호 없이도 저장 활성
    await expect(dialog.getByRole('button', { name: '저장' })).toBeEnabled();

    await dialog.getByPlaceholder('analytics-db').fill('analytics-db-2');
    await dialog.getByRole('button', { name: '저장' }).click();
    const renamedDatasource = page.getByRole('link', { name: 'analytics-db-2' });
    await expect(renamedDatasource).toHaveAttribute('href', '/data/analytics-db-2');
  });

  test('수정 시 비밀번호를 비우면 PUT 요청에 dbPassword가 없다', async ({ page }) => {
    await page.goto('/datasources');
    await page.getByRole('row').filter({ hasText: 'analytics-db' }).getByRole('button', { name: '수정' }).click();

    const dialog = page.getByRole('dialog');
    const putReq = page.waitForRequest((r) => r.url().includes('/api/v1/datasources/1') && r.method() === 'PUT');
    await dialog.getByRole('button', { name: '저장' }).click();
    const req = await putReq;
    expect(req.postDataJSON()).not.toHaveProperty('dbPassword');
  });

  test('미사용 데이터소스(legacy-dw)는 삭제된다', async ({ page }) => {
    await page.goto('/datasources');
    await page.getByRole('row').filter({ hasText: 'legacy-dw' }).getByRole('button', { name: '삭제' }).click();
    await expect(page.getByText('데이터소스를 삭제할까요?')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click();
    await expect(page.getByRole('cell', { name: 'legacy-dw' })).toHaveCount(0);
  });
});
