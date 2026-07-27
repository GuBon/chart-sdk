# 대한민국 지도 자산 출처·기준일·가공 내역

## 기준

- **행정구역 유효 기준일**: 2026-07-20
- **원본 경계 기준일**: 2025-06-30(SGIS 2025년 2분기)
- **좌표계**: 원본 SGIS TM → WGS84(EPSG:4326)
- **행정코드**: 행정안전부 `KIKcd_H.20260720`의 현행 행정기관 코드
- **결과**:
  - `kr-sido.json`: 16개 시·도
  - `kr-sigungu.json`: 253개 시·군·구(일반구 포함)

각 feature의 `properties`는 다음 계약을 사용한다.

| 속성 | 의미 |
|---|---|
| `code` | 2026-07-20 현재 행정안전부 행정기관 코드의 시·도 2자리/시·군·구 5자리 |
| `name` | ECharts 데이터와 일치시킬 현재 정식 전체 지역명 |
| `aliases` | 저장된 구버전 영역을 복원하기 위한 과거 명칭(있는 feature만) |
| `base_date` | 행정구역·코드 유효 기준일 `20260720` |
| `boundary_base_date` | 경계 좌표 원본 기준일 `20250630` |

`aliases`는 하나의 현행 구역으로 손실 없이 대응되는 과거 명칭에만 둔다. 2026년 개편으로
여러 구역에 나뉜 인천광역시의 과거 중구·서구는 자동 변환하면 잘못된 영역을 선택하게 되므로
별칭으로 매핑하지 않는다.

## 공식 원천

### 1. 2025년 2분기 시·도/시·군·구/행정동 경계

- 제공기관: 국가데이터처 통계지리정보서비스(SGIS)
- 데이터명: `국가데이터처_SGIS 행정구역 통계 및 경계_20250630`
- 원문: https://www.data.go.kr/data/15129688/fileData.do
- 사용 파일:
  - `bnd_sido_00_2025_2Q.shp`
  - `bnd_sigungu_00_2025_2Q.shp`
  - `bnd_dong_00_2025_2Q.shp`
- 이용허락범위: 공공데이터포털 표시 기준 **이용허락범위 제한 없음**

### 2. 2026년 7월 행정구역·코드

- 행정안전부, `행정기관(행정동) 및 관할구역(법정동) 변경내역(2026.7.1. 시행)`
  - https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127039
  - 전남광주통합특별시 신설 및 인천광역시 행정체제 개편
  - 첨부 `jscode20260701.zip`
- 행정안전부, `행정기관(행정동) 및 관할구역(법정동) 변경내역(2026.7.20. 시행)`
  - https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=127979
  - 첨부 `jscode20260720.zip`
- 인천광역시, `인천형 행정체제 개편 개요`
  - https://www.incheon.go.kr/IC01070101

## 2026년 경계 반영 방식

SGIS의 전국 SHP보다 2026년 7월 행정체제 개편이 늦으므로 다음 경계만 공식 하위 경계를 합쳐 보정했다.

1. **전남광주통합특별시**
   - 2025년 전라남도와 광주광역시 시·도 feature를 dissolve하여 하나의 시·도 경계로 생성했다.
   - 두 지역의 기존 시·군·구 경계는 유지하고, 시·도 접두명과 행정코드를 2026년 코드로 변경했다.
2. **인천광역시**
   - 폐지된 중구·동구·서구 시·군·구 feature를 제거했다.
   - 2025년 행정동 feature를 인천광역시가 공개한 관할 동 목록대로 dissolve하여 제물포구·영종구·서해구·검단구 경계를 생성했다.
   - 미추홀구·연수구·남동구·부평구·계양구·강화군·옹진군은 SGIS 경계를 유지하고 2026년 행정코드를 적용했다.
3. **7월 20일 변경**
   - 세종특별자치시 집현동 신설은 시·도 및 시·군·구 외곽 경계를 바꾸지 않으므로 코드 기준일만 갱신했다.

## 생성·검증

- 생성 스크립트: `chart-options/scripts/build-korea-maps.mjs`
- 검증 스크립트: `chart-options/scripts/validate-korea-maps.mjs`
- 형상 변환: mapshaper 0.7.48
  - WGS84 재투영
  - 인접 경계 dissolve
  - 작은 섬과 feature를 보존하는 화면 표시용 간략화
  - 좌표 소수점 4자리 정규화

ECharts에서는 `echarts.registerMap('kr-sido', geoJson)` 또는
`echarts.registerMap('kr-sigungu', geoJson)`으로 등록한다. `series.data[].name`은
해당 자산의 `properties.name`과 정확히 일치해야 한다.
