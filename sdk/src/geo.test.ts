import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// echarts/core 의 getMap·registerMap 만 mock. 모듈 캐시(inFlight)가 테스트 간 새도록 resetModules + 동적 import.
const ec = vi.hoisted(() => ({ getMap: vi.fn(), registerMap: vi.fn() }));
vi.mock('echarts/core', () => ({ getMap: ec.getMap, registerMap: ec.registerMap }));

const GEO = { type: 'FeatureCollection', features: [] };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  ec.getMap.mockReturnValue(undefined); // 기본: 미등록
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => GEO })));
});
afterEach(() => vi.unstubAllGlobals());

describe('ensureMapsRegistered', () => {
  it('map 시리즈가 없으면 fetch·registerMap 하지 않는다', async () => {
    const { ensureMapsRegistered } = await import('./geo');
    await ensureMapsRegistered('http://api', { series: [{ type: 'bar' }] });
    expect(fetch).not.toHaveBeenCalled();
    expect(ec.registerMap).not.toHaveBeenCalled();
  });

  it('map 시리즈의 GeoJSON 을 fetch 해 registerMap 한다', async () => {
    const { ensureMapsRegistered } = await import('./geo');
    await ensureMapsRegistered('http://api', { series: [{ type: 'map', map: 'kr-sido' }] });
    expect(fetch).toHaveBeenCalledWith('http://api/maps/kr-sido.json');
    expect(ec.registerMap).toHaveBeenCalledWith('kr-sido', GEO);
  });

  it('option.geo(지도 포인트)가 참조하는 지도도 등록한다', async () => {
    const { ensureMapsRegistered } = await import('./geo');
    await ensureMapsRegistered('http://api', {
      geo: { map: 'kr-sigungu' },
      series: [{ type: 'scatter', coordinateSystem: 'geo' }],
    });
    expect(fetch).toHaveBeenCalledWith('http://api/maps/kr-sigungu.json');
    expect(ec.registerMap).toHaveBeenCalledWith('kr-sigungu', GEO);
  });

  it('한 option 내 같은 지도를 중복 요청하지 않는다(캐시)', async () => {
    const { ensureMapsRegistered } = await import('./geo');
    await ensureMapsRegistered('http://api', { series: [{ type: 'map', map: 'kr-sido' }, { type: 'map', map: 'kr-sido' }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('이미 등록된 지도는 다시 fetch 하지 않는다', async () => {
    ec.getMap.mockReturnValue({}); // 등록됨
    const { ensureMapsRegistered } = await import('./geo');
    await ensureMapsRegistered('http://api', { series: [{ type: 'map', map: 'kr-sido' }] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetch 실패는 캐시하지 않아 다음 렌더에서 재시도된다', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 500 });
    const { ensureMapsRegistered } = await import('./geo');
    const opt = { series: [{ type: 'map', map: 'kr-sido' }] };
    await expect(ensureMapsRegistered('http://api', opt)).rejects.toThrow();
    await ensureMapsRegistered('http://api', opt); // 재시도 성공
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ec.registerMap).toHaveBeenCalledTimes(1);
  });
});
