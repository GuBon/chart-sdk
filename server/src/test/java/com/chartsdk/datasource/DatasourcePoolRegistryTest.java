package com.chartsdk.datasource;

import com.zaxxer.hikari.HikariDataSource;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.sql.Connection;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DatasourcePoolRegistryTest {
    @Test
    void evictionRetiresActiveGenerationAndClosesItAfterBorrowerReturns() throws Exception {
        DatasourcePoolFactory factory = mock(DatasourcePoolFactory.class);
        HikariDataSource firstPool = mock(HikariDataSource.class);
        HikariDataSource secondPool = mock(HikariDataSource.class);
        Connection firstDelegate = mock(Connection.class);
        Connection secondDelegate = mock(Connection.class);
        when(factory.create(7L)).thenReturn(firstPool, secondPool);
        when(firstPool.getConnection()).thenReturn(firstDelegate);
        when(secondPool.getConnection()).thenReturn(secondDelegate);
        DatasourcePoolRegistry registry = new DatasourcePoolRegistry(
                factory, new SimpleMeterRegistry(), 128, 1_800, 3_600);

        Connection borrowed = registry.connection(7L);
        registry.evict(7L);

        verify(firstPool, never()).close();
        Connection nextGeneration = registry.connection(7L);
        borrowed.close();
        verify(firstDelegate).close();
        verify(firstPool).close();

        nextGeneration.close();
        registry.closeAll();
        verify(secondPool).close();
    }

    @Test
    void softCapEvictsTheLeastRecentlyUsedIdlePoolBeforeCreatingAnother() throws Exception {
        DatasourcePoolFactory factory = mock(DatasourcePoolFactory.class);
        HikariDataSource firstPool = mock(HikariDataSource.class);
        HikariDataSource secondPool = mock(HikariDataSource.class);
        Connection firstDelegate = mock(Connection.class);
        Connection secondDelegate = mock(Connection.class);
        when(factory.create(1L)).thenReturn(firstPool);
        when(factory.create(2L)).thenReturn(secondPool);
        when(firstPool.getConnection()).thenReturn(firstDelegate);
        when(secondPool.getConnection()).thenReturn(secondDelegate);
        DatasourcePoolRegistry registry = new DatasourcePoolRegistry(
                factory, new SimpleMeterRegistry(), 1, 1_800, 3_600);

        registry.connection(1L).close();
        Connection second = registry.connection(2L);

        verify(firstPool).close();
        second.close();
        registry.closeAll();
    }
}
