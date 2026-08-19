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
    await expect(page).toHaveURL('/charts/analytics-db?view=schema');
    await expect(page.getByRole('heading', { name: 'analytics-db' })).toBeVisible();
    await page.getByRole('link', { name: /^public 관계/ }).click();
    await expect(page).toHaveURL('/charts/analytics-db/public?view=relations');
    await page.getByRole('navigation', { name: '스키마 보기' }).getByRole('link', { name: '차트', exact: true }).click();
    await expect(page).toHaveURL('/charts/analytics-db/public');
    await expect(page.locator('#chart-datasource-filter')).toHaveValue('analytics-db');
    await expect(page.getByText('일별 방문자', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: '데이터 탐색' }).click();
    await expect(page).toHaveURL('/charts/analytics-db/public?view=relations');
    const search = page.getByRole('textbox', { name: '관계 검색' });
    await search.fill('users');
    await expect(page.getByRole('link', { name: 'users' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'sales' })).toHaveCount(0);
    await search.clear();

    const salesLink = page.getByRole('link', { name: 'sales', exact: true });
    await expect(salesLink).toBeVisible();
    await expect(salesLink).toHaveAttribute('href', '/charts/analytics-db/public/sales?view=columns');
    await Promise.all([
      page.waitForURL('/charts/analytics-db/public/sales?view=columns'),
      salesLink.click(),
    ]);
    // 관계 제목은 데이터 표시 이름을 우선한다 — 실제 이름은 설명 줄과 컬럼 표의 '실제 이름' 열로 확인한다.
    await expect(page.getByRole('heading', { name: '매출', exact: true })).toBeVisible();
    await expect(page.getByText('public.sales · TABLE')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '표시 이름' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '실제 이름' })).toBeVisible();

    await page.getByRole('navigation', { name: '테이블 보기' }).getByRole('link', { name: '차트', exact: true }).click();
    await expect(page).toHaveURL('/charts/analytics-db/public/sales');
    await expect(page.locator('#chart-type-filter')).toBeVisible();
    const visitorChart = page.getByRole('article').filter({ hasText: '일별 방문자' });
    await expect(visitorChart).toBeVisible();
    await expect(visitorChart.getByRole('link', { name: '편집' }))
      .toHaveAttribute('href', '/charts/analytics-db/public/sales/13');
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

  test('차트 생성 경로와 충돌하는 new 이름은 등록할 수 없다', async ({ page }) => {
    await page.goto('/datasources');
    await page.getByRole('button', { name: '데이터소스 추가' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('analytics-db').fill('new');
    await dialog.getByPlaceholder('db.internal').fill('db.internal');
    await dialog.getByRole('textbox', { name: 'analytics', exact: true }).fill('analytics');
    await dialog.getByPlaceholder('reader').fill('reader');
    await dialog.locator('input[type="password"]').fill('secret');

    await expect(dialog.getByText('new는 차트 생성 경로에 사용되어 데이터소스 이름으로 등록할 수 없습니다.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  test('포트와 커넥션 상한의 범위 밖 값은 기본값으로 바꾸지 않고 저장을 막는다', async ({ page }) => {
    await page.goto('/datasources');
    await page.getByRole('button', { name: '데이터소스 추가' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('analytics-db').fill('boundary-db');
    await dialog.getByPlaceholder('db.internal').fill('db.internal');
    await dialog.getByRole('textbox', { name: 'analytics', exact: true }).fill('analytics');
    await dialog.getByPlaceholder('reader').fill('reader');
    await dialog.locator('input[type="password"]').fill('secret');
    await expect(dialog.getByRole('button', { name: '저장' })).toBeEnabled();

    await dialog.getByPlaceholder('5432').fill('0');
    await expect(dialog.getByText('포트는 1~65535 사이의 정수여야 합니다.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '저장' })).toBeDisabled();

    await dialog.getByPlaceholder('5432').fill('5432');
    await dialog.getByRole('button', { name: '고급 설정' }).click();
    await dialog.locator('input[inputmode="numeric"]').last().fill('51');
    await expect(dialog.getByText('커넥션 상한은 1~50 사이의 정수여야 합니다.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '저장' })).toBeDisabled();
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
    await expect(renamedDatasource).toHaveAttribute('href', '/charts/analytics-db-2?view=schema');
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
