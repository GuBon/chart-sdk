package com.chartsdk.query;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.SplittableRandom;

/** Deterministic Algorithm-R collector that bounds retained point rows while counting all rows. */
public final class ReservoirPointCollector {
    private ReservoirPointCollector() {
    }

    public static PointCollectionResult collect(ResultSet resultSet, long startNanos,
                                                int targetSize, long seed) throws SQLException {
        int capacity = Math.max(1, targetSize);
        ResultSetMetaData metadata = resultSet.getMetaData();
        int columnCount = metadata.getColumnCount();
        List<Map<String, Object>> columns = new ArrayList<>(columnCount);
        for (int index = 1; index <= columnCount; index++) {
            columns.add(Map.of(
                    "name", metadata.getColumnLabel(index),
                    "type", metadata.getColumnTypeName(index)));
        }

        SplittableRandom random = new SplittableRandom(seed);
        List<RetainedRow> reservoir = new ArrayList<>(capacity);
        long populationCount = 0;
        while (resultSet.next()) {
            long ordinal = populationCount++;
            if (reservoir.size() < capacity) {
                reservoir.add(new RetainedRow(ordinal, materialize(resultSet, columnCount)));
                continue;
            }
            long selected = random.nextLong(populationCount);
            if (selected < capacity) {
                reservoir.set((int) selected, new RetainedRow(ordinal, materialize(resultSet, columnCount)));
            }
        }

        reservoir.sort(Comparator.comparingLong(RetainedRow::ordinal));
        List<List<Object>> rows = reservoir.stream().map(RetainedRow::values).toList();
        long elapsedMs = Math.max(1, (System.nanoTime() - startNanos) / 1_000_000);
        return new PointCollectionResult(
                new QueryRows(List.copyOf(columns), rows, rows.size(), false, elapsedMs),
                populationCount);
    }

    private static List<Object> materialize(ResultSet resultSet, int columnCount) throws SQLException {
        List<Object> row = new ArrayList<>(columnCount);
        for (int index = 1; index <= columnCount; index++) row.add(resultSet.getObject(index));
        return row;
    }

    private record RetainedRow(long ordinal, List<Object> values) {
    }
}
