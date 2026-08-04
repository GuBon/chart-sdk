import { test, expect, type Page } from '@playwright/test';

async function selectBase(page: Page, name: string | RegExp) {
  await page.locator('aside').first().getByRole('button', { name: tableButtonName(name) }).click();
}

async function selectNewJoin(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name: '+ 조인 추가' }).click();
  await expect(page.getByTestId('table-selection-banner')).toContainText(/조인 테이블 선택 중/);
  await page.locator('aside').first().getByRole('button', { name: tableButtonName(name) }).click();
}

function tableButtonName(name: string | RegExp): RegExp {
  if (name instanceof RegExp) return name;
  const parts = name.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.join('.*'));
}

async function openOptionTab(page: Page, name: string) {
  const tab = page
    .getByRole('tablist', { name: '시각화 옵션 분류' })
    .getByRole('tab', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openOptionSection(page: Page, name: string) {
  const panel = page.getByRole('tabpanel');
  const button = panel.getByRole('button', { name, exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

async function selectTheme(page: Page, label: string) {
  await page.getByRole('combobox', { name: '테마', exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function chooseAxisColumn(page: Page, axisLabel: string, columnRef: string) {
  const columnName = columnRef.slice(columnRef.lastIndexOf('.') + 1);
  const candidates = page.locator('aside').first()
    .getByRole('button', { name: `${columnName} 컬럼을 ${axisLabel}에 사용`, exact: true });
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isEnabled()) {
      await candidate.click();
      return;
    }
  }
  throw new Error(`${axisLabel}에 사용할 수 있는 컬럼을 찾지 못했습니다: ${columnRef}`);
}

async function useXAxis(page: Page, column: string) {
  await page.getByTestId('builder-x-axis').click();
  await chooseAxisColumn(page, 'X축', column);
}

async function addValue(page: Page, column = 'id') {
  await page.getByRole('button', { name: '+ 값 추가' }).click();
  const match = (await page.getByTestId('table-selection-banner').textContent())?.match(/Y축 (\d+)/);
  if (!match) throw new Error('신규 Y축 선택 대상을 확인하지 못했습니다.');
  await chooseAxisColumn(page, `Y축 ${match[1]}`, column);
}

async function useYAxis(page: Page, index: number, column: string) {
  await page.getByTestId(`builder-y-column-${index}`).click();
  await chooseAxisColumn(page, `Y축 ${index + 1}`, column);
}

async function useSumValue(page: Page, column = 'amount') {
  await useYAxis(page, 0, column);
  await page.getByRole('combobox', { name: 'Y축 1 값 방식' }).selectOption('sum');
}

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

  test('미리보기는 720px을 넘어 확장되고 끝까지 줄인 데이터·노코드 패널은 자동으로 접힌다', async ({ page }) => {
    await page.goto('/charts/sales-db/public/sales/12');

    const previewWorkspace = page.getByTestId('visual-editor-workspace');
    const builderWorkspace = page.getByTestId('data-builder-workspace');
    let verticalHandles = page.locator('[role="separator"][aria-orientation="vertical"]');
    await expect(verticalHandles).toHaveCount(2);

    const previewBefore = await previewWorkspace.boundingBox();
    const previewHandle = await verticalHandles.last().boundingBox();
    if (!previewBefore || !previewHandle) throw new Error('미리보기 경계를 찾을 수 없습니다.');
    const targetPreviewWidth = 760;
    await page.mouse.move(previewHandle.x, previewHandle.y + previewHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(previewHandle.x - (targetPreviewWidth - previewBefore.width), previewHandle.y + previewHandle.height / 2, { steps: 8 });
    await page.mouse.up();
    expect((await previewWorkspace.boundingBox())?.width).toBeGreaterThan(720);
    await expect(builderWorkspace).toBeVisible();

    const builderBox = await builderWorkspace.boundingBox();
    const expandedPreviewHandle = await verticalHandles.last().boundingBox();
    if (!builderBox || !expandedPreviewHandle) throw new Error('노코드 패널 경계를 찾을 수 없습니다.');
    await page.mouse.move(expandedPreviewHandle.x, expandedPreviewHandle.y + expandedPreviewHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(builderBox.x + 24, expandedPreviewHandle.y + expandedPreviewHandle.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(builderWorkspace).toHaveCount(0);
    await expect(page.getByTestId('data-builder-workspace-rail')).toBeVisible();

    await page.getByTestId('data-builder-workspace-rail').click();
    await expect(builderWorkspace).toBeVisible();
    verticalHandles = page.locator('[role="separator"][aria-orientation="vertical"]');
    const datasourcePanel = page.getByTestId('schema-sidebar');
    const datasourceBox = await datasourcePanel.boundingBox();
    const datasourceHandle = await verticalHandles.first().boundingBox();
    if (!datasourceBox || !datasourceHandle) throw new Error('데이터 패널 경계를 찾을 수 없습니다.');
    await page.mouse.move(datasourceHandle.x, datasourceHandle.y + datasourceHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(datasourceBox.x + 24, datasourceHandle.y + datasourceHandle.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(datasourcePanel).toHaveCount(0);
    await expect(page.getByTestId('schema-sidebar-rail')).toBeVisible();
  });

  test('저장된 차트 편집 진입은 실행 없이 캐시 결과와 차트 미리보기를 복원한다', async ({ page }) => {
    let builderRuns = 0;
    const echartsErrors: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/query/run-builder') builderRuns += 1;
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('[ECharts]')) echartsErrors.push(message.text());
    });

    await page.goto('/charts/sales-db/public/sales/12');

    await expect(page).toHaveURL('/charts/sales-db/public/sales/12');

    const sidePanels = page.locator('aside');
    await expect(sidePanels.last().locator('canvas')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'category' })).toBeVisible();
    await expect(page.getByText('실행하면 미리보기가 표시됩니다.')).not.toBeVisible();
    await page.waitForTimeout(300);
    expect(builderRuns).toBe(0);
    expect(echartsErrors).toEqual([]);
  });

  test('데이터소스 선택 → 테이블/컬럼 트리가 동작한다', async ({ page }) => {
    await page.goto('/charts/new');

    // 선택 전 안내
    await expect(page.getByText('데이터소스를 먼저 선택하세요.')).toBeVisible();

    // 데이터소스 선택 (MSW 시드: analytics-db)
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    // 테이블 트리의 펼침 화살표로 sales 컬럼 노출
    const tree = page.locator('aside').first();
    await tree.getByRole('button', { name: 'sales public' }).locator('span').first().click();
    await expect(tree.getByText('category', { exact: true })).toBeVisible();
    await expect(tree.getByText('amount', { exact: true })).toBeVisible();
    await expect(tree.getByText('numeric', { exact: true })).toBeVisible();
  });

  test('왼쪽 테이블은 원본으로 바로 선택되고 조인 선택은 검색 포커스·Esc 취소가 동작한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    await expect(page.getByText('읽기 전용 조회')).toHaveCount(0);
    await expect(page.getByTestId('base-table-selector')).toHaveCount(0);
    await selectBase(page, 'sales public');
    await expect(page.locator('aside').first().getByRole('button', { name: 'sales public' })).toHaveClass(/bg-blue-100/);
    await expect(page.getByText('public.sales', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ 조인 추가' }).click();
    await expect(page.getByTestId('table-selection-banner')).toContainText('1번째 조인 테이블 선택 중');
    await expect(page.locator('#schema-search')).toBeFocused();
    await expect(page.locator('aside').first().getByRole('button', { name: 'sales public' })).toBeDisabled();
    await page.locator('aside').first().getByRole('button', { name: 'orders public' }).click();

    const joinSelector = page.getByTestId('join-table-selector-0');
    await expect(joinSelector).toContainText('public.orders');
    await joinSelector.click();
    await expect(page.getByTestId('table-selection-banner')).toContainText('1번째 조인 테이블 선택 중');
    await page.getByRole('button', { name: '테이블 선택 취소' }).click();
    await expect(page.getByTestId('table-selection-banner')).toHaveCount(0);
  });

  test('원본 테이블을 상단에 고정하고 X/Y 컬럼을 데이터 패널 선택 모드로 지정한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    const dataPanel = page.locator('aside').first();
    await selectBase(page, /orders.*public/);
    const baseTable = dataPanel.getByRole('button', { name: /orders.*public/ });
    await expect(baseTable).toHaveClass(/font-bold/);
    await expect(baseTable).toHaveClass(/bg-blue-100/);
    await expect(dataPanel.locator('[data-testid^="schema-table-"]').first()).toHaveAttribute('data-base-table', 'true');

    const xAxisField = page.getByTestId('builder-x-axis');
    await expect(page.locator('select#builder-x-axis')).toHaveCount(0);
    await xAxisField.click();
    await expect(xAxisField).toContainText('선택 중');
    await expect(page.getByTestId('table-selection-banner')).toContainText('X축에 넣을 컬럼을 선택하세요');
    await chooseAxisColumn(page, 'X축', 'status');
    await expect(xAxisField).toContainText('status');

    await page.getByRole('button', { name: '+ 값 추가' }).click();
    await expect(page.getByTestId('table-selection-banner')).toContainText('Y축 1에 넣을 컬럼을 선택하세요');
    await expect(page.getByTestId('pending-y-axis-selector')).toContainText('선택 중');
    await expect(page.locator('select#builder-y-column-0')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pending-y-axis-selector')).toHaveCount(0);
    await expect(page.getByTestId('builder-y-column-0')).toHaveCount(0);

    await page.getByRole('button', { name: '+ 값 추가' }).click();
    await chooseAxisColumn(page, 'Y축 1', 'amount');

    await expect(page.getByTestId('builder-y-column-0')).toContainText('amount');
    await expect(page.getByTestId('table-selection-banner')).toHaveCount(0);
  });

  test('빌더 폼: 테이블·X축·Y축 구성만으로 실행하지 않고 원본 데이터를 유지한다', async ({ page }) => {
    let aggregateRuns = 0;
    page.on('request', (request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/query/run-builder') return;
      if ((request.postDataJSON() as { mode?: string }).mode === 'aggregate') aggregateRuns += 1;
    });

    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    await selectBase(page, 'sales public');
    await expect(page.getByRole('button', { name: '원본 데이터', exact: true })).toHaveClass(/bg-bg-panel/);
    await expect(page.getByRole('columnheader', { name: 'category' })).toBeVisible();
    await useXAxis(page, 'category');

    // Y축 없으면 실행 비활성
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeDisabled();

    await addValue(page);
    await expect(page.getByRole('button', { name: '실행', exact: true })).toBeEnabled();
    await expect(page.getByRole('combobox', { name: 'Y축 1 값 방식' })).toHaveValue('none');
    await expect(page.getByText('원본값이 기본이며, 집계를 선택하면 X축과 계열 기준으로 그룹화합니다.')).toBeVisible();
    await page.waitForTimeout(500);
    expect(aggregateRuns).toBe(0);
    await expect(page.getByRole('button', { name: '원본 데이터', exact: true })).toHaveClass(/bg-bg-panel/);
    await expect(page.getByRole('columnheader', { name: 'category' })).toBeVisible();

    // 생성된 SQL 보기 토글
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText('실행하면 생성된 SQL이 표시됩니다.')).toBeVisible();
  });

  test('실행 시 집계 결과표와 생성 SQL이 채워진다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    // 탐색기에서 테이블 선택 → 원본 데이터 자동 로드
    await selectBase(page, 'sales public');
    await expect(page.getByText(/행 ·/)).toBeVisible();

    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();

    // 집계 결과(실행 결과 탭) — 카테고리 라벨 표시
    await expect(page.getByRole('cell', { name: '의류', exact: true }).first()).toBeVisible();

    // 생성된 SQL
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/SELECT/)).toBeVisible();
  });

  test('비-public 스키마 테이블을 선택해 스키마 한정 SQL을 생성한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });

    // 탐색기에서 analytics.events 선택 (스키마 배지 표시)
    await selectBase(page, /events/);
    await expect(page.locator('aside').first().getByRole('button', { name: 'events analytics' })).toBeVisible();

    await expect(page.getByText('analytics.events', { exact: true })).toBeVisible();

    await useXAxis(page, 'kind');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();

    // 생성된 SQL 이 "analytics"."events" 로 스키마 한정
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/FROM "analytics"\."events"/)).toBeVisible();
  });

  test('실행 후 ECharts 미리보기와 옵션 패널(대분류 전환)이 동작한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
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

  test('시각화 옵션 배치를 자동·오른쪽·아래쪽으로 선택하고 사용자 선택을 저장한다', async ({ page }) => {
    await page.goto('/charts/sales-db/public/sales/12');

    const workspace = page.getByTestId('visual-editor-workspace');
    const dockSelect = page.getByRole('combobox', { name: '옵션 패널 배치' });
    await expect(dockSelect).toHaveValue('auto');
    await expect(workspace).toHaveAttribute('data-option-dock', 'bottom');

    await dockSelect.selectOption('right');
    await expect(workspace).toHaveAttribute('data-option-dock-preference', 'right');
    await expect(workspace).toHaveAttribute('data-option-dock', 'right');
    await expect(page.getByTestId('visual-option-editor')).toHaveCSS('border-left-width', '1px');

    await dockSelect.selectOption('bottom');
    await expect(workspace).toHaveAttribute('data-option-dock', 'bottom');
    await expect(page.getByTestId('visual-option-editor')).toHaveCSS('border-top-width', '1px');

    await page.reload();
    await expect(page.getByRole('combobox', { name: '옵션 패널 배치' })).toHaveValue('bottom');
    await expect(page.getByTestId('visual-editor-workspace')).toHaveAttribute('data-option-dock', 'bottom');
  });

  test('가로·세로 프리셋과 직접 크기 편집, 패널별 좌측 레일 접기·전체 화면 검수가 동작한다', async ({ page }) => {
    await page.goto('/charts/sales-db/public/sales/12');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    const designCanvas = page.getByTestId('chart-design-canvas');
    const sizePreset = page.getByRole('combobox', { name: '미리보기 설계 크기' });
    const chartWidth = page.getByRole('spinbutton', { name: '차트 너비' });
    const chartHeight = page.getByRole('spinbutton', { name: '차트 높이' });
    await expect(designCanvas).toHaveAttribute('data-design-width', '640');
    await expect(designCanvas).toHaveAttribute('data-design-height', '360');
    await expect(chartWidth).toHaveValue('640');
    await expect(chartHeight).toHaveValue('360');

    await sizePreset.selectOption('fhd');
    await expect(designCanvas).toHaveAttribute('data-design-width', '1920');
    await expect(designCanvas).toHaveAttribute('data-design-height', '1080');
    await expect(chartWidth).toHaveValue('1920');
    await expect(chartHeight).toHaveValue('1080');

    // 사용자 지정으로 전환해도 과거 기본값(640×360)으로 튀지 않고 현재 프리셋에서 시작한다.
    await sizePreset.selectOption('custom');
    await expect(sizePreset).toHaveValue('custom');
    await expect(designCanvas).toHaveAttribute('data-design-width', '1920');
    await expect(designCanvas).toHaveAttribute('data-design-height', '1080');

    await sizePreset.selectOption('standardPortrait');
    await expect(designCanvas).toHaveAttribute('data-design-width', '360');
    await expect(designCanvas).toHaveAttribute('data-design-height', '640');
    await expect(chartWidth).toHaveValue('360');
    await expect(chartHeight).toHaveValue('640');

    const customPreview = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      const display = request.postDataJSON().options?.display;
      return display?.preset === 'custom' && display.width === 500 && display.height === 900;
    });
    await chartWidth.fill('500');
    await chartHeight.fill('900');
    await customPreview;
    await expect(sizePreset).toHaveValue('custom');
    await expect(designCanvas).toHaveAttribute('data-design-width', '500');
    await expect(designCanvas).toHaveAttribute('data-design-height', '900');

    await expect(page.getByRole('button', { name: /영역 확대/ })).toHaveCount(0);

    await page.getByRole('button', { name: '데이터 패널 접기' }).click();
    await expect(page.getByTestId('schema-sidebar')).toHaveCount(0);
    await expect(page.getByTestId('data-builder-workspace')).toBeVisible();
    const dataRail = page.getByTestId('schema-sidebar-rail');
    await expect(dataRail).toBeVisible();

    await page.getByRole('button', { name: '데이터 구성·결과 접기' }).click();
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
    await expect(dialog.getByTestId('chart-design-canvas')).toHaveAttribute('data-design-width', '500');
    await expect(dialog.getByTestId('chart-design-canvas')).toHaveAttribute('data-design-height', '900');
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
    await page.getByRole('button', { name: '데이터 구성·결과 펼치기' }).click();
    await expect(page.getByTestId('data-builder-workspace')).toBeVisible();
  });

  test('실행 없이 요소별 글꼴·글자 크기를 각 요소 편집 위치에서 지정한다', async ({ page }) => {
    let builderRuns = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/query/run-builder') builderRuns += 1;
    });

    await page.goto('/charts/sales-db/public/sales/12');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    // 저장 차트 재진입 시 정의 복원에 필요한 초기 조회는 이 테스트의 편집 동작과 무관하다.
    builderRuns = 0;

    // 스타일 탭에는 자동 상태 요소에 적용되는 전체 배율만 남는다.
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '글꼴');
    const fontSection = page.locator('section').filter({ has: page.getByText('글꼴', { exact: true }) });
    const policy = fontSection.getByTestId('typography-policy');
    await expect(policy).toContainText('요소별 글꼴과 글자 크기는 제목·범례·축 글자·라벨·툴팁 모양 섹션에서 각각 지정합니다.');
    await expect(policy).toContainText('현재 제목 18px · 범례 12px · 축 12px · 라벨 12px · 툴팁 12px');
    await expect(fontSection.locator('input[type="range"][aria-label="전체 글자 크기"]')).toHaveValue('100');
    await expect(fontSection.locator('input[type="range"][aria-label="제목 글자 크기"]')).toHaveCount(0);
    await expect(fontSection.getByRole('combobox')).toHaveCount(0);

    // 자동은 논리 크기를 따라 다시 계산된다.
    await page.getByRole('combobox', { name: '미리보기 설계 크기' }).selectOption('fhd');
    await expect(policy).toContainText('현재 제목 26px · 범례 16px · 축 16px · 라벨 16px · 툴팁 16px');

    // 제목 크기는 제목을 편집하는 기본 탭에서 지정한다.
    await openOptionTab(page, '기본');
    await page.locator('#option-title').fill('월별 매출');
    const pretendardPreview = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST'
        || new URL(response.url()).pathname !== '/api/v1/charts/preview'
        || !response.ok()) return false;
      const options = response.request().postDataJSON().options ?? {};
      return options.typography?.titleFontFamily === 'pretendard';
    });
    await page.getByRole('combobox', { name: '제목 글꼴' }).selectOption('pretendard');
    await expect(page.getByRole('combobox', { name: '제목 글꼴' })).toHaveValue('pretendard');
    const pretendardOption = (await pretendardPreview).json();
    await expect(pretendardOption).resolves.toMatchObject({
      option: { title: { textStyle: { fontFamily: "'ChartSDK Pretendard',sans-serif" } } },
    });
    await expect(page.locator('link[data-chartsdk-fonts]')).toHaveAttribute(
      'href',
      /\/fonts\/v1\/chartsdk-fonts\.css$/,
    );
    await expect.poll(() => page.evaluate(() =>
      performance.getEntriesByType('resource').some((entry) =>
        entry.name.includes('/fonts/v1/pretendard/') && entry.name.endsWith('.woff2')))).toBe(true);
    const titleFontRow = page.getByTestId('option-slider-typography_titleFontSize');
    await expect(titleFontRow).toContainText('자동 26px');
    await titleFontRow.locator('input[type="range"]').fill('31');
    await expect(titleFontRow).toContainText('31px');

    // 직접 지정한 요소는 논리 크기를 바꿔도 유지되고, 자동인 요소만 따라 내려간다.
    await page.getByRole('combobox', { name: '미리보기 설계 크기' }).selectOption('small');
    await openOptionTab(page, '스타일');
    await expect(policy).toContainText('현재 제목 31px · 범례 10px · 축 10px · 라벨 10px · 툴팁 10px');

    // '자동' 버튼으로 되돌린다.
    await openOptionTab(page, '기본');
    await titleFontRow.getByRole('button', { name: '자동', exact: true }).click();
    await expect(titleFontRow).toContainText('자동 14px');
    await openOptionTab(page, '스타일');
    await expect(policy).toContainText('현재 제목 14px · 범례 10px · 축 10px · 라벨 10px · 툴팁 10px');
    expect(builderRuns).toBe(0);
  });

  test('제목 세로쓰기와 저장 없는 미리보기 휠 줌을 제공한다', async ({ page }) => {
    const previewOptionsFor = (match: (options: Record<string, any>) => boolean) =>
      page.waitForRequest((request) => {
        if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
        return match(request.postDataJSON().options ?? {});
      });

    await page.goto('/charts/sales-db/public/sales/12');
    const preview = page.getByTestId('chart-preview');
    await expect(preview.locator('canvas')).toBeVisible();

    // 편집 미리보기의 휠 줌은 저장 옵션을 켜지 않아도 동작하고 dirty 상태를 만들지 않는다.
    await expect(preview).toHaveAttribute('data-preview-data-zoom', 'true');
    await expect(preview).toHaveAttribute('data-preview-data-zoomed', 'false');
    await preview.hover();
    await page.mouse.wheel(0, -600);
    await expect(preview).toHaveAttribute('data-preview-data-zoomed', 'true');
    await expect(page.locator('header').getByRole('button', { name: '초기화', exact: true })).toBeDisabled();
    await preview.dblclick();
    await expect(preview).toHaveAttribute('data-preview-data-zoomed', 'false');

    await openOptionTab(page, '기본');
    await page.locator('#option-title').fill('매출추이');

    const verticalTitle = previewOptionsFor((options) => options.titleDirection === 'vertical');
    await page.getByRole('tabpanel').getByRole('button', { name: '세로', exact: true }).click();
    expect((await verticalTitle).postDataJSON().options.title).toBe('매출추이');

    // 숫자 선택지는 문자열 "90"이 아니라 ECharts가 해석하는 숫자 90으로 저장한다.
    await openOptionTab(page, '계열');
    await openOptionSection(page, '라벨 · 정렬');
    const labelsEnabled = previewOptionsFor((options) => options.dataLabel === true);
    const dataLabelSwitch = page.getByRole('switch', { name: '데이터 라벨 표시' });
    await expect(dataLabelSwitch).toHaveAttribute('aria-checked', 'false');
    await dataLabelSwitch.click();
    await labelsEnabled;
    const verticalLabels = previewOptionsFor((options) => options.labelRotate === 90);
    await page.getByRole('tabpanel').getByRole('button', { name: '세로', exact: true }).click();
    expect((await verticalLabels).postDataJSON().options.labelRotate).toBe(90);
  });

  test('테마 팔레트와 직접 지정으로 시리즈 색상을 바꾸고 지정 해제 시 현재 테마로 복귀한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '색상');
    const seriesChip = page.locator('[data-testid^="series-color-chip-"]').first();
    const seriesSwatch = seriesChip.locator('[data-testid^="series-color-swatch-"]');
    await seriesChip.click();

    // 테마 색상 팔레트는 현재 선택한 시리즈에 해당 색을 지정한다.
    await page.getByTestId('palette-swatch-1').click();
    await expect(seriesSwatch).toHaveCSS('background-color', 'rgb(204, 102, 119)');

    const chipBox = await seriesChip.boundingBox();
    const swatchBox = await seriesSwatch.boundingBox();
    expect(chipBox).not.toBeNull();
    expect(swatchBox).not.toBeNull();
    expect(swatchBox!.x).toBeGreaterThan(chipBox!.x + chipBox!.width / 2);
    const gridColumns = await page.getByTestId('series-color-grid').evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean),
    );
    expect(gridColumns).toHaveLength(5);

    const colorPicker = page.locator('#option-series-color-picker');
    const directColorButton = page.getByTestId('series-color-edit');
    await expect(page.getByTestId('selected-color-target')).toContainText('선택:');
    await colorPicker.evaluate((input) => {
      const picker = input as HTMLInputElement & { dataset: DOMStringMap };
      picker.showPicker = () => { picker.dataset.opened = 'true'; };
    });
    await directColorButton.click();
    await expect(colorPicker).toHaveAttribute('data-opened', 'true');
    await colorPicker.fill('#ff0000');

    await expect(colorPicker).toHaveValue('#ff0000');
    await expect(seriesSwatch).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    await expect(page.getByTestId('palette-swatch-1')).toHaveCSS('background-color', 'rgb(204, 102, 119)');

    await selectTheme(page, 'Bold');
    await expect(page.getByTestId('palette-swatch-0')).toHaveCSS('background-color', 'rgb(127, 60, 141)');
    await expect(seriesSwatch).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    await page.getByRole('button', { name: '지정 해제', exact: true }).click();
    await expect(seriesSwatch).toHaveCSS('background-color', 'rgb(127, 60, 141)');
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('차트에서 고른 요소를 칩으로 관리하고 선택 삭제·모두 삭제한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();

    const preview = page.getByTestId('chart-preview');
    await expect(preview.locator('canvas')).toBeVisible();
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '색상');
    await page.getByTestId('chart-color-pick').click();
    await expect(preview).toHaveAttribute('data-color-picking', 'true');
    await expect(page.getByText('색상을 바꿀 요소를 선택하세요 · Esc 종료')).toBeVisible();

    const selectedItem = page.getByTestId('selected-chart-color-item');
    const canvas = preview.locator('canvas');
    const colorPoint = await canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext('2d');
      if (!context) return null;
      const pixels = context.getImageData(0, 0, target.width, target.height).data;
      for (let y = 0; y < target.height; y += 2) {
        for (let x = 0; x < target.width; x += 2) {
          const offset = (y * target.width + x) * 4;
          if (pixels[offset] === 136 && pixels[offset + 1] === 204 && pixels[offset + 2] === 238 && pixels[offset + 3] > 0) {
            return { x: x / target.width, y: y / target.height };
          }
        }
      }
      return null;
    });
    expect(colorPoint).not.toBeNull();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(
      bounds!.x + bounds!.width * colorPoint!.x,
      bounds!.y + bounds!.height * colorPoint!.y,
    );
    await expect(selectedItem).toContainText('·');

    const previewRequest = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options.itemColorOverrides?.length === 1;
    });
    await page.getByTestId('palette-swatch-2').click();
    const request = await previewRequest;
    expect(request.postDataJSON().options.itemColorOverrides).toEqual([
      expect.objectContaining({
        kind: 'cartesian',
        occurrence: 0,
        color: '#DDCC77',
      }),
    ]);
    await expect(selectedItem.locator('span').last()).toHaveCSS('background-color', 'rgb(221, 204, 119)');

    // 지정 해제는 현재 항목 칩을 유지한 채 현재 테마색으로만 되돌린다.
    const clearRequest = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return Array.isArray(request.postDataJSON().options.itemColorOverrides)
        && request.postDataJSON().options.itemColorOverrides.length === 0;
    });
    await page.getByRole('button', { name: '지정 해제', exact: true }).click();
    expect((await clearRequest).postDataJSON().options.itemColorOverrides).toEqual([]);
    await expect(selectedItem).toBeVisible();

    // 선택 삭제는 선택된 차트 요소의 지정색과 칩을 함께 제거한다.
    const reapplyRequest = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options.itemColorOverrides?.length === 1;
    });
    await page.getByTestId('palette-swatch-2').click();
    await reapplyRequest;
    const deleteRequest = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return Array.isArray(request.postDataJSON().options.itemColorOverrides)
        && request.postDataJSON().options.itemColorOverrides.length === 0;
    });
    await page.getByRole('button', { name: '선택 삭제', exact: true }).click();
    await deleteRequest;
    await expect(selectedItem).toHaveCount(0);

    // 모두 삭제는 차트에서 선택해 저장한 모든 단일 요소 지정색을 비운다.
    await page.mouse.click(
      bounds!.x + bounds!.width * colorPoint!.x,
      bounds!.y + bounds!.height * colorPoint!.y,
    );
    await expect(selectedItem).toBeVisible();
    const applyForAllDelete = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options.itemColorOverrides?.length === 1;
    });
    await page.getByTestId('palette-swatch-1').click();
    await applyForAllDelete;
    const clearAllRequest = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return Array.isArray(request.postDataJSON().options.itemColorOverrides)
        && request.postDataJSON().options.itemColorOverrides.length === 0;
    });
    await page.getByRole('button', { name: '모두 삭제', exact: true }).click();
    await clearAllRequest;
    await expect(preview).toHaveAttribute('data-color-picking', 'false');
    await expect(selectedItem).toHaveCount(0);
  });

  test('X축은 전체 라벨이 기본이고 Y축은 자동 눈금에서 고정 간격으로 변경할 수 있다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await openOptionTab(page, '축');
    await openOptionSection(page, 'X축');
    await openOptionSection(page, 'Y축');
    const xSection = page.locator('section').filter({ has: page.getByText('X축', { exact: true }) });
    const xLabelRow = xSection.getByText('라벨 표시', { exact: true }).locator('..');
    await expect(xLabelRow.getByRole('button', { name: '전체', exact: true })).toHaveClass(/bg-bg-panel/);
    await xLabelRow.getByRole('button', { name: '간격 지정', exact: true }).click();
    await expect(page.locator('#option-xAxis_labelEvery')).toBeVisible();
    await page.locator('#option-xAxis_labelEvery').fill('3');

    const ySection = page.locator('section').filter({ has: page.getByText('Y축', { exact: true }) });
    const xVerticalPreview = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options?.xAxis?.verticalLabels === true;
    });
    await xSection.getByRole('switch', { name: '라벨 세로쓰기' }).click();
    expect((await xVerticalPreview).postDataJSON().options.xAxis.verticalLabels).toBe(true);
    await expect(page.locator('#option-xAxis_rotate')).toBeVisible();

    const yVerticalPreview = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options?.yAxis?.verticalLabels === true;
    });
    await ySection.getByRole('switch', { name: '라벨 세로쓰기' }).click();
    expect((await yVerticalPreview).postDataJSON().options.yAxis.verticalLabels).toBe(true);

    const yTickRow = ySection.getByText('눈금 방식', { exact: true }).locator('..');
    await expect(yTickRow.getByRole('button', { name: '자동', exact: true })).toHaveClass(/bg-bg-panel/);
    await yTickRow.getByRole('button', { name: '고정 간격', exact: true }).click();
    await expect(page.locator('#option-yAxis_interval')).toBeVisible();
    await page.locator('#option-yAxis_interval').fill('20');

    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('산점도 전환 시 숫자 X축 스케일 설정이 노출되고 미리보기에 반영된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'id');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await page.getByRole('button', { name: '산점도', exact: true }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await openOptionTab(page, '축');
    await openOptionSection(page, 'X축');

    const xSection = page.locator('section').filter({
      has: page.getByRole('button', { name: 'X축', exact: true }),
    });
    const scaleRow = xSection.getByText('스케일', { exact: true }).locator('..');
    await expect(scaleRow.getByRole('button', { name: '선형', exact: true })).toBeVisible();

    const logPreview = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options?.xAxis?.scale === 'log';
    });
    await scaleRow.getByRole('button', { name: '로그', exact: true }).click();
    await logPreview;
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('표본 SUM은 외삽하지 않고 표본 합계로 명확히 표시한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);

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
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);

    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByRole('cell', { name: '의류', exact: true }).first()).toBeVisible();
    expect(modes).toEqual(['aggregate']);

    await page.getByRole('button', { name: '원본 데이터', exact: true }).click();
    await expect.poll(() => modes).toEqual(['aggregate', 'rows']);
  });

  test('자동 표본은 전체 추정 행 수 안내와 실제 표본 수를 표시한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await expect(page.getByRole('combobox', { name: '표본 방식' })).toHaveValue('auto');
    await expect(page.getByTestId('sample-total-hint')).toContainText('전체 약 500,000,000행 중 무작위 표본');
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await expect(page.getByTestId('sample-badge')).toContainText('무작위 행 표본 10,000행 · 표본 결과');
  });

  test('직접 지정 표본 크기는 최대 50,000행까지 실행 결과에 반영된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('combobox', { name: '표본 방식' }).selectOption('manual');
    await page.getByRole('spinbutton', { name: '표본 크기' }).fill('50000');
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await expect(page.getByTestId('sample-badge')).toContainText('무작위 행 표본 50,000행 · 표본 결과');
  });

  test('표본 추출 설정은 테이블 변경과 축 재구성 뒤에도 유지된다', async ({ page }) => {
    await page.goto('/charts/sales-db/public/sales/12');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toBeVisible();

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('combobox', { name: '표본 방식' }).selectOption('manual');
    await page.getByRole('spinbutton', { name: '표본 크기' }).fill('25000');

    // 차트 12 base=sales-db(ds2) → 왼쪽 목록에서 ds2 의 users 로 변경해도 표본 설정 유지.
    await selectBase(page, /users/);
    await page.getByRole('button', { name: '변경', exact: true }).click();
    // 기준 테이블을 바꾸면 축이 초기화되어 조회 전용 모드가 된다. 새 축을 구성하면 보존된 표본 설정이 다시 보인다.
    await useXAxis(page, 'region');
    await addValue(page);
    await useSumValue(page, 'id');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('combobox', { name: '표본 방식' })).toHaveValue('manual');
    await expect(page.getByRole('spinbutton', { name: '표본 크기' })).toHaveValue('25000');
  });

  test('조인을 추가해도 표본 설정을 유지하고 조인 결과 표본임을 안내한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);

    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('combobox', { name: '표본 방식' }).selectOption('manual');
    await page.getByRole('spinbutton', { name: '표본 크기' }).fill('25000');
    await expect(page.getByRole('switch', { name: '표본 추출' })).toHaveAttribute('aria-checked', 'true');

    await selectNewJoin(page, 'orders public');
    const sampleSwitch = page.getByRole('switch', { name: '표본 추출' });
    await expect(sampleSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(sampleSwitch).toBeEnabled();
    await expect(page.getByRole('spinbutton', { name: '표본 크기' })).toHaveValue('25000');
    await expect(page.getByTestId('sample-total-hint')).toHaveText('조인 결과에서 무작위 행 표본');
  });

  test('일반 View를 원본으로 선택하고 RESULT_RANDOM 표본 차트를 실행한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, /sales_summary/);
    await expect(page.locator('aside').first().getByText('View', { exact: true })).toBeVisible();

    await expect(page.getByText('analytics.sales_summary', { exact: true })).toBeVisible();
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);
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
    await expect(stale).toBeDisabled();

    const ready = tree.getByRole('button', { name: /monthly_sales_mv/ });
    await expect(ready).toBeEnabled();
    await ready.click();
    await expect(page.getByText('analytics.monthly_sales_mv', { exact: true })).toBeVisible();
  });

  test('테이블 조인을 구성하면 생성 SQL에 JOIN이 들어가고 컬럼이 qualified 된다 (11장)', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');

    // 조인 추가 → orders, ON sales.id = orders.sale_id
    await selectNewJoin(page, 'orders public');
    await page.getByRole('combobox', { name: '조인 기준 컬럼' }).selectOption('sales.id');
    await page.getByRole('combobox', { name: '조인 대상 컬럼' }).selectOption('orders.sale_id');

    // 조인 시 컬럼은 qualified("테이블.컬럼")
    await useXAxis(page, 'sales.category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();

    // 생성된 SQL 에 LEFT JOIN ... ON (qualified)
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/LEFT JOIN "orders" ON "sales"\."id" = "orders"\."sale_id"/)).toBeVisible();
  });

  test('서로 다른 데이터소스의 테이블을 조인하면 페더레이션 SQL(ds 별칭)과 스냅샷 안내가 나온다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');

    // 사이드바를 sales-db 로 전환(구성 유지, 모달 없음) → 조인 대상은 그 소스에서 고른다
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'sales-db' });
    // 조인 추가 → 다른 소스(sales-db)의 customers, ON sales.customer_id = customers.id
    await selectNewJoin(page, 'customers public');
    await page.getByRole('combobox', { name: '조인 기준 컬럼' }).selectOption('sales.customer_id');
    await page.getByRole('combobox', { name: '조인 대상 컬럼' }).selectOption('customers.id');

    await useXAxis(page, 'customers.region');
    await addValue(page);

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
    await selectBase(page, /users/);

    // 사이드바를 sales-db 로 전환 → 조인 대상은 다른 소스(sales-db)의 동명 users. 핸들 users_2 부여.
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'sales-db' });
    await selectNewJoin(page, 'users public');
    await page.getByRole('combobox', { name: '조인 기준 컬럼' }).selectOption('users.id');
    await page.getByRole('combobox', { name: '조인 대상 컬럼' }).selectOption('users_2.id');

    await useXAxis(page, 'users_2.region');
    await addValue(page);

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
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);
  }

  test('저장 조건이 부족하면 버튼을 비활성화하지 않고 정확한 안내를 표시한다', async ({ page }) => {
    await page.goto('/charts/new');
    const save = page.getByRole('button', { name: '저장', exact: true });

    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('차트 이름을 입력해야 저장할 수 있습니다.')).toBeVisible();

    await page.getByPlaceholder('차트 이름').fill('미완성 차트');
    await save.click();
    await expect(page.getByText('테이블을 선택해야 저장할 수 있습니다.')).toBeVisible();
  });

  test('실행·이름 입력 후 저장하면 완료 토스트가 뜬다', async ({ page }) => {
    await buildChart(page);
    // 저장 = 실행 + 캐시 시드(PRD 7.3): 실행 결과가 있어야 저장 가능
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByRole('cell', { name: '의류', exact: true }).first()).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('월별 매출');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장되었습니다')).toBeVisible();
    await expect(page).toHaveURL(/\/charts\/analytics-db\/public\/sales\/\d+$/);
  });

  test('전역 초기화는 이름·Builder·차트 옵션을 마지막 저장 상태로 복원한다', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await page.getByPlaceholder('차트 이름').fill('옵션 초기화 테스트');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장되었습니다')).toBeVisible();

    const reset = page.getByRole('button', { name: '초기화', exact: true });
    await expect(reset).toBeDisabled();
    await page.getByPlaceholder('차트 이름').fill('저장하지 않은 이름');
    await page.locator('#option-title').fill('저장하지 않은 제목');
    await useXAxis(page, 'dept');
    await expect(reset).toBeEnabled();
    await reset.click();

    await expect(page.getByPlaceholder('차트 이름')).toHaveValue('옵션 초기화 테스트');
    await expect(page.getByTestId('builder-x-axis')).toContainText('category');
    await expect(page.locator('#option-title')).toHaveValue('');
    await expect(page.getByText('마지막 저장 상태로 복원했습니다')).toBeVisible();
    await expect(reset).toBeDisabled();
  });

  test('저장 후 임베드 코드 버튼 활성화 + S3 모달 연결', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByRole('cell', { name: '의류', exact: true }).first()).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('신규 차트');
    await expect(page.getByRole('button', { name: '임베드 코드' })).toBeDisabled();

    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장되었습니다')).toBeVisible();

    await expect(page.getByRole('button', { name: '임베드 코드' })).toBeEnabled();
    await page.getByRole('button', { name: '임베드 코드' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/sdk\.js/)).toBeVisible();
  });

  test('빌더 변경으로 결과가 무효화되어도 저장 버튼은 안내를 위해 활성 상태를 유지한다', async ({ page }) => {
    await buildChart(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByRole('cell', { name: '의류', exact: true }).first()).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('x');
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();

    // X축 변경 → 결과/SQL 무효화. 실제 저장은 막되 버튼은 조건 안내를 위해 유지한다.
    await useXAxis(page, 'dept');
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
  });

  test('데이터소스를 바꿔도 구성이 유지되고 왼쪽 목록에서 다른 소스 조인을 선택한다', async ({ page }) => {
    await buildChart(page); // base = analytics-db(ds1) sales, X축=category
    // 소스를 sales-db 로 전환 — 모달 없이 구성(X축) 유지
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'sales-db' });
    await expect(page.getByText('데이터소스를 변경할까요?')).toBeHidden();
    await expect(page.getByText('원본 테이블을 변경할까요?')).toBeHidden();
    await expect(page.getByRole('combobox', { name: '데이터소스' })).toHaveValue('2');
    await expect(page.getByTestId('builder-x-axis')).toContainText('category'); // 구성 유지
    // 현재 탐색 중인 sales-db(ds2) 목록에서 customers를 조인 대상으로 선택한다.
    await selectNewJoin(page, 'customers public');
    await expect(page.getByTestId('join-table-selector-0')).toHaveAttribute('title', /public\.customers/);
  });

  test('설정된 차트에서 다른 원본 테이블을 클릭하면 변경 확인 모달을 거친다', async ({ page }) => {
    await buildChart(page); // base = ds1 sales
    await selectBase(page, /users/);
    await expect(page.getByText('원본 테이블을 변경할까요?')).toBeVisible();
    await expect(page.getByText(/X축.*Y축.*설정되어 있습니다/)).toBeVisible();
    await page.getByRole('button', { name: '아니요', exact: true }).click();
    await expect(page.getByText('원본 테이블을 변경할까요?')).toBeHidden();
    await expect(page.getByText('public.sales', { exact: true })).toBeVisible();
    await selectBase(page, /users/);
    await page.getByRole('button', { name: '예', exact: true }).click();
    await expect(page.getByText('public.users', { exact: true })).toBeVisible();
    await expect(page.getByTestId('builder-x-axis')).toContainText('데이터 패널에서 컬럼 선택');
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
  await selectBase(page, 'sales public');
}

test.describe('S2 노코드 구성 — 날짜 묶기·조건·정렬·실행', () => {
  test('날짜형 X축을 고르면 묶기 셀렉트가 기본 월로 나타난다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'date');
    await expect(page.getByRole('combobox', { name: 'X축 묶기' })).toHaveValue('month');
  });

  test('묶기를 주로 바꾸면 생성 SQL에 DATE_TRUNC(week)가 반영된다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'date');
    await page.getByRole('combobox', { name: 'X축 묶기' }).selectOption('week');
    await addValue(page);
    await useSumValue(page);
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
    await useXAxis(page, 'category');
    await addValue(page);
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
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('combobox', { name: '정렬 기준' }).selectOption('x');
    await page.getByRole('combobox', { name: '정렬 방향' }).selectOption('asc');
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await page.getByText('생성된 SQL 보기').click();
    await expect(page.getByText(/ORDER BY 1 ASC/)).toBeVisible();
  });

  test('Ctrl+Enter로 실행된다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);
    await page.getByTestId('builder-x-axis').focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('cell', { name: '의류', exact: true }).first()).toBeVisible();
  });

  test('조인 종류 INNER 반영·제거 뒤에도 표본 추출 컨트롤을 사용할 수 있다', async ({ page }) => {
    await newSalesBase(page);
    await selectNewJoin(page, 'orders public');
    await page.getByRole('combobox', { name: '조인 종류' }).selectOption('inner');
    await page.getByRole('combobox', { name: '조인 기준 컬럼' }).selectOption('sales.id');
    await page.getByRole('combobox', { name: '조인 대상 컬럼' }).selectOption('orders.sale_id');
    await useXAxis(page, 'sales.category');
    await addValue(page);
    await page.getByRole('combobox', { name: 'Y축 1 값 방식' }).selectOption('sum');
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
    await useXAxis(page, 'category');
    await addValue(page);
    await addValue(page);
    await expect(page.locator('#builder-y-column-1')).toBeVisible();
    // 원형 전환 → 시리즈 1개로 정규화 + 추가 버튼 비활성
    await page.getByRole('button', { name: '원형', exact: true }).click();
    await expect(page.locator('#builder-y-column-1')).toHaveCount(0);
    await expect(page.locator('#builder-y-column-0')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 값 추가' })).toBeDisabled();
  });

  test('분포로 전환하면 집계는 원본값뿐이고 날짜 묶기는 숨지만 행 표본은 사용할 수 있다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'date');
    await addValue(page);
    // 전환 전: 날짜 묶기·표본 스위치 존재
    await expect(page.getByRole('combobox', { name: 'X축 묶기' })).toBeVisible();
    await expect(page.getByRole('switch', { name: '표본 추출' })).toBeVisible();
    // 분포 전환
    await page.getByRole('button', { name: '산점도', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'X축 묶기' })).toHaveCount(0);
    const sampleSwitch = page.getByRole('switch', { name: '표본 추출' });
    await expect(sampleSwitch).toBeVisible();
    await expect(sampleSwitch).toBeEnabled();
    await sampleSwitch.click();
    await expect(sampleSwitch).toBeChecked();
    // 집계 셀렉트는 원본값 1개뿐
    await expect(page.locator('#builder-y-agg-0 option')).toHaveCount(1);
  });

  test('영역 지도 원본값에서도 행 표본을 실행하고 처리 방식을 표시한다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '영역 지도', exact: true }).click();
    await useYAxis(page, 0, 'amount');
    await expect(page.getByRole('combobox', { name: 'Y축 1 값 방식' })).toHaveValue('none');

    const sampleSwitch = page.getByRole('switch', { name: '표본 추출' });
    await expect(sampleSwitch).toBeVisible();
    await expect(sampleSwitch).toBeEnabled();
    await sampleSwitch.click();
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await expect(page.getByTestId('sample-badge')).toContainText('표본 결과');
    await expect(page.getByText('amount: 표본 원본값')).toBeVisible();
  });

  test('원본값 결과에서 분포 전환은 호환 결과와 저장 안내 버튼을 유지한다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('분포전환');
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
    // 이미 원본값 구성이므로 분포 전환과 호환돼 실행 결과를 재사용한다.
    await page.getByRole('button', { name: '산점도', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
  });
});

