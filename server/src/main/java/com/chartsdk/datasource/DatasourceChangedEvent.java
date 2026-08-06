package com.chartsdk.datasource;

/** Published inside datasource mutations and handled only after the metadata transaction commits. */
public record DatasourceChangedEvent(long datasourceId, Impact impact) {
    public enum Impact {
        POOL_CONFIGURATION,
        SOURCE_IDENTITY,
        DELETED
    }
}
