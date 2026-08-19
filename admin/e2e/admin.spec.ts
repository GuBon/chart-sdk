import { expect, test } from '@playwright/test';

test('관리자는 사용자 현황과 역할 변경을 관리한다', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '사용자 관리' })).toBeVisible();
  await page.getByRole('link', { name: '이서현' }).click();
  await expect(page.getByRole('heading', { name: '이서현' })).toBeVisible();
  await page.getByRole('button', { name: '관리자로 변경' }).click();
  const dialog = page.getByRole('dialog', { name: '변경 확인' });
  await dialog.getByRole('button', { name: '변경', exact: true }).click();
  await expect(page.getByRole('button', { name: '일반 사용자로 변경' })).toBeVisible();
  await expect(page.getByText('차트별 임베드 키 현황')).toBeVisible();
});

test('관리자의 차트 목록에는 모든 사용자의 차트가 보이고 타인 차트는 읽기 전용으로 연다', async ({ page }) => {
  await page.goto('/');
  // 내 차트(월별 매출)는 평소처럼 편집·임베드, 타인 차트(부서별 지출 · 이서현)는 열기만 — 복제·삭제·임베드 없음.
  const mine = page.getByRole('article').filter({ hasText: '월별 매출' });
  await expect(mine.getByRole('link', { name: '편집' })).toBeVisible();
  const others = page.getByRole('article').filter({ hasText: '부서별 지출' });
  await expect(others.getByText('이서현 · 읽기 전용')).toBeVisible();
  await expect(others.getByRole('button', { name: '임베드' })).toHaveCount(0);
  await expect(others.getByRole('button', { name: '부서별 지출 삭제' })).toHaveCount(0);
  await others.getByRole('link', { name: '열기' }).click();
  await expect(page).toHaveURL(/\/admin\/charts\/19$/);
  await expect(page.getByText('관리자 읽기 전용')).toBeVisible();
  await expect(page.getByRole('heading', { name: '부서별 지출' })).toBeVisible();
});

test('관리자는 차트 검색으로 소유자도 찾고, 읽기 전용 상세는 저장 스냅샷만 그린다', async ({ page }) => {
  // 관리자 페이지에는 별도 전체 차트 탭이 없다 — 전체 목록·소유자 검색은 일반 목록이 담당한다.
  await page.goto('/admin/users');
  await expect(page.getByRole('link', { name: '전체 차트' })).toHaveCount(0);

  await page.goto('/');
  // 검색 규칙은 역할과 무관하게 하나 — 차트 이름·설명·소유자(아이디·표시 이름·숫자 id).
  const search = page.getByRole('textbox', { name: '차트 검색' });
  await expect(search).toHaveAttribute('placeholder', '차트 검색 (차트 이름, 설명, 소유자)');
  await search.fill('lee.sh');
  await expect(page.locator('[data-testid="chart-card-name"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="chart-card-name"]')).toHaveText('부서별 지출');
  await search.fill('8');
  await expect(page.locator('[data-testid="chart-card-name"]')).toHaveText(['부서별 지출']);

  // 읽기 전용 상세: 저장 스냅샷이 있는 차트는 캔버스가 그려지고 편집 버튼은 없다.
  await page.goto('/admin/charts/12');
  await expect(page.getByText('관리자 읽기 전용')).toBeVisible();
  await expect(page.getByRole('heading', { name: '월별 매출' })).toBeVisible();
  await expect(page.getByRole('link', { name: '차트 목록' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('button', { name: '저장' })).toHaveCount(0);
  await expect(page.locator('[data-testid="chart-preview"] canvas').first()).toBeVisible();

  // 관리자 미리보기는 저장 스냅샷 전용 — live 차트(시드 24 '월별 순이익')는 고객 DB 를 조회하지 않고 안내만 보인다.
  await page.goto('/admin/charts/24');
  await expect(page.getByRole('heading', { name: '월별 순이익' })).toBeVisible();
  await expect(page.getByText('저장된 미리보기 스냅샷이 없습니다. 관리자 화면은 고객 데이터베이스를 조회하지 않습니다.')).toBeVisible();
  await expect(page.locator('[data-testid="chart-preview"] canvas')).toHaveCount(0);
});