test.describe('S2 이탈 모달·옵션 검색', () => {
  test('이탈확인에서 저장 안 함을 누르면 목록으로 이동한다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '목록', exact: true }).click();
    await expect(page.getByText('저장되지 않은 변경이 있습니다')).toBeVisible();
    await page.getByRole('button', { name: '저장 안 함' }).click();
    await expect(page.getByText('새 차트 만들기')).toBeVisible(); // 목록 도착
  });

  test('저장 후 나가기도 항상 안내 가능하며, 실행 후 저장하면 목록에 반영된다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByPlaceholder('차트 이름').fill('이탈저장차트');
    // 미실행 상태도 조건 안내를 위해 버튼은 활성 상태다.
    await page.getByRole('button', { name: '목록', exact: true }).click();
    await expect(page.getByRole('button', { name: '저장 후 나가기' })).toBeEnabled();
    await page.getByRole('button', { name: '계속 편집' }).click();
    // 실행 후 → 저장 후 나가기 활성 → 저장 + 이동
    await useSumValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByRole('cell', { name: '의류', exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '목록', exact: true }).click();
    await page.getByRole('button', { name: '저장 후 나가기' }).click();
    await expect(page.getByText('이탈저장차트', { exact: true })).toBeVisible();
  });

  test('옵션 검색으로 옵션 항목이 필터되고 지우면 복원된다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    // '제목' 검색 → 차트 제목은 남고 색상 테마는 사라짐
    await page.locator('#option-search').fill('제목');
    await expect(page.getByText('차트 제목', { exact: true })).toBeVisible();
    await expect(page.getByText('테마', { exact: true })).toBeHidden();
    // 지우면 복원
    await page.locator('#option-search').fill('');
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '색상');
    await expect(page.getByText('테마', { exact: true })).toBeVisible();
  });
});

