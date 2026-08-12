import { describe, expect, it } from 'vitest';
import { parseBoundedInteger } from './numericValidation';

describe('parseBoundedInteger', () => {
  it('범위 안의 정수만 반환한다', () => {
    expect(parseBoundedInteger('5432', 1, 65535)).toBe(5432);
    expect(parseBoundedInteger(' 5 ', 1, 50)).toBe(5);
  });

  it.each(['', ' ', '0', '-1', '1.5', '1e3', '65536', 'not-a-number'])(
    '잘못된 입력 %j을 기본값으로 바꾸지 않고 거부한다',
    (value) => {
      expect(parseBoundedInteger(value, 1, 65535)).toBeNull();
    },
  );
});
