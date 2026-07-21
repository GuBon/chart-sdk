import { test, expect } from '@playwright/test';

// S2-a 레이아웃 골격 + S2-b 스키마 탐색기 동작 검증.
test.describe('S2 차트 편집 — 골격 + 스키마 탐색기', () => {
  test('신규 진입 시 편집 헤더와 노코드 구성 내부의 정의모드 탭이 보인다', async ({ page }) => {
    await page.goto('/charts/new');

    // Top Bar
    await expect(page.getByRole('button', { name: '목록', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '저장' })).toBeVisible();
    await expect(page.getByRole('button', { name: '임베드 코드' })).toBeDisabled();
    await expect(page.getByPlaceholder('차트 이름')).toBeVisible();

    // 정의 모드 탭은 전역 헤더가 아니라 노코드 구성 패널 안에 위치한다.
    const builderWorkspace = page.getByTestId('data-builder-workspace');
    const defineModeTabs = builderWorkspace.getByRole('tablist', { name: '차트 정의 방식' });
    await expect(defineModeTabs).toBeVisible();
    await expect(defineModeTabs.getByRole('tab', { name: '노코드' })).toHaveAttribute('aria-selected', 'true');
    await expect(defineModeTabs.getByRole('tab', { name: /SQL/ })).toBeDisabled();

    // 테이블 목록과 차트 미리보기·옵션 패널의 기본 폭
    const sidePanels = page.locator('aside');
    await expect(sidePanels.first()).toHaveCSS('width', '320px');
    await expect(sidePanels.last()).toHaveCSS('width', '440px');
  });

  test('저장된 차트 편집 진입은 실행 없이 캐시 결과와 차트 미리보기를 복원한다', async ({ page }) => {
    let builderRuns = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/query/run-builder') builderRuns += 1;
    });

    await page.goto('/charts/12');

    await expect(page).toHaveURL('/data/2/public/sales/charts/12');

    const sidePanels = page.locator('aside');
    await expect(sidePanels.last().locator('canvas')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'category' })).toBeVisible();
    await expect(page.getByText('실행하면 미리보기가 표시됩니다.')).not.toBeVisible();
    await page.waitForTimeout(300);
    expect(builderRuns).toBe(0);
  });

  test('데이터소스 선택 → 테이블/컬럼 트리가 동작한다', async ({ page }) => {
    await page.goto('/charts/new');

    // 선택 전 안내
    await expect(page.getByText('데이터소스를 먼저 선택하세요.')).toBeVisible();

    // 데이터소스 선택 (MSW 시드: analytics-db)
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    // 테이블 트리 등장 후 sales 선택 → 컬럼 노출
    const tree = page.locator('aside').first();
    await tree.getByRole('button', { name: 'sales public' }).click();
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
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
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
    await expect(page.locator('aside').first().getByRole('button', { name: 'events analytics' })).toBeVisible();

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
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
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

  test('논리 크기별 미리보기와 패널별 좌측 레일 접기·전체 화면 검수가 동작한다', async ({ page }) => {
    await page.goto('/charts/12');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    const designCanvas = page.getByTestId('chart-design-canvas');
    await expect(designCanvas).toHaveAttribute('data-design-width', '640');
    await expect(designCanvas).toHaveAttribute('data-design-height', '360');

    await page.getByRole('combobox', { name: '미리보기 설계 크기' }).selectOption('fhd');
    await expect(designCanvas).toHaveAttribute('data-design-width', '1920');
    await expect(designCanvas).toHaveAttribute('data-design-height', '1080');

    await expect(page.getByRole('button', { name: /영역 확대/ })).toHaveCount(0);

    await page.getByRole('button', { name: '데이터 패널 접기' }).click();
    await expect(page.getByTestId('schema-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('data-builder-workspace')).toBeVisible();
    const dataRail = page.getByTestId('schema-sidebar-rail');
    await expect(dataRail).toBeVisible();

    await page.getByRole('button', { name: '노코드 구성·결과 접기' }).click();
    await expect(page.getByTestId('data-builder-workspace')).toHaveCount(0);
    const builderRail = page.getByTestId('data-builder-workspace-rail');
    await expect(builderRail).toBeVisible();
    const expandedBox = await page.getByTestId('visual-editor-workspace').boundingBox();
    const dataRailBox = await dataRail.boundingBox();
    const builderRailBox = await builderRail.boundingBox();
    expect(dataRailBox?.x).toBeLessThan(builderRailBox?.x ?? 0);
    expect(builderRailBox?.x).toBeLessThan(expandedBox?.x ?? 0);
    expect(expandedBox?.width).toBeGreaterThanOrEqual(1200);
    await expect(page.getByRole('button', { name: '너비 맞춤' })).toBeVisible();

    await page.getByRole('button', { name: '시각화 옵션 접기' }).click();
    await expect(page.getByTestId('visual-option-editor')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '시각화 옵션 펼치기' })).toBeVisible();

    const focusPreviewButton = page.getByRole('button', { name: '전체 화면', exact: true });
    await focusPreviewButton.click();
    const dialog = page.getByTestId('chart-focus-dialog');
    await expect(dialog).toBeVisible();
    const closeFocusPreview = dialog.getByRole('button', { name: '집중 미리보기 닫기' });
    await expect(closeFocusPreview).toBeFocused();
    await expect(dialog.getByTestId('chart-design-canvas')).toHaveAttribute('data-design-width', '1920');
    await dialog.getByRole('button', { name: '100%' }).click();
    await expect(dialog.getByTestId('chart-focus-viewport')).toHaveAttribute('data-fit-mode', 'actual');
    await closeFocusPreview.click();
    await expect(dialog).toHaveCount(0);
    await expect(focusPreviewButton).toBeFocused();

    await page.reload();
    await expect(page.getByTestId('schema-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('data-builder-workspace')).toHaveCount(0);
    await expect(page.getByTestId('visual-option-editor')).toHaveCount(0);
    await expect(page.getByTestId('schema-sidebar-rail')).toBeVisible();
    await expect(page.getByTestId('data-builder-workspace-rail')).toBeVisible();

    await page.getByRole('button', { name: '데이터 패널 펼치기' }).click();
    await expect(page.getByTestId('schema-sidebar')).toBeVisible();
    await expect(page.getByTestId('data-builder-workspace')).toHaveCount(0);
    await page.getByRole('button', { name: '노코드 구성·결과 펼치기' }).click();
    await expect(page.getByTestId('data-builder-workspace')).toBeVisible();
  });

  test('실행 없이 자동 글자는 논리 크기에 반응하고 직접 지정 px는 크기를 바꿔도 유지된다', async ({ page }) => {
    let builderRuns = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/query/run-builder') builderRuns += 1;
    });

    await page.goto('/charts/12');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    const fontSection = page.locator('section').filter({ has: page.getByText('글꼴', { exact: true }) });
    const policy = fontSection.getByTestId('typography-policy');
    await expect(policy).toContainText('자동: 논리 차트 크기를 바꾸면 다시 계산합니다.');
    await expect(policy).toContainText('현재 제목 18px · 범례 12px · 축 12px · 라벨 12px · 툴팁 12px');
    await expect(policy).toContainText('임베드 영역만 CSS로 리사이즈하면 위 px 값은 유지됩니다.');

    await page.getByRole('combobox', { name: '미리보기 설계 크기' }).selectOption('fhd');
    await expect(policy).toContainText('현재 제목 26px · 범례 16px · 축 16px · 라벨 16px · 툴팁 16px');

    await fontSection.getByRole('button', { name: '직접 지정', exact: true }).click();
    const titleFont = fontSection.locator('input[type="range"][aria-label="제목"]');
    await titleFont.fill('31');
    await expect(policy).toContainText('직접 지정: 저장한 px 값을 그대로 사용합니다.');
    await expect(policy).toContainText('현재 제목 31px');

    await page.getByRole('combobox', { name: '미리보기 설계 크기' }).selectOption('small');
    await expect(policy).toContainText('현재 제목 31px');

    await fontSection.getByRole('button', { name: '자동', exact: true }).click();
    await expect(policy).toContainText('현재 제목 14px · 범례 10px · 축 10px · 라벨 10px · 툴팁 10px');
    expect(builderRuns).toBe(0);
  });

  test('팔레트 swatch 선택 후 RGB 사용자지정 값이 미리보기에 반영된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
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

  test('표본 SUM은 외삽하지 않고 표본 합계로 명확히 표시한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.locator('#builder-y-column-0').selectOption('amount');

    // 표본 추출 토글 ON + 10,000행 직접 지정
    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('combobox', { name: '표본 방식' }).selectOption('manual');
    await page.getByRole('spinbutton', { name: '표본 크기' }).fill('10000');

    await page.getByRole('button', { name: '실행', exact: true }).click();

    await expect(page.getByTestId('sample-badge')).toContainText('무작위 행 표본 10,000행 · 표본 결과');
    await expect(page.getByText(/sum_amount: 표본 합계/)).toBeVisible();
    await expect(page.getByText(/전체 데이터의 합계·개수가 아닙니다/)).toBeVisible();

    // 표시용 SQL에서도 SUM에 외삽 배율을 붙이지 않는다.
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.locator('pre')).toContainText(/SUM\("[^"]+"\)/);
    await expect(page.locator('pre')).not.toContainText(/100\.0 \/|500000000\.0 \/|EXTRAPOLAT/);
  });

  test('실행 버튼은 집계만 조회하고 원본 데이터는 탭을 열 때 지연 조회한다', async ({ page }) => {
    const modes: string[] = [];
    page.on('request', (request) => {
      if (!request.url().includes('/api/v1/query/run-builder')) return;
      const body = request.postDataJSON() as { mode?: string };
      modes.push(body.mode ?? 'aggregate');
    });
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();

    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('의류')).toBeVisible();
    expect(modes).toEqual(['aggregate']);

    await page.getByRole('button', { name: '원본 데이터' }).click();
    await expect.poll(() => modes).toEqual(['aggregate', 'rows']);
  });

  test('자동 표본은 전체 추정 행 수 안내와 실제 표본 수를 표시한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await expect(page.getByRole('combobox', { name: '표본 방식' })).toHaveValue('auto');
    await expect(page.getByTestId('sample-total-hint')).toContainText('전체 약 500,000,000행 중 무작위 표본');
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await expect(page.getByTestId('sample-badge')).toContainText('무작위 행 표본 10,000행 · 표본 결과');
  });

  test('직접 지정 표본 크기는 최대 50,000행까지 실행 결과에 반영된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('combobox', { name: '표본 방식' }).selectOption('manual');
    await page.getByRole('spinbutton', { name: '표본 크기' }).fill('50000');
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await expect(page.getByTestId('sample-badge')).toContainText('무작위 행 표본 50,000행 · 표본 결과');
  });

  test('표본 추출 컨트롤은 기존 S2 편집 화면에서도 동일하게 노출되고 테이블 변경 시 유지된다', async ({ page }) => {
    await page.goto('/charts/12');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toBeVisible();

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('combobox', { name: '표본 방식' }).selectOption('manual');
    await page.getByRole('spinbutton', { name: '표본 크기' }).fill('25000');

    // 차트 12 base=sales-db(ds2) → 테이블 드롭다운은 ds2 테이블만. ds2 의 users 로 변경해도 표본 설정 유지.
    await page.getByRole('combobox', { name: '테이블' }).selectOption('2.public.users');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('combobox', { name: '표본 방식' })).toHaveValue('manual');
    await expect(page.getByRole('spinbutton', { name: '표본 크기' })).toHaveValue('25000');
  });

  test('조인을 추가해도 표본 설정을 유지하고 조인 결과 표본임을 안내한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('combobox', { name: '표본 방식' }).selectOption('manual');
    await page.getByRole('spinbutton', { name: '표본 크기' }).fill('25000');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: '+ 조인 추가' }).click();
    const sampleSwitch = page.getByRole('switch', { name: '표본 추출' });
    await expect(sampleSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(sampleSwitch).toBeEnabled();
    await expect(page.getByRole('spinbutton', { name: '표본 크기' })).toHaveValue('25000');
    await expect(page.getByTestId('sample-total-hint')).toHaveText('조인 결과에서 무작위 행 표본');
  });

  test('일반 View를 원본으로 선택하고 RESULT_RANDOM 표본 차트를 실행한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: /sales_summary/ }).click();
    await expect(page.locator('aside').first().getByText('View', { exact: true })).toBeVisible();

    await expect(page.getByRole('combobox', { name: '테이블' })).toHaveValue('1.analytics.sales_summary');
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.locator('#builder-y-column-0').selectOption('amount');
    await page.getByRole('switch', { name: '표본 추출' }).click();
    await expect(page.getByTestId('sample-total-hint')).toHaveText('View 조회 결과에서 무작위 행 표본');

    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByTestId('sample-badge')).toContainText('결과 무작위 행 표본 10,000행 · 표본 결과');
    await expect(page.getByText('주의: 조회 결과에서 무작위로 선택된 행의 표본 결과입니다.')).toBeVisible();
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/"__chartsdk_population" AS/)).toBeVisible();
  });

  test('갱신된 Materialized View는 선택할 수 있고 미갱신 Materialized View는 차단한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    const tree = page.locator('aside').first();
    const stale = tree.getByRole('button', { name: /stale_sales_mv/ });
    await expect(stale).toBeDisabled();
    await expect(stale).toHaveAttribute('title', 'REFRESH가 필요한 Materialized View입니다.');
    await expect(page.locator('#builder-table option[value="1.analytics.stale_sales_mv"]')).toHaveCount(0);

    const ready = tree.getByRole('button', { name: /monthly_sales_mv/ });
    await expect(ready).toBeEnabled();
    await ready.click();
    await expect(page.getByRole('combobox', { name: '테이블' })).toHaveValue('1.analytics.monthly_sales_mv');
  });

  test('테이블 조인을 구성하면 생성 SQL에 JOIN이 들어가고 컬럼이 qualified 된다 (11장)', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();

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
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();

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
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
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
    await page.getByRole('button', { name: '목록', exact: true }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeVisible();
    await page.getByRole('button', { name: '계속 편집' }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeHidden();
  });
});

