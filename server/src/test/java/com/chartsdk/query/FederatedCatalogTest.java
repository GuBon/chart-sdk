package com.chartsdk.query;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class FederatedCatalogTest {

    private final FederatedCatalog catalog = new FederatedCatalog(Map.of(
            2L, new SchemaCatalog(Map.of(
                    new SchemaCatalog.Key("sales", "orders"), Map.of("id", "bigint", "user_id", "bigint", "amount", "numeric"))),
            5L, new SchemaCatalog(Map.of(
                    new SchemaCatalog.Key("public", "customers"), Map.of("id", "bigint", "region", "text")))
    ));

    @Test
    void resolvesTablesWithinTheirOwnDatasource() {
        assertThat(catalog.hasTable(2L, "sales", "orders")).isTrue();
        assertThat(catalog.hasTable(5L, "public", "customers")).isTrue();
    }

    @Test
    void doesNotLeakTablesAcrossDatasources() {
        // orders 는 ds2 에만, customers 는 ds5 에만 — 소스가 다르면 없다.
        assertThat(catalog.hasTable(5L, "sales", "orders")).isFalse();
        assertThat(catalog.hasTable(2L, "public", "customers")).isFalse();
    }

    @Test
    void unknownDatasourceYieldsNothing() {
        assertThat(catalog.hasTable(99L, "sales", "orders")).isFalse();
        assertThat(catalog.columnType(99L, "sales", "orders", "amount")).isNull();
    }

    @Test
    void columnTypeIsScopedPerDatasource() {
        assertThat(catalog.columnType(2L, "sales", "orders", "amount")).isEqualTo("numeric");
        assertThat(catalog.columnType(5L, "public", "customers", "region")).isEqualTo("text");
        assertThat(catalog.hasColumn(2L, "sales", "orders", "region")).isFalse();     // region 은 ds5 것
        assertThat(catalog.hasColumn(5L, "public", "customers", "amount")).isFalse(); // amount 는 ds2 것
    }
}
