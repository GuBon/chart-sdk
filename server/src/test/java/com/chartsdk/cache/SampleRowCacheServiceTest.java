package com.chartsdk.cache;

import com.chartsdk.datasource.DatasourceRuntimeVersions;
import com.chartsdk.metrics.CapacityMetrics;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class SampleRowCacheServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final DatasourceRuntimeVersions versions = new DatasourceRuntimeVersions();
    private final SampleRowCacheService cache = new SampleRowCacheService(
            jdbc,
            mock(SampleCacheBuildLeaseRepository.class),
            new ObjectMapper(),
            mock(PlatformTransactionManager.class),
            900,
            86_400,
            64 * 1024 * 1024,
            128 * 1024 * 1024,
            512 * 1024 * 1024,
            2,
            35,
            100,
            versions,
            CapacityMetrics.noOp());

    @Test
    void blockedDatasourceBypassesSampleCacheWithoutBlockingTheLiveResult() {
        CachedResultSample loaded = new CachedResultSample(
                new QueryRows(List.of(), List.of(), 0, false, 1),
                SamplingMetadata.system(10),
                new BuilderSqlBuilder.Sql("SELECT 1", List.of(), SamplingMetadata.system(10)));
        versions.beginCacheInvalidation(7L);

        CachedResultSample result = cache.getOrLoad("fingerprint", 7L, List.of(7L), 900, () -> loaded);

        assertThat(result).isSameAs(loaded);
        verifyNoInteractions(jdbc);
    }
}
