import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// echarts/core 의 getMap·registerMap 만 mock. 모듈 캐시(inFlight)가 테스트 간 새도록 resetModules + 동적 import.
const ec = vi.hoisted(() => ({ getMap: vi.fn(), registerMap: vi.fn() }));
vi.mock('echarts/core', () => ({ getMap: ec.getMap, registerMap: ec.registerMap }));

const GEO = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: '서울특별시' }, geometry: { type: 'Polygon', coordinates: [[[126.8, 37.4], [127.2, 37.4], [127.2, 37.8], [126.8, 37.8], [126.8, 37.4]]] } },
    { type: 'Feature', properties: { name: '부산광역시' }, geometry: { type: 'Polygon', coordinates: [[[128.8, 34.9], [129.3, 34.9], [129.3, 35.4], [128.8, 35.4], [128.8, 34.9]]] } },
  ],
};

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
    expect(fetch).toHaveBeenCalledWith('http://api/maps/kr-sido.json?v=v1');
    expect(ec.registerMap).toHaveBeenCalledWith('kr-sido', GEO);
  });

  it('option.geo(지도 포인트)가 참조하는 지도도 등록한다', async () => {
    const { ensureMapsRegistered } = await import('./geo');
    await ensureMapsRegistered('http://api', {
      geo: { map: 'kr-sigungu' },
      series: [{ type: 'scatter', coordinateSystem: 'geo' }],
    });
    expect(fetch).toHaveBeenCalledWith('http://api/maps/kr-sigungu.json?v=v1');
    expect(ec.registerMap).toHaveBeenCalledWith('kr-sigungu', GEO);
  });

  it('option에 포함된 동적 Polygon GeoJSON을 등록하고 내부 메타데이터를 제거한다', async () => {
    const { ensureMapsRegistered } = await import('./geo');
    ec.getMap.mockReturnValueOnce(undefined).mockReturnValueOnce({});
    const dynamic = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Polygon', coordinates: [] } }] };
    const option: Record<string, unknown> = {
      __chartsdkMaps: [{ name: 'chartsdk-dynamic-1234', geoJSON: dynamic }],
      series: [{ type: 'map', map: 'chartsdk-dynamic-1234' }],
    };

    await ensureMapsRegistered('http://api', option);

    expect(ec.registerMap).toHaveBeenCalledWith('chartsdk-dynamic-1234', dynamic);
    expect(fetch).not.toHaveBeenCalled();
    expect(option.__chartsdkMaps).toBeUndefined();
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

  it('현재 데이터의 Polygon 지역 경계를 boundingCoords로 적용하고 내부 설정을 제거한다', async () => {
    ec.getMap.mockReturnValue({ geoJSON: GEO });
    const { ensureMapsRegistered } = await import('./geo');
    const option: Record<string, unknown> = {
      __chartsdkMapViewport: { mode: 'regions', regionKeys: ['서울특별시'] },
      series: [{ type: 'map', map: 'kr-sido', data: [{ name: '서울특별시', value: 10 }, { name: '부산광역시', value: 20 }] }],
    };

    await ensureMapsRegistered('http://api', option);

    const series = (option.series as Array<Record<string, unknown>>)[0];
    const bounds = series.boundingCoords as number[][];
    expect(bounds[0][0]).toBeCloseTo(126.768);
    expect(bounds[0][1]).toBeCloseTo(37.832);
    expect(bounds[1][0]).toBeCloseTo(127.232);
    expect(bounds[1][1]).toBeCloseTo(37.368);
    expect(option.__chartsdkMapViewport).toBeUndefined();
  });

  it('여러 map 계열에 흩어진 지역을 모두 합쳐 데이터 경계를 계산한다', async () => {
    ec.getMap.mockReturnValue({ geoJSON: GEO });
    const { ensureMapsRegistered } = await import('./geo');
    const option: Record<string, unknown> = {
      __chartsdkMapViewport: { mode: 'data' },
      series: [
        { type: 'map', map: 'kr-sido', name: '온라인', data: [{ name: '서울특별시', value: 10 }] },
        { type: 'map', map: 'kr-sido', name: '매장', data: [{ name: '부산광역시', value: 20 }] },
      ],
    };

    await ensureMapsRegistered('http://api', option);

    for (const series of option.series as Array<Record<string, any>>) {
      expect(series.boundingCoords[0][0]).toBeCloseTo(126.6);
      expect(series.boundingCoords[0][1]).toBeCloseTo(38.032);
      expect(series.boundingCoords[1][0]).toBeCloseTo(129.5);
      expect(series.boundingCoords[1][1]).toBeCloseTo(34.668);
    }
  });

  it('지도 포인트 데이터 전체 경계를 geo boundingCoords로 적용한다', async () => {
    ec.getMap.mockReturnValue({ geoJSON: GEO });
    const { ensureMapsRegistered } = await import('./geo');
    const option: Record<string, unknown> = {
      __chartsdkMapViewport: { mode: 'data' },
      geo: { map: 'kr-sido' },
      series: [{ type: 'scatter', coordinateSystem: 'geo', data: [[126.9, 37.5], [129.1, 35.1]] }],
    };

    await ensureMapsRegistered('http://api', option);

    expect((option.geo as Record<string, unknown>).boundingCoords).toEqual([[126.724, 37.692], [129.27599999999998, 34.908]]);
  });

  it('좌표 지정 경계는 여백 없이 그대로 적용한다', async () => {
    ec.getMap.mockReturnValue({ geoJSON: GEO });
    const { ensureMapsRegistered } = await import('./geo');
    const option: Record<string, unknown> = {
      __chartsdkMapViewport: { mode: 'coordinates', bounds: { west: 126.7, east: 127.3, south: 37.3, north: 37.8 } },
      geo: { map: 'kr-sido' },
      series: [{ type: 'scatter', coordinateSystem: 'geo', data: [[129.1, 35.1]] }],
    };

    await ensureMapsRegistered('http://api', option);

    expect((option.geo as Record<string, unknown>).boundingCoords).toEqual([[126.7, 37.8], [127.3, 37.3]]);
  });

  it('지역 선택 방식으로만 전환하면 기존 화면 경계를 그대로 유지한다', async () => {
    ec.getMap.mockReturnValue({ geoJSON: GEO });
    const { ensureMapsRegistered } = await import('./geo');
    const option: Record<string, unknown> = {
      __chartsdkMapViewport: {
        mode: 'regions',
        regionKeys: [],
        bounds: { west: 126.7, east: 127.3, south: 37.3, north: 37.8 },
      },
      series: [{ type: 'map', map: 'kr-sido', data: [{ name: '서울특별시', value: 10 }] }],
    };

    await ensureMapsRegistered('http://api', option);

    expect((option.series as Array<Record<string, unknown>>)[0].boundingCoords)
      .toEqual([[126.7, 37.8], [127.3, 37.3]]);
    expect(option.__chartsdkMapViewport).toBeUndefined();
  });
});
