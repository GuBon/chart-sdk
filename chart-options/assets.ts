/**
 * 브라우저에 장기 캐시되는 SDK 정적 자산 계약.
 * 폰트 또는 기본 GeoJSON 내용이 바뀌면 값을 올려 새 URL을 만들고 이전 캐시와 분리한다.
 */
export const CHART_STATIC_ASSET_VERSION = 'v1';

export function versionedAssetUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('v', CHART_STATIC_ASSET_VERSION);
  return parsed.href;
}
