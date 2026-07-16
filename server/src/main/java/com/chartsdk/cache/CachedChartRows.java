package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;

import java.time.Instant;

public record CachedChartRows(QueryRows rows, Instant computedAt, SamplingMetadata sampling) {
    public CachedChartRows(QueryRows rows, Instant computedAt) {
        this(rows, computedAt, null);
    }

    public CachedChartRows withSampling(SamplingMetadata definitionSampling) {
        return new CachedChartRows(rows, computedAt, definitionSampling);
    }
}
