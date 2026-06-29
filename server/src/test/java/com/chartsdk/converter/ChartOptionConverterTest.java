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
}
