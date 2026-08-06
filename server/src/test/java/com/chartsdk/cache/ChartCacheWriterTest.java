package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChartCacheWriterTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ChartCacheWriter writer = new ChartCacheWriter(jdbc);
    private final QueryRows rows = new QueryRows(List.of(), List.of(), 0, false, 1);

    @Test
    void cacheWriteUsesAnIndependentShortTransaction() throws Exception {
        Transactional annotation = ChartCacheWriter.class
                .getMethod("upsert", long.class, String.class, QueryRows.class, int.class)
                .getAnnotation(Transactional.class);

        assertThat(annotation).isNotNull();
        assertThat(annotation.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
    }

    @Test
    @SuppressWarnings("unchecked")
    void staleComputationCannotOverwriteCurrentCache() {
        when(jdbc.query(anyString(), any(org.springframework.jdbc.core.ResultSetExtractor.class), any()))
                .thenAnswer(invocation -> 8);

        assertThatThrownBy(() -> writer.upsert(12L, "{}", rows, 7))
                .isInstanceOf(StaleChartDefinitionException.class)
                .hasMessageContaining("executed version 7", "current version 8");

        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
}