test.describe('S2 네이티브 확장 — 100% 정규화·혼합(combo)', () => {
  test('누적 variant를 고르면 100% 정규화 토글이 나타나고 미리보기가 유지된다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    // 기본 variant → 100% 정규화 숨김(showIf: variant==='stacked')
    await expect(page.getByText('100% 정규화')).toBeHidden();
    // 누적 선택 → 토글 노출 → 켜도 미리보기 유지
    await page.getByRole('button', { name: '누적', exact: true }).click();
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '막대');
    await expect(page.getByText('100% 정규화')).toBeVisible();
    await page.getByRole('switch', { name: '100% 정규화' }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('시리즈 종류에서 한 시리즈를 선으로 바꾸면 혼합 차트가 렌더된다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page); // 시리즈 sum_id
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    // 실행 후 '시리즈 종류' 컨트롤 노출 → sum_id 시리즈를 선으로
    await openOptionTab(page, '계열');
    await openOptionSection(page, '혼합');
    await expect(page.getByText('시리즈 종류')).toBeVisible();
    await page.locator('[data-testid^="series-type-"]').first().getByRole('button', { name: '선', exact: true }).click();
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
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  }

  for (const label of ['박스 플롯', '행렬 히트맵', '영역 지도']) {
    test(`${label} 유형으로 전환·재실행 시 미리보기가 렌더된다`, async ({ page }) => {
      await runBar(page);
      // 대분류 전환 → 빌더 정규화로 결과 무효화될 수 있어 재실행
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('button', { name: '실행', exact: true }).click();
      await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    });
  }

  test('모든 차트가 같은 25개 테마를 공유하고 지도는 순차형 테마를 먼저 제공한다', async ({ page }) => {
    await runBar(page);
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '색상');
    const theme = page.locator('#option-palettePreset');
    await expect(theme.locator('option')).toHaveCount(25);
    await expect(theme.locator('option').first()).toHaveText('Safe');
    await page.getByRole('combobox', { name: '테마', exact: true }).click();
    await expect(page.getByRole('listbox', { name: '테마 목록' }).getByRole('option')).toHaveCount(25);
    await expect(page.getByRole('listbox', { name: '테마 목록' }).getByRole('option').first()).toHaveText('Safe');
    await page.keyboard.press('Escape');
    await page.getByPlaceholder('차트 이름').fill('색상 테마 초기화 테스트');
    await page.locator('header').getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장되었습니다')).toBeVisible();

    await openOptionTab(page, '기본');
    await page.getByRole('button', { name: '영역 지도', exact: true }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '색상');

    await expect(theme).toHaveValue('teal');
    await expect(theme.locator('option')).toHaveCount(25);
    await expect(theme.locator('option').first()).toHaveText('Burg');
    await page.getByRole('combobox', { name: '테마', exact: true }).click();
    await expect(page.getByRole('listbox', { name: '테마 목록' }).getByRole('option')).toHaveCount(25);
    await expect(page.getByRole('listbox', { name: '테마 목록' }).getByRole('option').first()).toHaveText('Burg');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette-gradient')).toBeVisible();
    await selectTheme(page, 'Burg');
    await expect(page.getByTestId('palette-swatch-0')).toHaveCSS('background-color', 'rgb(255, 198, 196)');

    await page.getByRole('switch', { name: '색상 방향 반전' }).click();
    await expect(page.getByTestId('palette-gradient')).toHaveAttribute('aria-label', /반전됨/);
    await expect(page.getByTestId('palette-swatch-0')).toHaveCSS('background-color', 'rgb(103, 32, 68)');

    await page.locator('header').getByRole('button', { name: '초기화', exact: true }).click();
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '색상');
    await expect(theme).toHaveValue('safe');
    await expect(theme.locator('option')).toHaveCount(25);
    await expect(theme.locator('option').first()).toHaveText('Safe');
  });

  test('표본 추출 실행 결과에 방식·집계 주의문구가 표시된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await useSumValue(page);
    await page.getByRole('switch', { name: '표본 추출' }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.getByText('주의: 전체 데이터에서 무작위로 선택된 행의 표본 결과입니다.')).toBeVisible();
    await expect(page.getByText('주의: SUM·COUNT는 선택된 표본의 합계·개수이며 전체 데이터의 합계·개수가 아닙니다.')).toBeVisible();
  });
});

