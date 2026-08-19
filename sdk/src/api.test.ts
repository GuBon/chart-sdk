import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMBED_MAP_REQUEST_TIMEOUT_MS,
  EMBED_REQUEST_TIMEOUT_MS,
  fetchChartOption,
  resolveEmbedMapTimeoutMs,
  resolveEmbedTimeoutMs,
} from './api';

// fetch 를 stub 해 URL·헤더·에러 처리를 검증(네트워크 없음).
describe('fetchChartOption', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('임베드 키를 Bearer 헤더로만 보낸다 — URL 에 chartId 등 차트 식별자가 없다', async () => {
    const json = { chartId: 12, computedAt: '2026-07-06T12:00:00Z', option: { series: [] } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => json });
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchChartOption('http://api.test', 'cek1_101_sig');
    expect(out).toEqual(json);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/v1/charts/data');
    expect(url).not.toContain('chartId');
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
    expect(init.headers.Authorization).toBe('Bearer cek1_101_sig');
  });

  it('ok 응답의 JSON 을 그대로 반환한다', async () => {
    const json = { chartId: 5, computedAt: 'x', option: { a: 1 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => json }));
    expect(await fetchChartOption('http://a', 'cek1_5_sig')).toEqual(json);
  });

  it('!ok 응답은 상태코드를 담아 throw 한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(fetchChartOption('http://a', 'bad-key')).rejects.toThrow('401');
  });

  it('타임아웃 시 요청 signal 을 abort 한다(무한 대기 hang 방지)', async () => {
    vi.useFakeTimers();
    try {
      let captured: AbortSignal | undefined;
      const fetchMock = vi.fn((_url: string, init: RequestInit) => {
        captured = init.signal ?? undefined;
        return new Promise<never>(() => {}); // 응답하지 않는 서버(hang)
      });
      vi.stubGlobal('fetch', fetchMock);

      void fetchChartOption('http://a', 'cek1_9_sig', 5000).catch(() => {});
      expect(captured?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(captured?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('resolveEmbedTimeoutMs', () => {
  const script = (timeoutMs?: string) => ({ dataset: { timeoutMs } });

  it('전역 재정의 > script[data-timeout-ms] > 기본값 순으로 해석한다', () => {
    expect(resolveEmbedTimeoutMs(script('70000'), 90_000)).toBe(90_000);
    expect(resolveEmbedTimeoutMs(script('70000'))).toBe(70_000);
    expect(resolveEmbedTimeoutMs(script(), undefined)).toBe(EMBED_REQUEST_TIMEOUT_MS);
    expect(resolveEmbedTimeoutMs(null)).toBe(EMBED_REQUEST_TIMEOUT_MS);
  });

  it('유효하지 않은 값(숫자 아님·0·음수·빈 문자열)은 무시하고 다음 후보로 넘어간다', () => {
    expect(resolveEmbedTimeoutMs(script('abc'))).toBe(EMBED_REQUEST_TIMEOUT_MS);
    expect(resolveEmbedTimeoutMs(script('70000'), -1)).toBe(70_000);
    expect(resolveEmbedTimeoutMs(script('70000'), 0)).toBe(70_000);
    expect(resolveEmbedTimeoutMs(script(''), Number.NaN)).toBe(EMBED_REQUEST_TIMEOUT_MS);
  });

  it('기본값은 서버 합성 최악치(refresh 대기+표본 빌드 대기+표본 쿼리+본 쿼리 ≈ 130s)보다 크다', () => {
    const composedWorstCaseMs = (35 + 35 + 30 + 30) * 1000;
    expect(EMBED_REQUEST_TIMEOUT_MS).toBeGreaterThan(composedWorstCaseMs);
  });
});

describe('resolveEmbedMapTimeoutMs', () => {
  const script = (mapTimeoutMs?: string) => ({ dataset: { mapTimeoutMs } });

  it('전역 > script 속성 > 지도 기본값 순으로 선택한다', () => {
    expect(resolveEmbedMapTimeoutMs(script('12000'), 9_000)).toBe(9_000);
    expect(resolveEmbedMapTimeoutMs(script('12000'))).toBe(12_000);
    expect(resolveEmbedMapTimeoutMs(null)).toBe(EMBED_MAP_REQUEST_TIMEOUT_MS);
  });

  it('유효하지 않은 재정의는 무시한다', () => {
    expect(resolveEmbedMapTimeoutMs(script('bad'), -1)).toBe(EMBED_MAP_REQUEST_TIMEOUT_MS);
  });
});
