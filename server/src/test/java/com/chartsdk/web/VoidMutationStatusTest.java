package com.chartsdk.web;

import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.token.EmbedKeyService;
import com.chartsdk.token.TokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

class VoidMutationStatusTest {
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = standaloneSetup(
                new EmbedKeyController(mock(EmbedKeyService.class)),
                new UserTokenController(mock(JdbcTemplate.class), mock(TokenService.class)),
                new DatasourceController(mock(DatasourceService.class)))
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @Test
    void allVoidDeletesReturn204WithoutBody() throws Exception {
        for (String path : new String[]{"/api/v1/embed-keys/1", "/api/v1/tokens/1", "/api/v1/datasources/1"}) {
            mvc.perform(delete(path))
                    .andExpect(status().isNoContent())
                    .andExpect(content().string(""));
        }
    }
}
