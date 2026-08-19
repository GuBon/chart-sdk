import { describe, expect, it } from 'vitest';
import { safeLoginNext } from './authRedirect';

describe('safeLoginNext', () => {
  const origin = 'https://charts.example';

  it('같은 origin 경로와 query/hash를 보존한다', () => {
    expect(safeLoginNext('/charts/3?q=a#preview', origin)).toBe('/charts/3?q=a#preview');
  });

  it('외부·scheme-relative·backslash 우회를 거부한다', () => {
    expect(safeLoginNext('https://evil.example/x', origin)).toBe('/');
    expect(safeLoginNext('//evil.example/x', origin)).toBe('/');
    expect(safeLoginNext('\\\\evil.example/x', origin)).toBe('/');
    expect(safeLoginNext('javascript:alert(1)', origin)).toBe('/');
  });
});
