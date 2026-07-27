#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mapsDir = resolve(import.meta.dirname, '..', 'maps');
const sido = readMap('kr-sido.json');
const sigungu = readMap('kr-sigungu.json');

assert(sido.features.length === 16, `Expected 16 provinces, got ${sido.features.length}`);
assert(sigungu.features.length === 253, `Expected 253 municipalities, got ${sigungu.features.length}`);
validateFeatures(sido, 'sido');
validateFeatures(sigungu, 'sigungu');

const provinceNames = namesOf(sido);
const municipalityNames = namesOf(sigungu);
for (const current of ['전남광주통합특별시', '강원특별자치도', '전북특별자치도']) {
  assert(provinceNames.has(current), `Missing current province: ${current}`);
}
for (const retired of ['광주광역시', '전라남도', '강원도', '전라북도']) {
  assert(!provinceNames.has(retired), `Retired province remains: ${retired}`);
}
for (const current of ['인천광역시 제물포구', '인천광역시 영종구', '인천광역시 서해구', '인천광역시 검단구']) {
  assert(municipalityNames.has(current), `Missing 2026 Incheon district: ${current}`);
}
for (const retired of ['인천광역시 중구', '인천광역시 동구', '인천광역시 서구']) {
  assert(!municipalityNames.has(retired), `Retired Incheon district remains: ${retired}`);
}

const provinceCodes = new Set(sido.features.map((feature) => feature.properties.code));
for (const feature of sigungu.features) {
  assert(
    provinceCodes.has(feature.properties.code.slice(0, 2)),
    `Municipality code has no province: ${feature.properties.code} ${feature.properties.name}`,
  );
}

console.log('Korea map assets are valid: 16 provinces, 253 municipalities, effective 2026-07-20.');

function validateFeatures(collection, label) {
  const codes = new Set();
  const names = new Set();
  const aliases = new Map();
  for (const feature of collection.features) {
    const { properties, geometry } = feature;
    assert(feature.type === 'Feature', `${label}: invalid feature type`);
    assert(/^\d+$/.test(properties.code), `${label}: invalid code ${properties.code}`);
    assert(properties.name?.trim(), `${label}: missing name`);
    assert(properties.base_date === '20260720', `${label}: wrong effective date for ${properties.name}`);
    assert(properties.boundary_base_date === '20250630', `${label}: wrong boundary date for ${properties.name}`);
    assert(!codes.has(properties.code), `${label}: duplicate code ${properties.code}`);
    assert(!names.has(properties.name), `${label}: duplicate name ${properties.name}`);
    codes.add(properties.code);
    names.add(properties.name);
    for (const alias of properties.aliases ?? []) {
      const owner = aliases.get(alias);
      assert(!owner || owner === properties.name, `${label}: duplicate alias ${alias}`);
      aliases.set(alias, properties.name);
    }
    assert(['Polygon', 'MultiPolygon'].includes(geometry?.type), `${label}: invalid geometry for ${properties.name}`);
    visitCoordinates(geometry.coordinates, (longitude, latitude) => {
      assert(longitude >= 124 && longitude <= 132, `${label}: longitude out of Korea bounds`);
      assert(latitude >= 32 && latitude <= 44, `${label}: latitude out of Korea bounds`);
    });
  }
}

function visitCoordinates(value, visitor) {
  assert(Array.isArray(value), 'Geometry coordinates must be arrays');
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    visitor(value[0], value[1]);
    return;
  }
  for (const child of value) visitCoordinates(child, visitor);
}

function namesOf(collection) {
  return new Set(collection.features.map((feature) => feature.properties.name));
}

function readMap(fileName) {
  const value = JSON.parse(readFileSync(resolve(mapsDir, fileName), 'utf8'));
  assert(value?.type === 'FeatureCollection' && Array.isArray(value.features), `${fileName}: invalid GeoJSON`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
