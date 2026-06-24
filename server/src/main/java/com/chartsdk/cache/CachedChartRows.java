package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;

import java.time.Instant;

public record CachedChartRows(QueryRows rows, Instant computedAt) {
}
