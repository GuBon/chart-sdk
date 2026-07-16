package com.chartsdk.converter;

import com.chartsdk.config.OptionDefaults;
import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ChartOptionConverterTest {
    private final ChartOptionConverter converter = new ChartOptionConverter(new OptionDefaults(Map.of()));

    private record LayoutContractCase(
            String name,
            String chartType,
            Map<String, Object> options,
            Map<String, Object> expected,
            List<String> absent
    ) {}

    @Test
    void sharedLayoutContractFixtureMatchesServerConverter() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/layout-contract-cases.json")) {
            assertThat(in).as("shared layout contract fixture").isNotNull();
            List<LayoutContractCase> cases = new ObjectMapper().readValue(in, new TypeReference<>() {});
            for (LayoutContractCase c : cases) {
                Map<String, Object> option = converter.convert(rows2(), c.chartType(), c.options());
                for (Map.Entry<String, Object> expected : c.expected().entrySet()) {
                    assertThat(valueAt(option, expected.getKey()))
                            .as("%s: %s", c.name(), expected.getKey())
                            .isEqualTo(expected.getValue());
                }
                for (String path : c.absent() == null ? List.<String>of() : c.absent()) {
                    assertThat(valueAt(option, path)).as("%s: %s absent", c.name(), path).isNull();
                }
            }
        }
    }

    private Object valueAt(Object root, String path) {
        Object value = root;
        for (String key : path.split("\\.")) {
            if (value instanceof List<?> list) value = list.get(Integer.parseInt(key));
            else if (value instanceof Map<?, ?> map) value = map.get(key);
            else return null;
        }
        return value;
    }

    @Test
    void titleAndLegendOnSameEdgeStackAndGridReservesSpace() {
        // 제목 top + 범례 top → 범례를 제목 다음 줄로(TITLE_H=26), grid.top 은 제목+범례 합만큼 가산.
        Map<String, Object> option = converter.convert(rows(), "bar", Map.of(
                "title", "긴 제목", "titleV", "top",
                "legend", Map.of("show", true, "position", "top")
        ));
        Map<?, ?> legend = (Map<?, ?>) option.get("legend");
        assertThat(legend.get("top")).isEqualTo(26); // 제목 다음 줄
        assertThat(legend.get("type")).isEqualTo("scroll"); // 단일행 보장
        Map<?, ?> grid = (Map<?, ?>) option.get("grid");
        assertThat(grid.get("top")).isEqualTo(28 + 26 + 24); // normal base + title + legend

        // 제목 없음 + 범례 top → 범례는 최상단(0), grid.top 은 범례만 가산.
        Map<String, Object> noTitle = converter.convert(rows(), "bar", Map.of(
                "legend", Map.of("show", true, "position", "top")
        ));
        assertThat(((Map<?, ?>) noTitle.get("legend")).get("top")).isEqualTo(0);
        assertThat(((Map<?, ?>) noTitle.get("grid")).get("top")).isEqualTo(28 + 24);
    }

    @Test
    void titleAtBottomStacksLegendAndVisualMapAbove() {
        // 막대: 제목 bottom + 범례 bottom → 범례를 제목 위로, grid.bottom 가산.
        Map<String, Object> bar = converter.convert(rows(), "bar", Map.of(
                "title", "하단 제목", "titleV", "bottom",
                "legend", Map.of("show", true, "position", "bottom")
        ));
        assertThat(((Map<?, ?>) bar.get("legend")).get("bottom")).isEqualTo(26);
        assertThat(((Map<?, ?>) bar.get("grid")).get("bottom")).isEqualTo(24 + 26 + 24);

        // 히트맵: 제목 bottom → visualMap 을 제목 위로(26), grid.bottom = base+title+visualMap.
        Map<String, Object> heat = converter.convert(rows2(), "heatmap", Map.of("title", "히트맵 제목", "titleV", "bottom"));
        assertThat(((Map<?, ?>) heat.get("visualMap")).get("bottom")).isEqualTo(26);
        assertThat(((Map<?, ?>) heat.get("grid")).get("bottom")).isEqualTo(24 + 26 + 36);
    }

    @Test
    void dataLabelAddsHideOverlapLabelLayout() {
        Map<String, Object> option = converter.convert(rows(), "bar", Map.of("dataLabel", true));
        Map<?, ?> s0 = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(((Map<?, ?>) s0.get("label")).get("show")).isEqualTo(true);
        assertThat(((Map<?, ?>) s0.get("labelLayout")).get("hideOverlap")).isEqualTo(true);

        // 라벨 꺼진 기본 차트엔 labelLayout 없음.
        Map<String, Object> noLabel = converter.convert(rows(), "bar", Map.of());
        assertThat(((Map<?, ?>) ((List<?>) noLabel.get("series")).get(0)).get("labelLayout")).isNull();

        // 시군구처럼 지역이 많은 지도 라벨에도 같은 겹침 방지 계약을 적용한다.
        Map<String, Object> map = converter.convert(rows(), "map", Map.of("dataLabel", true));
        Map<?, ?> mapSeries = (Map<?, ?>) ((List<?>) map.get("series")).get(0);
        assertThat(((Map<?, ?>) mapSeries.get("labelLayout")).get("hideOverlap")).isEqualTo(true);
    }

    @Test
    void paletteActiveIndexRotatesCartesianSeriesColor() {
        Map<String, Object> option = converter.convert(rows(), "bar", Map.of(
                "palette", List.of("#111111", "#222222", "#333333"),
                "paletteActiveIndex", 1
        ));

        assertThat(option.get("color")).isEqualTo(List.of("#222222", "#333333", "#111111"));
        List<?> series = (List<?>) option.get("series");
        Map<?, ?> firstSeries = (Map<?, ?>) series.get(0);
        assertThat(firstSeries.get("color")).isEqualTo("#222222");
        assertThat(((Map<?, ?>) firstSeries.get("itemStyle")).get("color")).isEqualTo("#222222");
    }

    @Test
    void paletteActiveIndexRotatesPieDataColors() {
        Map<String, Object> option = converter.convert(rows(), "pie", Map.of(
                "palette", List.of("#111111", "#222222", "#333333"),
                "paletteActiveIndex", 2
        ));

        assertThat(option.get("color")).isEqualTo(List.of("#333333", "#111111", "#222222"));
        List<?> series = (List<?>) option.get("series");
        Map<?, ?> firstSeries = (Map<?, ?>) series.get(0);
        List<?> data = (List<?>) firstSeries.get("data");
        Map<?, ?> firstPoint = (Map<?, ?>) data.get(0);
        assertThat(((Map<?, ?>) firstPoint.get("itemStyle")).get("color")).isEqualTo("#333333");
    }

    @Test
    void stackedBarNormalizeDividesByCategoryTotal() {
        // 100% 정규화: 각 카테고리(행) 합으로 나눠 스택이 1이 되어야 한다(시리즈 합이 아니라).
        Map<String, Object> option = converter.convert(rows2(), "bar", Map.of(
                "variant", "stacked",
                "bar", Map.of("normalize", true)
        ));

        @SuppressWarnings("unchecked")
        List<Object> series = (List<Object>) option.get("series");
        @SuppressWarnings("unchecked")
        List<Object> s0 = (List<Object>) ((Map<?, ?>) series.get(0)).get("data"); // A: 10/40, B: 20/40
        @SuppressWarnings("unchecked")
        List<Object> s1 = (List<Object>) ((Map<?, ?>) series.get(1)).get("data"); // A: 30/40, B: 20/40
        assertThat(s0).containsExactly(0.25, 0.5);
        assertThat(s1).containsExactly(0.75, 0.5);
    }

    @Test
    void seriesTypesOverridesPerSeriesTypeAndStyle() {
        // 혼합(combo): s2 만 line 으로 오버라이드 → type=line + lineStyle 색, s1 은 bar 유지.
        Map<String, Object> option = converter.convert(rows2(), "bar", Map.of(
                "seriesTypes", Map.of("s2", "line"),
                "palette", List.of("#111111", "#222222")
        ));

        List<?> series = (List<?>) option.get("series");
        Map<?, ?> first = (Map<?, ?>) series.get(0);
        Map<?, ?> second = (Map<?, ?>) series.get(1);
        assertThat(first.get("type")).isEqualTo("bar");
        assertThat(second.get("type")).isEqualTo("line");
        assertThat(((Map<?, ?>) second.get("lineStyle")).get("color")).isEqualTo("#222222");
        assertThat(first.get("lineStyle")).isNull(); // 막대 시리즈엔 lineStyle 없음
    }

    @Test
    void boxplotComputesFiveNumberSummaryPerCategory() {
        // A = 1..9 (홀수 9개), B = 10,20,30,40 (짝수 4개 → 선형보간). yAxis.secondAxis 는 무시(이중축 오염 방지).
        Map<String, Object> option = converter.convert(boxplotRows(), "boxplot", Map.of(
                "yAxis", Map.of("secondAxis", true, "title", "값")
        ));

        List<?> series = (List<?>) option.get("series");
        Map<?, ?> s0 = (Map<?, ?>) series.get(0);
        assertThat(s0.get("type")).isEqualTo("boxplot");
        List<?> data = (List<?>) s0.get("data");
        assertThat(data.get(0)).isEqualTo(List.of(1.0, 3.0, 5.0, 7.0, 9.0));       // A: min·Q1·median·Q3·max
        assertThat(data.get(1)).isEqualTo(List.of(10.0, 17.5, 25.0, 32.5, 40.0));  // B: 짝수 선형보간

        Map<?, ?> xAxis = (Map<?, ?>) option.get("xAxis");
        assertThat(xAxis.get("type")).isEqualTo("category");
        assertThat(xAxis.get("data")).isEqualTo(List.of("A", "B"));
        // 이중축 오염 방지: yAxis 는 단일 Map(배열 아님) + decorateAxis 로 name 반영
        assertThat(option.get("yAxis")).isInstanceOf(Map.class);
        assertThat(((Map<?, ?>) option.get("yAxis")).get("name")).isEqualTo("값");
    }

    @Test
    void heatmapBuildsMatrixDataVisualMapAndDropsLegend() {
        // 공통 zone 잔존 legend 가 heatmap 에서 제거되는지도 함께 검증.
        Map<String, Object> option = converter.convert(rows2(), "heatmap", Map.of(
                "legend", Map.of("show", true, "position", "bottom")
        ));

        Map<?, ?> xAxis = (Map<?, ?>) option.get("xAxis");
        Map<?, ?> yAxis = (Map<?, ?>) option.get("yAxis");
        assertThat(xAxis.get("type")).isEqualTo("category");
        assertThat(xAxis.get("data")).isEqualTo(List.of("A", "B"));
        assertThat(yAxis.get("type")).isEqualTo("category");
        assertThat(yAxis.get("data")).isEqualTo(List.of("s1", "s2"));

        List<?> series = (List<?>) option.get("series");
        Map<?, ?> s0 = (Map<?, ?>) series.get(0);
        assertThat(s0.get("type")).isEqualTo("heatmap");
        assertThat(s0.get("data")).isEqualTo(List.of(
                List.of(0, 0, 10.0), List.of(0, 1, 30.0), List.of(1, 0, 20.0), List.of(1, 1, 20.0)));

        Map<?, ?> vm = (Map<?, ?>) option.get("visualMap");
        assertThat(vm.get("min")).isEqualTo(10.0);
        assertThat(vm.get("max")).isEqualTo(30.0);
        assertThat(vm.get("calculable")).isEqualTo(true);
        assertThat(option.get("legend")).isNull();                 // visualMap 이 범례 대체
        assertThat(((Map<?, ?>) option.get("tooltip")).get("trigger")).isEqualTo("item");
    }

    @Test
    void mapBuildsRegionDataVisualMapAndRoam() {
        Map<String, Object> option = converter.convert(rows(), "map", Map.of(
                "map", Map.of("roam", true), "dataLabel", true,
                "legend", Map.of("show", true)
        ));

        List<?> series = (List<?>) option.get("series");
        Map<?, ?> s0 = (Map<?, ?>) series.get(0);
        assertThat(s0.get("type")).isEqualTo("map");
        assertThat(s0.get("map")).isEqualTo("kr-sido");
        assertThat(s0.get("roam")).isEqualTo(true);
        assertThat(((Map<?, ?>) s0.get("label")).get("show")).isEqualTo(true);

        Map<?, ?> p0 = (Map<?, ?>) ((List<?>) s0.get("data")).get(0);
        assertThat(p0.get("name")).isEqualTo("A");
        assertThat(p0.get("value")).isEqualTo(10.0);

        Map<?, ?> vm = (Map<?, ?>) option.get("visualMap");
        assertThat(vm.get("min")).isEqualTo(10.0);
        assertThat(vm.get("max")).isEqualTo(20.0);
        assertThat(option.get("xAxis")).isNull();                  // 지도는 축 없음
        assertThat(option.get("legend")).isNull();
        assertThat(((Map<?, ?>) option.get("tooltip")).get("trigger")).isEqualTo("item");
    }

    @Test
    void geoScatterBuildsGeoWithScatterPointsAndPerItemSymbolSize() {
        // 크기값(3열) 있음 → 포인트별 symbolSize(6~28px sqrt 스케일), geo.map 은 map.name 옵션을 따름.
        QueryRows rows = new QueryRows(
                List.of(Map.of("name", "lng", "type", "number"), Map.of("name", "lat", "type", "number"), Map.of("name", "cnt", "type", "number")),
                List.of(List.of(127.0, 37.5, 10), List.of(129.0, 35.1, 90)),
                2, false, 0);
        Map<String, Object> option = converter.convert(rows, "geoscatter", Map.of(
                "map", Map.of("name", "kr-sigungu", "roam", true)
        ));

        Map<?, ?> geo = (Map<?, ?>) option.get("geo");
        assertThat(geo.get("map")).isEqualTo("kr-sigungu");
        assertThat(geo.get("roam")).isEqualTo(true);

        List<?> series = (List<?>) option.get("series");
        Map<?, ?> s0 = (Map<?, ?>) series.get(0);
        assertThat(s0.get("type")).isEqualTo("scatter");
        assertThat(s0.get("coordinateSystem")).isEqualTo("geo");
        List<?> data = (List<?>) s0.get("data");
        Map<?, ?> p0 = (Map<?, ?>) data.get(0);
        Map<?, ?> p1 = (Map<?, ?>) data.get(1);
        assertThat(p0.get("value")).isEqualTo(List.of(127.0, 37.5, 10.0));
        assertThat(p0.get("symbolSize")).isEqualTo(6);   // 최소값 → 6px
        assertThat(p1.get("symbolSize")).isEqualTo(28);  // 최대값 → 6+22px
        assertThat(((Map<?, ?>) option.get("tooltip")).get("trigger")).isEqualTo("item");
        assertThat(option.get("legend")).isNull();
    }

    @Test
    void geoScatterWithoutSizeUsesPlainCoordsAndBaseSymbolSize() {
        QueryRows rows = new QueryRows(
                List.of(Map.of("name", "lng", "type", "number"), Map.of("name", "lat", "type", "number")),
                List.of(List.of(127.0, 37.5)),
                1, false, 0);
        Map<String, Object> option = converter.convert(rows, "geoscatter", Map.of(
                "geoscatter", Map.of("symbolSize", 14)
        ));

        Map<?, ?> geo = (Map<?, ?>) option.get("geo");
        assertThat(geo.get("map")).isEqualTo("kr-sido"); // 기본 지도
        Map<?, ?> s0 = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(s0.get("symbolSize")).isEqualTo(14);
        assertThat(((List<?>) s0.get("data")).get(0)).isEqualTo(List.of(127.0, 37.5));
    }

    @Test
    void mapHonorsSelectedMapNameWithSafeFallback() {
        Map<String, Object> sigungu = converter.convert(rows(), "map", Map.of("map", Map.of("name", "kr-sigungu")));
        assertThat(((Map<?, ?>) ((List<?>) sigungu.get("series")).get(0)).get("map")).isEqualTo("kr-sigungu");
        // 화이트리스트 밖 값은 kr-sido 폴백(미등록 지도 참조 방지)
        Map<String, Object> bogus = converter.convert(rows(), "map", Map.of("map", Map.of("name", "../etc")));
        assertThat(((Map<?, ?>) ((List<?>) bogus.get("series")).get(0)).get("map")).isEqualTo("kr-sido");
    }

    /** 상자수염용 — A: 1..9(순서 섞음), B: 10,20,30,40. 변환기가 카테고리별로 그룹핑·정렬. */
    private QueryRows boxplotRows() {
        return new QueryRows(
                List.of(
                        Map.of("name", "region", "type", "text"),
                        Map.of("name", "amount", "type", "number")
                ),
                List.of(
                        List.of("A", 5), List.of("A", 1), List.of("A", 9), List.of("A", 3), List.of("A", 7),
                        List.of("A", 2), List.of("A", 8), List.of("A", 4), List.of("A", 6),
                        List.of("B", 30), List.of("B", 10), List.of("B", 40), List.of("B", 20)
                ),
                13,
                false,
                0
        );
    }

    private QueryRows rows() {
        return new QueryRows(
                List.of(
                        Map.of("name", "category", "type", "text"),
                        Map.of("name", "amount", "type", "number")
                ),
                List.of(
                        List.of("A", 10),
                        List.of("B", 20)
                ),
                2,
                false,
                0
        );
    }

    /** 2개 값 시리즈(s1·s2) — 정규화·combo 검증용. 카테고리 합 A=40, B=40. */
    private QueryRows rows2() {
        return new QueryRows(
                List.of(
                        Map.of("name", "category", "type", "text"),
                        Map.of("name", "s1", "type", "number"),
                        Map.of("name", "s2", "type", "number")
                ),
                List.of(
                        List.of("A", 10, 30),
                        List.of("B", 20, 20)
                ),
                2,
                false,
                0
        );
    }
}
