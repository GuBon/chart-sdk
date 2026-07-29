import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchChartOption } from './api';

// fetch 를 stub 해 URL·헤더·에러 처리를 검증(네트워크 없음).
describe('fetchChartOption', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('chartId·token 으로 인증 요청 URL·헤더를 조립한다', async () => {
    const json = { chartId: 12, computedAt: '2026-07-06T12:00:00Z', option: { series: [] } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => json });
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchChartOption('http://api.test', '12', 'TKN');
    expect(out).toEqual(json);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/v1/charts/data?chartId=12');
    expect(init.cache).toBe('no-store');
    expect(init.headers.Authorization).toBe('Bearer TKN');
  });

  it('chartId 를 URL 인코딩한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await fetchChartOption('http://api.test', 'a b/c', 'T');
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/api/v1/charts/data?chartId=a%20b%2Fc');
  });

  it('ok 응답의 JSON 을 그대로 반환한다', async () => {
    const json = { chartId: 5, computedAt: 'x', option: { a: 1 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => json }));
    expect(await fetchChartOption('http://a', '5', 't')).toEqual(json);
  });

  it('!ok 응답은 상태코드를 담아 throw 한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(fetchChartOption('http://a', '9', 'bad')).rejects.toThrow('401');
  });
});
