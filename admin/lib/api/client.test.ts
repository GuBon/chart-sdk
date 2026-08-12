import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiErrorMessage, apiFieldError, request } from './client';

describe('Admin API client cache policy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('서버 결과 캐시 정책을 브라우저 HTTP 캐시가 우회하지 않게 no-store로 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ charts: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await request('/charts');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/charts'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});

describe('Admin API error presentation', () => {
  it('5xx 요청 ID를 사용자가 지원팀에 전달할 수 있게 메시지에 포함한다', () => {
    const error = new ApiError('INTERNAL_ERROR', '서버 오류가 발생했습니다.', 500, undefined, 'req-123');

    expect(apiErrorMessage(error, 'fallback')).toBe('서버 오류가 발생했습니다. (요청 ID: req-123)');
  });

  it('4xx에는 요청 ID를 덧붙이지 않고 필드 오류를 제공한다', () => {
    const error = new ApiError(
      'VALIDATION_FAILED',
      '입력값을 확인하세요.',
      400,
      { expiresInDays: '1~3650일 범위여야 합니다.' },
      'req-400',
    );

    expect(apiErrorMessage(error, 'fallback')).toBe('입력값을 확인하세요.');
    expect(apiFieldError(error, 'expiresInDays')).toBe('1~3650일 범위여야 합니다.');
    expect(apiFieldError(error, 'username')).toBeUndefined();
  });

  it('API 오류가 아니면 화면별 대체 메시지를 사용한다', () => {
    expect(apiErrorMessage(new Error('network'), '연결에 실패했습니다.')).toBe('연결에 실패했습니다.');
  });
});
