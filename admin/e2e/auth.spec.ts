import { expect, test } from '@playwright/test';

test('회원가입·로그인·보호 경로·로그아웃 흐름', async ({ page }) => {
  // MSW 기본 관리자 세션에서 로그아웃해 익명 상태를 만든다.
  await page.goto('/');
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/datasources');
  await expect(page).toHaveURL(/\/login\?next=%2Fdatasources$/);

  await page.goto('/signup');
  await page.getByLabel('아이디').fill('new-chart-user');
  await page.getByLabel(/비밀번호 \(최소 15자\)/).fill('long password for charts');
  await page.getByLabel('비밀번호 확인').fill('long password for charts');
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?registered=1$/);

  await page.getByLabel('아이디').fill('new-chart-user');
  await page.getByLabel('비밀번호').fill('long password for charts');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('header span[title="kim.gy"]')).toHaveText('김건영');

  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
