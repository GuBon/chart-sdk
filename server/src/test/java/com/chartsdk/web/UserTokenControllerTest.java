package com.chartsdk.web;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

import com.chartsdk.token.TokenService;

import java.util.Map;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

class UserTokenControllerTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final TokenService tokens = mock(TokenService.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mvc = standaloneSetup(new UserTokenController(jdbc, tokens))
                .setControllerAdvice(new ApiExceptionHandler())
                .setValidator(validator)
                .build();
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 3651})
    void issueRejectsExpiryOutsideOneTo3650WithFieldError(int expiresInDays) throws Exception {
        mvc.perform(post("/api/v1/users/7/tokens")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expiresInDays\":" + expiresInDays + "}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.fields.expiresInDays").exists());

        verifyNoInteractions(tokens);
    }

    @Test
    void issueUses365DayDefaultWhenBodyIsAbsent() throws Exception {
        when(tokens.issue(7L, 365)).thenReturn(Map.of("tokenId", 10L));

        mvc.perform(post("/api/v1/users/7/tokens"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenId").value(10));

        verify(tokens).issue(7L, 365);
    }
}
