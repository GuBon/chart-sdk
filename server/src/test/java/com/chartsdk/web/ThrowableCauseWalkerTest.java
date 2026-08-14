package com.chartsdk.web;

import org.junit.jupiter.api.Test;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

class ThrowableCauseWalkerTest {
    @Test
    void inspectsTheTopLevelException() {
        assertThat(ThrowableCauseWalker.firstSqlState(new SQLException("duplicate", "23505")))
                .isEqualTo("23505");
    }

    @Test
    void terminatesOnMultiObjectCauseCycle() {
        RuntimeException first = new RuntimeException("first");
        RuntimeException second = new RuntimeException("second");
        first.initCause(second);
        second.initCause(first);

        assertThat(ThrowableCauseWalker.firstSqlState(first)).isNull();
        assertThat(ThrowableCauseWalker.rootMessage(first)).isEqualTo("second");
    }
}
