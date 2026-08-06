package com.chartsdk.query;

import com.chartsdk.cache.SamplingMetadata;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.SplittableRandom;

/**
 * 표본 방식 결정 엔진(설계 §표본추출). base 테이블의 PK·행수·키 밀도를 즉답성 카탈로그 쿼리로 조사해
 * INDEX_RANDOM(무편향 무작위 행 표본)·SYSTEM(폴백)·FULL_SCAN(작은 테이블) 중 하나를 고른다.
 * DB 접근을 여기 격리해 {@link BuilderSqlBuilder}는 순수(SQL 생성 전용)로 유지한다.
 */
@Service
public class SamplingPlanner {

    public static final int DEFAULT_SIZE = 10_000;      // auto 기본 목표 행 수. 오차는 집계·분산·그룹별 유효 n에 따라 별도 계산한다.
    static final int MAX_PROBES = 60_000;        // 인덱스 프로브 예산(10s 타임아웃)
    static final double MIN_DENSITY = 0.5;       // 키 밀도 하한 — 미만이면 오버샘플 비용 과다
    static final long FULL_SCAN_ROWS = 100_000;  // 이하 테이블은 스캔이 프로브보다 싸고 정확

    private final QueryExecutor queries;

    public SamplingPlanner(QueryExecutor queries) {
        this.queries = queries;
    }

    /** 관계/조인 결과 표본 계획. 표본 미설정·rows 모드이면 NONE이다. */
    public SamplePlan plan(long datasourceId, Map<String, Object> cfg, boolean rawMode) {
        return plan(datasourceId, cfg, null, rawMode);
    }

    public SamplePlan plan(long datasourceId, Map<String, Object> cfg,
                           String chartType, boolean rawMode) {
        if (rawMode || !(cfg.get("sample") instanceof Map<?, ?> sample)) return SamplePlan.none();
        Table table = parseBaseTable(cfg.get("table"));
        if (table == null) return SamplePlan.none();

        String mode = "auto".equals(String.valueOf(sample.get("mode"))) ? "auto" : "manual";
        Double rate = sample.get("rate") instanceof Number n ? n.doubleValue() : null;
        // 레거시 rate 입력은 기존 계약대로 SYSTEM 비율 요청이다. 새 UI의 개수 기반 요청에는 rate가 없다.
        boolean systemPinned = "system".equals(String.valueOf(sample.get("method"))) || rate != null;
        Integer size = sample.get("size") instanceof Number n ? n.intValue() : null;
        long seed = sample.get("seed") instanceof Number n ? n.longValue() : SamplingMetadata.DEFAULT_SEED;

        boolean automatic = "auto".equals(mode);
        if (automatic && chartType != null
                && !PointSamplingPolicy.supportsAutomaticSampling(chartType, cfg)) {
            return SamplePlan.fullScan(0, seed);
        }

        if (rate != null && rate >= SamplingMetadata.MAX_RATE) return SamplePlan.fullScan(0, seed);

        // Filters and joins can reduce a huge base table to a tiny point set. Plan from the
        // post-WHERE/JOIN cardinality so automatic mode never samples merely because the source is large.
        if (automatic && chartType != null && PointSamplingPolicy.hasResultShapingFilters(cfg)) {
            return SamplePlan.resultRandom(0, resolveSize(mode, size, rate, 0), seed,
                    "AUTO_POINT_RESULT", true);
        }

        // 조인 결과 자체가 모집단이다. 어떤 base 관계를 먼저 뽑지 않고 JOIN+WHERE 뒤에서 행 표본을 적용한다.
        if (cfg.get("joins") instanceof List<?> joins && !joins.isEmpty()) {
            return SamplePlan.resultRandom(0, resolveSize(mode, size, rate, 0), seed,
                    "JOIN_RESULT", automatic);
        }

        try {
            RelationStats stats = relationStats(datasourceId, table);
            long pop = stats == null ? 0 : stats.populationEstimate();
            String relkind = stats == null ? null : stats.relkind();

            // 일반 VIEW와 파티션 부모에는 TABLESAMPLE을 붙일 수 없다. 관계 조회 결과를 행 단위로 뽑는다.
            if (stats == null || "v".equals(relkind) || "p".equals(relkind)) {
                String reason = stats == null ? "UNKNOWN_RELATION_KIND" : "v".equals(relkind) ? "VIEW_RESULT" : "PARTITIONED_RESULT";
                return SamplePlan.resultRandom(pop, resolveSize(mode, size, rate, pop), seed,
                        reason, automatic);
            }
            if (systemPinned) {
                double blockRate = rate != null ? rate : effectiveRate(DEFAULT_SIZE, pop);
                return SamplePlan.system(pop, resolveSize(mode, size, rate, pop), blockRate, seed, "SYSTEM_PINNED");
            }
            long exactThreshold = automatic && chartType != null
                    ? resolveSize(mode, size, rate, pop)
                    : FULL_SCAN_ROWS;
            if (pop > 0 && pop <= exactThreshold) return SamplePlan.fullScan(pop, seed);
            if (pop <= 0) return systemFallback(size, rate, mode, pop, seed, "NO_ROW_STATS");

            Pk pk = primaryKey(datasourceId, table);
            if (pk == null) return systemFallback(size, rate, mode, pop, seed, "NO_INTEGER_PK");
            long[] range = minMax(datasourceId, table, pk.column());
            if (range == null) return systemFallback(size, rate, mode, pop, seed, "EMPTY_KEY_RANGE");

            long span = range[1] - range[0] + 1;
            double density = span <= 0 ? 0 : (double) pop / span;
            if (density < MIN_DENSITY) return systemFallback(size, rate, mode, pop, seed, "SPARSE_KEYS");

            int k = resolveSize(mode, size, rate, pop);
            long probes = (long) Math.ceil(k / density);
            if (probes > MAX_PROBES) {
                k = (int) Math.floor(MAX_PROBES * density);
                if (k < SamplingMetadata.MIN_SIZE) return systemFallback(size, rate, mode, pop, seed, "PROBE_BUDGET");
                probes = MAX_PROBES;
            }
            long[] keys = randomKeys(range[0], range[1], (int) probes, seed);
            return SamplePlan.indexRandom(keys, pk.column(), pop, k, seed);
        } catch (RuntimeException e) {
            // 관계 종류를 모르면 VIEW에 불법 TABLESAMPLE을 붙이지 않도록 범용 결과 행 표본으로 폴백한다.
            return SamplePlan.resultRandom(0, resolveSize(mode, size, rate, 0), seed,
                    "PLANNER_ERROR", automatic);
        }
    }

