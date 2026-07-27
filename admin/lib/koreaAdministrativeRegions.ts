import sidoGeoJson from '@chartsdk/chart-options/maps/kr-sido.json';
import sigunguGeoJson from '@chartsdk/chart-options/maps/kr-sigungu.json';
import {
  normalizeMapBounds,
  normalizeMapViewport,
  type MapBounds,
  type MapViewport,
} from '@chartsdk/chart-options/geo';

export interface AdministrativeRegionSelection {
  province: string;
  city: string;
  county: string;
  district: string;
}

export interface AdministrativeRegionOption {
  value: string;
  label: string;
}

export interface AdministrativeRegionOptions {
  provinces: AdministrativeRegionOption[];
  cities: AdministrativeRegionOption[];
  counties: AdministrativeRegionOption[];
  districts: AdministrativeRegionOption[];
}

const EMPTY_SELECTION: AdministrativeRegionSelection = {
  province: '',
  city: '',
  county: '',
  district: '',
};

interface BoundaryFeature {
  properties?: {
    code?: string | number;
    name?: string;
    aliases?: unknown;
  };
  geometry?: {
    coordinates?: unknown;
  };
}

interface ProvinceBoundary {
  code: string;
  name: string;
  key: string;
  aliases: string[];
  bounds: MapBounds;
}

interface ChildBoundary {
  province: string;
  name: string;
  key: string;
  sourceKey: string;
  aliases: string[];
  bounds: MapBounds;
}

interface CityBoundary extends ChildBoundary {
  districtBounds: MapBounds[];
}

interface DistrictBoundary extends ChildBoundary {
  city: string;
}

const provinces = buildProvinces(featuresOf(sidoGeoJson));
const provinceByName = new Map(provinces.map((province) => [province.name, province]));
const cities = new Map<string, CityBoundary>();
const counties: ChildBoundary[] = [];
const districts: DistrictBoundary[] = [];

for (const feature of featuresOf(sigunguGeoJson)) {
  const code = String(feature.properties?.code ?? '');
  const sourceKey = String(feature.properties?.name ?? '').trim();
  const sourceAliases = aliasesOf(feature.properties?.aliases);
  const province = provinces.find((candidate) => code.startsWith(candidate.code));
  const bounds = boundsFromCoordinates(feature.geometry?.coordinates);
  if (!province || !sourceKey || !bounds) continue;

  const localName = sourceKey.startsWith(`${province.name} `)
    ? sourceKey.slice(province.name.length + 1).trim()
    : sourceKey;
  const cityDistrict = /^(.+?시)(.+구)$/.exec(localName);

  if (cityDistrict) {
    const cityName = cityDistrict[1].trim();
    const districtName = cityDistrict[2].trim();
    const cityKey = `${province.name} ${cityName}`;
    const cityAliases = sourceAliases.flatMap((alias) => (
      alias.endsWith(districtName) ? [alias.slice(0, -districtName.length).trim()] : []
    ));
    const existingCity = cities.get(cityKey);
    if (existingCity) {
      existingCity.bounds = mergeBounds(existingCity.bounds, bounds);
      existingCity.districtBounds.push(bounds);
      existingCity.aliases = [...new Set([...existingCity.aliases, ...cityAliases])];
    } else {
      cities.set(cityKey, {
        province: province.name,
        name: cityName,
        key: cityKey,
        sourceKey: cityKey,
        aliases: cityAliases,
        bounds,
        districtBounds: [bounds],
      });
    }
    districts.push({
      province: province.name,
      city: cityKey,
      name: districtName,
      key: `${cityKey} ${districtName}`,
      sourceKey,
      aliases: sourceAliases,
      bounds,
    });
    continue;
  }

  if (localName.endsWith('시')) {
    const key = `${province.name} ${localName}`;
    cities.set(key, {
      province: province.name,
      name: localName,
      key,
      sourceKey,
      aliases: sourceAliases,
      bounds,
      districtBounds: [],
    });
  } else if (localName.endsWith('군')) {
    counties.push({
      province: province.name,
      name: localName,
      key: `${province.name} ${localName}`,
      sourceKey,
      aliases: sourceAliases,
      bounds,
    });
  } else if (localName.endsWith('구')) {
    districts.push({
      province: province.name,
      city: '',
      name: localName,
      key: `${province.name} ${localName}`,
      sourceKey,
      aliases: sourceAliases,
      bounds,
    });
  }
}

const cityList = [...cities.values()];
const regionByKey = new Map<string, ProvinceBoundary | CityBoundary | ChildBoundary | DistrictBoundary>();
for (const region of [...provinces, ...cityList, ...counties, ...districts]) {
  regionByKey.set(region.key, region);
  for (const alias of region.aliases) regionByKey.set(alias, region);
  if ('sourceKey' in region) regionByKey.set(region.sourceKey, region);
}

export function administrativeRegionOptions(
  selection: AdministrativeRegionSelection,
): AdministrativeRegionOptions {
  const province = provinceByName.get(selection.province);
  if (!province) {
    return {
      provinces: provinces.map(toOption),
      cities: [],
      counties: [],
      districts: [],
    };
  }

  const provinceCities = cityList
    .filter((city) => city.province === province.name)
    .sort(compareRegionNames);
  const provinceCounties = counties
    .filter((county) => county.province === province.name)
    .sort(compareRegionNames);
  const provinceDistricts = districts
    .filter((district) => (
      district.province === province.name
      && (selection.city ? district.city === selection.city : district.city === '')
    ))
    .sort(compareRegionNames);

  return {
    provinces: provinces.map(toOption),
    cities: provinceCities.map(toOption),
    counties: provinceCounties.map(toOption),
    districts: provinceDistricts.map(toOption),
  };
}

