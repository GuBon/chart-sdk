package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ReservoirPointCollectorTest {
    @Test
    void boundsMemoryCountsPopulationAndIsDeterministicForTheSameInputOrder() throws Exception {
        PointCollectionResult first = collect(100, 10, 77);
        PointCollectionResult second = collect(100, 10, 77);

        assertThat(first.populationCount()).isEqualTo(100);
        assertThat(first.rows().rowCount()).isEqualTo(10);
        assertThat(first.sampled()).isTrue();
        assertThat(first.rows().rows()).isEqualTo(second.rows().rows());
        assertThat(first.rows().rows()).extracting(row -> (Integer) row.get(0)).isSorted();
        assertThat(first.rows().truncated()).isFalse();
    }

    @Test
    void keepsTheExactResultWhenPopulationDoesNotExceedTarget() throws Exception {
        PointCollectionResult result = collect(10, 10, 77);

        assertThat(result.sampled()).isFalse();
        assertThat(result.rows().rowCount()).isEqualTo(10);
        assertThat(result.rows().rows()).extracting(row -> row.get(0))
                .containsExactly(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    }

    @Test
    void materializesOnlyRowsSelectedForRetention() throws Exception {
        int population = 10_000;
        AtomicInteger materializedRows = new AtomicInteger();
        PointCollectionResult result = collect(population, 10, 77, materializedRows);

        assertThat(result.populationCount()).isEqualTo(population);
        assertThat(result.rows().rowCount()).isEqualTo(10);
        assertThat(materializedRows.get()).isGreaterThanOrEqualTo(10).isLessThan(population / 10);
    }

    private static PointCollectionResult collect(int population, int target, long seed) throws Exception {
        return collect(population, target, seed, new AtomicInteger());
    }

    private static PointCollectionResult collect(int population, int target, long seed,
                                                  AtomicInteger materializedRows) throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        ResultSetMetaData metadata = mock(ResultSetMetaData.class);
        AtomicInteger cursor = new AtomicInteger(-1);
        when(resultSet.getMetaData()).thenReturn(metadata);
        when(metadata.getColumnCount()).thenReturn(1);
        when(metadata.getColumnLabel(1)).thenReturn("point_id");
        when(metadata.getColumnTypeName(1)).thenReturn("integer");
        when(resultSet.next()).thenAnswer(ignored -> cursor.incrementAndGet() < population);
        when(resultSet.getObject(1)).thenAnswer(ignored -> {
            materializedRows.incrementAndGet();
            return cursor.get();
        });
        return ReservoirPointCollector.collect(resultSet, System.nanoTime(), target, seed);
    }
}
