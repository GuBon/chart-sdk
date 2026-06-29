package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SqlLiteralsTest {
    @Test
    void inlinesBoundValuesForStoredGeneratedSql() {
        String sql = "SELECT * FROM \"sales\" WHERE \"name\" = ? AND \"amount\" >= ? AND \"deleted\" IS ?";

        String inlined = SqlLiterals.inline(sql, List.of("Bob's store", 100, false));

        assertThat(inlined).isEqualTo("SELECT * FROM \"sales\" WHERE \"name\" = 'Bob''s store' AND \"amount\" >= 100 AND \"deleted\" IS false");
    }
}
