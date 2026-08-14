package com.chartsdk.datasource;

import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.context.ApplicationEventPublisher;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import org.mockito.ArgumentCaptor;

class DatasourceServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final DatasourcePasswordResolver passwords = mock(DatasourcePasswordResolver.class);
    private final DatasourceService service = new DatasourceService(jdbc, passwords);

    @Test
    void inputResolvesOperationalDefaultsInOnePlace() {
        DatasourceInput input = new DatasourceInput("analytics", "localhost", null, "analytics", "reader", "secret", null);
        DatasourceTestInput testInput = new DatasourceTestInput(null, "localhost", null, "analytics", "reader", "secret");

        assertThat(input.resolvedPort()).isEqualTo(5432);
        assertThat(input.resolvedMaxPoolSize()).isEqualTo(5);
        assertThat(testInput.resolvedPort()).isEqualTo(5432);
    }

    @Test
    void connectionTestErrorIsCategorizedBySqlStateWithoutLeakingRawDetail() {
        // 원문(호스트·DB·사용자명 등)이 담긴 예외라도 사용자 문구엔 원인 카테고리만 남고 원문은 제외된다.
        assertThat(DatasourceService.friendlyConnectionError(
                new SQLException("FATAL: password authentication failed for user \"reader\"", "28P01")))
                .contains("자격 증명")
                .doesNotContain("reader", "password authentication");
        assertThat(DatasourceService.friendlyConnectionError(new SQLException("no such db", "3D000")))
                .contains("데이터베이스가 존재하지 않");
        assertThat(DatasourceService.friendlyConnectionError(
                new SQLException("Connection to secret.internal:5432 refused", "08006")))
                .contains("연결할 수 없")
                .doesNotContain("secret.internal");
        // SQLSTATE 없는 알 수 없는 원인은 일반 안내로 폴백한다.
        assertThat(DatasourceService.friendlyConnectionError(new RuntimeException("weird internal detail")))
                .contains("연결에 실패")
                .doesNotContain("weird internal detail");
    }

    @Test
    void createRejectsMissingRequiredFieldsBeforeDatabaseAccess() {
        DatasourceInput input = new DatasourceInput("", "localhost", 5432, "analytics", "reader", "secret", 5);

        assertThatThrownBy(() -> service.create(input))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("INVALID_REQUEST");
        verifyNoInteractions(jdbc, passwords);
    }

    @Test
    void createRequiresPasswordBeforeDatabaseAccess() {
        DatasourceInput input = new DatasourceInput("analytics", "localhost", 5432, "analytics", "reader", "", 5);

        assertThatThrownBy(() -> service.create(input))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("INVALID_REQUEST");
        verifyNoInteractions(jdbc, passwords);
    }

    @Test
    void createRejectsNameReservedByChartCreationRoute() {
        DatasourceInput input = new DatasourceInput("NEW", "localhost", 5432, "analytics", "reader", "secret", 5);

        assertThatThrownBy(() -> service.create(input))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("DATASOURCE_NAME_RESERVED");
        verifyNoInteractions(jdbc, passwords);
    }

    @Test
    void createRejectsPortOutsideDatabaseBoundaryBeforeDatabaseAccess() {
        DatasourceInput input = new DatasourceInput("analytics", "localhost", 0, "analytics", "reader", "secret", 5);

        assertThatThrownBy(() -> service.create(input))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("PORT_OUT_OF_RANGE");
        verifyNoInteractions(jdbc, passwords);
    }

    @Test
    void createRejectsPoolSizeOutsideDatabaseBoundaryBeforeDatabaseAccess() {
        DatasourceInput input = new DatasourceInput("analytics", "localhost", 5432, "analytics", "reader", "secret", 51);

        assertThatThrownBy(() -> service.create(input))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("MAX_POOL_SIZE_OUT_OF_RANGE");
        verifyNoInteractions(jdbc, passwords);
    }

    @Test
    void deleteReportsHowManyChartsReferenceDatasource() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(7L))).thenReturn(3);

        assertThatThrownBy(() -> service.delete(7L))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("3 chart(s)")
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("DATASOURCE_IN_USE");
    }

    @Test
    @SuppressWarnings("unchecked")
    void listMapsDatabaseColumnsToPasswordFreeApiView() throws Exception {
        ResultSet resultSet = mock(ResultSet.class);
        Timestamp testedAt = Timestamp.from(Instant.parse("2026-07-21T01:02:03Z"));
        when(resultSet.getLong("id")).thenReturn(7L);
        when(resultSet.getString("name")).thenReturn("analytics");
        when(resultSet.getString("host")).thenReturn("db.internal");
        when(resultSet.getInt("port")).thenReturn(5433);
        when(resultSet.getString("database_name")).thenReturn("warehouse");
        when(resultSet.getString("db_user")).thenReturn("reader");
        when(resultSet.getInt("max_pool_size")).thenReturn(8);
        when(resultSet.getTimestamp("last_tested_at")).thenReturn(testedAt);
        when(resultSet.getObject("last_test_ok", Boolean.class)).thenReturn(Boolean.TRUE);
        when(jdbc.query(anyString(), any(RowMapper.class))).thenAnswer(invocation -> {
            RowMapper<DatasourceView> mapper = invocation.getArgument(1);
            return List.of(mapper.mapRow(resultSet, 0));
        });

        assertThat(service.list()).containsExactly(new DatasourceView(
                7L, "analytics", "db.internal", 5433, "warehouse", "reader", 8,
                "2026-07-21T01:02:03Z", true
        ));
    }

    @Test
    @SuppressWarnings("unchecked")
    void identityUpdatePublishesPostCommitRuntimeInvalidationIntent() throws Exception {
        ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        DatasourceService eventService = new DatasourceService(jdbc, passwords, events);
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), eq(7L))).thenAnswer(invocation -> {
            ResultSet resultSet = mock(ResultSet.class);
            when(resultSet.next()).thenReturn(true);
            when(resultSet.getLong("id")).thenReturn(7L);
            when(resultSet.getString("name")).thenReturn("analytics");
            when(resultSet.getString("host")).thenReturn("old.internal");
            when(resultSet.getInt("port")).thenReturn(5432);
            when(resultSet.getString("database_name")).thenReturn("warehouse");
            when(resultSet.getString("db_user")).thenReturn("reader");
            when(resultSet.getInt("max_pool_size")).thenReturn(5);
            ResultSetExtractor<?> extractor = invocation.getArgument(1);
            return extractor.extractData(resultSet);
        });
        DatasourceInput changed = new DatasourceInput(
                "analytics", "new.internal", 5432, "warehouse", "reader", null, 5);

        eventService.update(7L, changed);

        ArgumentCaptor<DatasourceChangedEvent> event = ArgumentCaptor.forClass(DatasourceChangedEvent.class);
        verify(events).publishEvent(event.capture());
        assertThat(event.getValue()).isEqualTo(new DatasourceChangedEvent(
                7L, DatasourceChangedEvent.Impact.SOURCE_IDENTITY));
    }
}
