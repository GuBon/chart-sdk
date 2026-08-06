package com.chartsdk.query;

/** Result of a full point-result scan whose retained rows may have switched to reservoir sampling. */
public record PointCollectionResult(QueryRows rows, long populationCount) {
    public boolean sampled() {
        return populationCount > rows.rowCount();
    }
}
