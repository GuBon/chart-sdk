import { test, expect } from '@playwright/test';

// S2-a 레이아웃 골격 + S2-b 스키마 탐색기 동작 검증.
test.describe('S2 차트 편집 — 골격 + 스키마 탐색기', () => {
  test('신규 진입 시 편집 헤더·정의모드 탭이 보인다', async ({ page }) => {
    await page.goto('/charts/new');

    // Top Bar
    await expect(page.getByRole('button', { name: '목록' })).toBeVisible();
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible();
    await expect(page.getByRole('button', { name: '임베드 코드' })).toBeDisabled();
    await expect(page.getByPlaceholder('차트 이름')).toBeVisible();

    // 정의 모드 탭
    await expect(page.getByText('노코드', { exact: true })).toBeVisible();
    await expect(page.getByText('준비 중')).toBeVisible();
  });

  test('데이터소스 선택 → 테이블/컬럼 트리가 동작한다', async ({ page }) => {
    await page.goto('/charts/new');

    // 선택 전 안내
    await expect(page.getByText('데이터소스를 먼저 선택하세요.')).toBeVisible();

    // 데이터소스 선택 (MSW 시드: analytics-db)
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    // 테이블 트리 등장 후 sales 선택 → 컬럼 노출
    const tree = page.locator('aside').first();
    await tree.getByRole('button', { name: /sales/ }).click();
    await expect(tree.getByText('category', { exact: true })).toBeVisible();
    await expect(tree.getByText('amount', { exact: true })).toBeVisible();
    await expect(tree.getByText('numeric', { exact: true })).toBeVisible();
  });

  test('빌더 폼: 테이블·X축·Y축 구성 시 실행이 활성화되고 SQL 보기가 토글된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    await page.getByRole('combobox', { name: '테이블' }).selectOption('sales');
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');

    // Y축 없으면 실행 비활성
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeEnabled();

    // 생성된 SQL 보기 토글
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText('실행하면 생성된 SQL이 표시됩니다.')).toBeVisible();
  });

  test('실행 시 집계 결과표와 생성 SQL이 채워진다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    // 탐색기에서 테이블 선택 → 원본 데이터 자동 로드
    await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();
    await expect(page.getByText(/행 ·/)).toBeVisible();

    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();

    // 집계 결과(실행 결과 탭) — 카테고리 라벨 표시
    await expect(page.getByText('의류')).toBeVisible();

    // 생성된 SQL
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/SELECT/)).toBeVisible();
  });

  test('실행 후 ECharts 미리보기와 옵션 패널(대분류 전환)이 동작한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();

    // ECharts 캔버스 렌더
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    // 옵션 패널 + 대분류 선택기
    await expect(page.getByText('시각화 옵션')).toBeVisible();
    await expect(page.getByRole('button', { name: '원형' })).toBeVisible();

    // 대분류 전환(막대→원형) 후에도 미리보기 유지
    await page.getByRole('button', { name: '원형', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('팔레트 swatch 선택 후 RGB 사용자지정 값이 미리보기에 반영된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await page.getByTestId('palette-swatch-1').click();
    await page.locator('#option-palette-r').fill('255');
    await page.locator('#option-palette-g').fill('0');
    await page.locator('#option-palette-b').fill('0');

    await expect(page.locator('#option-palette-color')).toHaveValue('#ff0000');
    await expect(page.getByTestId('palette-swatch-1')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('표본 추출을 켜면 생성 SQL에 TABLESAMPLE이 주입되고 근사치 배지가 뜬다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();

    // 표본 추출 토글 ON + 비율 25%
    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('spinbutton', { name: '표본 비율' }).fill('25');

    await page.getByRole('button', { name: '실행', exact: true }).click();

    // 실행 결과 메타에 근사치 배지
    await expect(page.getByText(/근사치 · 표본 25%/)).toBeVisible();

    // 생성된 SQL 에 TABLESAMPLE SYSTEM (25)
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/TABLESAMPLE SYSTEM \(25\)/)).toBeVisible();
  });

  test('표본 추출 컨트롤은 기존 S2 편집 화면에서도 동일하게 노출되고 테이블 변경 시 유지된다', async ({ page }) => {
    await page.goto('/charts/12');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toBeVisible();

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('spinbutton', { name: '표본 비율' }).fill('30');

    await page.getByRole('combobox', { name: '테이블' }).selectOption('users');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('spinbutton', { name: '표본 비율' })).toHaveValue('30');
  });

  test('조인을 추가하면 표본 추출이 자동 해제되고 다시 켤 수 없다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('spinbutton', { name: '표본 비율' }).fill('25');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: '+ 조인 추가' }).click();
    const sampleSwitch = page.getByRole('switch', { name: '표본 추출' });
    await expect(sampleSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(sampleSwitch).toBeDisabled();
    await expect(page.getByText('조인 사용 중에는 표본 추출을 사용할 수 없습니다.')).toBeVisible();
  });

  test('테이블 조인을 구성하면 생성 SQL에 JOIN이 들어가고 컬럼이 qualified 된다 (11장)', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();

    // 조인 추가 → orders, ON sales.id = orders.sale_id
    await page.getByRole('button', { name: '+ 조인 추가' }).click();
    await page.getByRole('combobox', { name: '조인 테이블' }).selectOption('orders');
    await page.getByRole('combobox', { name: '조인 기준 컬럼' }).selectOption('sales.id');
    await page.getByRole('combobox', { name: '조인 대상 컬럼' }).selectOption('orders.sale_id');

    // 조인 시 컬럼은 qualified("테이블.컬럼")
    await page.getByRole('combobox', { name: 'X축' }).selectOption('sales.category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();

    // 생성된 SQL 에 LEFT JOIN ... ON (qualified)
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/LEFT JOIN "orders" ON "sales"\."id" = "orders"\."sale_id"/)).toBeVisible();
  });
});

