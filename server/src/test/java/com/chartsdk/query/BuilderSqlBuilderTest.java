package com.chartsdk.query;

import com.chartsdk.web.ApiException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BuilderSqlBuilderTest {
    private record SamplingContractCase(
            String name,
            String agg,
            double rate,
            double sampledValue,
            double expectedValue,
            boolean extrapolated
    ) {}

    private final SchemaCatalog catalog = SchemaCatalog.ofPublic(Map.of(
            "sales", Map.of(
                    "id", "bigint",
                    "category", "text",
                    "amount", "numeric",
                    "ordered_at", "timestamp without time zone",
                    "customer_id", "bigint"
            ),
            "customers", Map.of(
                    "id", "bigint",
                    "region", "text"
            )
    ));

    @Test
    void generatesAggregateSqlWithBoundWhereValues() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "total")),
                "where", List.of(
                        Map.of("column", "category", "op", "contains", "value", "foo"),
                        Map.of("column", "amount", "op", "gte", "value", "100")
                ),
                "orderBy", Map.of("target", "y0", "direction", "desc")
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."sales"."category", SUM("public"."sales"."amount") AS "total" FROM "public"."sales" WHERE "public"."sales"."category" ILIKE ? AND "public"."sales"."amount" >= ? GROUP BY "public"."sales"."category" ORDER BY 2 DESC LIMIT 1000\
                """);
        assertThat(sql.params()).containsExactly("%foo%", 100L);
    }

    @Test
    void sharedSamplingContractKeepsEveryAggregateOnTheObservedSampleScale() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/sampling-contract-cases.json")) {
            assertThat(in).as("shared sampling contract fixture").isNotNull();
            List<SamplingContractCase> cases = new ObjectMapper().readValue(in, new TypeReference<>() {});

            for (SamplingContractCase c : cases) {
                String rate = BigDecimal.valueOf(c.rate()).stripTrailingZeros().toPlainString();
                BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                        "table", "sales",
                        "xAxis", "category",
                        "yAxis", List.of(Map.of("column", "amount", "agg", c.agg())),
                        "sample", Map.of("rate", c.rate())
                ), "bar", false);

                assertThat(sql.text()).as(c.name())
                        .contains("TABLESAMPLE SYSTEM (" + rate + ") REPEATABLE (48291)")
                        .contains("\"__chartsdk_sample_count\"")
                        .contains("\"__chartsdk_sample_total\"");
                assertThat(c.extrapolated()).as(c.name()).isFalse();
                assertThat(sql.text()).as(c.name()).doesNotContain("100.0 / " + rate);
                assertThat(c.sampledValue()).as(c.name()).isEqualTo(c.expectedValue());
            }
        }
    }

    @Test
    void supportsDecimalRateAndRepeatableSeed() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "avg")),
                "sample", Map.of("mode", "auto", "rate", 0.1, "seed", 12345)
        ), "bar", false);

        assertThat(sql.text()).contains("TABLESAMPLE SYSTEM (0.1) REPEATABLE (12345)");
        assertThat(sql.sampling().mode()).isEqualTo("auto");
        assertThat(sql.sampling().seed()).isEqualTo(12345L);
    }

    @Test
    void rateHundredPerformsExactFullScanWithoutSampleSqlOrScaling() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum")),
                "sample", Map.of("mode", "manual", "rate", 100, "seed", 9)
        ), "bar", false);

        assertThat(sql.text())
                .doesNotContain("TABLESAMPLE")
                .doesNotContain("REPEATABLE")
                .doesNotContain("100.0 /")
                .doesNotContain("__chartsdk_sample");
        assertThat(sql.sampling().approximate()).isFalse();
        assertThat(sql.sampling().method()).isEqualTo("FULL_SCAN");
        assertThat(sql.sampling().seed()).isNull();
    }

    @Test
    void varianceUsesPostgresVarianceAndRemainsASampleEstimate() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "variance")),
                "sample", Map.of("rate", 5)
        ), "bar", false);

        assertThat(sql.text()).contains("VARIANCE(\"public\".\"sales\".\"amount\")").doesNotContain("100.0 / 5");
        assertThat(sql.sampling().estimates()).containsExactly(
                new com.chartsdk.cache.SamplingMetadata.Estimate(
                        "variance_amount", "variance", "SAMPLE_ESTIMATE", null));
    }

    @Test
    void indexRandomWrapsBaseInSampleCteButKeepsSumAsTheObservedSampleTotal() {
        SamplePlan plan = SamplePlan.indexRandom(new long[]{1L, 2L, 3L}, "id", 500_000_000L, 10_000, 48291L);
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "total")),
                "sample", Map.of("mode", "auto", "seed", 48291)
        ), "bar", false, plan);

        // 1단계 CTE: 무작위 키를 unnest 해 등가 조인(무편향) + 실측 표본수 CTE.
        assertThat(sql.text())
                .startsWith("WITH \"__chartsdk_sample\" AS (SELECT \"__chartsdk_base\".* "
                        + "FROM unnest(?) AS \"__chartsdk_keys\"(\"v\") "
                        + "JOIN \"public\".\"sales\" \"__chartsdk_base\" ON \"__chartsdk_base\".\"id\" = \"__chartsdk_keys\".\"v\"), "
                        + "\"__chartsdk_n\" AS (SELECT COUNT(*) AS \"sampled\" FROM \"__chartsdk_sample\") SELECT")
                .contains("SUM(\"__chartsdk_sample\".\"amount\") AS \"total\"")
                .contains("(SELECT \"sampled\" FROM \"__chartsdk_n\") AS \"__chartsdk_sample_total\"")
                .contains(" FROM \"__chartsdk_sample\" GROUP BY \"__chartsdk_sample\".\"category\"")
                .doesNotContain("500000000.0 /", "__chartsdk_sample_n_0", "__chartsdk_sample_mean_0", "__chartsdk_sample_sd_0");

        // 키 배열이 첫 파라미터(unnest).
        assertThat(sql.params()).hasSize(1);
        assertThat(sql.params().get(0)).isInstanceOf(long[].class);
        assertThat((long[]) sql.params().get(0)).containsExactly(1L, 2L, 3L);

        assertThat(sql.sampling().method()).isEqualTo("INDEX_RANDOM");
        assertThat(sql.sampling().approximate()).isTrue();
        assertThat(sql.sampling().populationEstimate()).isEqualTo(500_000_000L);
        assertThat(sql.sampling().sampleSize()).isEqualTo(10_000);
        assertThat(sql.sampling().confidenceLevel()).isEqualTo(0.95);
        assertThat(sql.sampling().valueMode()).isEqualTo("sample");
        assertThat(sql.sampling().estimates()).containsExactly(
                new com.chartsdk.cache.SamplingMetadata.Estimate(
                        "total", "sum", "SAMPLE_AGGREGATE", "SAMPLE_AGGREGATE_ONLY"));
    }

    @Test
    void indexRandomCollectsEffectiveCountAndMomentsForDispersionAggregates() {
        SamplePlan plan = SamplePlan.indexRandom(new long[]{1L, 2L}, "id", 1_000_000L, 10_000, 48291L);
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(
                        Map.of("column", "amount", "agg", "stddev"),
                        Map.of("column", "amount", "agg", "variance")),
                "sample", Map.of("mode", "auto", "size", 10_000)
        ), "bar", false, plan);

        assertThat(sql.text())
                .contains("COUNT(\"__chartsdk_sample\".\"amount\") AS \"__chartsdk_sample_n_0\"")
                .contains("STDDEV_SAMP(\"__chartsdk_sample\".\"amount\") AS \"__chartsdk_sample_sd_0\"")
                .contains("COUNT(\"__chartsdk_sample\".\"amount\") AS \"__chartsdk_sample_n_1\"")
                .contains("STDDEV_SAMP(\"__chartsdk_sample\".\"amount\") AS \"__chartsdk_sample_sd_1\"");
    }

    @Test
    void fullScanPlanProducesExactAggregateWithoutSampleClauses() {
        SamplePlan plan = SamplePlan.fullScan(40_000L, 48291L);
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "total")),
                "sample", Map.of("mode", "auto", "seed", 48291)
        ), "bar", false, plan);

        assertThat(sql.text()).doesNotContain("TABLESAMPLE", "unnest", "__chartsdk_", "100.0 /");
        assertThat(sql.params()).isEmpty();
        assertThat(sql.sampling().approximate()).isFalse();
        assertThat(sql.sampling().method()).isEqualTo("FULL_SCAN");
    }

    @Test
    void rowsModeKeepsWhereButSkipsAggregationAndSample() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum")),
                "sample", Map.of("rate", 10),
                "where", List.of(Map.of("column", "amount", "op", "lt", "value", 500))
        ), "bar", true);

        assertThat(sql.text()).isEqualTo("SELECT * FROM \"public\".\"sales\" WHERE \"public\".\"sales\".\"amount\" < ? LIMIT 1000");
        assertThat(sql.params()).containsExactly(500);
    }

    @Test
    void barChartCanUseRawTupleValuesWithoutGrouping() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "ordered_at",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none")),
                "orderBy", Map.of("target", "x", "direction", "asc")
        ), "line", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."sales"."ordered_at", "public"."sales"."amount" AS "amount" FROM "public"."sales" ORDER BY 1 ASC LIMIT 1000\
                """);
        assertThat(sql.params()).isEmpty();
    }

    @Test
    void pieChartCanUseRawNameValueTuplesWithoutGrouping() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none"))
        ), "pie", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."sales"."category", "public"."sales"."amount" AS "amount" FROM "public"."sales" LIMIT 1000\
                """);
        assertThat(sql.params()).isEmpty();
    }

    @Test
    void rawTupleValuesCannotBeMixedWithAggregates() {
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(
                        Map.of("column", "amount", "agg", "none"),
                        Map.of("column", "id", "agg", "count")
                )
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("raw values cannot be mixed");
    }

    @Test
    void samplesJoinAndFilterResultBeforeAggregation() {
        Map<String, Object> cfg = Map.of(
                "table", "sales",
                "joins", List.of(Map.of(
                        "table", "customers",
                        "type", "left",
                        "on", Map.of("leftColumn", "sales.customer_id", "rightColumn", "customers.id")
                )),
                "xAxis", "customers.region",
                "yAxis", List.of(Map.of("column", "sales.amount", "agg", "avg", "alias", "average")),
                "where", List.of(Map.of("column", "sales.amount", "op", "gte", "value", 100)),
                "sample", Map.of("mode", "manual", "size", 10_000, "seed", 77)
        );

        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, cfg, "bar", false);

        assertThat(sql.text())
                .startsWith("WITH \"__chartsdk_seed\" AS MATERIALIZED (SELECT setseed(?)")
                .contains("\"__chartsdk_population\" AS (SELECT")
                .contains("FROM \"public\".\"sales\" LEFT JOIN \"public\".\"customers\"")
                .contains("WHERE \"public\".\"sales\".\"amount\" >= ?)")
                .contains("ORDER BY random() LIMIT 10000")
                .contains("AVG(\"__chartsdk_sample\".\"__chartsdk_y_0\") AS \"average\"")
                .contains("GROUP BY \"__chartsdk_sample\".\"__chartsdk_x\"");
        assertThat(sql.params()).hasSize(2);
        assertThat(sql.params().get(0)).isInstanceOf(Double.class);
        assertThat(sql.params().get(1)).isEqualTo(100);
        assertThat(sql.sampling().method()).isEqualTo("RESULT_RANDOM");
        assertThat(sql.sampling().confidenceLevel()).isEqualTo(0.95);
    }

    @Test
    void validatesBucketColumnTypeBeforeSqlGeneration() {
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "xAxisBucket", "month",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum"))
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Bucket requires a date/timestamp column");
    }

    @Test
    void scatterRequiresNumericXAxisAndNoneAggregation() {
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none"))
        ), "scatter", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("scatter xAxis must be numeric");
    }

    @Test
    void boxplotRequiresSingleRawValueField() {
        // 정상: 원본값 1개 → 그룹 없는 SELECT x,y (SQL 은 line/scatter 원본값과 동일 형태)
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none"))
        ), "boxplot", false);
        assertThat(sql.text()).contains("\"amount\"").doesNotContain("GROUP BY");

        // 값 컬럼 2개 → 거부
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none"), Map.of("column", "id", "agg", "none"))
        ), "boxplot", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("boxplot requires exactly one value field");

        // 집계 있음 → 거부
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum"))
        ), "boxplot", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("boxplot requires agg 'none'");
    }

    @Test
    void geoScatterRequiresNumericLongitudeAndRawCoords() {
        // 정상: 경도(숫자)+위도 원본 2컬럼
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "amount",
                "yAxis", List.of(Map.of("column", "id", "agg", "none"))
        ), "geoscatter", false);
        assertThat(sql.text()).doesNotContain("GROUP BY");

        // 텍스트 경도 → 거부
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "id", "agg", "none"))
        ), "geoscatter", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("longitude) must be numeric");

        // 3컬럼 → 거부
        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "amount",
                "yAxis", List.of(Map.of("column", "id", "agg", "none"), Map.of("column", "amount", "agg", "none"), Map.of("column", "customer_id", "agg", "none"))
        ), "geoscatter", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("one or two yAxis fields");
    }

    @Test
    void mapRequiresSingleValueField() {
        // 정상: 집계 1개 → GROUP BY 있는 SQL
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum"))
        ), "map", false);
        assertThat(sql.text()).contains("SUM").contains("GROUP BY");

        assertThatThrownBy(() -> BuilderSqlBuilder.generate(catalog, Map.of(
                "table", "sales",
                "xAxis", "category",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum"), Map.of("column", "id", "agg", "count"))
        ), "map", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("map requires exactly one yAxis");
    }

    // ── 다중 스키마(§1.2) ────────────────────────────────────
    // public.events 와 tandanji.events 는 동명이나 컬럼 구성이 다르다 — 스키마 해석이 독립적이어야 한다.
    private final SchemaCatalog multiSchema = new SchemaCatalog(Map.of(
            new SchemaCatalog.Key("tandanji", "events"), Map.of(
                    "id", "bigint",
                    "user_id", "bigint",
                    "amount", "numeric",
                    "created_at", "timestamp without time zone"
            ),
            new SchemaCatalog.Key("tandanji", "users"), Map.of(
                    "id", "bigint",
                    "name", "text"
            ),
            new SchemaCatalog.Key("public", "events"), Map.of(
                    "id", "bigint",
                    "label", "text"
            )
    ));

    @Test
    void qualifiesEveryIdentifierWithNonPublicSchema() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "xAxis", "user_id",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "total"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "tandanji"."events"."user_id", SUM("tandanji"."events"."amount") AS "total" FROM "tandanji"."events" GROUP BY "tandanji"."events"."user_id" LIMIT 1000\
                """);
        assertThat(sql.params()).isEmpty();
    }

    @Test
    void unqualifiedTableDefaultsToPublicSchema() {
        // table="events" (스키마 미지정) → public.events 로 해석되어야 한다(동명 tandanji.events 가 아니라).
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "events",
                "xAxis", "label",
                "yAxis", List.of(Map.of("column", "id", "agg", "count", "alias", "cnt"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."events"."label", COUNT("public"."events"."id") AS "cnt" FROM "public"."events" GROUP BY "public"."events"."label" LIMIT 1000\
                """);
    }

    @Test
    void resolvesColumnsAgainstTheResolvedSchemaNotASameNamedTable() {
        // "amount" 는 tandanji.events 에만 있다. public.events 로 잘못 해석하면 INVALID_IDENTIFIER 가 나야 한다.
        BuilderSqlBuilder.Sql ok = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "xAxis", "user_id",
                "yAxis", List.of(Map.of("column", "amount", "agg", "none"))
        ), "line", false);
        assertThat(ok.text()).isEqualTo("""
                SELECT "tandanji"."events"."user_id", "tandanji"."events"."amount" AS "amount" FROM "tandanji"."events" LIMIT 1000\
                """);

        assertThatThrownBy(() -> BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "events",
                "xAxis", "label",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum"))
        ), "bar", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Unknown column: amount");
    }

    @Test
    void joinAcrossNonPublicSchemaQualifiesEverySide() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "joins", List.of(Map.of(
                        "table", "tandanji.users",
                        "type", "inner",
                        "on", Map.of("leftColumn", "events.user_id", "rightColumn", "users.id")
                )),
                "xAxis", "users.name",
                "yAxis", List.of(Map.of("column", "events.amount", "agg", "sum", "alias", "total"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "tandanji"."users"."name", SUM("tandanji"."events"."amount") AS "total" FROM "tandanji"."events" INNER JOIN "tandanji"."users" ON "tandanji"."events"."user_id" = "tandanji"."users"."id" GROUP BY "tandanji"."users"."name" LIMIT 1000\
                """);
    }

    @Test
    void dateBucketOnNonPublicTableQualifiesIdentifier() {
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events",
                "xAxis", "created_at",
                "xAxisBucket", "month",
                "yAxis", List.of(Map.of("column", "amount", "agg", "sum", "alias", "매출")),
                "orderBy", Map.of("target", "x", "direction", "asc")
        ), "line", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT DATE_TRUNC('month', "tandanji"."events"."created_at") AS "created_at", SUM("tandanji"."events"."amount") AS "매출" FROM "tandanji"."events" GROUP BY 1 ORDER BY 1 ASC LIMIT 1000\
                """);
    }

    @Test
    void joinsSameNameTablesAcrossSchemasViaHandles() {
        // base=tandanji.events 와 join=public.events 는 이름이 같지만 서로 다른 핸들(events / events_2)로 함께 조인 가능.
        // 단일 소스라도 스키마로 완전 한정돼 SQL 이 모호하지 않다(별칭 불필요).
        BuilderSqlBuilder.Sql sql = BuilderSqlBuilder.generate(multiSchema, Map.of(
                "table", "tandanji.events", // 문자열 → handle 기본 "events"
                "joins", List.of(Map.of(
                        "table", Map.of("schema", "public", "name", "events", "handle", "events_2"),
                        "type", "inner",
                        "on", Map.of("leftColumn", "events.user_id", "rightColumn", "events_2.id")
                )),
                "xAxis", "events_2.label",
                "yAxis", List.of(Map.of("column", "events.amount", "agg", "sum", "alias", "total"))
        ), "bar", false);

        assertThat(sql.text()).isEqualTo("""
                SELECT "public"."events"."label", SUM("tandanji"."events"."amount") AS "total" FROM "tandanji"."events" INNER JOIN "public"."events" ON "tandanji"."events"."user_id" = "public"."events"."id" GROUP BY "public"."events"."label" LIMIT 1000\
                """);
    }
}
