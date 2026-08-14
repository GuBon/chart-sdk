package com.chartsdk.web;

import java.sql.SQLException;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;
import java.util.function.Function;

/** 순환하거나 비정상적으로 긴 cause 체인에서도 종료가 보장되는 공통 순회기. */
public final class ThrowableCauseWalker {
    private static final int MAX_DEPTH = 32;

    private ThrowableCauseWalker() {
    }

    public static String firstSqlState(Throwable error) {
        return first(error, current -> current instanceof SQLException sql ? sql.getSQLState() : null);
    }

    public static String rootMessage(Throwable error) {
        Throwable last = last(error);
        return last == null || last.getMessage() == null ? "" : last.getMessage();
    }

    private static <T> T first(Throwable error, Function<Throwable, T> mapper) {
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        Throwable current = error;
        for (int depth = 0; current != null && depth < MAX_DEPTH && seen.add(current); depth++) {
            T value = mapper.apply(current);
            if (value != null) return value;
            current = current.getCause();
        }
        return null;
    }

    private static Throwable last(Throwable error) {
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        Throwable current = error;
        Throwable last = null;
        for (int depth = 0; current != null && depth < MAX_DEPTH && seen.add(current); depth++) {
            last = current;
            current = current.getCause();
        }
        return last;
    }
}
