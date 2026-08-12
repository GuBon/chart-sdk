package com.chartsdk.token;

import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class TokenServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final JwtTokenProvider jwt = mock(JwtTokenProvider.class);
    private final TokenService service = new TokenService(jdbc, jwt);

    @Test
    void issueReportsMissingActiveUserBeforeRotatingTokens() {
        when(jdbc.queryForObject(
                "SELECT count(*) FROM mc_user WHERE id=? AND is_active=true", Integer.class, 404L))
                .thenReturn(0);

        assertThatThrownBy(() -> service.issue(404L, 365))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("USER_NOT_FOUND");
        verifyNoInteractions(jwt);
    }
}
