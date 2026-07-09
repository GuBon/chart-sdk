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
    // 다시 클릭 → 변경 → base 교체 + 구성(X축) 초기화
    await page.locator('aside').first().getByRole('button', { name: /users/ }).click();
    await page.getByRole('button', { name: '변경', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '테이블' })).toHaveValue('1.public.users');
    await expect(page.getByRole('combobox', { name: 'X축' })).toHaveValue(''); // 기준 변경 시 구성 초기화
  });

  test('미저장 변경 상태에서 목록 이동은 이탈확인 모달을 거친다', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('button', { name: '목록' }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeVisible();
    await page.getByRole('button', { name: '계속 편집' }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeHidden();
  });
});

// 신규 진입 + base(sales) 선택까지 공통.
async function newSalesBase(page: import('@playwright/test').Page) {
  await page.goto('/charts/new');
  await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
  await page.locator('aside').first().getByRole('button', { name: /sales/ }).click();
}

test.describe('S2 노코드 구성 — 날짜 묶기·조건·정렬·실행', () => {
  test('날짜형 X축을 고르면 묶기 셀렉트가 기본 월로 나타난다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('date');
    await expect(page.getByRole('combobox', { name: 'X축 묶기' })).toHaveValue('month');
  });

  test('묶기를 주로 바꾸면 생성 SQL에 DATE_TRUNC(week)가 반영된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('date');
    await page.getByRole('combobox', { name: 'X축 묶기' }).selectOption('week');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/DATE_TRUNC\('week', "date"\)/)).toBeVisible();
  });

  test('조건 연산자에 따라 값 입력 컨트롤이 분기된다(in·between·is_null)', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('button', { name: '+ 조건 추가' }).click();
    // 기본 eq → 단일 값
    await expect(page.getByPlaceholder('값', { exact: true })).toBeVisible();
    // in → 콤마 목록 1개
    await page.getByRole('combobox', { name: '조건 연산자' }).selectOption('in');
    await expect(page.getByPlaceholder('값1, 값2, 값3')).toBeVisible();
    // between → 시작·끝 2개
    await page.getByRole('combobox', { name: '조건 연산자' }).selectOption('between');
    await expect(page.getByPlaceholder('시작')).toBeVisible();
    await expect(page.getByPlaceholder('끝')).toBeVisible();
    // is_null → 값 입력 없음
    await page.getByRole('combobox', { name: '조건 연산자' }).selectOption('is_null');
    await expect(page.getByPlaceholder('값1, 값2, 값3')).toHaveCount(0);
    await expect(page.getByPlaceholder('시작')).toHaveCount(0);
  });

  test('in 조건으로 실행하면 SQL에 IN 절이 생성된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '+ 조건 추가' }).click();
    await page.getByRole('combobox', { name: '조건 연산자' }).selectOption('in');
    await page.getByPlaceholder('값1, 값2, 값3').fill('의류, 식품');
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/IN \(\?, \?\)/)).toBeVisible();
  });

  test('조건 제거 버튼으로 조건 행이 사라진다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('button', { name: '+ 조건 추가' }).click();
    await expect(page.getByRole('combobox', { name: '조건 연산자' })).toBeVisible();
    await page.getByRole('button', { name: '조건 제거' }).click();
    await expect(page.getByRole('combobox', { name: '조건 연산자' })).toHaveCount(0);
  });

  test('정렬 기준·방향을 지정하면 생성 SQL에 ORDER BY가 들어간다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('combobox', { name: '정렬 기준' }).selectOption('x');
    await page.getByRole('combobox', { name: '정렬 방향' }).selectOption('asc');
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/ORDER BY 1 ASC/)).toBeVisible();
  });

  test('Ctrl+Enter로 실행된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('combobox', { name: 'X축' }).focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('의류')).toBeVisible();
  });

  test('조인 종류 INNER 반영 후, 조인을 제거하면 표본 추출이 다시 활성화된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('button', { name: '+ 조인 추가' }).click();
    await page.getByRole('combobox', { name: '조인 테이블' }).selectOption('1.public.orders');
    await page.getByRole('combobox', { name: '조인 종류' }).selectOption('inner');
    await page.getByRole('combobox', { name: '조인 기준 컬럼' }).selectOption('sales.id');
    await page.getByRole('combobox', { name: '조인 대상 컬럼' }).selectOption('orders.sale_id');
    await page.getByRole('combobox', { name: 'X축' }).selectOption('sales.category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/INNER JOIN "orders"/)).toBeVisible();
    // 조인 제거 → 표본 스위치 재활성
    await page.getByRole('button', { name: '조인 제거' }).click();
    await expect(page.getByRole('switch', { name: '표본 추출' })).toBeEnabled();
  });
});

