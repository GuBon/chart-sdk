// 지도(map) 차트용 GeoJSON 지연 등록.
// 서버가 조립한 option 에 `series[].type==='map'` 이 있으면, 그 map 이름의 GeoJSON 을
// `${apiBase}/maps/{name}.json` 에서 1회 fetch 해 echarts.registerMap 한다(방식 A: SDK 는 데이터만 가져와 등록).
// 이미 등록됐거나 진행 중이면 재요청하지 않는다(모듈 캐시).
import * as echarts from 'echarts/core';
import { applyMapViewport, takeEmbeddedMaps } from '@chartsdk/chart-options/geo';

const inFlight = new Map<string, Promise<void>>();

/** option 에서 지도 이름 목록(중복 제거) — map 시리즈의 `map` + geo 컴포넌트(option.geo)의 `map`. */
function mapNames(option: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const rawSeries = (option as { series?: unknown }).series;
  for (const s of Array.isArray(rawSeries) ? rawSeries : rawSeries ? [rawSeries] : []) {
    if (s && typeof s === 'object') {
      const series = s as { type?: unknown; map?: unknown };
      if (series.type === 'map' && typeof series.map === 'string' && series.map) names.add(series.map);
    }
  }
  // 지도 포인트(scatter on geo)는 option.geo 가 지도를 참조한다.
  const rawGeo = (option as { geo?: unknown }).geo;
  for (const g of Array.isArray(rawGeo) ? rawGeo : rawGeo ? [rawGeo] : []) {
    if (g && typeof g === 'object') {
      const geo = g as { map?: unknown };
      if (typeof geo.map === 'string' && geo.map) names.add(geo.map);
    }
  }
  return [...names];
}

function registerOne(apiBase: string, name: string): Promise<void> {
  // 이미 등록돼 있으면(다른 차트가 먼저 등록) 즉시 완료.
  if (echarts.getMap(name)) return Promise.resolve();
  let p = inFlight.get(name);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${apiBase}/maps/${encodeURIComponent(name)}.json`);
      if (!res.ok) throw new Error(`map ${name} 로드 실패: ${res.status}`);
      echarts.registerMap(name, await res.json());
    })().catch((e) => {
      // 실패는 캐시하지 않는다 — 다음 렌더에서 재시도 가능(일시적 네트워크 오류 대응).
      inFlight.delete(name);
      throw e;
    });
    inFlight.set(name, p);
  }
  return p;
}

/** option 의 map 시리즈에 필요한 GeoJSON 을 모두 등록. map 차트가 없으면 즉시 반환. */
export async function ensureMapsRegistered(apiBase: string, option: Record<string, unknown>): Promise<void> {
  // 동적 DB Polygon 지도는 option에 GeoJSON이 함께 온다. 먼저 등록하고 내부 메타데이터는 setOption 전에 제거한다.
  for (const embedded of takeEmbeddedMaps(option)) {
    if (!echarts.getMap(embedded.name)) echarts.registerMap(embedded.name, embedded.geoJSON as never);
  }
  await Promise.all(mapNames(option).map((n) => registerOne(apiBase, n)));
  applyMapViewport(option, (name) => echarts.getMap(name));
}
