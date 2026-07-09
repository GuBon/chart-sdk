package com.chartsdk.converter;

import com.chartsdk.config.OptionDefaults;
import com.chartsdk.query.QueryRows;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ChartOptionConverterTest {
    private final ChartOptionConverter converter = new ChartOptionConverter(new OptionDefaults(Map.of()));

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
