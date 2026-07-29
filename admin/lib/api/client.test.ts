import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './client';

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