// 신규 진입 + base(sales) 선택까지 공통.
async function newSalesBase(page: import('@playwright/test').Page) {
  await page.goto('/charts/new');
  await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
  await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
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

  test('조인 종류 INNER 반영·제거 뒤에도 표본 추출 컨트롤을 사용할 수 있다', async ({ page }) => {
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
    await expect(page.getByRole('switch', { name: '표본 추출' })).toBeEnabled();
    // 조인 제거 뒤에도 표본 스위치 사용 가능
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
    await page.getByRole('button', { name: '목록', exact: true }).click();
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
    await page.getByRole('button', { name: '목록', exact: true }).click();
    await expect(page.getByRole('button', { name: '저장 후 나가기' })).toBeDisabled();
    await page.getByRole('button', { name: '계속 편집' }).click();
    // 실행 후 → 저장 후 나가기 활성 → 저장 + 이동
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('의류')).toBeVisible();
    await page.getByRole('button', { name: '목록', exact: true }).click();
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

// 대형 스키마(legacy-dw = bulk_table 60개) — 사이드바 클라이언트 페이지네이션·정렬.
test.describe('S2 스키마 탐색기 — 페이지네이션·정렬', () => {
  test('테이블이 50개를 넘으면 50개씩 페이지로 나뉜다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'legacy-dw' });
    const aside = page.locator('aside').first();
    // 60개 → 1페이지 50개
    await expect(aside.getByRole('button', { name: /bulk_table/ })).toHaveCount(50);
    await expect(aside.getByText('1 / 2')).toBeVisible();
    await expect(aside.getByRole('button', { name: '이전' })).toBeDisabled();
    // 다음 → 2페이지 10개
    await aside.getByRole('button', { name: '다음' }).click();
    await expect(aside.getByText('2 / 2')).toBeVisible();
    await expect(aside.getByRole('button', { name: /bulk_table/ })).toHaveCount(10);
    await expect(aside.getByRole('button', { name: '다음' })).toBeDisabled();
  });

  test('이름 내림차순 정렬은 첫 테이블을 바꾼다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'legacy-dw' });
    const aside = page.locator('aside').first();
    // 정렬은 검색칸 우측 필터 아이콘 → 팝오버 메뉴 (화면설계 S2 사이드바)
    await page.getByRole('button', { name: '정렬', exact: true }).click();
    await page.getByRole('button', { name: '이름 내림차순' }).click();
    await expect(aside.getByRole('button', { name: /bulk_table/ }).first()).toContainText('bulk_table_60');
  });

  test('검색은 전체 페이지를 대상으로 하고 1페이지로 리셋한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'legacy-dw' });
    const aside = page.locator('aside').first();
    // 2페이지로 이동
    await aside.getByRole('button', { name: '다음' }).click();
    await expect(aside.getByText('2 / 2')).toBeVisible();
    // 1페이지 소속 테이블을 검색 → 찾아지고(전체 대상) 1페이지 리셋되어 페이저 사라짐
    await page.locator('#schema-search').fill('bulk_table_05');
    await expect(aside.getByRole('button', { name: /bulk_table/ })).toHaveCount(1);
    await expect(aside.getByRole('button', { name: /bulk_table_05/ })).toBeVisible();
    await expect(aside.getByRole('button', { name: '다음' })).toHaveCount(0); // 페이저 숨김
    // 지우면 50개 복원
    await page.locator('#schema-search').fill('');
    await expect(aside.getByRole('button', { name: /bulk_table/ })).toHaveCount(50);
  });

  test('스키마 필터 — 2개 이상일 때만 노출되고 해당 스키마만 남긴다', async ({ page }) => {
    await page.goto('/charts/new');
    const aside = page.locator('aside').first();

    // 단일 스키마 소스(sales-db: public 만): 팝오버에 스키마 섹션 없음
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'sales-db' });
    await expect(aside.getByText('public', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '정렬', exact: true }).click();
    await expect(page.getByText('스키마순')).toBeVisible();
    await expect(page.getByText('스키마', { exact: true })).toHaveCount(0);
    await page.mouse.click(700, 400); // 백드롭 클릭 → 닫힘

    // 다중 스키마 소스(legacy-dw: public + archive): 섹션 노출 + 필터 적용
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'legacy-dw' });
    await page.getByRole('button', { name: '정렬', exact: true }).click();
    await expect(page.getByText('스키마', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'archive', exact: true }).click();
    await expect(aside.getByRole('button', { name: /events/ })).toBeVisible();
    await expect(aside.getByRole('button', { name: /bulk_table/ })).toHaveCount(0);
    await expect(aside.getByRole('button', { name: '다음' })).toHaveCount(0); // 1건이라 페이저 숨김

    // 전체로 복원
    await page.getByRole('button', { name: '정렬', exact: true }).click();
    await page.getByRole('button', { name: '전체', exact: true }).click();
    await expect(aside.getByRole('button', { name: /bulk_table/ })).toHaveCount(50);
  });
});

