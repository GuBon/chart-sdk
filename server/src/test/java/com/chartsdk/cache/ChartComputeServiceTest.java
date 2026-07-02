package com.chartsdk.cache;

import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.QueryRows;
import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 서빙 경로 불변식(설계 §8) — {@link ChartComputeService#serve} 단일 진입점(임베드·목록/미리보기 공유).
 * 다중 소스 차트는 페더레이션(재계산)을 절대 호출하지 않고 캐시 스냅샷만 반환하고,
 * 단일 소스는 캐시 미스/만료 시 단일 비행 재계산을 유지한다.
 */
class ChartComputeServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final FederatedQueryRunner runner = mock(FederatedQueryRunner.class);
    private final ChartCacheService cache = mock(ChartCacheService.class);
    private final ChartComputeService compute = spy(new ChartComputeService(jdbc, runner, cache));

    private static CachedChartRows snapshot() {
        return new CachedChartRows(new QueryRows(List.of(), List.of(), 0, false, 1), Instant.now());
    }

    @Test
    void multiSourceServesCacheSnapshotWithoutFederating() {
        doReturn(true).when(compute).isMultiSource(1L);
        when(cache.find(1L)).thenReturn(Optional.of(snapshot()));

        assertThat(compute.serve(1L, 2L, "SELECT 1", "manual", 3600, 0)).isNotNull();

        // 핵심 불변식: 다중 소스 서빙은 재계산(페더레이션)을 절대 호출하지 않는다.
        verify(compute, never()).refreshSingleFlight(anyLong(), anyLong(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void multiSourceWithoutSnapshotThrowsInsteadOfFederating() {
        doReturn(true).when(compute).isMultiSource(1L);
        when(cache.find(1L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> compute.serve(1L, 2L, "SELECT 1", "manual", 3600, 0))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("snapshot is not ready");

        verify(compute, never()).refreshSingleFlight(anyLong(), anyLong(), anyString(), anyInt(), anyBoolean());
    }

    @Test
    void singleSourceRecomputesOnCacheMiss() {
        doReturn(false).when(compute).isMultiSource(1L);
        when(cache.findUsable(1L, "ttl", 3600, 0)).thenReturn(Optional.empty());
        doReturn(snapshot()).when(compute).refreshSingleFlight(1L, 2L, "SELECT 1", 0, true);

        assertThat(compute.serve(1L, 2L, "SELECT 1", "ttl", 3600, 0)).isNotNull();

        verify(compute, times(1)).refreshSingleFlight(1L, 2L, "SELECT 1", 0, true);
    }

    @Test
    void isMultiSourceCountsJunctionRows() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(2);
        assertThat(compute.isMultiSource(1L)).isTrue();

        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(1);
        assertThat(compute.isMultiSource(1L)).isFalse();

        when(jdbc.queryForObject(anyString(), eq(Integer.class), any())).thenReturn(null);
        assertThat(compute.isMultiSource(1L)).isFalse();
    }
}
