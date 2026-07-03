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

    await page.getByRole('combobox', { name: '테이블' }).selectOption('1.public.sales');
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

  test('비-public 스키마 테이블을 선택해 스키마 한정 SQL을 생성한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    // 탐색기에서 analytics.events 선택 (스키마 배지 표시)
    await page.locator('aside').first().getByRole('button', { name: /events/ }).click();
    await expect(page.locator('aside').first().getByText('analytics', { exact: true })).toBeVisible();

    // 노코드 테이블 셀렉트 값은 스키마 한정 키
    await expect(page.getByRole('combobox', { name: '테이블' })).toHaveValue('1.analytics.events');

    await page.getByRole('combobox', { name: 'X축' }).selectOption('kind');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();

    // 생성된 SQL 이 "analytics"."events" 로 스키마 한정
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/FROM "analytics"\."events"/)).toBeVisible();
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
    await expect(page.getByTestId('palette-swatch-0')).toHaveCSS('background-color', 'rgb(84, 112, 198)');
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

    // 차트 12 base=sales-db(ds2) → 테이블 드롭다운은 ds2 테이블만. ds2 의 users 로 변경해도 표본 설정 유지.
    await page.getByRole('combobox', { name: '테이블' }).selectOption('2.public.users');
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
    await page.getByRole('combobox', { name: '조인 테이블' }).selectOption('1.public.orders');
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

  test('서로 다른 데이터소스의 테이블을 조인하면 페더레이션 SQL(ds 별칭)과 스냅샷 안내가 나온다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();

    // 사이드바를 sales-db 로 전환(구성 유지, 모달 없음) → 조인 대상은 그 소스에서 고른다
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'sales-db' });
    // 조인 추가 → 다른 소스(sales-db)의 customers, ON sales.customer_id = customers.id
    await page.getByRole('button', { name: '+ 조인 추가' }).click();
    await page.getByRole('combobox', { name: '조인 테이블' }).selectOption('2.public.customers');
    await page.getByRole('combobox', { name: '조인 기준 컬럼' }).selectOption('sales.customer_id');
    await page.getByRole('combobox', { name: '조인 대상 컬럼' }).selectOption('customers.id');

    await page.getByRole('combobox', { name: 'X축' }).selectOption('customers.region');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();

    // 다중 소스 스냅샷 안내(설계 §7)
    await expect(page.getByText('여러 데이터소스를 조인하면 저장 시점 스냅샷으로 고정됩니다(새로고침으로 갱신).')).toBeVisible();

    // 생성 SQL 이 ds 별칭으로 페더레이션 표기
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/FROM "ds1"\."sales"/)).toBeVisible();
    await expect(page.getByText(/JOIN "ds2"\."customers"/)).toBeVisible();
  });

  test('서로 다른 소스의 동명 테이블(users ⋈ users)도 핸들로 구분해 조인할 수 있다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    // base = ds1.public.users
    await page.locator('aside').first().getByRole('button', { name: /users/ }).click();

    // 사이드바를 sales-db 로 전환 → 조인 대상은 다른 소스(sales-db)의 동명 users. 핸들 users_2 부여.
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'sales-db' });
    await page.getByRole('button', { name: '+ 조인 추가' }).click();
    await page.getByRole('combobox', { name: '조인 테이블' }).selectOption('2.public.users');
    await page.getByRole('combobox', { name: '조인 기준 컬럼' }).selectOption('users.id');
    await page.getByRole('combobox', { name: '조인 대상 컬럼' }).selectOption('users_2.id');

    await page.getByRole('combobox', { name: 'X축' }).selectOption('users_2.region');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();

    // 예전엔 "같은 테이블을 중복 조인할 수 없습니다"로 오차단됐다 — 이제 핸들로 구분돼 조인 가능(오류 없음).
    await expect(page.getByText(/중복 조인/)).toHaveCount(0);
    // 다중 소스 스냅샷 안내가 뜨고 실행이 활성화된다.
    await expect(page.getByText('여러 데이터소스를 조인하면 저장 시점 스냅샷으로 고정됩니다(새로고침으로 갱신).')).toBeVisible();
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeEnabled();
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

  test('사이드바 데이터소스를 바꿔도 구성이 유지되고 테이블 드롭다운만 해당 소스로 필터된다', async ({ page }) => {
    await buildChart(page); // base = analytics-db(ds1) sales, X축=category
    // 소스를 sales-db 로 전환 — 모달 없이 구성(X축) 유지
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'sales-db' });
    await expect(page.getByText('데이터소스를 변경할까요?')).toBeHidden();
    await expect(page.getByText('기준 테이블을 바꿀까요?')).toBeHidden();
    await expect(page.getByRole('combobox', { name: '데이터소스' })).toHaveValue('2');
    await expect(page.getByRole('combobox', { name: 'X축' })).toHaveValue('category'); // 구성 유지
    // 조인 테이블 드롭다운은 sales-db(ds2) 테이블만 — customers 선택 가능
    await page.getByRole('button', { name: '+ 조인 추가' }).click();
    await page.getByRole('combobox', { name: '조인 테이블' }).selectOption('2.public.customers');
    await expect(page.getByRole('combobox', { name: '조인 테이블' })).toHaveValue('2.public.customers');
  });

  test('사이드바에서 다른 테이블을 클릭하면 기준 테이블 변경 확인 모달을 거친다', async ({ page }) => {
    await buildChart(page); // base = ds1 sales
    // 같은 소스의 다른 테이블(users) 트리 클릭 → 확인 모달
    await page.locator('aside').first().getByRole('button', { name: /users/ }).click();
    await expect(page.getByText('기준 테이블을 바꿀까요?')).toBeVisible();
    // 취소 → base 유지
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.getByText('기준 테이블을 바꿀까요?')).toBeHidden();
    await expect(page.getByRole('combobox', { name: '테이블' })).toHaveValue('1.public.sales');
    // 다시 클릭 → 변경 → base 교체
    await page.locator('aside').first().getByRole('button', { name: /users/ }).click();
    await page.getByRole('button', { name: '변경', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '테이블' })).toHaveValue('1.public.users');
  });

  test('미저장 변경 상태에서 목록 이동은 이탈확인 모달을 거친다', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('button', { name: '목록' }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeVisible();
    await page.getByRole('button', { name: '계속 편집' }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeHidden();
  });
});
