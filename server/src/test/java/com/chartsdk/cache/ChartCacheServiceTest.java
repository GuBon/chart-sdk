package com.chartsdk.cache;

import com.chartsdk.datasource.DatasourceRuntimeVersions;
import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChartCacheServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final ChartCacheWriter writer = mock(ChartCacheWriter.class);
    private final DatasourceRuntimeVersions versions = new DatasourceRuntimeVersions();
    private final ChartCacheService cache = new ChartCacheService(jdbc, mapper, writer, versions);

    @Test
    @SuppressWarnings("unchecked")
    void servesDefinitionCompatibleV7SnapshotAsCurrentV9Contract() throws Exception {
        SamplingMetadata definition = SamplingMetadata.fromBuilderConfig(Map.of(
                "sample", Map.of("mode", "auto", "size", 10_000, "seed", 77)));
        SamplingMetadata legacy = SamplingMetadata.fromMap(Map.of(
                "version", 7, "mode", "auto", "requestedMethod", "auto",
                "approximate", true, "method", "INDEX_RANDOM", "valueMode", "sample",
                "sizeTarget", 10_000, "seed", 77, "populationEstimate", 1_000_000,
                "sampleSize", 10_000));
        QueryRows rows = new QueryRows(List.of(), List.of(), 0, false, 3);
        String payload = new CachedChartPayloadCodec(mapper).write(rows, legacy);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), eq(11L))).thenAnswer(invocation -> {
            ResultSet resultSet = mock(ResultSet.class);
            when(resultSet.next()).thenReturn(true);
            when(resultSet.getString("result")).thenReturn(payload);
            when(resultSet.getTimestamp("computed_at")).thenReturn(Timestamp.from(Instant.EPOCH));
            when(resultSet.getObject("definition_version", Integer.class)).thenReturn(4);
            ResultSetExtractor<Optional<CachedChartRows>> extractor = invocation.getArgument(1);
            return extractor.extractData(resultSet);
        });

        Optional<CachedChartRows> restored = cache.findCompatible(11L, 4, definition);

        assertThat(restored).isPresent();
        assertThat(restored.orElseThrow().sampling().version()).isEqualTo(SamplingMetadata.CONTRACT_VERSION);
        assertThat(restored.orElseThrow().sampling()).usingRecursiveComparison()
                .ignoringFields("version")
                .isEqualTo(legacy);
    }

    @Test
    @SuppressWarnings("unchecked")
    void skipsOnlyChartsThatReferenceABlockedDatasource() {
        versions.beginCacheInvalidation(7L);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class)))
                .thenAnswer(invocation -> invocation.getArgument(2, Long.class).equals(11L));
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), eq(12L)))
                .thenReturn(Optional.empty());
        QueryRows rows = new QueryRows(List.of(), List.of(), 0, false, 1);

        assertThat(cache.findCompatible(11L, 1, null)).isEmpty();
        assertThat(cache.findCompatible(12L, 1, null)).isEmpty();
        cache.upsert(11L, rows, 1, null);

        verify(jdbc, times(1)).query(anyString(), any(ResultSetExtractor.class), eq(12L));
        verify(writer, never()).upsert(eq(11L), anyString(), eq(rows), eq(1));
    }
}
