import { describe, expect, it } from 'vitest';
import {
  administrativeRegionOptions,
  administrativeRegionSelectionFromViewport,
  mapViewportForAdministrativeSelection,
  type AdministrativeRegionSelection,
} from './koreaAdministrativeRegions';

const emptySelection: AdministrativeRegionSelection = {
  province: '',
  city: '',
  county: '',
  district: '',
};

describe('대한민국 행정구역 표시 영역', () => {
  it('2026-07-20 기준 16개 시·도를 최신 행정 코드 순서로 제공한다', () => {
    const options = administrativeRegionOptions(emptySelection);

    expect(options.provinces).toHaveLength(16);
    expect(options.provinces[0]).toEqual({ value: '서울특별시', label: '서울특별시' });
    expect(options.provinces[1]).toEqual({ value: '전남광주통합특별시', label: '전남광주통합특별시' });
    expect(options.provinces).not.toContainEqual(expect.objectContaining({ value: '광주광역시' }));
    expect(options.provinces).not.toContainEqual(expect.objectContaining({ value: '전라남도' }));
    expect(options.cities).toEqual([]);
    expect(options.counties).toEqual([]);
    expect(options.districts).toEqual([]);
  });

  it('도의 시·군과 선택한 시의 구를 독립된 목록으로 구성한다', () => {
    const provinceOptions = administrativeRegionOptions({
      ...emptySelection,
      province: '경기도',
    });

    expect(provinceOptions.cities).toContainEqual({ value: '경기도 수원시', label: '수원시' });
    expect(provinceOptions.cities).toContainEqual({ value: '경기도 시흥시', label: '시흥시' });
    expect(provinceOptions.counties).toContainEqual({ value: '경기도 가평군', label: '가평군' });
    expect(provinceOptions.districts).toEqual([]);

    const cityOptions = administrativeRegionOptions({
      ...emptySelection,
      province: '경기도',
      city: '경기도 수원시',
    });
    expect(cityOptions.districts).toEqual(expect.arrayContaining([
      { value: '경기도 수원시 권선구', label: '권선구' },
      { value: '경기도 수원시 장안구', label: '장안구' },
    ]));
  });

  it('광역시의 군과 구는 시 선택 없이 제공한다', () => {
    const options = administrativeRegionOptions({
      ...emptySelection,
      province: '부산광역시',
    });

    expect(options.cities).toEqual([]);
    expect(options.counties).toContainEqual({ value: '부산광역시 기장군', label: '기장군' });
    expect(options.districts).toContainEqual({ value: '부산광역시 해운대구', label: '해운대구' });
  });

  it('전남광주통합특별시는 시·군과 광주권 구를 한 계층에서 제공한다', () => {
    const options = administrativeRegionOptions({
      ...emptySelection,
      province: '전남광주통합특별시',
    });

    expect(options.cities).toContainEqual({ value: '전남광주통합특별시 목포시', label: '목포시' });
    expect(options.counties).toContainEqual({ value: '전남광주통합특별시 담양군', label: '담양군' });
    expect(options.districts).toContainEqual({ value: '전남광주통합특별시 광산구', label: '광산구' });
  });

  it('인천 2026 개편 구를 제공하고 폐지된 구는 제거한다', () => {
    const options = administrativeRegionOptions({
      ...emptySelection,
      province: '인천광역시',
    });

    expect(options.districts.map((option) => option.label)).toEqual(expect.arrayContaining([
      '제물포구', '영종구', '서해구', '검단구',
    ]));
    expect(options.districts.map((option) => option.label)).not.toEqual(expect.arrayContaining([
      '중구', '동구', '서구',
    ]));
  });

  it('가장 구체적인 선택의 경계와 읽기 쉬운 지역 키를 viewport에 저장한다', () => {
    const viewport = mapViewportForAdministrativeSelection({
      province: '경기도',
      city: '경기도 수원시',
      county: '',
      district: '경기도 수원시 장안구',
    });

    expect(viewport).toMatchObject({
      mode: 'regions',
      regionKeys: ['경기도 수원시 장안구'],
      bounds: {
        west: expect.any(Number),
        east: expect.any(Number),
        south: expect.any(Number),
        north: expect.any(Number),
      },
    });
  });

  it('저장 viewport와 구버전 지역명을 최신 드롭다운 선택으로 복원한다', () => {
    expect(administrativeRegionSelectionFromViewport({
      mode: 'regions',
      regionKeys: ['경기도 수원시 장안구'],
    })).toEqual({
      province: '경기도',
      city: '경기도 수원시',
      county: '',
      district: '경기도 수원시 장안구',
    });

    expect(administrativeRegionSelectionFromViewport({
      mode: 'regions',
      regionKeys: ['경기도 수원시장안구'],
    })).toEqual({
      province: '경기도',
      city: '경기도 수원시',
      county: '',
      district: '경기도 수원시 장안구',
    });

    expect(administrativeRegionSelectionFromViewport({
      mode: 'regions',
      regionKeys: ['광주광역시'],
    })).toEqual({
      province: '전남광주통합특별시',
      city: '',
      county: '',
      district: '',
    });

    expect(administrativeRegionSelectionFromViewport({
      mode: 'regions',
      regionKeys: ['인천광역시 동구'],
    })).toEqual({
      province: '인천광역시',
      city: '',
      county: '',
      district: '인천광역시 제물포구',
    });
  });
});
