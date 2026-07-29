package com.chartsdk.web;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class HttpCachePolicyFilterTest {
    private final HttpCachePolicyFilter filter = new HttpCachePolicyFilter();
    private final FilterChain chain = mock(FilterChain.class);

    @Test
    void apiResponsesAreNeverStoredByTheBrowser() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/charts/data");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
    }

    @Test
    void versionedMapsAreImmutableButUnversionedMapsRevalidate() throws Exception {
        MockHttpServletRequest versioned = new MockHttpServletRequest("GET", "/maps/kr-sido.json");
        versioned.setParameter("v", "v1");
        MockHttpServletResponse versionedResponse = new MockHttpServletResponse();
        filter.doFilter(versioned, versionedResponse, chain);
        assertThat(versionedResponse.getHeader("Cache-Control"))
                .isEqualTo("public, max-age=31536000, immutable");

        MockHttpServletRequest unversioned = new MockHttpServletRequest("GET", "/maps/kr-sido.json");
        MockHttpServletResponse unversionedResponse = new MockHttpServletResponse();
        filter.doFilter(unversioned, unversionedResponse, chain);
        assertThat(unversionedResponse.getHeader("Cache-Control"))
                .isEqualTo("public, max-age=3600, must-revalidate");
    }
}
