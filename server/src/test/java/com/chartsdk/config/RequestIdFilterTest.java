package com.chartsdk.config;

import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class RequestIdFilterTest {
    private final RequestIdFilter filter = new RequestIdFilter();

    @Test
    void preservesOnlySafeTrimmedRequestIdAndClearsMdc() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/charts");
        request.addHeader("X-Request-Id", "  gateway_01:trace-2  ");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> duringRequest = new AtomicReference<>();

        filter.doFilter(request, response, (req, res) -> duringRequest.set(MDC.get("requestId")));

        assertThat(duringRequest).hasValue("gateway_01:trace-2");
        assertThat(response.getHeader("X-Request-Id")).isEqualTo("gateway_01:trace-2");
        assertThat(MDC.get("requestId")).isNull();
    }

    @Test
    void replacesUnsafeRequestId() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/charts");
        request.addHeader("X-Request-Id", "unsafe id");
        MockHttpServletResponse response = new MockHttpServletResponse();
        AtomicReference<String> duringRequest = new AtomicReference<>();

        filter.doFilter(request, response, (req, res) -> duringRequest.set(MDC.get("requestId")));

        assertThat(duringRequest.get()).matches("[0-9a-f]{8}");
        assertThat(response.getHeader("X-Request-Id")).isEqualTo(duringRequest.get());
        assertThat(MDC.get("requestId")).isNull();
    }
}
