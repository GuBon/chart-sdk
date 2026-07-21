package com.chartsdk.web;

import com.chartsdk.datasource.DatasourceInput;
import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.datasource.DatasourceView;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DatasourceControllerTest {
    private final DatasourceService service = mock(DatasourceService.class);
    private final DatasourcePoolRegistry pools = mock(DatasourcePoolRegistry.class);
    private final DatasourceController controller = new DatasourceController(service, pools);
    private final DatasourceInput input = new DatasourceInput("analytics", "localhost", 5432, "analytics", "reader", null, 5);

    @Test
    void updateEvictsExistingPoolAfterCredentialsChange() {
        DatasourceView expected = new DatasourceView(7L, "analytics", "localhost", 5432, "analytics", "reader", 5, null, null);
        when(service.update(7L, input)).thenReturn(expected);

        assertThat(controller.update(7L, input)).isSameAs(expected);
        verify(pools).evict(7L);
    }

    @Test
    void deleteEvictsExistingPoolAfterSuccessfulDeactivation() {
        controller.delete(7L);

        verify(service).delete(7L);
        verify(pools).evict(7L);
    }
}
