package com.chartsdk.web;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.WebRequest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

class ApiExceptionHandlerTest {
    private final ApiExceptionHandler handler = new ApiExceptionHandler();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mvc = standaloneSetup(new ProbeController())
                .setControllerAdvice(handler)
                .setValidator(validator)
                .build();
    }

    @AfterEach
    void clearRequestId() {
        MDC.remove("requestId");
    }

    @Test
    void validationReturns400EnvelopeWithFieldMessages() throws Exception {
        mvc.perform(post("/probe/validated")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.fields.name").value("이름은 필수입니다."));
    }

    @Test
    void methodNotAllowedPreservesAllowHeader() throws Exception {
        mvc.perform(post("/probe"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(header().string(HttpHeaders.ALLOW, "GET"))
                .andExpect(jsonPath("$.error.code").value("METHOD_NOT_ALLOWED"));
    }

    @Test
    void unsupportedMediaTypeReturns415Envelope() throws Exception {
        mvc.perform(post("/probe/json")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("name=test"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(header().string(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE))
                .andExpect(jsonPath("$.error.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    @Test
    void notAcceptableReturns406EnvelopeAndSupportedMediaHeader() throws Exception {
        mvc.perform(get("/probe").accept(MediaType.APPLICATION_XML))
                .andExpect(status().isNotAcceptable())
                .andExpect(header().string(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE))
                .andExpect(jsonPath("$.error.code").value("NOT_ACCEPTABLE"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void notFoundUses404Envelope() {
        ResponseEntity<Object> response = handler.handleExceptionInternal(
                new IllegalArgumentException("missing"), null, HttpHeaders.EMPTY,
                HttpStatus.NOT_FOUND, mock(WebRequest.class));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        Map<String, Object> error = (Map<String, Object>) ((Map<String, Object>) response.getBody()).get("error");
        assertThat(error).containsEntry("code", "NOT_FOUND");
    }

    @Test
    @SuppressWarnings("unchecked")
    void unexpectedErrorIncludesRequestIdForSupportCorrelation() {
        MDC.put("requestId", "req-test-500");

        ResponseEntity<Map<String, Object>> response = handler.handleUnexpected(new RuntimeException("boom"));

        Map<String, Object> error = (Map<String, Object>) response.getBody().get("error");
        assertThat(error)
                .containsEntry("code", "INTERNAL_ERROR")
                .containsEntry("requestId", "req-test-500");
    }

    @RestController
    static class ProbeController {
        @GetMapping(value = "/probe", produces = MediaType.APPLICATION_JSON_VALUE)
        Map<String, Object> get() {
            return Map.of("ok", true);
        }

        @PostMapping(value = "/probe/json", consumes = MediaType.APPLICATION_JSON_VALUE)
        Map<String, Object> json(@RequestBody Map<String, Object> body) {
            return body;
        }

        @PostMapping("/probe/validated")
        void validate(@Valid @RequestBody ProbeInput input) {
        }
    }

    record ProbeInput(@NotBlank(message = "이름은 필수입니다.") String name) {
    }
}
