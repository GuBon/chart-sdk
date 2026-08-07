package com.chartsdk.query;

import com.chartsdk.datasource.DatasourcePoolRegistry;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class QueryExecutorTest {

    @Test
    void catalogIsReusedWithinTheShortMetadataTtl() throws Exception {
        DatasourcePoolRegistry pools = mock(DatasourcePoolRegistry.class);
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet resultSet = mock(ResultSet.class);
        when(pools.connection(7L)).thenReturn(connection);
        when(connection.prepareStatement(org.mockito.ArgumentMatchers.anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(resultSet);
        when(resultSet.next()).thenReturn(false);
        QueryExecutor executor = new QueryExecutor(pools);

        assertThat(executor.catalog(7L)).isSameAs(executor.catalog(7L));

        verify(pools, times(1)).connection(7L);
        verify(statement).setQueryTimeout(10);
    }

    @Test
    void chartExecutionHasNoProductLevelRowCapAndUsesCursorFetch() throws Exception {
        DatasourcePoolRegistry pools = mock(DatasourcePoolRegistry.class);
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet resultSet = mock(ResultSet.class);
        ResultSetMetaData metadata = mock(ResultSetMetaData.class);
        when(pools.connection(7L)).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        when(connection.prepareStatement("SELECT * FROM chart_data")).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(resultSet);
        when(resultSet.getMetaData()).thenReturn(metadata);
        when(metadata.getColumnCount()).thenReturn(0);

        QueryRows rows = new QueryExecutor(pools).executeChart(
                7L, "SELECT * FROM chart_data", List.of());

        verify(connection).setAutoCommit(false);
        verify(statement).setMaxRows(QueryExecutor.UNBOUNDED_CHART_ROWS);
        verify(statement).setQueryTimeout(30);
        verify(statement).setFetchSize(1_000);
        verify(connection).rollback();
        assertThat(rows.rowCount()).isZero();
    }

    @Test
    void bernoulliExecutionSeedsTheSameConnectionBeforeTheSampleQuery() throws Exception {
        DatasourcePoolRegistry pools = mock(DatasourcePoolRegistry.class);
        Connection connection = mock(Connection.class);
        PreparedStatement seedStatement = mock(PreparedStatement.class);
        PreparedStatement queryStatement = mock(PreparedStatement.class);
        ResultSet resultSet = mock(ResultSet.class);
        ResultSetMetaData metadata = mock(ResultSetMetaData.class);
        when(pools.connection(7L)).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        when(connection.prepareStatement("SELECT setseed(?)")).thenReturn(seedStatement);
        when(connection.prepareStatement("SELECT * FROM sampled WHERE random() < ?")).thenReturn(queryStatement);
        when(queryStatement.executeQuery()).thenReturn(resultSet);
        when(resultSet.getMetaData()).thenReturn(metadata);
        when(metadata.getColumnCount()).thenReturn(0);

        new QueryExecutor(pools).executeBernoulli(
                7L, "SELECT * FROM sampled WHERE random() < ?", List.of(0.02), true, 77);

        var order = inOrder(connection, seedStatement, queryStatement);
        order.verify(connection).prepareStatement("SELECT setseed(?)");
        order.verify(seedStatement).setDouble(1, SamplingSeed.unit(77));
        order.verify(seedStatement).execute();
        order.verify(connection).prepareStatement("SELECT * FROM sampled WHERE random() < ?");
        verify(queryStatement).setObject(1, 0.02);
        verify(queryStatement).setMaxRows(QueryExecutor.UNBOUNDED_CHART_ROWS);
        verify(queryStatement).setQueryTimeout(30);
    }
}
