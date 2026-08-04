package com.chartsdk.cache;

import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryRows;

/** Bounded post-JOIN rows stored by the L1 sampling cache. */
public record CachedResultSample(
        QueryRows rows,
        SamplingMetadata sampling,
        BuilderSqlBuilder.Sql sourceSql
) {
    public CachedResultSample {
        if (rows == null || sampling == null || sourceSql == null) {
            throw new IllegalArgumentException("rows, sampling, and sourceSql are required");
        }
    }
}