export function administrativeRegionSelectionFromViewport(
  value: unknown,
): AdministrativeRegionSelection {
  const viewport = normalizeMapViewport(value);
  if (viewport.mode !== 'regions' || viewport.regionKeys.length === 0) return { ...EMPTY_SELECTION };

  const region = regionByKey.get(viewport.regionKeys[0]);
  if (!region) return { ...EMPTY_SELECTION };
  if (!('province' in region)) {
    return { ...EMPTY_SELECTION, province: region.name };
  }
  if ('city' in region) {
    return {
      ...EMPTY_SELECTION,
      province: region.province,
      city: region.city,
      district: region.key,
    };
  }
  if ('districtBounds' in region) {
    return {
      ...EMPTY_SELECTION,
      province: region.province,
      city: region.key,
    };
  }
  return {
    ...EMPTY_SELECTION,
    province: region.province,
    county: region.key,
  };
}

export function mapViewportForAdministrativeSelection(
  selection: AdministrativeRegionSelection,
): MapViewport {
  const province = provinceByName.get(selection.province);
  if (!province) return { mode: 'regions', regionKeys: [] };

  const district = regionByKey.get(selection.district);
  if (isDistrictInSelection(district, selection)) return regionViewport(district);

  const county = regionByKey.get(selection.county);
  if (isCountyInProvince(county, province.name)) return regionViewport(county);

  const city = regionByKey.get(selection.city);
  if (isCityInProvince(city, province.name)) return regionViewport(city);

  return regionViewport(province);
}

function buildProvinces(features: BoundaryFeature[]): ProvinceBoundary[] {
  return features.flatMap((feature) => {
    const code = String(feature.properties?.code ?? '');
    const name = String(feature.properties?.name ?? '').trim();
    const bounds = boundsFromCoordinates(feature.geometry?.coordinates);
    return code && name && bounds ? [{
      code,
      name,
      key: name,
      aliases: aliasesOf(feature.properties?.aliases),
      bounds,
    }] : [];
  }).sort((left, right) => Number(left.code) - Number(right.code));
}

function aliasesOf(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : [];
}

function featuresOf(value: unknown): BoundaryFeature[] {
  if (!value || typeof value !== 'object') return [];
  const features = (value as { features?: unknown }).features;
  return Array.isArray(features)
    ? features.filter((feature): feature is BoundaryFeature => !!feature && typeof feature === 'object')
    : [];
}

function toOption(region: ProvinceBoundary | ChildBoundary): AdministrativeRegionOption {
  return { value: region.key, label: region.name };
}

function compareRegionNames(left: ChildBoundary, right: ChildBoundary): number {
  return left.name.localeCompare(right.name, 'ko');
}

function regionViewport(region: ProvinceBoundary | ChildBoundary): MapViewport {
  return {
    mode: 'regions',
    regionKeys: [region.key],
    bounds: { ...region.bounds },
  };
}

function isCityInProvince(
  value: ProvinceBoundary | CityBoundary | ChildBoundary | DistrictBoundary | undefined,
  province: string,
): value is CityBoundary {
  return !!value && 'districtBounds' in value && value.province === province;
}

function isCountyInProvince(
  value: ProvinceBoundary | CityBoundary | ChildBoundary | DistrictBoundary | undefined,
  province: string,
): value is ChildBoundary {
  return !!value
    && 'province' in value
    && !('city' in value)
    && !('districtBounds' in value)
    && value.province === province;
}

function isDistrictInSelection(
  value: ProvinceBoundary | CityBoundary | ChildBoundary | DistrictBoundary | undefined,
  selection: AdministrativeRegionSelection,
): value is DistrictBoundary {
  return !!value
    && 'city' in value
    && value.province === selection.province
    && value.city === selection.city;
}

type BoundsAccumulator = MapBounds & { count: number };

function boundsFromCoordinates(value: unknown): MapBounds | null {
  const bounds: BoundsAccumulator = {
    west: Infinity,
    east: -Infinity,
    south: Infinity,
    north: -Infinity,
    count: 0,
  };
  visitCoordinates(value, bounds);
  if (bounds.count === 0) return null;
  return normalizeMapBounds(bounds);
}

function visitCoordinates(value: unknown, bounds: BoundsAccumulator): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    const [longitude, latitude] = value;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return;
    bounds.west = Math.min(bounds.west, longitude);
    bounds.east = Math.max(bounds.east, longitude);
    bounds.south = Math.min(bounds.south, latitude);
    bounds.north = Math.max(bounds.north, latitude);
    bounds.count += 1;
    return;
  }
  for (const child of value) visitCoordinates(child, bounds);
}

function mergeBounds(left: MapBounds, right: MapBounds): MapBounds {
  return {
    west: Math.min(left.west, right.west),
    east: Math.max(left.east, right.east),
    south: Math.min(left.south, right.south),
    north: Math.max(left.north, right.north),
  };
}
