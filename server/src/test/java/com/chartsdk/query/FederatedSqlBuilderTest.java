package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 다중 소스 페더레이션 SQL 생성(설계 §6). {@link RefRenderer#FEDERATED} 로 모든 식별자가
 * {@code "ds{id}"."schema"."table"} 로 한정되는지, 구조화 참조·라우팅 판정·모호성 거부를 검증한다.
 */
class FederatedSqlBuilderTest {

    // ds2 = 주문(sales.orders), ds5 = 고객(public.customers) — 서로 다른 데이터소스.
    private final FederatedCatalog catalog = new FederatedCatalog(Map.of(
            2L, new SchemaCatalog(Map.of(
                    new SchemaCatalog.Key("sales", "orders"),
                    Map.of("id", "bigint", "user_id", "bigint", "amount", "numeric", "ordered_at", "timestamp without time zone"))),
            5L, new SchemaCatalog(Map.of(
                    new SchemaCatalog.Key("public", "customers"),
                    Map.of("id", "bigint", "region", "text")))
    ));

    private static Map<String, Object> ref(int ds, String schema, String name) {
        return Map.of("datasourceId", ds, "schema", schema, "name", name);
    }

    private BuilderSqlBuilder.Sql gen(Map<String, Object> cfg, String chartType, boolean rawMode) {
        return BuilderSqlBuilder.generate(catalog, RefRenderer.FEDERATED, cfg, chartType, rawMode);
    }

    @Test
    void qualifiesEveryIdentifierWithDatasourceAliasAcrossSources() {
        BuilderSqlBuilder.Sql sql = gen(Map.of(
                "table", ref(2, "sales", "orders"),
                "joins", List.of(Map.of(
                        "table", ref(5, "public", "customers"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "orders.user_id", "rightColumn", "customers.id"))),
                "xAxis", "customers.region",
                "yAxis", List.of(Map.of("column", "orders.amount", "agg", "sum", "alias", "total"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "ds5"."public"."customers"."region", SUM("ds2"."sales"."orders"."amount") AS "total" FROM "ds2"."sales"."orders" INNER JOIN "ds5"."public"."customers" ON "ds2"."sales"."orders"."user_id" = "ds5"."public"."customers"."id" GROUP BY "ds5"."public"."customers"."region" LIMIT 1000\
                """);
        assertThat(sql.params()).isEmpty();
    }

    @Test
    void crossSourceWhereKeepsBoundValuesAndDatasourceAliases() {
        BuilderSqlBuilder.Sql sql = gen(Map.of(
                "table", ref(2, "sales", "orders"),
                "joins", List.of(Map.of(
                        "table", ref(5, "public", "customers"),
                        "type", "left",
                        "on", Map.of("leftColumn", "orders.user_id", "rightColumn", "customers.id"))),
                "xAxis", "customers.region",
                "yAxis", List.of(Map.of("column", "orders.amount", "agg", "sum", "alias", "total")),
                "where", List.of(Map.of("column", "orders.amount", "op", "gte", "value", "1000"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "ds5"."public"."customers"."region", SUM("ds2"."sales"."orders"."amount") AS "total" FROM "ds2"."sales"."orders" LEFT JOIN "ds5"."public"."customers" ON "ds2"."sales"."orders"."user_id" = "ds5"."public"."customers"."id" WHERE "ds2"."sales"."orders"."amount" >= ? GROUP BY "ds5"."public"."customers"."region" LIMIT 1000\
                """);
        assertThat(sql.params()).containsExactly(1000L);
    }

    @Test
    void dateBucketOnCrossSourceQualifiesIdentifier() {
        BuilderSqlBuilder.Sql sql = gen(Map.of(
                "table", ref(2, "sales", "orders"),
                "joins", List.of(Map.of(
                        "table", ref(5, "public", "customers"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "orders.user_id", "rightColumn", "customers.id"))),
                "xAxis", "orders.ordered_at",
                "xAxisBucket", "month",
                "yAxis", List.of(Map.of("column", "orders.amount", "agg", "sum", "alias", "매출")),
                "orderBy", Map.of("target", "x", "direction", "asc")
        ), "line", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT DATE_TRUNC('month', "ds2"."sales"."orders"."ordered_at") AS "ordered_at", SUM("ds2"."sales"."orders"."amount") AS "매출" FROM "ds2"."sales"."orders" INNER JOIN "ds5"."public"."customers" ON "ds2"."sales"."orders"."user_id" = "ds5"."public"."customers"."id" GROUP BY 1 ORDER BY 1 ASC LIMIT 1000\
                """);
    }

    @Test
    void unknownColumnInThatSourceIsRejectedBeforeSql() {
        // region 은 ds5(customers) 것 — orders(ds2)에는 없다.
        assertThatThrownBy(() -> gen(Map.of(
                "table", ref(2, "sales", "orders"),
                "xAxis", "user_id",
                "yAxis", List.of(Map.of("column", "region", "agg", "sum"))
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Unknown column: region");
    }

    @Test
    void referencedDatasourcesDrivesRouting() {
        Map<String, Object> multi = Map.of(
                "table", ref(2, "sales", "orders"),
                "joins", List.of(Map.of("table", ref(5, "public", "customers"), "type", "inner",
                        "on", Map.of("leftColumn", "orders.user_id", "rightColumn", "customers.id"))));
        assertThat(BuilderSqlBuilder.referencedDatasources(multi)).containsExactlyInAnyOrder(2L, 5L);

        Map<String, Object> single = Map.of("table", ref(2, "sales", "orders"));
        assertThat(BuilderSqlBuilder.referencedDatasources(single)).containsExactly(2L);

        Map<String, Object> legacyString = Map.of("table", "sales"); // 하위호환 문자열 — 명시 소스 없음
        assertThat(BuilderSqlBuilder.referencedDatasources(legacyString)).isEmpty();
    }

    @Test
    void rejectsAmbiguousTableNameAcrossDatasources() {
        // 같은 bare 이름 orders 가 ds2·ds9 두 소스에 존재 → 조인 시 컬럼 참조 모호 → 거부.
        FederatedCatalog dup = new FederatedCatalog(Map.of(
                2L, new SchemaCatalog(Map.of(new SchemaCatalog.Key("sales", "orders"), Map.of("id", "bigint", "user_id", "bigint"))),
                9L, new SchemaCatalog(Map.of(new SchemaCatalog.Key("public", "orders"), Map.of("id", "bigint", "amount", "numeric")))
        ));
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(dup, RefRenderer.FEDERATED, Map.of(
                "table", ref(2, "sales", "orders"),
                "joins", List.of(Map.of("table", ref(9, "public", "orders"), "type", "inner",
                        "on", Map.of("leftColumn", "orders.user_id", "rightColumn", "orders.id"))),
                "xAxis", "orders.id",
                "yAxis", List.of(Map.of("column", "orders.amount", "agg", "sum"))
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Ambiguous table name across sources/schemas: orders");
    }
}
