#!/usr/bin/env node

/**
 * SGIS 2025 Q2 공식 경계와 행정안전부 최신 행정코드를 ECharts용 GeoJSON으로 변환한다.
 *
 * 사용 예:
 * node scripts/build-korea-maps.mjs \
 *   --sido-shp bnd_sido_00_2025_2Q.shp \
 *   --sigungu-shp bnd_sigungu_00_2025_2Q.shp \
 *   --dong-shp bnd_dong_00_2025_2Q.shp \
 *   --admin-codes KIKcd_H.20260720 \
 *   --effective-date 20260720 \
 *   --output-dir maps
 *
 * mapshaper 0.7.48을 npx로 실행한다. 원본 SHP는 SGIS TM 좌표계이며,
 * 결과는 WGS84·소수점 4자리·화면 표시용 간략화 GeoJSON이다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const required = ['sido-shp', 'sigungu-shp', 'dong-shp', 'admin-codes', 'effective-date', 'output-dir'];
for (const key of required) {
  if (!args[key]) throw new Error(`Missing --${key}`);
}
if (!/^\d{8}$/.test(args['effective-date'])) throw new Error('--effective-date must be YYYYMMDD');

const sourcePaths = {
  sido: resolve(args['sido-shp']),
  sigungu: resolve(args['sigungu-shp']),
  dong: resolve(args['dong-shp']),
  codes: resolve(args['admin-codes']),
};
const outputDir = resolve(args['output-dir']);
const workDir = mkdtempSync(join(tmpdir(), 'chartsdk-korea-maps-'));
const boundaryBaseDate = '20250630';
const effectiveDate = args['effective-date'];

const SOURCE_PROVINCES = {
  '11': '서울특별시',
  '21': '부산광역시',
  '22': '대구광역시',
  '23': '인천광역시',
  '24': '광주광역시',
  '25': '대전광역시',
  '26': '울산광역시',
  '29': '세종특별자치시',
  '31': '경기도',
  '32': '강원특별자치도',
  '33': '충청북도',
  '34': '충청남도',
  '35': '전북특별자치도',
  '36': '전라남도',
  '37': '경상북도',
  '38': '경상남도',
  '39': '제주특별자치도',
};

const TARGET_PROVINCE_BY_SOURCE = {
  '11': '서울특별시',
  '21': '부산광역시',
  '22': '대구광역시',
  '23': '인천광역시',
  '24': '전남광주통합특별시',
  '25': '대전광역시',
  '26': '울산광역시',
  '29': '세종특별자치시',
  '31': '경기도',
  '32': '강원특별자치도',
  '33': '충청북도',
  '34': '충청남도',
  '35': '전북특별자치도',
  '36': '전남광주통합특별시',
  '37': '경상북도',
  '38': '경상남도',
  '39': '제주특별자치도',
};

const INCHEON_GROUPS = {
  제물포구: new Set([
    '연안동', '신포동', '신흥동', '도원동', '율목동', '동인천동', '개항동',
    '만석동', '화수1·화평동', '화수2동', '송현1·2동', '송현3동',
    '송림1동', '송림2동', '송림3·5동', '송림4동', '송림6동', '금창동',
  ]),
  영종구: new Set(['용유동', '운서동', '영종동', '영종1동', '영종2동']),
  서해구: new Set([
    '검암경서동', '연희동', '청라1동', '청라2동', '청라3동',
    '가정1동', '가정2동', '가정3동', '신현원창동',
    '석남1동', '석남2동', '석남3동', '가좌1동', '가좌2동', '가좌3동', '가좌4동',
  ]),
  검단구: new Set([
    '검단동', '불로대곡동', '원당동', '당하동', '오류왕길동', '마전동', '아라동',
  ]),
};

try {
  const converted = {
    sido: join(workDir, 'sido-source.json'),
    sigungu: join(workDir, 'sigungu-source.json'),
    dong: join(workDir, 'incheon-dong-source.json'),
  };
  runMapshaper([
    sourcePaths.sido,
    '-proj', 'wgs84',
    '-simplify', '0.15%', 'keep-shapes',
    '-o', 'force', 'format=geojson', 'precision=0.0001', converted.sido,
  ]);
  runMapshaper([
    sourcePaths.sigungu,
    '-proj', 'wgs84',
    '-simplify', '0.35%', 'keep-shapes',
    '-o', 'force', 'format=geojson', 'precision=0.0001', converted.sigungu,
  ]);
  runMapshaper([
    sourcePaths.dong,
    '-filter', "ADM_CD.substr(0,2) == '23'",
    '-proj', 'wgs84',
    '-simplify', '0.5%', 'keep-shapes',
    '-o', 'force', 'format=geojson', 'precision=0.0001', converted.dong,
  ]);

  const official = parseOfficialCodes(sourcePaths.codes);
  const sourceSido = readGeoJson(converted.sido);
  const sourceSigungu = readGeoJson(converted.sigungu);
  const sourceDong = readGeoJson(converted.dong);
  assertFeatureCount(sourceSido, 17, 'SGIS sido');
  assertFeatureCount(sourceSigungu, 252, 'SGIS sigungu');

  const stagedSido = stageSido(sourceSido, official);
  const stagedSigungu = stageSigungu(sourceSigungu, sourceDong, official);
  const stagedSidoPath = join(workDir, 'sido-staged.json');
  const stagedSigunguPath = join(workDir, 'sigungu-staged.json');
  writeJson(stagedSidoPath, stagedSido);
  writeJson(stagedSigunguPath, stagedSigungu);

  const dissolvedSidoPath = join(workDir, 'sido-dissolved.json');
  const dissolvedSigunguPath = join(workDir, 'sigungu-dissolved.json');
  dissolve(stagedSidoPath, dissolvedSidoPath);
  dissolve(stagedSigunguPath, dissolvedSigunguPath);

  const finalSido = finalize(readGeoJson(dissolvedSidoPath), provinceAliases);
  const finalSigungu = finalize(readGeoJson(dissolvedSigunguPath), sigunguAliases);
  assertFeatureCount(finalSido, 16, 'final sido');
  assertFeatureCount(finalSigungu, 253, 'final sigungu');
  assertUnique(finalSido, 'sido');
  assertUnique(finalSigungu, 'sigungu');

  writeJson(join(outputDir, 'kr-sido.json'), finalSido);
  writeJson(join(outputDir, 'kr-sigungu.json'), finalSigungu);
  console.log(`Generated ${finalSido.features.length} provinces and ${finalSigungu.features.length} municipalities.`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

function stageSido(source, official) {
  return {
    type: 'FeatureCollection',
    features: source.features.map((feature) => {
      const sourceCode = String(feature.properties.SIDO_CD);
      const name = TARGET_PROVINCE_BY_SOURCE[sourceCode];
      const code = official.provinceByName.get(name);
      if (!name || !code) throw new Error(`Unknown province source code: ${sourceCode}`);
      return stagedFeature(feature.geometry, code, name);
    }),
  };
}

function stageSigungu(source, dongSource, official) {
  const features = [];
  for (const feature of source.features) {
    const sourceCode = String(feature.properties.SIGUNGU_CD);
    const sourceProvinceCode = sourceCode.slice(0, 2);
    const sourceProvince = SOURCE_PROVINCES[sourceProvinceCode];
    const province = TARGET_PROVINCE_BY_SOURCE[sourceProvinceCode];
    const localName = String(feature.properties.SIGUNGU_NM).trim();
    if (!sourceProvince || !province || !localName) throw new Error(`Unknown sigungu: ${sourceCode}`);
    if (sourceProvinceCode === '23' && ['중구', '동구', '서구'].includes(localName)) continue;

    const lookupName = province === '세종특별자치시' && localName === '세종시' ? '' : localName;
    const code = lookupName
      ? official.municipalityByName.get(`${province}|${lookupName}`)
      : '36110';
    if (!code) throw new Error(`No current code for ${province} ${localName}`);
    features.push(stagedFeature(feature.geometry, code, `${province} ${localName}`));
  }

  const groupByDong = new Map();
  for (const [group, names] of Object.entries(INCHEON_GROUPS)) {
    for (const name of names) {
      if (groupByDong.has(name)) throw new Error(`Duplicate Incheon dong mapping: ${name}`);
      groupByDong.set(name, group);
    }
  }
  const selectedDongs = dongSource.features.filter((feature) => {
    const sourceCode = String(feature.properties.ADM_CD);
    return sourceCode.startsWith('23010') || sourceCode.startsWith('23020') || sourceCode.startsWith('23080');
  });
  for (const feature of selectedDongs) {
    const dongName = String(feature.properties.ADM_NM).trim();
    const group = groupByDong.get(dongName);
    if (!group) throw new Error(`Unmapped Incheon dong: ${dongName}`);
    const code = official.municipalityByName.get(`인천광역시|${group}`);
    if (!code) throw new Error(`No current code for 인천광역시 ${group}`);
    features.push(stagedFeature(feature.geometry, code, `인천광역시 ${group}`));
  }
  if (selectedDongs.length !== [...groupByDong.keys()].length) {
    throw new Error(`Incheon dong count mismatch: ${selectedDongs.length}/${groupByDong.size}`);
  }

  return { type: 'FeatureCollection', features };
}

function stagedFeature(geometry, code, name) {
  return {
    type: 'Feature',
    properties: {
      code,
      name,
      base_date: effectiveDate,
      boundary_base_date: boundaryBaseDate,
    },
    geometry,
  };
}

function dissolve(input, output) {
  runMapshaper([
    input,
    '-dissolve', 'fields=code,name,base_date,boundary_base_date',
    '-o', 'force', 'format=geojson', 'precision=0.0001', output,
  ]);
}

function finalize(collection, aliasesFor) {
  collection.features.sort((left, right) => (
    String(left.properties.code).localeCompare(String(right.properties.code))
  ));
  for (const feature of collection.features) {
    const aliases = aliasesFor(feature.properties.name);
    feature.properties = {
      code: String(feature.properties.code),
      name: String(feature.properties.name),
      ...(aliases.length > 0 ? { aliases } : {}),
      base_date: effectiveDate,
      boundary_base_date: boundaryBaseDate,
    };
  }
  return collection;
}

function provinceAliases(name) {
  if (name === '전남광주통합특별시') return ['광주광역시', '전라남도'];
  if (name === '강원특별자치도') return ['강원도'];
  if (name === '전북특별자치도') return ['전라북도'];
  return [];
}

function sigunguAliases(name) {
  const aliases = [];
  const [province, ...localParts] = name.split(' ');
  const localName = localParts.join(' ');
  const formerProvince = {
    전남광주통합특별시: localName.endsWith('구') ? '광주광역시' : '전라남도',
    강원특별자치도: '강원도',
    전북특별자치도: '전라북도',
  }[province];
  if (formerProvince) aliases.push(`${formerProvince} ${localName}`);

  const compactLocalName = localName.replace(/^(.+시)\s+(.+구)$/, '$1$2');
  if (compactLocalName !== localName) {
    aliases.push(`${province} ${compactLocalName}`);
    if (formerProvince) aliases.push(`${formerProvince} ${compactLocalName}`);
  }
  if (name === '인천광역시 제물포구') aliases.push('인천광역시 동구');
  return [...new Set(aliases)];
}

function parseOfficialCodes(path) {
  const decoded = new TextDecoder('euc-kr').decode(readFileSync(path));
  const provinceByName = new Map();
  const municipalityByName = new Map();
  for (const line of decoded.split(/\r?\n/).slice(1)) {
    if (!/^\d{10}/.test(line)) continue;
    const code = line.slice(0, 10);
    const parts = line.slice(10).trim().split(/\s{2,}/);
    const province = parts[0];
    const municipality = parts[1];
    if (code.endsWith('00000000') && province) provinceByName.set(province, code.slice(0, 2));
    if (code.endsWith('00000') && municipality) {
      municipalityByName.set(`${province}|${municipality}`, code.slice(0, 5));
    }
  }
  if (provinceByName.size !== 16) throw new Error(`Expected 16 current provinces, got ${provinceByName.size}`);
  return { provinceByName, municipalityByName };
}

function runMapshaper(mapshaperArgs) {
  const windowsNpxCli = resolve(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const executable = process.platform === 'win32' && existsSync(windowsNpxCli) ? process.execPath : 'npx';
  const prefix = executable === process.execPath ? [windowsNpxCli] : [];
  execFileSync(executable, [...prefix, '--yes', 'mapshaper@0.7.48', ...mapshaperArgs], {
    stdio: 'inherit',
  });
}

function readGeoJson(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error(`Invalid GeoJSON: ${basename(path)}`);
  }
  return value;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, 'utf8');
}

function assertFeatureCount(collection, expected, label) {
  if (collection.features.length !== expected) {
    throw new Error(`${label}: expected ${expected} features, got ${collection.features.length}`);
  }
}

function assertUnique(collection, label) {
  for (const property of ['code', 'name']) {
    const values = collection.features.map((feature) => feature.properties[property]);
    if (new Set(values).size !== values.length) throw new Error(`${label}: duplicate ${property}`);
  }
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index]?.replace(/^--/, '');
    const value = tokens[index + 1];
    if (!key || value == null) throw new Error(`Invalid argument near ${tokens[index] ?? '<end>'}`);
    parsed[key] = value;
  }
  return parsed;
}
