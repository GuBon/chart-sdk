package com.chartsdk.chart;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ChartRepositoryTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ChartRepository repository = new ChartRepository(jdbc, new ObjectMapper());

    @Test
    void duplicateKeepsGeneratedNameInsideVarchar200Boundary() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(99L);

        assertThat(repository.duplicate(null, 7L)).isEqualTo(99L);

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForObject(sql.capture(), eq(Long.class), arguments.capture());
        assertThat(sql.getValue()).contains("LEFT(name, ?) || ?");
        assertThat(arguments.getValue()).containsExactly(195, " (복사)", 7L);
    }
}