test.describe('S2 분석 표시 — 박스플롯 이상치·시간축 이동평균', () => {
  test('박스플롯은 IQR 이상치를 별도 산점도로 표시하고 색상·표시 여부를 편집한다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '박스 플롯', exact: true }).click();

    const runResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/query/run-builder'
      && response.ok());
    await page.getByRole('button', { name: '실행', exact: true }).click();
    const runPayload = await (await runResponsePromise).json();
    expect(runPayload.option.series).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '__chartsdk_boxplot_outliers',
        type: 'scatter',
        data: expect.arrayContaining([expect.any(Array)]),
      }),
    ]));

    await openOptionTab(page, '계열');
    await openOptionSection(page, '분석 표시');
    await expect(page.getByTestId('boxplot-outliers')).toContainText('1.5 × IQR');
    const color = page.getByLabel('박스플롯 이상치 색상');
    await expect(color).toHaveValue('#d81b60');

    const colorResponsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST'
        || new URL(response.url()).pathname !== '/api/v1/charts/preview') return false;
      return response.request().postDataJSON().options.analysis?.boxplotOutliers?.color === '#0055AA';
    });
    await color.fill('#0055aa');
    const colorPayload = await (await colorResponsePromise).json();
    expect(colorPayload.option.series).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '__chartsdk_boxplot_outliers',
        itemStyle: expect.objectContaining({ color: '#0055AA' }),
      }),
    ]));

    const hiddenResponsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST'
        || new URL(response.url()).pathname !== '/api/v1/charts/preview') return false;
      return response.request().postDataJSON().options.analysis?.boxplotOutliers?.show === false;
    });
    await page.getByRole('switch', { name: '박스플롯 이상치 표시' }).click();
    const hiddenPayload = await (await hiddenResponsePromise).json();
    expect(hiddenPayload.option.series).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '__chartsdk_boxplot_outliers' }),
    ]));
    await expect(color).toHaveCount(0);
  });

  test('날짜형 선 차트는 선택 계열의 SMA를 시간 오름차순으로 계산하고 범례를 제어한다', async ({ page }) => {
    await newSalesBase(page);
    await useXAxis(page, 'date');
    await addValue(page);
    await useSumValue(page, 'amount');
    await addValue(page);
    await useYAxis(page, 1, 'id');
    await page.getByRole('combobox', { name: 'Y축 2 값 방식' }).selectOption('sum');
    await page.getByRole('button', { name: '선', exact: true }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    await openOptionTab(page, '계열');
    // 이동평균은 정렬 선택을 무효로 만든다 — 잠금 전 상태와 저장값을 먼저 고정한다.
    await openOptionSection(page, '라벨 · 정렬');
    const sortOrder = page.locator('#option-sortOrder');
    await sortOrder.selectOption('desc');
    await expect(sortOrder).toBeEnabled();

    await openOptionSection(page, '분석 표시');
    await expect(page.getByTestId('moving-average')).toContainText('시간 오름차순');

    const enabledRequest = page.waitForRequest((request) => {
      if (request.method() !== 'POST'
        || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options.analysis?.movingAverage?.enabled === true;
    });
    await page.getByRole('switch', { name: '이동평균 표시' }).click();
    await enabledRequest;

    await expect(sortOrder).toBeDisabled();
    await expect(page.getByTestId('option-locked-sortOrder')).toContainText('시간 오름차순으로 고정됩니다');

    await page.getByRole('combobox', { name: '이동평균 적용 계열' }).selectOption('1');
    await page.getByLabel('이동평균 기간').fill('2');

    const finalResponsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST'
        || new URL(response.url()).pathname !== '/api/v1/charts/preview') return false;
      const movingAverage = response.request().postDataJSON().options.analysis?.movingAverage;
      return movingAverage?.enabled === true
        && movingAverage.seriesIndex === 1
        && movingAverage.period === 2
        && movingAverage.showInLegend === false;
    });
    await page.getByRole('switch', { name: '이동평균 범례 포함' }).click();
    const payload = await (await finalResponsePromise).json();

    const dates = payload.option.xAxis.data as string[];
    expect(dates).toEqual([...dates].sort((left, right) => Date.parse(left) - Date.parse(right)));
    const baseSeries = payload.option.series[1];
    const movingAverage = payload.option.series.find(
      (series: { id?: string }) => series.id === '__chartsdk_moving_average_1');
    expect(movingAverage).toEqual(expect.objectContaining({
      type: 'line',
      data: expect.arrayContaining([expect.any(Number)]),
      lineStyle: expect.objectContaining({
        type: 'dashed',
        width: 2,
        color: baseSeries.lineStyle?.color ?? baseSeries.itemStyle?.color,
      }),
    }));
    expect(movingAverage.data[0]).toBeNull();
    expect(payload.option.legend.data).not.toContain(movingAverage.name);

    // 잠금은 표시 상태일 뿐이라 이동평균을 끄면 저장된 정렬값이 그대로 되살아난다.
    await page.getByRole('switch', { name: '이동평균 표시' }).click();
    await expect(sortOrder).toBeEnabled();
    await expect(sortOrder).toHaveValue('desc');
  });
});

