package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DataDisplayNameServiceTest {

    private static final SchemaCatalog CATALOG = SchemaCatalog.ofPublic(Map.of(
            "sales", Map.of("amount", "numeric")
    ));

    @Test
    void upsertsAndClearsOverridesWithoutChangingTheDatasourceSchema() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(contains("SELECT EXISTS"), eq(Boolean.class), eq(7L)))
                .thenReturn(true);
        DataDisplayNameService service = new DataDisplayNameService(jdbc);

        service.update(7L, "public", "sales", "amount", "  매출액  ", CATALOG);
        service.update(7L, "public", "sales", "amount", " ", CATALOG);

        verify(jdbc).update(
                contains("INSERT INTO mc_data_display_name"),
                eq(7L), eq("public"), eq("sales"), eq("amount"), eq("매출액")
        );
        verify(jdbc).update(
                contains("DELETE FROM mc_data_display_name"),
                eq(7L), eq("public"), eq("sales"), eq("amount")
        );
    }

    @Test
    void rejectsUnknownPhysicalIdentifiersBeforeWritingMetadata() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        DataDisplayNameService service = new DataDisplayNameService(jdbc);

        assertThatThrownBy(() ->
                service.update(7L, "public", "sales", "missing", "표시 이름", CATALOG))
                .isInstanceOfSatisfying(ApiException.class, error ->
                        assertThat(error.code()).isEqualTo("INVALID_IDENTIFIER"));

        verifyNoInteractions(jdbc);
    }
}
