package com.chartsdk.converter;

import com.chartsdk.query.QueryRows;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SeriesPivotTest {
    private final QueryRows longRows = new QueryRows(
            List.of(
                    Map.of("name", "region", "type", "text"),
                    Map.of("name", "year", "type", "integer"),
                    Map.of("name", "population", "type", "bigint")
            ),
            List.of(
                    List.of("서울", 2013, 10_300_000),
                    List.of("부산", 2012, 3_500_000),
                    List.of("서울", 2012, 10_400_000),
                    List.of("부산", 2013, 3_480_000)
            ), 4, false, 9
    );

    @Test
    void pivotsLongRowsAndSortsSeriesNaturally() {
        QueryRows pivoted = SeriesPivot.pivot(longRows, Map.of("seriesBy", "year", "seriesOrder", "asc"));

        assertThat(pivoted.columns()).extracting(column -> column.get("name"))
                .containsExactly("region", "2012", "2013");
        assertThat(pivoted.rows()).containsExactly(
                List.of("서울", 10_400_000, 10_300_000),
                List.of("부산", 3_500_000, 3_480_000)
        );
        assertThat(pivoted.rowCount()).isEqualTo(2);
    }

    @Test
    void fillsMissingCellsWithNullAndLabelsNullSeries() {
        QueryRows input = new QueryRows(longRows.columns(), List.of(
                java.util.Arrays.asList("서울", null, 1),
                List.of("부산", 2012, 2)
        ), 2, false, 1);

        QueryRows pivoted = SeriesPivot.pivot(input, Map.of("seriesBy", "year"));
        assertThat(pivoted.columns()).extracting(column -> column.get("name"))
                .containsExactly("region", "2012", "미분류");
        assertThat(pivoted.rows().get(0)).containsExactly("서울", null, 1);
    }

    @Test
    void rejectsDuplicateXSeriesCells() {
        QueryRows duplicate = new QueryRows(longRows.columns(), List.of(
                List.of("서울", 2012, 1), List.of("서울", 2012, 2)
        ), 2, false, 1);

        assertThatThrownBy(() -> SeriesPivot.pivot(duplicate, Map.of("seriesBy", "year")))
                .hasMessageContaining("서울 / 2012");
    }
}
