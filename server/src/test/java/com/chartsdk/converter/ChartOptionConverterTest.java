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

    private record StatisticalOverlayContractCase(
            String name,
            String chartType,
            List<Map<String, Object>> columns,
            List<List<Object>> rows,
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

    @Test
    void generatedPieDefaultsKeepDataLabelDisabled() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/chart-defaults.json")) {
            assertThat(in).as("generated chart defaults").isNotNull();
            Map<String, Map<String, Object>> byType = new ObjectMapper().readValue(in, new TypeReference<>() {});
            ChartOptionConverter defaultedConverter = new ChartOptionConverter(new OptionDefaults(byType));

            Map<String, Object> option = defaultedConverter.convert(rows(), "pie", Map.of());
            Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
            Map<?, ?> label = (Map<?, ?>) series.get("label");

            assertThat(label.get("show")).isEqualTo(false);
            assertThat(label.get("position")).isEqualTo("outside");
            assertThat(((Map<?, ?>) option.get("tooltip")).get("trigger")).isEqualTo("item");
        }
    }

    @Test
    void legacyAutoTooltipTriggerMigratesToItem() {
        Map<String, Object> option = converter.convert(rows(), "bar", Map.of(
                "tooltip", Map.of("trigger", "auto")
        ));

        assertThat(((Map<?, ?>) option.get("tooltip")).get("trigger")).isEqualTo("item");
    }

    @Test
    void hiddenDataLabelDoesNotLeakRotationAndComputedAtPreferenceIsForwarded() {
        Map<String, Object> option = converter.convert(rows(), "pie", Map.of(
                "dataLabel", false,
                "labelRotate", 90,
                "showComputedAt", false
        ));
        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        Map<?, ?> label = (Map<?, ?>) series.get("label");

        assertThat(label.get("show")).isEqualTo(false);
        assertThat(label.containsKey("rotate")).isFalse();
        assertThat(option.get("__chartsdkShowComputedAt")).isEqualTo(false);
    }

    @Test
    void generatedMapAndHeatmapDefaultsUseTheFullSequentialPalette() throws Exception {
        Map<String, Map<String, Object>> byType = generatedDefaults();
        ChartOptionConverter defaultedConverter = new ChartOptionConverter(new OptionDefaults(byType));
        for (String chartType : List.of("map", "heatmap")) {
            Map<String, Object> option = defaultedConverter.convert(rows2(), chartType, Map.of());
            assertThat(valueAt(option, "visualMap.inRange.color"))
                    .as("%s generated defaults", chartType)
                    .isEqualTo(byType.get(chartType).get("palette"));
        }
    }

    @Test
    void sharedAnalysisAnnotationContractFixtureMatchesServerConverter() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/analysis-annotation-contract-cases.json")) {
            assertThat(in).as("shared analysis annotation contract fixture").isNotNull();
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

    @Test
    void sharedStatisticalOverlayContractFixtureMatchesServerConverter() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/statistical-overlay-contract-cases.json")) {
            assertThat(in).as("shared statistical overlay contract fixture").isNotNull();
            List<StatisticalOverlayContractCase> cases = new ObjectMapper().readValue(in, new TypeReference<>() {});
            for (StatisticalOverlayContractCase c : cases) {
                QueryRows rows = new QueryRows(c.columns(), c.rows(), c.rows().size(), false, 0);
                Map<String, Object> option = converter.convert(rows, c.chartType(), c.options());
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

    @Test
    void movingAverageLegendExclusionDoesNotCreateMissingLegend() {
        QueryRows rows = new QueryRows(
                List.of(
                        Map.of("name", "observed_at", "type", "date"),
                        Map.of("name", "sales", "type", "numeric")
                ),
                List.of(
                        List.of("2026-01-01", 10),
                        List.of("2026-02-01", 20)
                ),
                2,
                false,
                0
        );
        Map<String, Object> option = converter.convert(rows, "line", Map.of(
                "analysis", Map.of(
                        "movingAverage", Map.of(
                                "enabled", true,
                                "seriesIndex", 0,
                                "period", 2,
                                "showInLegend", false
                        )
                )
        ));

        assertThat(option).doesNotContainKey("legend");
    }

    private Object valueAt(Object root, String path) {
        Object value = root;
        for (String key : path.split("\\.")) {
            if (value instanceof List<?> list) {
                int index = Integer.parseInt(key);
                if (index < 0 || index >= list.size()) return null;
                value = list.get(index);
            }
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
    void lineVariantOnlyAppliesToLineSeriesInAComboChart() {
        Map<String, Object> option = converter.convert(rows2(), "line", Map.of(
                "variant", "smooth",
                "seriesTypes", Map.of("s2", "bar")
        ));

        List<?> series = (List<?>) option.get("series");
        Map<?, ?> line = (Map<?, ?>) series.get(0);
        Map<?, ?> bar = (Map<?, ?>) series.get(1);
        assertThat(line.get("type")).isEqualTo("line");
        assertThat(line.get("smooth")).isEqualTo(true);
        assertThat(bar.get("type")).isEqualTo("bar");
        assertThat(bar.containsKey("smooth")).isFalse();
        assertThat(bar.containsKey("step")).isFalse();
        assertThat(bar.containsKey("areaStyle")).isFalse();
        assertThat(bar.containsKey("lineStyle")).isFalse();
    }

    @Test
    void bubbleSizeColumnScalesPointsWithoutBecomingAnotherSeries() {
        QueryRows bubbleRows = new QueryRows(
                List.of(
                        Map.of("name", "x", "type", "number"),
                        Map.of("name", "y", "type", "number"),
                        Map.of("name", "size", "type", "number")
                ),
                List.of(List.of(1, 10, 3), List.of(2, 20, 9)),
                2,
                false,
                0
        );
        Map<String, Object> option = converter.convert(bubbleRows, "scatter", Map.of(
                "variant", "bubble",
                "scatter", Map.of("bubbleField", "size", "symbolSize", 16)
        ));

        List<?> series = (List<?>) option.get("series");
        assertThat(series).hasSize(1);
        Map<?, ?> points = (Map<?, ?>) series.get(0);
        assertThat(points.get("name")).isEqualTo("y");
        assertThat(points.containsKey("symbolSize")).isFalse();
        List<?> data = (List<?>) points.get("data");
        assertThat(((Map<?, ?>) data.get(0)).get("value")).isEqualTo(List.of(1, 10, 3));
        assertThat(((Map<?, ?>) data.get(0)).get("symbolSize")).isEqualTo(6);
        assertThat(((Map<?, ?>) data.get(1)).get("symbolSize")).isEqualTo(28);
        Map<?, ?> autoColorMap = (Map<?, ?>) option.get("__chartsdkAutoColorMap");
        assertThat(autoColorMap).hasSize(1);
        assertThat(autoColorMap.containsKey("y")).isTrue();
    }

    @Test
    void axisTitlePlacementAndAxisPositionAreConvertedForEcharts() {
        Map<String, Object> option = converter.convert(rows2(), "bar", Map.of(
                "xAxis", Map.of(
                        "title", "기간", "titleLocation", "start", "titleGap", 34,
                        "titleRotate", 15, "position", "top", "offset", 7
                ),
                "yAxis", Map.of(
                        "title", "매출", "titleLocation", "end", "titleGap", 72,
                        "titleRotate", 90, "position", "right", "offset", 11,
                        "secondAxis", true
                )
        ));

        Map<?, ?> xAxis = (Map<?, ?>) option.get("xAxis");
        assertThat(xAxis.get("name")).isEqualTo("기간");
        assertThat(xAxis.get("nameLocation")).isEqualTo("start");
        assertThat(xAxis.get("nameGap")).isEqualTo(8);
        assertThat(xAxis.get("nameRotate")).isEqualTo(15);
        assertThat(xAxis.get("position")).isEqualTo("top");
        assertThat(xAxis.containsKey("offset")).isFalse();

        List<?> yAxes = (List<?>) option.get("yAxis");
        Map<?, ?> primary = (Map<?, ?>) yAxes.get(0);
        Map<?, ?> secondary = (Map<?, ?>) yAxes.get(1);
        assertThat(primary.get("name")).isEqualTo("매출");
        assertThat(primary.get("nameLocation")).isEqualTo("end");
        assertThat(primary.get("nameGap")).isEqualTo(8);
        assertThat(primary.get("nameRotate")).isEqualTo(-90);
        assertThat(primary.get("position")).isEqualTo("right");
        assertThat(primary.containsKey("offset")).isFalse();
        assertThat(secondary.get("position")).isEqualTo("left");
        assertThat(((Map<?, ?>) ((List<?>) option.get("series")).get(1)).get("yAxisIndex")).isEqualTo(1);
    }

    @Test
    void horizontalBarMapsLogicalAxisPositionsToPhysicalAxes() {
        Map<String, Object> option = converter.convert(rows2(), "bar", Map.of(
                "variant", "horizontal",
                "xAxis", Map.of("title", "범주", "position", "top"),
                "yAxis", Map.of("title", "값", "position", "right")
        ));

        Map<?, ?> xAxis = (Map<?, ?>) option.get("xAxis");
        Map<?, ?> yAxis = (Map<?, ?>) option.get("yAxis");
        assertThat(xAxis.get("position")).isEqualTo("top");
        assertThat(yAxis.get("position")).isEqualTo("right");
        assertThat(xAxis.get("nameRotate")).isEqualTo(0);
        assertThat(yAxis.get("nameRotate")).isEqualTo(-90);
    }

    @Test
    void categoryXDefaultsToAllLabelsAndNumericYDefaultsToAutomaticTicks() {
        Map<String, Object> option = converter.convert(rows2(), "bar", Map.of());
        Map<?, ?> xAxis = (Map<?, ?>) option.get("xAxis");
        Map<?, ?> yAxis = (Map<?, ?>) option.get("yAxis");
        Map<?, ?> xLabel = (Map<?, ?>) xAxis.get("axisLabel");

        assertThat(xLabel.get("interval")).isEqualTo(0);
        assertThat(xLabel.get("hideOverlap")).isEqualTo(false);
        assertThat(yAxis.get("interval")).isNull();
        assertThat(yAxis.get("splitNumber")).isEqualTo(5);
        assertThat(yAxis.get("scale")).isEqualTo(false);
    }

    @Test
    void onlyAutomaticCategoryLabelsHideOverlapsAndFixedStepsStayExact() {
        Map<String, Object> option = converter.convert(rows2(), "bar", Map.of(
                "xAxis", Map.of(
                        "labelIntervalMode", "step", "labelEvery", 3,
                        "showMinLabel", true, "showMaxLabel", false, "hideOverlap", true
                ),
                "yAxis", Map.of("tickMode", "fixed", "interval", 20, "includeZero", false)
        ));
        Map<?, ?> xLabel = (Map<?, ?>) ((Map<?, ?>) option.get("xAxis")).get("axisLabel");
        Map<?, ?> yAxis = (Map<?, ?>) option.get("yAxis");

        assertThat(xLabel.get("interval")).isEqualTo(2);
        assertThat(xLabel.get("showMinLabel")).isEqualTo(true);
        assertThat(xLabel.get("showMaxLabel")).isEqualTo(false);
        assertThat(xLabel.get("hideOverlap")).isEqualTo(false);
        assertThat(yAxis.get("interval")).isEqualTo(20L);
        assertThat(yAxis.get("splitNumber")).isNull();
        assertThat(yAxis.get("scale")).isEqualTo(true);

        Map<String, Object> automatic = converter.convert(rows2(), "bar", Map.of(
                "xAxis", Map.of("labelIntervalMode", "auto", "hideOverlap", false)
        ));
        Map<?, ?> automaticLabel = (Map<?, ?>) ((Map<?, ?>) automatic.get("xAxis")).get("axisLabel");
        assertThat(automaticLabel.get("interval")).isEqualTo("auto");
        assertThat(automaticLabel.get("hideOverlap")).isEqualTo(true);
    }

    @Test
    void removesLegacyYAxisIntervalBoundsAndKeepsNumericXAxisBounds() {
        Map<String, Object> withoutLegacyBounds = converter.convert(rows2(), "bar", Map.of(
                "yAxis", Map.of("minInterval", 10, "maxInterval", 20)
        ));
        Map<?, ?> yWithoutBounds = (Map<?, ?>) withoutLegacyBounds.get("yAxis");
        assertThat(yWithoutBounds.get("minInterval")).isNull();
        assertThat(yWithoutBounds.get("maxInterval")).isNull();

        Map<String, Object> scatter = converter.convert(rows2(), "scatter", Map.of(
                "xAxis", Map.of("minInterval", 1, "maxInterval", 5)
        ));
        Map<?, ?> scatterX = (Map<?, ?>) scatter.get("xAxis");
        assertThat(scatterX.get("minInterval")).isEqualTo(1L);
        assertThat(scatterX.get("maxInterval")).isEqualTo(5L);
    }

    @Test
    void heatmapCategoryYDefaultsToAutomaticLabelInterval() {
        Map<String, Object> option = converter.convert(rows2(), "heatmap", Map.of());
        Map<?, ?> yLabel = (Map<?, ?>) ((Map<?, ?>) option.get("yAxis")).get("axisLabel");
        assertThat(yLabel.get("interval")).isEqualTo("auto");
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
        assertThat(((Map<?, ?>) option.get("tooltip")).get("trigger")).isNull();
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
        assertThat(((Map<?, ?>) option.get("tooltip")).get("trigger")).isNull();
        assertThat(option.get("__chartsdkMapViewport")).isEqualTo(Map.of("mode", "data"));
    }

    @Test
    void mapAndHeatmapUseFullSequentialPaletteAndCanReverseIt() {
        List<String> colors = List.of(
                "#D1EEEA", "#A8DBD9", "#85C4C9", "#68ABB8",
                "#4F90A6", "#3B738F", "#2A5674"
        );
        for (String chartType : List.of("map", "heatmap")) {
            Map<String, Object> forward = converter.convert(rows2(), chartType, Map.of(
                    "palette", colors,
                    "colorTheme", Map.of("version", 3),
                    "paletteReversed", false
            ));
            assertThat(valueAt(forward, "visualMap.inRange.color"))
                    .as("%s forward", chartType)
                    .isEqualTo(colors);

            Map<String, Object> reversed = converter.convert(rows2(), chartType, Map.of(
                    "palette", colors,
                    "colorTheme", Map.of("version", 3),
                    "paletteReversed", true
            ));
            assertThat(valueAt(reversed, "visualMap.inRange.color"))
                    .as("%s reversed", chartType)
                    .isEqualTo(List.of(
                            "#2A5674", "#3B738F", "#4F90A6", "#68ABB8",
                            "#85C4C9", "#A8DBD9", "#D1EEEA"
                    ));
        }
    }

    @Test
    void legacyMapUsesFirstD3SequentialTheme() throws Exception {
        Map<String, Map<String, Object>> byType = generatedDefaults();
        ChartOptionConverter defaultedConverter = new ChartOptionConverter(new OptionDefaults(byType));
        Map<String, Object> option = defaultedConverter.convert(rows(), "map", Map.of(
                "palettePreset", "safe",
                "palette", List.of("#88CCEE", "#CC6677")
        ));

        assertThat(valueAt(option, "visualMap.inRange.color"))
                .isEqualTo(byType.get("map").get("palette"));
        assertThat(option.get("color")).isEqualTo(byType.get("map").get("palette"));
    }

    @Test
    void mapNormalizesLegacyTooltipTemplateAndCustomizesEmphasisColor() {
        Map<String, Object> option = converter.convert(rows(), "map", Map.of(
                "map", Map.of(
                        "tooltip", Map.of("enabled", true, "template", "{series}\n{name}: {value}"),
                        "emphasis", Map.of("enabled", true, "color", "#12AB34")
                )
        ));

        assertThat(((Map<?, ?>) option.get("tooltip")).get("show")).isNull();
        Map<?, ?> tooltipMetadata = (Map<?, ?>) option.get("__chartsdkTooltip");
        assertThat(tooltipMetadata.get("mode")).isEqualTo("fields");
        assertThat(tooltipMetadata.get("chartType")).isEqualTo("map");
        assertThat(tooltipMetadata.get("showSeriesColor")).isEqualTo(true);
        assertThat((List<?>) tooltipMetadata.get("fields")).isNotEmpty();
        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(series.get("name")).isEqualTo("amount");
        assertThat(((Map<?, ?>) ((Map<?, ?>) series.get("emphasis")).get("itemStyle")).get("areaColor"))
                .isEqualTo("#12AB34");
        assertThat(series.get("select")).isNull();
    }

    @Test
    void mapAndGeoScatterForwardSavedViewportContract() {
        Map<String, Object> viewport = Map.of(
                "mode", "coordinates",
                "bounds", Map.of("west", 126.7, "east", 127.3, "south", 37.3, "north", 37.8)
        );
        Map<String, Object> map = converter.convert(rows(), "map", Map.of("map", Map.of("viewport", viewport)));
        assertThat(map.get("__chartsdkMapViewport")).isEqualTo(viewport);

        QueryRows points = new QueryRows(
                List.of(Map.of("name", "lng", "type", "number"), Map.of("name", "lat", "type", "number")),
                List.of(List.of(127.0, 37.5)), 1, false, 0);
        Map<String, Object> geo = converter.convert(points, "geoscatter", Map.of("map", Map.of("viewport", viewport)));
        assertThat(geo.get("__chartsdkMapViewport")).isEqualTo(viewport);
    }

    @Test
    void mapEmbedsDynamicGeoJsonForSpatialPolygonRows() {
        QueryRows spatialRows = new QueryRows(
                List.of(
                        Map.of("name", "__chartsdk_area_name", "type", "text"),
                        Map.of("name", "__chartsdk_area_value", "type", "numeric"),
                        Map.of("name", "__chartsdk_geojson", "type", "text")
                ),
                List.of(
                        List.of("영역 A", 10, "{\"type\":\"Polygon\",\"coordinates\":[[[127,37],[128,37],[128,38],[127,37]]]}"),
                        List.of("영역 B", 30, "{\"type\":\"MultiPolygon\",\"coordinates\":[[[[128,36],[129,36],[129,37],[128,36]]]]}")
                ),
                2, false, 0
        );

        Map<String, Object> option = converter.convert(spatialRows, "map", Map.of("map", Map.of("roam", true)));
        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(series.get("map")).asString().startsWith("chartsdk-dynamic-");
        assertThat(series.get("data")).isEqualTo(List.of(
                Map.of("name", "영역 A", "value", 10.0),
                Map.of("name", "영역 B", "value", 30.0)
        ));

        List<?> embedded = (List<?>) option.get("__chartsdkMaps");
        assertThat(embedded).hasSize(1);
        Map<?, ?> payload = (Map<?, ?>) embedded.get(0);
        assertThat(payload.get("name")).isEqualTo(series.get("map"));
        Map<?, ?> geoJson = (Map<?, ?>) payload.get("geoJSON");
        assertThat(geoJson.get("type")).isEqualTo("FeatureCollection");
        List<?> features = (List<?>) geoJson.get("features");
        assertThat(features).hasSize(2);
        assertThat(((Map<?, ?>) ((Map<?, ?>) features.get(0)).get("properties")).get("name")).isEqualTo("영역 A");
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
        assertThat(geo.get("itemStyle")).as("ECharts geo 기본 배경색·경계색·경계 굵기 사용").isNull();

        List<?> series = (List<?>) option.get("series");
        Map<?, ?> s0 = (Map<?, ?>) series.get(0);
        assertThat(s0.get("type")).isEqualTo("scatter");
        assertThat(s0.get("coordinateSystem")).isEqualTo("geo");
        List<?> data = (List<?>) s0.get("data");
        Map<?, ?> p0 = (Map<?, ?>) data.get(0);
        Map<?, ?> p1 = (Map<?, ?>) data.get(1);
        assertThat(p0.get("value")).isEqualTo(java.util.Arrays.asList(127.0, 37.5, null, 10));
        assertThat(p0.get("symbolSize")).isEqualTo(6);   // 최소값 → 6px
        assertThat(p1.get("symbolSize")).isEqualTo(28);  // 최대값 → 6+22px
        assertThat(((Map<?, ?>) option.get("tooltip")).get("trigger")).isNull();
        assertThat(option.get("legend")).isNull();
    }

    @Test
    void geoScatterCanHideAndStyleAdministrativeBoundaryWithoutOverridingDefaults() {
        QueryRows rows = new QueryRows(
                List.of(Map.of("name", "lng", "type", "number"), Map.of("name", "lat", "type", "number")),
                List.of(List.of(127.0, 37.5)),
                1, false, 0);

        Map<String, Object> defaults = converter.convert(rows, "geoscatter", Map.of());
        Map<?, ?> defaultGeo = (Map<?, ?>) defaults.get("geo");
        assertThat(defaultGeo.get("show")).isNull();
        assertThat(defaultGeo.get("itemStyle")).isNull();

        Map<String, Object> hidden = converter.convert(rows, "geoscatter", Map.of(
                "map", Map.of("boundary", Map.of("show", false))
        ));
        Map<?, ?> hiddenGeo = (Map<?, ?>) hidden.get("geo");
        assertThat(hiddenGeo.get("show")).isEqualTo(false);
        assertThat(hiddenGeo.get("itemStyle")).isNull();

        Map<String, Object> styled = converter.convert(rows, "geoscatter", Map.of(
                "map", Map.of("boundary", Map.of(
                        "show", true,
                        "areaColor", "#112233",
                        "borderColor", "#AABBCC",
                        "borderWidth", 25
                ))
        ));
        Map<?, ?> styledGeo = (Map<?, ?>) styled.get("geo");
        assertThat(styledGeo.get("show")).isNull();
        assertThat(styledGeo.get("itemStyle")).isEqualTo(Map.of(
                "areaColor", "#112233",
                "borderColor", "#AABBCC",
                "borderWidth", 20.0
        ));
    }

    @Test
    void generatedGeoScatterDefaultsUseFivePixelAdministrativeBoundary() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/chart-defaults.json")) {
            assertThat(in).as("generated chart defaults").isNotNull();
            Map<String, Map<String, Object>> byType = new ObjectMapper().readValue(in, new TypeReference<>() {});
            ChartOptionConverter defaultedConverter = new ChartOptionConverter(new OptionDefaults(byType));
            QueryRows rows = new QueryRows(
                    List.of(Map.of("name", "lng", "type", "number"), Map.of("name", "lat", "type", "number")),
                    List.of(List.of(127.0, 37.5)),
                    1, false, 0);

            Map<String, Object> option = defaultedConverter.convert(rows, "geoscatter", Map.of());
            Map<?, ?> geo = (Map<?, ?>) option.get("geo");

            assertThat(geo.get("show")).isNull();
            assertThat(geo.get("itemStyle")).isEqualTo(Map.of("borderWidth", 5.0));
        }
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
        assertThat(((List<?>) s0.get("data")).get(0)).isEqualTo(Map.of(
                "name", "127.0, 37.5",
                "value", java.util.Arrays.asList(127.0, 37.5, null, null)
        ));
    }

    @Test
    void geoScatterCanDisableTooltipAndAllHoverEmphasis() {
        QueryRows rows = new QueryRows(
                List.of(Map.of("name", "lng", "type", "number"), Map.of("name", "lat", "type", "number")),
                List.of(List.of(127.0, 37.5)),
                1, false, 0);
        Map<String, Object> option = converter.convert(rows, "geoscatter", Map.of(
                "map", Map.of(
                        "tooltip", Map.of("enabled", false),
                        "emphasis", Map.of("enabled", false)
                )
        ));

        assertThat(((Map<?, ?>) option.get("tooltip")).get("show")).isEqualTo(false);
        assertThat(option.get("__chartsdkTooltip")).isNull();
        assertThat(((Map<?, ?>) ((Map<?, ?>) option.get("geo")).get("emphasis")).get("disabled"))
                .isEqualTo(true);
        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(((Map<?, ?>) series.get("emphasis")).get("disabled")).isEqualTo(true);
    }

    @Test
    void everyChartTypeUsesFieldTooltipMetadataAndKeepsNativeEmphasisDefaults() {
        for (String chartType : List.of("bar", "line", "pie", "scatter", "boxplot", "heatmap", "map", "geoscatter")) {
            Map<String, Object> option = converter.convert(rows(), chartType, Map.of());
            Map<?, ?> tooltip = (Map<?, ?>) option.get("tooltip");
            Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);

            assertThat(tooltip.get("show")).as(chartType + " tooltip.show").isNull();
            assertThat(tooltip.get("trigger")).as(chartType + " tooltip.trigger").isNull();
            assertThat(tooltip.get("confine")).as(chartType + " tooltip.confine").isNull();
            Map<?, ?> tooltipMetadata = (Map<?, ?>) option.get("__chartsdkTooltip");
            assertThat(tooltipMetadata.get("mode")).as(chartType + " tooltip mode").isEqualTo("fields");
            assertThat(tooltipMetadata.get("chartType")).as(chartType + " tooltip type").isEqualTo(chartType);
            assertThat(tooltipMetadata.get("showSeriesColor")).as(chartType + " tooltip marker").isEqualTo(true);

            assertThat(series.get("emphasis")).as(chartType + " series emphasis").isNull();
            if ("geoscatter".equals(chartType)) {
                assertThat(((Map<?, ?>) option.get("geo")).get("emphasis"))
                        .isEqualTo(Map.of("disabled", true));
            }
        }
    }

    @Test
    void everyChartTypeCanDisableTooltipAndEmphasisThroughTheCommonContract() {
        Map<String, Object> interactions = Map.of(
                "tooltip", Map.of("enabled", false),
                "emphasis", Map.of("enabled", false)
        );

        for (String chartType : List.of("bar", "line", "pie", "scatter", "boxplot", "heatmap", "map", "geoscatter")) {
            Map<String, Object> option = converter.convert(rows(), chartType, interactions);
            Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);

            assertThat(((Map<?, ?>) option.get("tooltip")).get("show")).as(chartType).isEqualTo(false);
            assertThat(option.get("__chartsdkTooltip")).as(chartType).isNull();
            assertThat(series.get("emphasis")).as(chartType).isEqualTo(Map.of("disabled", true));
            if ("geoscatter".equals(chartType)) {
                assertThat(((Map<?, ?>) option.get("geo")).get("emphasis"))
                        .isEqualTo(Map.of("disabled", true));
            }
        }
    }

    @Test
    void fieldTooltipUsesBuilderLabelsAndStoresOnlyVisibleCurrentResultFields() {
        QueryRows rows = new QueryRows(
                List.of(
                        Map.of("name", "region", "type", "text"),
                        Map.of("name", "월 매출", "type", "numeric")
                ),
                List.of(List.of("서울", 1200)),
                1,
                false,
                0
        );
        Map<String, Object> option = converter.convert(
                rows,
                "bar",
                Map.of("tooltip", Map.of(
                        "contentMode", "fields",
                        "showSeriesColor", false,
                        "fields", Map.of(
                                "measure:sum:sales.amount:0", false,
                                "measure:removed:99", false
                        )
                )),
                Map.of(
                        "xAxis", "sales.region",
                        "yAxis", List.of(Map.of(
                                "column", "sales.amount",
                                "agg", "sum",
                                "alias", "월 매출"
                        ))
                )
        );

        assertThat(option.get("__chartsdkTooltip")).isEqualTo(Map.of(
                "mode", "fields",
                "chartType", "bar",
                "showSeriesColor", false,
                "fields", List.of(Map.of(
                        "key", "x:sales.region",
                        "label", "region",
                        "role", "가로축",
                        "kind", "category",
                        "defaultVisible", true
                ))
        ));
    }

    @Test
    void commonTooltipAndEmphasisOverridesAreMappedToEChartsPaths() {
        Map<String, Object> option = converter.convert(rows(), "line", Map.of(
                "tooltip", Map.of(
                        "trigger", "axis",
                        "axisPointer", "shadow",
                        "confine", "inside",
                        "backgroundColor", "#102030",
                        "textColor", "#F0F0F0",
                        "borderColor", "#405060",
                        "borderWidth", 3,
                        "padding", 16,
                        "contentMode", "custom",
                        "template", "{series}: {value}"
                ),
                "emphasis", Map.of(
                        "focus", "series",
                        "scale", false,
                        "lineWidth", 7,
                        "colorMode", "custom",
                        "color", "#12AB34"
                )
        ));

        assertThat(option.get("tooltip")).isEqualTo(Map.of(
                "trigger", "axis",
                "axisPointer", Map.of("type", "shadow"),
                "confine", true,
                "backgroundColor", "#102030",
                "borderColor", "#405060",
                "borderWidth", 3,
                "padding", 16,
                "textStyle", Map.of("fontSize", 12, "color", "#F0F0F0")
        ));
        Map<?, ?> tooltipMetadata = (Map<?, ?>) option.get("__chartsdkTooltip");
        assertThat(tooltipMetadata.get("mode")).isEqualTo("fields");
        assertThat(tooltipMetadata.get("chartType")).isEqualTo("line");
        assertThat(tooltipMetadata.get("showSeriesColor")).isEqualTo(true);
        assertThat((List<?>) tooltipMetadata.get("fields")).isNotEmpty();
        Map<?, ?> emphasis = (Map<?, ?>) ((Map<?, ?>) ((List<?>) option.get("series")).get(0)).get("emphasis");
        assertThat(emphasis.get("focus")).isEqualTo("series");
        assertThat(emphasis.get("scale")).isEqualTo(false);
        assertThat(emphasis.get("lineStyle")).isEqualTo(Map.of("width", 7, "color", "#12AB34"));
        assertThat(emphasis.get("itemStyle")).isEqualTo(Map.of("color", "#12AB34"));
    }

    @Test
    void mapHonorsSelectedMapNameWithSafeFallback() {
        Map<String, Object> sigungu = converter.convert(rows(), "map", Map.of("map", Map.of("name", "kr-sigungu")));
        assertThat(((Map<?, ?>) ((List<?>) sigungu.get("series")).get(0)).get("map")).isEqualTo("kr-sigungu");
        // 화이트리스트 밖 값은 kr-sido 폴백(미등록 지도 참조 방지)
        Map<String, Object> bogus = converter.convert(rows(), "map", Map.of("map", Map.of("name", "../etc")));
        assertThat(((Map<?, ?>) ((List<?>) bogus.get("series")).get(0)).get("map")).isEqualTo("kr-sido");
    }

    @Test
    void geoScatterUsesThemeColorForAllPointsAndKeepsPointOverrideSeparate() {
        QueryRows points = new QueryRows(
                List.of(
                        Map.of("name", "lng", "type", "number"),
                        Map.of("name", "lat", "type", "number")
                ),
                List.of(List.of(126.978, 37.5665), List.of(129.0756, 35.1796)),
                2, false, 0);
        Map<String, Object> option = converter.convert(points, "geoscatter", Map.of(
                "palette", List.of("#123456", "#654321"),
                "itemColorOverrides", List.of(Map.of(
                        "kind", "geoscatter",
                        "seriesName", "__geoscatter__",
                        "dimensions", List.of(129.0756, 35.1796),
                        "occurrence", 0,
                        "color", "#FFB000"
                )),
                "emphasis", Map.of("colorMode", "custom", "color", "#12AB34")
        ));

        Map<?, ?> geo = (Map<?, ?>) option.get("geo");
        assertThat(geo.get("emphasis")).isEqualTo(Map.of("disabled", true));

        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(((Map<?, ?>) series.get("itemStyle")).get("color")).isEqualTo("#123456");
        assertThat(((Map<?, ?>) series.get("emphasis")).get("itemStyle"))
                .isEqualTo(Map.of("color", "#12AB34"));
        List<?> data = (List<?>) series.get("data");
        assertThat(data.get(0)).isEqualTo(Map.of(
                "name", "126.978, 37.5665",
                "value", java.util.Arrays.asList(126.978, 37.5665, null, null)
        ));
        assertThat(((Map<?, ?>) ((Map<?, ?>) data.get(1)).get("itemStyle")).get("color"))
                .isEqualTo("#FFB000");
    }

    @Test
    void mapGroupsReservedAreaRowsIntoStableSeriesAndTargetsEverySeries() {
        QueryRows rows = new QueryRows(
                List.of(
                        Map.of("name", "__chartsdk_area_name", "type", "text"),
                        Map.of("name", "__chartsdk_area_value", "type", "number"),
                        Map.of("name", "__chartsdk_series", "type", "text")
                ),
                List.of(
                        List.of("서울특별시", 120, "온라인"),
                        List.of("부산광역시", 80, "매장"),
                        List.of("제주특별자치도", 55, "온라인")
                ),
                3, false, 0
        );
        Map<String, Object> option = converter.convert(rows, "map", Map.of(
                "variant", "map",
                "legend", Map.of("show", true, "position", "right"),
                "colorMap", Map.of("온라인", "#0055AA", "매장", "#DD5500")
        ));

        List<?> series = (List<?>) option.get("series");
        assertThat(series).hasSize(2);
        Map<?, ?> online = (Map<?, ?>) series.get(0);
        Map<?, ?> store = (Map<?, ?>) series.get(1);
        assertThat(online.get("id")).isEqualTo("__chartsdk_geo_map_0");
        assertThat(online.get("name")).isEqualTo("온라인");
        assertThat(online.get("type")).isEqualTo("map");
        assertThat(((List<?>) online.get("data"))).hasSize(2);
        Map<?, ?> onlineStyle = (Map<?, ?>) online.get("itemStyle");
        assertThat(onlineStyle.get("areaColor")).isEqualTo("#0055AA");
        assertThat(store.get("id")).isEqualTo("__chartsdk_geo_map_1");
        assertThat(store.get("name")).isEqualTo("매장");
        assertThat(option.get("legend")).isNotNull();
        assertThat((List<?>) ((Map<?, ?>) option.get("visualMap")).get("seriesTargets"))
                .isEqualTo(List.of(
                        Map.of("seriesId", "__chartsdk_geo_map_0", "dimension", 0),
                        Map.of("seriesId", "__chartsdk_geo_map_1", "dimension", 0)
                ));
    }

    @Test
    void mapHeatmapUsesPointRolesGroupsAndEcharts61SeriesTargets() {
        QueryRows rows = groupedGeoPointRows();
        Map<String, Object> option = converter.convert(rows, "map", Map.of(
                "variant", "heatmap",
                "map", Map.of(
                        "name", "kr-sigungu",
                        "heatmapPointSize", 18,
                        "heatmapBlurSize", 24,
                        "heatmapMinOpacity", 0.1,
                        "heatmapMaxOpacity", 0.85
                ),
                "tooltip", Map.of("contentMode", "custom", "template", "{series}: {value}")
        ));

        assertThat(((Map<?, ?>) option.get("geo")).get("map")).isEqualTo("kr-sigungu");
        Map<?, ?> tooltipMetadata = (Map<?, ?>) option.get("__chartsdkTooltip");
        assertThat(tooltipMetadata.get("mode")).isEqualTo("fields");
        assertThat(tooltipMetadata.get("chartType")).isEqualTo("map");
        assertThat(tooltipMetadata.get("showSeriesColor")).isEqualTo(true);
        assertThat((List<?>) tooltipMetadata.get("fields")).isNotEmpty();
        List<?> series = (List<?>) option.get("series");
        assertThat(series).hasSize(2);
        Map<?, ?> online = (Map<?, ?>) series.get(0);
        assertThat(online.get("id")).isEqualTo("__chartsdk_geo_heatmap_0");
        assertThat(online.get("type")).isEqualTo("heatmap");
        assertThat(online.get("pointSize")).isEqualTo(18);
        assertThat(online.get("blurSize")).isEqualTo(24);
        assertThat(online.get("minOpacity")).isEqualTo(0.1);
        assertThat(online.get("maxOpacity")).isEqualTo(0.85);
        Map<?, ?> firstPoint = (Map<?, ?>) ((List<?>) online.get("data")).get(0);
        assertThat(firstPoint.get("name")).isEqualTo("서울점");
        assertThat(firstPoint.get("value")).isEqualTo(List.of(126.978, 37.5665, 120.0));
        assertThat((List<?>) ((Map<?, ?>) option.get("visualMap")).get("seriesTargets"))
                .isEqualTo(List.of(
                        Map.of("seriesId", "__chartsdk_geo_heatmap_0", "dimension", 2),
                        Map.of("seriesId", "__chartsdk_geo_heatmap_1", "dimension", 2)
                ));
    }

    @Test
    void effectScatterUsesSeriesColorsAndSharedPointStyles() {
        QueryRows rows = groupedGeoPointRows();
        Map<String, Object> option = converter.convert(rows, "geoscatter", Map.of(
                "variant", "effectScatter",
                "colorMap", Map.of("온라인", "#0055AA"),
                "geoscatter", Map.of(
                        "symbol", "triangle",
                        "symbolSize", 16,
                        "opacity", 0.8,
                        "borderColor", "#001122",
                        "borderWidth", 2,
                        "showEffectOn", "render",
                        "rippleScale", 4,
                        "ripplePeriod", 6,
                        "rippleBrushType", "fill"
                )
        ));

        List<?> series = (List<?>) option.get("series");
        assertThat(series).hasSize(2);
        Map<?, ?> online = (Map<?, ?>) series.get(0);
        assertThat(online.get("id")).isEqualTo("__chartsdk_geo_point_0");
        assertThat(online.get("type")).isEqualTo("effectScatter");
        assertThat(online.get("symbol")).isEqualTo("triangle");
        assertThat(online.get("symbolSize")).isEqualTo(16);
        assertThat(online.get("showEffectOn")).isEqualTo("render");
        assertThat(online.get("rippleEffect")).isEqualTo(Map.of(
                "scale", 4.0, "period", 6.0, "brushType", "fill"
        ));
        assertThat(online.get("itemStyle")).isEqualTo(Map.of(
                "color", "#0055AA",
                "opacity", 0.8,
                "borderColor", "#001122",
                "borderWidth", 2
        ));
        Map<?, ?> firstPoint = (Map<?, ?>) ((List<?>) online.get("data")).get(0);
        assertThat(firstPoint.get("name")).isEqualTo("서울점");
        assertThat(firstPoint.get("value"))
                .isEqualTo(List.of(126.978, 37.5665, 120, 10));
        assertThat(firstPoint.get("symbolSize")).isEqualTo(6);
        assertThat(option).doesNotContainKey("visualMap");
    }

    private QueryRows groupedGeoPointRows() {
        return new QueryRows(
                List.of(
                        Map.of("name", "__chartsdk_longitude", "type", "number"),
                        Map.of("name", "__chartsdk_latitude", "type", "number"),
                        Map.of("name", "__chartsdk_point_name", "type", "text"),
                        Map.of("name", "__chartsdk_point_value", "type", "number"),
                        Map.of("name", "__chartsdk_size", "type", "number"),
                        Map.of("name", "__chartsdk_series", "type", "text")
                ),
                List.of(
                        List.of(126.978, 37.5665, "서울점", 120, 10, "온라인"),
                        List.of(129.0756, 35.1796, "부산점", 80, 30, "매장"),
                        List.of(126.5312, 33.4996, "제주점", 55, 20, "온라인")
                ),
                3, false, 0
        );
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

    @Test
    @SuppressWarnings("unchecked")
    void d3CategoryColorsDoNotCycleAndPersistBySeriesName() throws Exception {
        List<Map<String, Object>> columns = new java.util.ArrayList<>();
        columns.add(Map.of("name", "region", "type", "text"));
        List<Object> row = new java.util.ArrayList<>();
        row.add("서울");
        for (int i = 0; i < 14; i++) {
            columns.add(Map.of("name", "s" + i, "type", "number"));
            row.add(i);
        }
        QueryRows many = new QueryRows(columns, List.of(row), 1, false, 0);

        List<?> category10 = (List<?>) generatedDefaults().get("bar").get("palette");
        Map<String, Object> first = converter.convert(many, "bar", Map.of("palette", category10));
        Map<String, Object> auto = (Map<String, Object>) first.get("__chartsdkAutoColorMap");
        assertThat(auto.values()).hasSize(14).doesNotHaveDuplicates();
        assertThat(auto.get("s0")).isEqualTo(category10.get(0));
        assertThat(auto.get("s9")).isEqualTo(category10.get(9));
        assertThat(auto.get("s10")).isNotEqualTo(auto.get("s0"));

        Map<String, Object> second = converter.convert(many, "line", Map.of(
                "autoColorMap", auto,
                "colorMap", Map.of("s4", "#010203")
        ));
        List<Map<String, Object>> series = (List<Map<String, Object>>) second.get("series");
        assertThat(series.get(4).get("color")).isEqualTo("#010203");
        assertThat(series.get(5).get("color")).isEqualTo(auto.get("s5"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void sequentialPaletteSpreadsAcrossEverySeriesInsteadOfFallingBackToGeneratedColors() {
        List<Map<String, Object>> columns = new java.util.ArrayList<>();
        columns.add(Map.of("name", "region", "type", "text"));
        List<Object> row = new java.util.ArrayList<>();
        row.add("서울");
        for (int i = 0; i < 10; i++) {
            columns.add(Map.of("name", "s" + i, "type", "number"));
            row.add(i);
        }
        QueryRows many = new QueryRows(columns, List.of(row), 1, false, 0);

        Map<String, Object> option = converter.convert(many, "bar", Map.of(
                "palettePreset", "viridis",
                "palette", List.of("#000000", "#FFFFFF"),
                "autoColorMap", Map.of("s0", "#FF0000")
        ));
        Map<String, Object> auto = (Map<String, Object>) option.get("__chartsdkAutoColorMap");

        assertThat(auto).hasSize(10);
        assertThat(auto.get("s0")).isEqualTo("#000000");
        assertThat(auto.get("s5")).isEqualTo("#8E8E8E");
        assertThat(auto.get("s9")).isEqualTo("#FFFFFF");
        assertThat(auto.values()).doesNotHaveDuplicates();
    }

    @Test
    @SuppressWarnings("unchecked")
    void emitsRuntimeFormatMetadataAndPercentBarSizing() {
        Map<String, Object> option = converter.convert(rows(), "bar", Map.of(
                "tooltip", Map.of("valueFormat", "comma"),
                "yAxis", Map.of("format", "decimal1", "unit", "명"),
                "bar", Map.of("width", 55, "gap", 20)
        ));

        assertThat((Map<String, Object>) option.get("__chartsdkValueFormat"))
                .containsEntry("tooltip", "comma").containsEntry("yAxis", "decimal1").containsEntry("unit", "명");
        List<Map<String, Object>> series = (List<Map<String, Object>>) option.get("series");
        assertThat(series.get(0)).containsEntry("barWidth", "55%").containsEntry("barGap", "20%");
    }

    @Test
    void appliesColorToOnlyOneCartesianDataItem() {
        Map<String, Object> option = converter.convert(rows(), "bar", Map.of(
                "itemColorOverrides", List.of(Map.of(
                        "kind", "cartesian",
                        "seriesName", "amount",
                        "dimensions", List.of("B"),
                        "occurrence", 0,
                        "color", "#FFB000"
                ))
        ));

        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        List<?> data = (List<?>) series.get("data");
        assertThat(data.get(0)).isEqualTo(10);
        assertThat(((Map<?, ?>) ((Map<?, ?>) data.get(1)).get("itemStyle")).get("color")).isEqualTo("#FFB000");
    }

    @Test
    void linePointOverrideDoesNotChangeWholeLineColor() {
        Map<String, Object> option = converter.convert(rows(), "line", Map.of(
                "colorMap", Map.of("amount", "#112233"),
                "itemColorOverrides", List.of(Map.of(
                        "kind", "cartesian",
                        "seriesName", "amount",
                        "dimensions", List.of("A"),
                        "occurrence", 0,
                        "color", "#FFB000"
                ))
        ));

        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(((Map<?, ?>) series.get("lineStyle")).get("color")).isEqualTo("#112233");
        Map<?, ?> point = (Map<?, ?>) ((List<?>) series.get("data")).get(0);
        assertThat(((Map<?, ?>) point.get("itemStyle")).get("color")).isEqualTo("#FFB000");
    }

    @Test
    void mapItemOverrideUsesAreaColorAndKeepsVisualMap() {
        Map<String, Object> option = converter.convert(rows(), "map", Map.of(
                "itemColorOverrides", List.of(Map.of(
                        "kind", "map",
                        "seriesName", "__map__",
                        "dimensions", List.of("B"),
                        "occurrence", 0,
                        "color", "#FFB000"
                ))
        ));

        List<?> data = (List<?>) ((Map<?, ?>) ((List<?>) option.get("series")).get(0)).get("data");
        assertThat(((Map<?, ?>) data.get(0)).get("itemStyle")).isNull();
        assertThat(((Map<?, ?>) ((Map<?, ?>) data.get(1)).get("itemStyle")).get("areaColor")).isEqualTo("#FFB000");
        assertThat(option.get("visualMap")).isNotNull();
    }

    @Test
    void boxplotUsesSeriesColorMapAndItemOverride() {
        Map<String, Object> option = converter.convert(boxplotRows(), "boxplot", Map.of(
                "colorMap", Map.of("amount", "#112233"),
                "itemColorOverrides", List.of(Map.of(
                        "kind", "boxplot",
                        "seriesName", "__boxplot__",
                        "dimensions", List.of("B"),
                        "occurrence", 0,
                        "color", "#FFB000"
                ))
        ));

        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(((Map<?, ?>) series.get("itemStyle")).get("color")).isEqualTo("#112233");
        List<?> data = (List<?>) series.get("data");
        Map<?, ?> itemStyle = (Map<?, ?>) ((Map<?, ?>) data.get(1)).get("itemStyle");
        assertThat(itemStyle.get("color")).isEqualTo("#FFB000");
        assertThat(itemStyle.get("borderColor")).isEqualTo("#FFB000");
    }

    @Test
    void scatterPointIdentityUsesBothCoordinates() {
        Map<String, Object> option = converter.convert(rows(), "scatter", Map.of(
                "itemColorOverrides", List.of(Map.of(
                        "kind", "scatter",
                        "seriesName", "amount",
                        "dimensions", List.of("B", 20),
                        "occurrence", 0,
                        "color", "#FFB000"
                ))
        ));

        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        List<?> data = (List<?>) series.get("data");
        assertThat(data.get(0)).isEqualTo(List.of("A", 10));
        Map<?, ?> point = (Map<?, ?>) data.get(1);
        assertThat(point.get("value")).isEqualTo(List.of("B", 20));
        assertThat(((Map<?, ?>) point.get("itemStyle")).get("color")).isEqualTo("#FFB000");
    }

    @Test
    void acceptsShorthandHexOverrideColor() {
        Map<String, Object> option = converter.convert(rows(), "bar", Map.of(
                "itemColorOverrides", List.of(Map.of(
                        "kind", "cartesian",
                        "seriesName", "amount",
                        "dimensions", List.of("B"),
                        "occurrence", 0,
                        "color", "#fb0"
                ))
        ));

        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        List<?> data = (List<?>) series.get("data");
        assertThat(((Map<?, ?>) ((Map<?, ?>) data.get(1)).get("itemStyle")).get("color")).isEqualTo("#FFBB00");
    }

    @Test
    @SuppressWarnings("unchecked")
    void emitsDisplayMetadataWithoutRenamingPhysicalSeries() {
        Map<String, Object> builder = Map.of(
                "xAxis", "sales.category",
                "yAxis", List.of(Map.of("column", "sales.amount", "agg", "sum")),
                "fieldDisplayNames", Map.of(
                        "sales.category", "상품 분류",
                        "sales.amount", "매출액"
                )
        );

        Map<String, Object> option = converter.convert(rows(), "bar", Map.of(), builder);
        Map<String, Object> xAxis = (Map<String, Object>) option.get("xAxis");
        Map<String, Object> yAxis = (Map<String, Object>) option.get("yAxis");
        List<Map<String, Object>> series = (List<Map<String, Object>>) option.get("series");
        Map<String, Object> displayNames =
                (Map<String, Object>) option.get(FieldDisplayNameResolver.SERIES_DISPLAY_NAMES_KEY);
        Map<String, Object> tooltip = (Map<String, Object>) option.get("__chartsdkTooltip");
        List<Map<String, Object>> fields = (List<Map<String, Object>>) tooltip.get("fields");

        assertThat(xAxis.get("name")).isEqualTo("상품 분류");
        assertThat(yAxis.get("name")).isEqualTo("매출액 합계");
        assertThat(series.get(0).get("name")).isEqualTo("amount");
        assertThat(displayNames).containsEntry("amount", "매출액 합계");
        assertThat(fields).extracting(field -> field.get("label"))
                .contains("상품 분류", "매출액 합계");
    }

    private Map<String, Map<String, Object>> generatedDefaults() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/chart-defaults.json")) {
            assertThat(in).as("generated chart defaults").isNotNull();
            return new ObjectMapper().readValue(in, new TypeReference<>() {});
        }
    }
}
