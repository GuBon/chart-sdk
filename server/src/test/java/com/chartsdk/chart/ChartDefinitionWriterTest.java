package com.chartsdk.chart;

import com.chartsdk.web.dto.ChartSaveRequest;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ChartDefinitionWriterTest {
    private final ChartRepository charts = mock(ChartRepository.class);
    private final ChartDefinitionWriter writer = new ChartDefinitionWriter(charts);

    @Test
    void metadataAndDatasourceLinksShareOneTransactionBoundary() throws Exception {
        assertThat(ChartDefinitionWriter.class
                .getMethod("create", Long.class, ChartSaveRequest.class, Set.class)
                .getAnnotation(Transactional.class)).isNotNull();
        assertThat(ChartDefinitionWriter.class
                .getMethod("update", Long.class, long.class, ChartSaveRequest.class, Set.class)
                .getAnnotation(Transactional.class)).isNotNull();
    }

    @Test
    void createWritesDefinitionBeforeReplacingItsDatasourceSet() {
        ChartSaveRequest input = request(null);
        when(charts.create(null, input)).thenReturn(41L);

        ChartDefinitionWriter.SavedChart saved = writer.create(null, input, Set.of(2L, 3L));

        assertThat(saved).isEqualTo(new ChartDefinitionWriter.SavedChart(41L, 0));
        var order = inOrder(charts);
        order.verify(charts).create(null, input);
        order.verify(charts).setChartDatasources(null, 41L, Set.of(2L, 3L));
    }

    private static ChartSaveRequest request(Integer version) {
        return new ChartSaveRequest("chart", null, 2L, "builder", "SELECT 1",
                Map.of("table", "sales"), "bar", Map.of(), "manual", version);
    }
}
