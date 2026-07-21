package com.chartsdk.query;

import com.chartsdk.datasource.DatasourcePoolRegistry;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class QueryExecutorTest {

    @Test
    void unboundedExecutionRemovesJdbcRowCapAndKeepsTimeout() throws Exception {
        DatasourcePoolRegistry pools = mock(DatasourcePoolRegistry.class);
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet resultSet = mock(ResultSet.class);
        ResultSetMetaData metadata = mock(ResultSetMetaData.class);
        when(pools.connection(7L)).thenReturn(connection);
        when(connection.prepareStatement("SELECT longitude, latitude FROM points")).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(resultSet);
        when(resultSet.getMetaData()).thenReturn(metadata);
        when(metadata.getColumnCount()).thenReturn(0);
        AtomicInteger seen = new AtomicInteger();
        when(resultSet.next()).thenAnswer(ignored -> seen.getAndIncrement() < 1_001);

        QueryRows rows = new QueryExecutor(pools).executeUnbounded(
                7L, "SELECT longitude, latitude FROM points", List.of());

        verify(statement).setQueryTimeout(10);
        verify(statement).setMaxRows(0);
        assertThat(rows.rowCount()).isEqualTo(1_001);
        assertThat(rows.truncated()).isFalse();
    }
}
