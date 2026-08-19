import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_INVALID_EVENT, ApiError, apiErrorMessage, apiFieldError, clearCsrfToken, currentAuthGeneration, request,
} from './client';

const csrfResponse = () => ({
  ok: true, status: 200, text: async () => JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 't' }),
});
const unauthorizedResponse = () => ({
  ok: false, status: 401, text: async () => JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: '로그인 필요' } }),
});
/** 호출 측이 resolve 시점을 쥐는 fetch 응답. */
function deferredResponse<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('Admin API client cache policy', () => {
  afterEach(() => {
    clearCsrfToken();
    vi.unstubAllGlobals();
  });

  it('서버 결과 캐시 정책을 브라우저 HTTP 캐시가 우회하지 않게 no-store로 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ charts: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await request('/charts');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/charts'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it.each([204, 205, 200])('상태 %s의 빈 성공 본문을 undefined로 처리한다', async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'test-token' }),
      })
      .mockResolvedValueOnce({ ok: true, status, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(request<void>('/empty', { method: 'DELETE' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/v1/empty'),
      expect.objectContaining({ credentials: 'include' }),
    );
    const headers = fetchMock.mock.calls[1][1]?.headers as Headers;
    expect(headers.get('X-CSRF-TOKEN')).toBe('test-token');
  });

  it('CSRF 만료 mutation은 새 토큰으로 정확히 한 번 재시도한다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'old' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => JSON.stringify({ error: { code: 'CSRF_INVALID', message: '만료' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'new' }) })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(request<void>('/mutation', { method: 'PATCH', body: { active: false } })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((fetchMock.mock.calls[1][1]?.headers as Headers).get('X-CSRF-TOKEN')).toBe('old');
    expect((fetchMock.mock.calls[3][1]?.headers as Headers).get('X-CSRF-TOKEN')).toBe('new');
  });

  it('세션 401을 인증 상태 무효화 이벤트로 알린다', async () => {
    vi.stubGlobal('window', new EventTarget());
    const listener = vi.fn();
    window.addEventListener(AUTH_INVALID_EVENT, listener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { code: 'SESSION_EXPIRED', message: '만료' } }),
    }));

    await expect(request('/charts')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_INVALID_EVENT, listener);
  });

  it('로그인 전에 시작된 /auth/me 의 401 은 로그인 뒤 도착해도 세션을 무효화하지 않는다', async () => {
    vi.stubGlobal('window', new EventTarget());
    const listener = vi.fn();
    window.addEventListener(AUTH_INVALID_EVENT, listener);
    const slowMe = deferredResponse<ReturnType<typeof unauthorizedResponse>>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(slowMe.promise)                                   // 부팅 시 /auth/me (느림)
      .mockResolvedValueOnce(csrfResponse())                                 // 로그인 전 CSRF
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ id: 1 }) }); // /auth/login
    vi.stubGlobal('fetch', fetchMock);

    const generationBefore = currentAuthGeneration();
    const me = request('/auth/me');
    await request('/auth/login', { method: 'POST', body: { username: 'u', password: 'p' } });
    expect(currentAuthGeneration()).toBe(generationBefore + 1);

    slowMe.resolve(unauthorizedResponse());
    await expect(me).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_INVALID_EVENT, listener);
  });

  it('로그인 뒤의 GET 은 이전 세대에서 진행 중이던 같은 경로 요청을 공유하지 않는다', async () => {
    vi.stubGlobal('window', new EventTarget());
    const slowMe = deferredResponse<ReturnType<typeof unauthorizedResponse>>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(slowMe.promise)
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ id: 1 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ id: 1, username: 'u' }) });
    vi.stubGlobal('fetch', fetchMock);

    const staleMe = request('/auth/me');
    await request('/auth/login', { method: 'POST', body: { username: 'u', password: 'p' } });
    const freshMe = request<{ username: string }>('/auth/me');
    expect(freshMe).not.toBe(staleMe);
    await expect(freshMe).resolves.toEqual({ id: 1, username: 'u' });
    slowMe.resolve(unauthorizedResponse());
    await expect(staleMe).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