test.describe('S2 차트 유형 제약', () => {
  test('원형은 시리즈를 1개로 제한한다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await expect(page.locator('#builder-y-column-1')).toBeVisible();
    // 원형 전환 → 시리즈 1개로 정규화 + 추가 버튼 비활성
    await page.getByRole('button', { name: '원형', exact: true }).click();
    await expect(page.locator('#builder-y-column-1')).toHaveCount(0);
    await expect(page.locator('#builder-y-column-0')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 시리즈 추가' })).toBeDisabled();
  });

  test('분포로 전환하면 집계는 원본값뿐이고 표본·날짜 묶기 컨트롤이 사라진다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('date');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    // 전환 전: 날짜 묶기·표본 스위치 존재
    await expect(page.getByRole('combobox', { name: 'X축 묶기' })).toBeVisible();
    await expect(page.getByRole('switch', { name: '표본 추출' })).toBeVisible();
    // 분포 전환
    await page.getByRole('button', { name: '분포', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'X축 묶기' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: '표본 추출' })).toHaveCount(0);
    // 집계 셀렉트는 원본값 1개뿐
    await expect(page.locator('#builder-y-agg-0 option')).toHaveCount(1);
  });

  test('분포 전환은 실행 결과를 무효화해 저장이 비활성화된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('의류')).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('분포전환');
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
    // 분포 전환 → 구성이 바뀌어 결과 무효화
    await page.getByRole('button', { name: '분포', exact: true }).click();
    await expect(page.getByText('실행하면 미리보기가 표시됩니다.')).toBeVisible();
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeDisabled();
  });
});

test.describe('S2 이탈 모달·옵션 검색', () => {
  test('이탈확인에서 저장 안 함을 누르면 목록으로 이동한다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '목록' }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeVisible();
    await page.getByRole('button', { name: '저장 안 함' }).click();
    await expect(page.getByText('새 차트 만들기')).toBeVisible(); // 목록 도착
  });

  test('저장 후 나가기는 실행 결과가 있어야 활성화되고, 저장 후 목록에 반영된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByPlaceholder('차트 이름').fill('이탈저장차트');
    // 미실행 → 저장 후 나가기 비활성
    await page.getByRole('button', { name: '목록' }).click();
    await expect(page.getByRole('button', { name: '저장 후 나가기' })).toBeDisabled();
    await page.getByRole('button', { name: '계속 편집' }).click();
    // 실행 후 → 저장 후 나가기 활성 → 저장 + 이동
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('의류')).toBeVisible();
    await page.getByRole('button', { name: '목록' }).click();
    await page.getByRole('button', { name: '저장 후 나가기' }).click();
    await expect(page.getByText('이탈저장차트', { exact: true })).toBeVisible();
  });

  test('옵션 검색으로 옵션 항목이 필터되고 지우면 복원된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('의류')).toBeVisible();
    // '제목' 검색 → 차트 제목은 남고 색 모드는 사라짐
    await page.locator('#option-search').fill('제목');
    await expect(page.getByText('차트 제목', { exact: true })).toBeVisible();
    await expect(page.getByText('색 모드', { exact: true })).toBeHidden();
    // 지우면 복원
    await page.locator('#option-search').fill('');
    await expect(page.getByText('색 모드', { exact: true })).toBeVisible();
  });
});

test.describe('S2 네이티브 확장 — 100% 정규화·혼합(combo)', () => {
  test('누적 variant를 고르면 100% 정규화 토글이 나타나고 미리보기가 유지된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    // 기본 variant → 100% 정규화 숨김(showIf: variant==='stacked')
    await expect(page.getByText('100% 정규화')).toBeHidden();
    // 누적 선택 → 토글 노출 → 켜도 미리보기 유지
    await page.getByRole('button', { name: '누적', exact: true }).click();
    await expect(page.getByText('100% 정규화')).toBeVisible();
    await page.getByRole('switch', { name: '100% 정규화' }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('시리즈 종류에서 한 시리즈를 선으로 바꾸면 혼합 차트가 렌더된다', async ({ page }) => {
    await newSalesBase(page);
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click(); // 시리즈 sum_id
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    // 실행 후 '시리즈 종류' 컨트롤 노출 → sum_id 시리즈를 선으로
    await expect(page.getByText('시리즈 종류')).toBeVisible();
    await page.getByTestId('series-type-sum_id').getByRole('button', { name: '선', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });
});
