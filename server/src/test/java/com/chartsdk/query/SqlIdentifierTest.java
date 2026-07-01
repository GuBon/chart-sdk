package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SqlIdentifierTest {

    @Test
    void quotesAndEscapesEmbeddedDoubleQuotes() {
        assertThat(SqlIdentifier.quote("sales")).isEqualTo("\"sales\"");
        assertThat(SqlIdentifier.quote("we\"ird")).isEqualTo("\"we\"\"ird\"");
    }

    @Test
    void qualifyJoinsSchemaAndTable() {
        assertThat(SqlIdentifier.qualify("tandanji", "events")).isEqualTo("\"tandanji\".\"events\"");
    }

    @Test
    void qualifyOmitsBlankSchema() {
        assertThat(SqlIdentifier.qualify(null, "events")).isEqualTo("\"events\"");
        assertThat(SqlIdentifier.qualify("", "events")).isEqualTo("\"events\"");
        assertThat(SqlIdentifier.qualify("  ", "events")).isEqualTo("\"events\"");
    }

    @Test
    void qualifyEscapesEmbeddedDoubleQuotesOnBothParts() {
        assertThat(SqlIdentifier.qualify("sch\"ema", "ta\"ble")).isEqualTo("\"sch\"\"ema\".\"ta\"\"ble\"");
    }
}
