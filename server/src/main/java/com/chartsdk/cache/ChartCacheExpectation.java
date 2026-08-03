package com.chartsdk.cache;

/** Definition identity required for a cached chart payload to be reusable. */
public record ChartCacheExpectation(int definitionVersion, SamplingMetadata sampling) {
}
