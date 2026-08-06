package com.chartsdk.datasource;

import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DatasourceRuntimeVersionsTest {
    private final DatasourceRuntimeVersions versions = new DatasourceRuntimeVersions();

    @Test
    void blocksOnlyAffectedCacheAccessAndRestoresItAfterCompletion() {
        Map<Long, Long> staleSnapshot = versions.snapshot(List.of(7L));
        versions.beginCacheInvalidation(7L);
        Map<Long, Long> blockedSnapshot = versions.snapshot(List.of(7L));
        Map<Long, Long> unaffectedSnapshot = versions.snapshot(List.of(8L));
        AtomicInteger operations = new AtomicInteger();

        assertThatThrownBy(() -> versions.readCache(
                staleSnapshot, List.of(7L), () -> Optional.of("stale")))
                .isInstanceOfSatisfying(ApiException.class,
                        failure -> assertThat(failure.code()).isEqualTo("DATASOURCE_CHANGED_DURING_QUERY"));
        assertThat(versions.readCache(blockedSnapshot, List.of(7L), () -> {
            operations.incrementAndGet();
            return Optional.of("blocked");
        })).isEmpty();
        assertThat(versions.writeCache(blockedSnapshot, List.of(7L), operations::incrementAndGet)).isFalse();
        assertThat(versions.readCache(unaffectedSnapshot, List.of(8L), () -> {
            operations.incrementAndGet();
            return Optional.of("available");
        })).contains("available");
        assertThat(operations).hasValue(1);

        versions.completeCacheInvalidation(7L);

        assertThat(versions.readCache(blockedSnapshot, List.of(7L), () -> Optional.of("restored")))
                .contains("restored");
        assertThat(versions.writeCache(blockedSnapshot, List.of(7L), operations::incrementAndGet)).isTrue();
        assertThat(operations).hasValue(2);
    }
}
