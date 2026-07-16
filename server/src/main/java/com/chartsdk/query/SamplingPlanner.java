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

    static final int DEFAULT_SIZE = 10_000;      // auto 기본 목표 행 수. 오차는 집계·분산·그룹별 유효 n에 따라 별도 계산한다.
    static final int MAX_PROBES = 60_000;        // 인덱스 프로브 예산(10s 타임아웃)
    static final double MIN_DENSITY = 0.5;       // 키 밀도 하한 — 미만이면 오버샘플 비용 과다
    static final long FULL_SCAN_ROWS = 100_000;  // 이하 테이블은 스캔이 프로브보다 싸고 정확

    private final QueryExecutor queries;

    public SamplingPlanner(QueryExecutor queries) {
        this.queries = queries;
    }

    /** base 테이블 표본 계획. 표본 미설정·rows 모드·조인 동반이면 NONE(빌더가 나머지 검증). */
    public SamplePlan plan(long datasourceId, Map<String, Object> cfg, boolean rawMode) {
        if (rawMode || !(cfg.get("sample") instanceof Map<?, ?> sample)) return SamplePlan.none();
        if (cfg.get("joins") instanceof List<?> j && !j.isEmpty()) return SamplePlan.none(); // 표본+조인은 빌더가 400
        Table table = parseBaseTable(cfg.get("table"));
        if (table == null) return SamplePlan.none();

        String mode = "auto".equals(String.valueOf(sample.get("mode"))) ? "auto" : "manual";
        boolean systemPinned = "system".equals(String.valueOf(sample.get("method")));
        Double rate = sample.get("rate") instanceof Number n ? n.doubleValue() : null;
        Integer size = sample.get("size") instanceof Number n ? n.intValue() : null;
        long seed = sample.get("seed") instanceof Number n ? n.longValue() : SamplingMetadata.DEFAULT_SEED;

        if (rate != null && rate >= SamplingMetadata.MAX_RATE) return SamplePlan.fullScan(0, seed);

        try {
            long pop = reltuples(datasourceId, table);
            if (systemPinned) {
                double blockRate = rate != null ? rate : effectiveRate(DEFAULT_SIZE, pop);
                return SamplePlan.system(pop, resolveSize(mode, size, rate, pop), blockRate, seed, "SYSTEM_PINNED");
            }
            if (pop > 0 && pop <= FULL_SCAN_ROWS) return SamplePlan.fullScan(pop, seed);
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
            // 카탈로그 조사 실패(권한·통계 부재 등) → 안전하게 SYSTEM 폴백. 본 쿼리 실패 시 정식 에러로 표면화된다.
            return systemFallback(size, rate, mode, 0, seed, "PLANNER_ERROR");
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
    private long reltuples(long datasourceId, Table t) {
        List<List<Object>> rows = queries.execute(datasourceId, """
                SELECT GREATEST(c.reltuples, 0)::bigint
                  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = ? AND c.relname = ?
                """, List.of(t.schema(), t.table())).rows();
        return rows.isEmpty() ? 0 : toLong(rows.get(0).get(0));
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
}
