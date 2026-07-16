# 지도 자산 출처·라이선스

## kr-sido.json — 대한민국 시도 경계

- **출처**: [southkorea/southkorea-maps](https://github.com/southkorea/southkorea-maps) — `kostat/2013/json/skorea_provinces_geo_simple.json` (간략화판, 약 143KB)
- **원 데이터**: 통계청(KOSTAT) 2013 행정구역 경계
- **라이선스**: KOSTAT 데이터 — "Free to share or remix" (southkorea-maps README 기준)
- **구성**: 17개 시도 FeatureCollection. 각 feature `properties.name` = 한글 정식 시도명(예: `서울특별시`, `경상남도`, `제주특별자치도`).
- **ECharts 사용**: `echarts.registerMap('kr-sido', <이 JSON>)` 후 `series.type='map', map:'kr-sido'`. map series 데이터 `{name, value}` 의 `name` 을 위 `properties.name` 과 매칭(기본 `nameProperty:'name'`). 따라서 차트 데이터의 지역명 컬럼 값은 반드시 정식 시도명이어야 한다.

## kr-sigungu.json — 대한민국 시군구 경계

- **출처**: 동일 저장소 `kostat/2013/json/skorea_municipalities_geo_simple.json` (간략화판). 라이선스 동일(KOSTAT "Free to share or remix").
- **전처리(중요)**: 원본 `properties.name` 은 시군구명만 담겨 광역시 간 **중복이 7종**(중구·동구·남구·북구·서구·고성군 등) 존재 → 이름 매칭이 모호해진다. 커밋본은 `code` 앞 2자리(시도 코드)를 kr-sido 의 시도명과 조인해 **`"부산광역시 중구"` 형태의 정식 전체 명칭으로 재작성**했다(251개, 중복 0).
- **데이터 요건**: 시군구 지도를 쓰는 차트의 지역명 컬럼 값은 `"시도명 시군구명"`(공백 1개) 정식 표기여야 매칭된다.
