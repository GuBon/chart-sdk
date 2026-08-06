package com.chartsdk.datasource;

import com.zaxxer.hikari.HikariDataSource;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Reference-counted generation of a datasource pool. */
final class DatasourcePoolHandle {
    private final long datasourceId;
    private final HikariDataSource pool;
    private final Runnable onClosed;
    private int borrowers;
    private boolean retiring;
    private boolean closed;
    private volatile long lastUsedNanos = System.nanoTime();

    DatasourcePoolHandle(long datasourceId, HikariDataSource pool, Runnable onClosed) {
        this.datasourceId = datasourceId;
        this.pool = pool;
        this.onClosed = onClosed;
    }

    long datasourceId() {
        return datasourceId;
    }

    synchronized int borrowerCount() {
        return borrowers;
    }

    synchronized boolean isIdle() {
        return borrowers == 0 && !retiring;
    }

    synchronized boolean isClosed() {
        return closed;
    }

    long lastUsedNanos() {
        return lastUsedNanos;
    }

    int pendingThreads() {
        try {
            var poolBean = pool.getHikariPoolMXBean();
            return poolBean == null ? 0 : Math.max(0, poolBean.getThreadsAwaitingConnection());
        } catch (RuntimeException closingRace) {
            return 0;
        }
    }

    synchronized boolean idleForAtLeast(long nowNanos, long durationNanos) {
        return borrowers == 0 && !retiring && nowNanos - lastUsedNanos >= durationNanos;
    }

    Connection borrow() throws SQLException {
        synchronized (this) {
            if (retiring || closed) return null;
            borrowers++;
        }
        try {
            return managed(pool.getConnection());
        } catch (SQLException | RuntimeException failure) {
            releaseBorrower();
            throw failure;
        }
    }

    void retire() {
        boolean closeNow;
        synchronized (this) {
            retiring = true;
            closeNow = borrowers == 0 && !closed;
            if (closeNow) closed = true;
        }
        if (closeNow) closePool();
    }

    private Connection managed(Connection delegate) {
        AtomicBoolean returned = new AtomicBoolean();
        return (Connection) Proxy.newProxyInstance(
                Connection.class.getClassLoader(),
                new Class<?>[]{Connection.class},
                (proxy, method, args) -> {
                    if ("close".equals(method.getName()) && method.getParameterCount() == 0) {
                        if (returned.compareAndSet(false, true)) {
                            try {
                                delegate.close();
                            } finally {
                                releaseBorrower();
                            }
                        }
                        return null;
                    }
                    try {
                        return method.invoke(delegate, args);
                    } catch (InvocationTargetException failure) {
                        throw failure.getCause();
                    }
                });
    }

    private void releaseBorrower() {
        boolean closeNow;
        synchronized (this) {
            borrowers--;
            lastUsedNanos = System.nanoTime();
            closeNow = retiring && borrowers == 0 && !closed;
            if (closeNow) closed = true;
        }
        if (closeNow) closePool();
    }

    private void closePool() {
        try {
            pool.close();
        } finally {
            onClosed.run();
        }
    }
}