// 신규 3종(상자수염·히트맵·지도) — 대분류 전환 후 재실행 시 ECharts 미리보기가 렌더되는지.
// (실행이 선행돼야 옵션 패널이 활성화되어 대분류 버튼을 누를 수 있다.)
test.describe('S2 신규 유형 — 상자수염·히트맵·지도', () => {
  async function runBar(page: import('@playwright/test').Page) {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  }

  for (const label of ['박스 플롯', '히트맵', '지도']) {
    test(`${label} 유형으로 전환·재실행 시 미리보기가 렌더된다`, async ({ page }) => {
      await runBar(page);
      // 대분류 전환 → 빌더 정규화로 결과 무효화될 수 있어 재실행
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('button', { name: '실행', exact: true }).click();
      await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    });
  }

  test('표본 추출 실행 결과에 방식·집계 주의문구가 표시된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('주의: 전체 데이터에서 무작위로 선택된 행의 표본 결과입니다.')).toBeVisible();
    await expect(page.getByText('주의: SUM·COUNT는 선택된 표본의 합계·개수이며 전체 데이터의 합계·개수가 아닙니다.')).toBeVisible();
  });
});

// 지도 포인트(geoscatter) + 시군구 지도 — geo 좌표계·registerMap(kr-sigungu) 경로 검증.
test.describe('S2 지도 확장 — 지도 포인트·시군구', () => {
  test('지도 포인트 유형은 숫자 경도·위도로 실행 시 미리보기가 렌더된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    // 지도 포인트 전환 → 텍스트 X(category)는 거부되므로 숫자 경도 컬럼으로 교체 후 실행
    await page.getByRole('button', { name: '지도 포인트', exact: true }).click();
    await expect(page.getByText('지도 포인트는 숫자 경도(X) 컬럼이 필요합니다.')).toBeVisible();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('amount');
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('PostGIS Point 컬럼과 크기값을 선택하면 실제 좌표 표본으로 지도 포인트가 렌더된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('button', { name: '지도 포인트', exact: true }).click();

    await page.getByRole('combobox', { name: '좌표 방식' }).selectOption('spatial');
    await expect(page.getByRole('combobox', { name: '공간 Point 컬럼' })).toHaveValue('location');
    await page.getByRole('combobox', { name: '점 크기 컬럼' }).selectOption('amount');

    const requestPromise = page.waitForRequest((request) =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/query/run-builder');
    await page.getByRole('button', { name: '실행', exact: true }).click();
    const request = await requestPromise;
    expect(request.postDataJSON().builderConfig.geoPoint).toEqual({
      mode: 'spatial',
      spatialColumn: 'location',
      sizeColumn: 'amount',
    });

    await expect(page.getByRole('columnheader', { name: '__chartsdk_longitude' })).toBeVisible();
    await expect(page.getByText('126.978')).toBeVisible();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    await page.getByText('생성된 SQL 보기').click();
    const sql = page.locator('pre');
    await expect(sql).toContainText('ST_X(ST_Transform');
    await expect(sql).toContainText('ST_Y(ST_Transform');
    await expect(sql).not.toContainText('LIMIT 1000');
  });

  test('지도 유형에서 지도 단위를 시군구로 바꿔도 미리보기가 렌더된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await page.locator('aside').first().getByRole('button', { name: 'sales public' }).click();
    await page.getByRole('combobox', { name: 'X축' }).selectOption('category');
    await page.getByRole('button', { name: '+ 시리즈 추가' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    // 지리 계열은 GEO 그룹 헤더 아래에 노출 (화면설계 S2 옵션 패널)
    await expect(page.getByText('GEO', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '지도', exact: true }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    // 지도 단위 세그먼트: 시도 → 시군구 (옵션 변경은 preview 재조립 — 재실행 불필요)
    await page.getByRole('button', { name: '시군구', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });
});
