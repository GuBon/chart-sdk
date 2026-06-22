/**
 * chart-options SSOT → defaults.json
 * ----------------------------------
 * 레지스트리의 대분류별 기본 options 를 JSON 으로 산출한다.
 * server(Spring Boot)가 이 파일을 클래스패스 리소스로 로드해 누락 옵션을 기본값으로 채운다
 * (변환기 매핑 스펙 5장 `withDefaults`). 기본값을 Java 에 중복 정의하지 않기 위한 단일 소스.
 *
 * 실행: `npm run gen -w @chartsdk/chart-options` (Node >= 22, 네이티브 TS).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAJOR_TYPES, defaultsFor } from '../optionRegistry.ts';

const defaults = Object.fromEntries(MAJOR_TYPES.map((type) => [type, defaultsFor(type)]));

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'defaults.json');
writeFileSync(outPath, JSON.stringify(defaults, null, 2) + '\n');

console.log(`defaults.json 생성 완료 — 대분류: ${MAJOR_TYPES.join(', ')}`);