    private SamplePlan systemFallback(Integer size, Double rate, String mode, long pop, long seed, String reason) {
        int k = resolveSize(mode, size, rate, pop);
        double blockRate = rate != null ? rate : effectiveRate(k, pop);
        return SamplePlan.system(pop, k, blockRate, seed, reason);
    }

    /** 목표 표본 갯수 K. 명시 size 우선, 레거시 %는 갯수로 환산, 기본은 auto DEFAULT_SIZE. */
    private static int resolveSize(String mode, Integer size, Double rate, long pop) {
        if (size != null) return clampSize(size);
        if ("manual".equals(mode) && rate != null && pop > 0) return clampSize((int) Math.round(pop * rate / 100.0));
        return DEFAULT_SIZE;
    }

    private static int clampSize(int size) {
        return Math.max(SamplingMetadata.MIN_SIZE, Math.min(SamplingMetadata.MAX_SIZE, size));
    }

    private static double effectiveRate(int k, long pop) {
        if (pop <= 0) return SamplingMetadata.MIN_RATE;
        return Math.max(SamplingMetadata.MIN_RATE, Math.min(SamplingMetadata.MAX_RATE,
                Math.round(1000.0 * k / pop) / 10.0));
    }

    /** [min,max] 균일 좌표 count 개(복원추출 — dedup 불필요, 등가 조인이 미스만 만들어 무편향 유지). */
    private static long[] randomKeys(long min, long max, int count, long seed) {
        SplittableRandom rnd = new SplittableRandom(seed);
        long[] keys = new long[count];
        long boundLo = min;
        long boundHi = max == Long.MAX_VALUE ? Long.MAX_VALUE : max + 1; // nextLong 상한 배타
        for (int i = 0; i < count; i++) keys[i] = rnd.nextLong(boundLo, boundHi);
        return keys;
    }

    // ── 카탈로그 조사 쿼리 ─────────────────────────────────
    private RelationStats relationStats(long datasourceId, Table t) {
        List<List<Object>> rows = queries.execute(datasourceId, """
                SELECT c.relkind::text, GREATEST(c.reltuples, 0)::bigint
                  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = ? AND c.relname = ?
                """, List.of(t.schema(), t.table())).rows();
        return rows.isEmpty() ? null : new RelationStats(String.valueOf(rows.get(0).get(0)), toLong(rows.get(0).get(1)));
    }

    private Pk primaryKey(long datasourceId, Table t) {
        List<List<Object>> rows = queries.execute(datasourceId, """
                SELECT a.attname
                  FROM pg_catalog.pg_index i
                  JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
                  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
                  JOIN pg_catalog.pg_type ty ON ty.oid = a.atttypid
                 WHERE i.indisprimary AND i.indnkeyatts = 1
                   AND n.nspname = ? AND c.relname = ?
                   AND ty.typname IN ('int2', 'int4', 'int8')
                """, List.of(t.schema(), t.table())).rows();
        return rows.isEmpty() ? null : new Pk(String.valueOf(rows.get(0).get(0)));
    }

    private long[] minMax(long datasourceId, Table t, String pkColumn) {
        String ref = SqlIdentifier.qualify(t.schema(), t.table());
        String pk = SqlIdentifier.quote(pkColumn);
        List<List<Object>> rows = queries.execute(datasourceId,
                "SELECT MIN(" + pk + "), MAX(" + pk + ") FROM " + ref, List.of()).rows();
        if (rows.isEmpty() || rows.get(0).get(0) == null || rows.get(0).get(1) == null) return null;
        return new long[]{toLong(rows.get(0).get(0)), toLong(rows.get(0).get(1))};
    }

    private static long toLong(Object value) {
        return value instanceof Number n ? n.longValue() : 0;
    }

    private static Table parseBaseTable(Object raw) {
        if (raw instanceof Map<?, ?> m) {
            Object name = m.get("name");
            if (name == null) return null;
            Object schema = m.get("schema");
            return new Table(schema == null ? SchemaCatalog.DEFAULT_SCHEMA : String.valueOf(schema), String.valueOf(name));
        }
        if (raw == null) return null;
        String s = String.valueOf(raw);
        if (s.isBlank()) return null;
        int dot = s.indexOf('.');
        return dot < 0 ? new Table(SchemaCatalog.DEFAULT_SCHEMA, s)
                : new Table(s.substring(0, dot), s.substring(dot + 1));
    }

    private record Table(String schema, String table) {}

    private record Pk(String column) {}

    private record RelationStats(String relkind, long populationEstimate) {}
}
