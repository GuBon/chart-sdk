package com.chartsdk.embed;

import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartCacheService;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Phase 4 — 서빙 경로 불변식(설계 §8): 다중 소스 차트는 임베드 서빙에서 페더레이션(refreshSingleFlight)을
 * 절대 호출하지 않고 캐시 스냅샷만 반환한다. 단일 소스는 기존 재계산 동작을 보존한다.
 */
class EmbedChartServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ChartCacheService cache = mock(ChartCacheService.class);
    private final ChartComputeService compute = mock(ChartComputeService.class);
    private final EmbedChartService service = new EmbedChartService(jdbc, null, cache, compute, mock(ChartOptionConverter.class));

    private static EmbedChartService.ChartDefinition chart() {
        return new EmbedChartService.ChartDefinition(1L, 2L, "SELECT 1", "bar", Map.of(), "manual", 3600, 0);
    }

    private static CachedChartRows snapshot() {
        return new CachedChartRows(new QueryRows(List.of(), List.of(), 0, false, 1), Instant.now());
    }

    @Test
    void multiSourceServesCacheSnapshotWithoutFederating() {
        when(cache.find(1L)).thenReturn(Optional.of(snapshot()));

        assertThat(service.servedRows(chart(), true)).isNotNull();

        // 핵심 불변식: 다중 소스 서빙은 재계산(페더레이션)을 절대 호출하지 않는다.
        verify(compute, never()).refreshSingleFlight(anyLong(), anyLong(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void multiSourceWithoutSnapshotThrowsInsteadOfFederatingOnHotPath() {
        when(cache.find(1L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.servedRows(chart(), true))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("snapshot is not ready");

        verify(compute, never()).refreshSingleFlight(anyLong(), anyLong(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void singleSourceStillRecomputesOnCacheMiss() {
        when(cache.findUsable(anyLong(), anyString(), anyInt(), anyInt())).thenReturn(Optional.empty());
        when(compute.refreshSingleFlight(anyLong(), anyLong(), anyString(), anyInt(), anyBoolean())).thenReturn(snapshot());

        assertThat(service.servedRows(chart(), false)).isNotNull();

        verify(compute, times(1)).refreshSingleFlight(1L, 2L, "SELECT 1", 0, true);
    }
}