// 지도 포인트(geoscatter) + 행정 경계 지도 — geo 좌표계와 지도 렌더링 경로 검증.
test.describe('S2 지도 확장 — 지도 포인트·행정 경계', () => {
  test('지도 포인트 유형은 숫자 경도·위도로 실행 시 미리보기가 렌더된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    // 지도 포인트 전환 → 텍스트 X(category)는 거부되므로 숫자 경도 컬럼으로 교체 후 실행
    await page.getByRole('button', { name: '포인트 지도', exact: true }).click();
    await expect(page.getByText('포인트 지도는 숫자 경도(X) 컬럼이 필요합니다.')).toBeVisible();
    await useXAxis(page, 'amount');
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('PostGIS Point 컬럼과 크기값을 선택하면 실제 좌표 표본으로 지도 포인트가 렌더된다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await page.getByRole('button', { name: '포인트 지도', exact: true }).click();

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

    // 영역 지도와 마찬가지로 포인트 지도에서도 시·도/시·군·구 표시 영역을 선택할 수 있다.
    await openOptionTab(page, '영역');
    await openOptionSection(page, '표시 영역');
    const viewport = page.getByTestId('map-viewport-control');
    const regionMode = viewport.getByRole('radio', { name: '지역 선택' });
    await expect(regionMode).toBeVisible();
    await regionMode.click();
    await expect(viewport.getByRole('combobox', { name: '시/도', exact: true })).toBeVisible();
    await expect(viewport.getByRole('combobox', { name: '구', exact: true })).toBeVisible();

    // 테마 변경은 전체 점 기본색을 바꾸며, 배경 지역 강조는 항상 꺼진다.
    await openOptionTab(page, '스타일');
    await openOptionSection(page, '색상');
    await expect(page.getByText('차트 요소 색상', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '선택 삭제', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '모두 삭제', exact: true })).toBeVisible();
    const themeColorPreview = page.waitForResponse(async (response) => {
      if (response.request().method() !== 'POST'
        || new URL(response.url()).pathname !== '/api/v1/charts/preview'
        || !response.ok()) return false;
      return response.request().postDataJSON().options?.palette?.[0] === '#7F3C8D';
    });
    await selectTheme(page, 'Bold');
    const payload = await (await themeColorPreview).json();
    expect(payload.option.series[0].itemStyle.color).toBe('#7F3C8D');
    expect(payload.option.geo.emphasis).toEqual({ disabled: true });
  });

  test('지도 영역 탭에서 시도·시군구 행정 경계를 선택해 미리보기에 반영한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();

    // 지리 계열은 GEO 그룹 헤더 아래에 노출 (화면설계 S2 옵션 패널)
    await expect(page.getByText('GEO', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '영역 지도', exact: true }).click();
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await openOptionTab(page, '영역');
    await openOptionSection(page, '표시 영역');
    const boundaryRow = page.getByText('행정 경계', { exact: true }).locator('..');
    await expect(boundaryRow.getByRole('button', { name: '시·도', exact: true })).toBeVisible();
    await expect(boundaryRow.getByRole('button', { name: '시·군·구', exact: true })).toBeVisible();

    const sigunguPreview = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options?.map?.name === 'kr-sigungu';
    });
    await boundaryRow.getByRole('button', { name: '시·군·구', exact: true }).click();
    await sigunguPreview;
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
  });

  test('동적 Polygon 지도의 표시 영역을 데이터·지역·지도 조정·WGS84 좌표로 지정한다', async ({ page }) => {
    await page.goto('/charts/new');
    await page.getByRole('combobox', { name: '데이터소스' }).selectOption({ label: 'analytics-db' });
    await selectBase(page, 'sales public');
    await useXAxis(page, 'category');
    await addValue(page);
    await page.getByRole('button', { name: '실행', exact: true }).click();

    await page.getByRole('button', { name: '영역 지도', exact: true }).click();
    await page.getByRole('combobox', { name: '지도 경계 방식' }).selectOption('spatial');
    await page.getByRole('button', { name: '실행', exact: true }).click();
    await expect(page.locator('[data-testid="chart-preview"] canvas')).toBeVisible();
    await page.getByPlaceholder('차트 이름').fill('지도 영역 저장 테스트');

    await openOptionTab(page, '영역');
    const control = page.getByTestId('map-viewport-control');
    const areaActions = control.getByTestId('map-viewport-actions');
    const topBar = page.locator('header').first();
    await expect(control).toBeVisible();
    await expect(control.getByRole('radio', { name: '데이터 전체' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('표시 영역: 데이터 전체')).toBeVisible();
    await expect(topBar.getByRole('button', { name: '초기화', exact: true })).toBeDisabled();
    await expect(areaActions.getByRole('button', { name: '초기화', exact: true })).toBeDisabled();
    await expect(areaActions.getByRole('button', { name: '저장', exact: true })).toBeDisabled();

    const previewCanvas = page.locator('[data-testid="chart-preview"] canvas');
    await previewCanvas.hover();
    await page.mouse.wheel(0, -300);
    await expect(control.getByRole('radio', { name: '데이터 전체' })).toHaveAttribute('aria-checked', 'true');
    await expect(areaActions.getByRole('button', { name: '초기화', exact: true })).toBeDisabled();
    await expect(areaActions.getByRole('button', { name: '저장', exact: true })).toBeDisabled();

    await page.waitForTimeout(500);
    const beforeRegionMode = await previewCanvas.screenshot();
    await control.getByRole('radio', { name: '지역 선택' }).click();
    await page.waitForTimeout(500);
    expect((await previewCanvas.screenshot()).equals(beforeRegionMode)).toBe(true);
    const provinceSelect = control.getByRole('combobox', { name: '시/도', exact: true });
    const citySelect = control.getByRole('combobox', { name: '시', exact: true });
    const countySelect = control.getByRole('combobox', { name: '군', exact: true });
    const districtSelect = control.getByRole('combobox', { name: '구', exact: true });
    await expect(provinceSelect).toBeVisible();
    await expect(provinceSelect.locator('option')).toHaveCount(17);
    const provinceLabels = await provinceSelect.locator('option').allTextContents();
    expect(provinceLabels).toContain('전남광주통합특별시');
    expect(provinceLabels).not.toContain('광주광역시');
    expect(provinceLabels).not.toContain('전라남도');
    await expect(control.getByRole('combobox', { name: '시', exact: true })).toBeDisabled();
    await expect(control.getByRole('combobox', { name: '군', exact: true })).toBeDisabled();
    await expect(control.getByRole('combobox', { name: '구', exact: true })).toBeDisabled();

    await provinceSelect.selectOption({ label: '전남광주통합특별시' });
    await expect(citySelect.locator('option')).toContainText(['목포시']);
    await expect(countySelect.locator('option')).toContainText(['담양군']);
    await expect(districtSelect.locator('option')).toContainText(['광산구']);

    await provinceSelect.selectOption({ label: '인천광역시' });
    const incheonDistrictLabels = await districtSelect.locator('option').allTextContents();
    expect(incheonDistrictLabels).toEqual(expect.arrayContaining(['제물포구', '영종구', '서해구', '검단구']));
    expect(incheonDistrictLabels).not.toEqual(expect.arrayContaining(['중구', '동구', '서구']));

    await provinceSelect.selectOption({ label: '경기도' });
    await expect(citySelect).toBeEnabled();
    await expect(countySelect).toBeEnabled();
    await expect(districtSelect).toBeDisabled();
    await citySelect.selectOption({ label: '수원시' });
    await expect(districtSelect).toBeEnabled();
    await districtSelect.selectOption({ label: '장안구' });
    await expect(page.getByText('표시 영역: 경기도 수원시 장안구')).toBeVisible();
    await provinceSelect.selectOption({ label: '서울특별시' });
    await expect(citySelect).toBeDisabled();
    await expect(countySelect).toBeDisabled();
    await expect(districtSelect).toBeEnabled();
    await districtSelect.selectOption({ label: '강남구' });
    await expect(page.getByText('표시 영역: 서울특별시 강남구')).toBeVisible();
    await expect(areaActions.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
    await topBar.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장되었습니다')).toBeVisible();
    await expect(topBar.getByRole('button', { name: '초기화', exact: true })).toBeDisabled();
    await expect(areaActions.getByRole('button', { name: '초기화', exact: true })).toBeDisabled();

    await page.waitForTimeout(1200);
    const beforeManualMode = await previewCanvas.screenshot();
    await control.getByRole('radio', { name: '지도에서 조정' }).click();
    await page.waitForTimeout(250);
    expect((await previewCanvas.screenshot()).equals(beforeManualMode)).toBe(true);
    await previewCanvas.hover();
    await page.waitForTimeout(100);
    const beforeWheelZoom = await previewCanvas.screenshot();
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await previewCanvas.screenshot()).equals(beforeWheelZoom)).toBe(false);
    const adjustedBounds = await control.getByTestId('map-bounds-summary').textContent();
    await openOptionTab(page, '상호작용');
    const tooltipSection = page.locator('section').filter({ has: page.getByText('툴팁', { exact: true }) });
    const tooltipPreview = page.waitForRequest((request) => {
      if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/v1/charts/preview') return false;
      return request.postDataJSON().options.tooltip?.enabled === false;
    });
    await tooltipSection.getByRole('switch', { name: '툴팁 표시' }).click();
    await tooltipPreview;
    await openOptionTab(page, '영역');
    await page.waitForTimeout(300);
    await expect(control.getByTestId('map-bounds-summary')).toHaveText(adjustedBounds!);
    await expect(page.getByText('표시 영역: 지도 조정 중')).toBeVisible();
    await expect(areaActions.getByRole('button', { name: '저장', exact: true })).toBeEnabled();
    await areaActions.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('지도 영역을 저장했습니다. 최상단 저장 전에는 임베드에 반영되지 않습니다.')).toBeVisible();
    await expect(page.getByText('표시 영역: 지도 조정 중')).toBeVisible();
    await expect(areaActions.getByRole('button', { name: '초기화', exact: true })).toBeDisabled();
    await expect(topBar.getByRole('button', { name: '초기화', exact: true })).toBeEnabled();

    await previewCanvas.hover();
    await page.mouse.wheel(0, -300);
    await expect(areaActions.getByRole('button', { name: '초기화', exact: true })).toBeEnabled();
    await areaActions.getByRole('button', { name: '초기화', exact: true }).click();
    await expect(page.getByText('마지막 영역 저장 상태로 복원했습니다')).toBeVisible();
    await expect(page.getByText('표시 영역: 사용자 지정')).toBeVisible();

    await topBar.getByRole('button', { name: '초기화', exact: true }).click();
    await expect(page.getByText('표시 영역: 서울특별시 강남구')).toBeVisible();
    await expect(control.getByRole('combobox', { name: '시/도', exact: true })).toHaveValue('서울특별시');
    await expect(control.getByRole('combobox', { name: '구', exact: true })).toHaveValue('서울특별시 강남구');
    await page.waitForTimeout(1200);

    const previewBox = await previewCanvas.boundingBox();
    expect(previewBox).not.toBeNull();
    await page.keyboard.down('Shift');
    await page.mouse.move(previewBox!.x + previewBox!.width * 0.2, previewBox!.y + previewBox!.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(previewBox!.x + previewBox!.width * 0.8, previewBox!.y + previewBox!.height * 0.75);
    await expect(page.getByTestId('map-box-zoom-selection')).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(control.getByRole('radio', { name: '지도에서 조정' })).toHaveAttribute('aria-checked', 'true');
    await expect(areaActions.getByRole('button', { name: '저장', exact: true })).toBeEnabled();

    const savedManualRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      if (request.method() !== 'PUT' || !/^\/api\/v1\/charts\/\d+$/.test(url.pathname)) return false;
      return request.postDataJSON().options?.map?.viewport?.mode === 'manual';
    });
    await topBar.getByRole('button', { name: '저장', exact: true }).click();
    const savedManualViewport = (await savedManualRequest).postDataJSON().options.map.viewport;
    expect(savedManualViewport.bounds).toEqual({
      west: expect.any(Number),
      east: expect.any(Number),
      south: expect.any(Number),
      north: expect.any(Number),
    });
    await expect(page.getByText('표시 영역: 사용자 지정')).toBeVisible();
    await expect(topBar.getByRole('button', { name: '초기화', exact: true })).toBeDisabled();
    await expect(areaActions.getByRole('button', { name: '초기화', exact: true })).toBeDisabled();
    await page.waitForTimeout(1200);

    const beforeCoordinateMode = await previewCanvas.screenshot();
    await control.getByRole('radio', { name: '좌표로 지정' }).click();
    await page.waitForTimeout(250);
    expect((await previewCanvas.screenshot()).equals(beforeCoordinateMode)).toBe(true);
    await control.getByRole('spinbutton', { name: '서쪽 경도' }).fill('126.7');
    await control.getByRole('spinbutton', { name: '동쪽 경도' }).fill('127.3');
    await control.getByRole('spinbutton', { name: '남쪽 위도' }).fill('37.3');
    await control.getByRole('spinbutton', { name: '북쪽 위도' }).fill('37.8');
    await control.getByRole('button', { name: '좌표로 이동', exact: true }).click();
    await expect(page.getByText('표시 영역: 좌표 지정')).toBeVisible();
    const savedCoordinateRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      if (request.method() !== 'PUT' || !/^\/api\/v1\/charts\/\d+$/.test(url.pathname)) return false;
      return request.postDataJSON().options?.map?.viewport?.mode === 'coordinates';
    });
    await topBar.getByRole('button', { name: '저장', exact: true }).click();
    const request = await savedCoordinateRequest;
    expect(request.postDataJSON().options.map.viewport).toEqual({
      mode: 'coordinates',
      bounds: { west: 126.7, east: 127.3, south: 37.3, north: 37.8 },
    });
  });
});
