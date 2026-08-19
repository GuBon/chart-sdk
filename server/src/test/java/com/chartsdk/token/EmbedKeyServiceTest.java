package com.chartsdk.token;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.dao.CannotAcquireLockException;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.OptionalLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class EmbedKeyServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final EmbedKeyCodec codec = new EmbedKeyCodec("test-embed-key-secret");
    private final CurrentUserProvider currentUser = () -> OptionalLong.of(7L);
    private final EmbedKeyService service = new EmbedKeyService(jdbc, codec, currentUser);

    @Test
    void issueReportsMissingActiveUserBeforeTouchingKeys() {
        when(jdbc.queryForObject(
                "SELECT count(*) FROM mc_user WHERE id=? AND is_active=true", Integer.class, 404L))
                .thenReturn(0);

        assertThatThrownBy(() -> service.issueFor(12L, 404L, 365))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("USER_NOT_FOUND");
        verify(jdbc, never()).update(anyString(), any(), any());
    }

    @Test
    void issueHidesChartsOutsideOwnerScope() {
        when(jdbc.queryForObject(
                "SELECT count(*) FROM mc_user WHERE id=? AND is_active=true", Integer.class, 7L))
                .thenReturn(1);
        // 다른 사용자 소유 차트 — 발급 시점에 존재를 숨기고 404 (서빙이 아니라 발급이 소유자 범위를 지킨다)
        when(jdbc.query(contains("FOR UPDATE NOWAIT"), any(ResultSetExtractor.class), eq(99L), eq(7L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    ResultSetExtractor<?> extractor = invocation.getArgument(1);
                    return extractor.extractData(rs);
                });

        assertThatThrownBy(() -> service.issueFor(99L, 7L, 365))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("CHART_NOT_FOUND");
        verify(jdbc, never()).update(contains("ROTATED"), eq(99L), eq(7L));
    }

    @Test
    void listReturnsMetadataWithoutReconstructingBearerKey() {
        when(jdbc.queryForObject(
                "SELECT count(*) FROM mc_chart WHERE id=? AND owner_id=?", Integer.class, 12L, 7L)).thenReturn(1);
        when(jdbc.query(contains("FROM mc_embed_key k"), any(RowMapper.class), eq(12L), eq(7L), eq(7L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("id")).thenReturn(101L);
                    when(rs.getLong("user_id")).thenReturn(7L);
                    when(rs.getLong("chart_id")).thenReturn(12L);
                    when(rs.getBoolean("is_active")).thenReturn(true);
                    when(rs.getTimestamp("expires_at")).thenReturn(Timestamp.from(Instant.now().plus(30, ChronoUnit.DAYS)));
                    when(rs.getTimestamp("created_at")).thenReturn(Timestamp.from(Instant.now().minus(1, ChronoUnit.DAYS)));
                    RowMapper<EmbedKeySummary> mapper = invocation.getArgument(1);
                    return List.of(mapper.mapRow(rs, 0));
                });

        List<EmbedKeySummary> result = service.listForChart(12L);

        assertThat(result).singleElement().satisfies(summary -> {
            assertThat(summary.status()).isEqualTo(EmbedKeyStatus.ACTIVE);
            assertThat(summary.getClass().getRecordComponents())
                    .extracting(component -> component.getName())
                    .doesNotContain("embedKey");
        });
        verify(jdbc, never()).query(contains("FROM mc_embed_key k"), any(ResultSetExtractor.class), eq(101L));
    }

    @Test
    void issueMapsNowaitLockConflictToStable409Code() {
        when(jdbc.queryForObject(
                "SELECT count(*) FROM mc_user WHERE id=? AND is_active=true", Integer.class, 7L))
                .thenReturn(1);
        SQLException sql = new SQLException("could not obtain lock", "55P03");
        when(jdbc.query(contains("FOR UPDATE NOWAIT"), any(ResultSetExtractor.class), eq(12L), eq(7L)))
                .thenThrow(new CannotAcquireLockException("lock", sql));

        assertThatThrownBy(() -> service.issueFor(12L, 7L, 365))
                .isInstanceOf(ApiException.class)
                .satisfies(error -> {
                    ApiException api = (ApiException) error;
                    assertThat(api.status().value()).isEqualTo(409);
                    assertThat(api.code()).isEqualTo("EMBED_KEY_ISSUE_IN_PROGRESS");
                });
    }

    @Test
    void validateBearerRejectsMissingHeaderWithoutDbLookup() {
        assertThatThrownBy(() -> service.validateBearer(null))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("TOKEN_INVALID");
        verifyNoInteractions(jdbc);
    }

    @Test
    void validateBearerRejectsForgedKeyWithoutDbLookup() {
        String foreign = new EmbedKeyCodec("other-secret").encode(42L);
        assertThatThrownBy(() -> service.validateBearer("Bearer " + foreign))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("TOKEN_INVALID");
        verifyNoInteractions(jdbc);
    }

    @Test
    void validateBearerMapsRowStatesToContractErrorCodes() {
        stubMissingRow(42L);
        assertThatThrownBy(() -> service.validateBearer("Bearer " + codec.encode(42L)))
                .as("서명은 유효하나 행이 없음(차트/사용자 삭제) → REVOKED 로 수렴")
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("TOKEN_REVOKED");

        stubKeyRow(42L, false, true, Instant.now().plus(1, ChronoUnit.DAYS));
        assertThatThrownBy(() -> service.validateBearer("Bearer " + codec.encode(42L)))
                .extracting(error -> ((ApiException) error).code()).isEqualTo("TOKEN_REVOKED");

        stubKeyRow(42L, true, false, Instant.now().plus(1, ChronoUnit.DAYS));
        assertThatThrownBy(() -> service.validateBearer("Bearer " + codec.encode(42L)))
                .as("사용자 비활성 → REVOKED")
                .extracting(error -> ((ApiException) error).code()).isEqualTo("TOKEN_REVOKED");

        stubKeyRow(42L, true, true, Instant.now().minus(1, ChronoUnit.DAYS));
        assertThatThrownBy(() -> service.validateBearer("Bearer " + codec.encode(42L)))
                .extracting(error -> ((ApiException) error).code()).isEqualTo("TOKEN_EXPIRED");
    }

    @Test
    void validateBearerReturnsServerSideBinding() {
        stubKeyRow(42L, true, true, Instant.now().plus(30, ChronoUnit.DAYS));

        EmbedKeyPrincipal principal = service.validateBearer("Bearer " + codec.encode(42L));

        assertThat(principal.keyId()).isEqualTo(42L);
        assertThat(principal.userId()).isEqualTo(7L);
        assertThat(principal.chartId()).isEqualTo(12L); // 서빙 차트는 클라이언트 입력이 아니라 이 바인딩에서 나온다
    }

    private void stubMissingRow(long keyId) {
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), eq(keyId))).thenAnswer(invocation -> {
            ResultSet rs = mock(ResultSet.class); // next() 기본 false — 행 없음
            ResultSetExtractor<?> extractor = invocation.getArgument(1);
            return extractor.extractData(rs);
        });
    }

    private void stubKeyRow(long keyId, boolean keyActive, boolean userActive, Instant expiresAt) {
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), eq(keyId))).thenAnswer(invocation -> {
            ResultSet rs = mock(ResultSet.class);
            when(rs.next()).thenReturn(true);
            when(rs.getBoolean("is_active")).thenReturn(keyActive);
            when(rs.getBoolean("user_active")).thenReturn(userActive);
            when(rs.getTimestamp("expires_at")).thenReturn(Timestamp.from(expiresAt));
            when(rs.getLong("user_id")).thenReturn(7L);
            when(rs.getLong("chart_id")).thenReturn(12L);
            ResultSetExtractor<?> extractor = invocation.getArgument(1);
            return extractor.extractData(rs);
        });
    }
}