test.describe('S2 차트 편집 — 저장·모달(S2-f)', () => {
  async function buildChart(page: import('@playwright/test').Page) {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
  }

  test('실행·이름 입력 후 저장하면 완료 토스트가 뜬다', async ({ page }) => {
    await buildChart(page);
    // 저장 = 실행 + 캐시 시드(PRD 7.3): 실행 결과가 있어야 저장 가능
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('의류')).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('월별 매출');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장되었습니다')).toBeVisible();
  });

  test('저장 후 임베드 코드 버튼 활성화 + S3 모달 연결', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('의류')).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('신규 차트');
    await expect(page.getByRole('button', { name: '임베드 코드' })).toBeDisabled();

    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장되었습니다')).toBeVisible();

    await expect(page.getByRole('button', { name: '임베드 코드' })).toBeEnabled();
    await page.getByRole('button', { name: '임베드 코드' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/sdk\.js/)).toBeVisible();
  });

  test('빌더 변경 시 실행 결과가 무효화되어 재실행 전 저장 불가', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('의류')).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('x');
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();

    // X축 변경 → 결과/SQL 무효화 → 저장 비활성(stale 저장 방지)
    await page.getByRole('combobox', { name: 'X축' }).selectOption('dept');
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeDisabled();
  });

  test('구성이 있을 때 데이터소스 변경은 확인 모달을 거친다', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'sales-db' });
    await expect(page.getByText('데이터소스를 변경할까요?')).toBeVisible();
    await page.getByRole('button', { name: '변경', exact: true }).click();
    await expect(page.getByText('데이터소스를 변경할까요?')).toBeHidden();
    await expect(page.getByRole('combobox', { name: '데이터소스' })).toHaveValue('2');
  });

  test('미저장 변경 상태에서 목록 이동은 이탈확인 모달을 거친다', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('button', { name: '목록' }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeVisible();
    await page.getByRole('button', { name: '계속 편집' }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeHidden();
  });
});
