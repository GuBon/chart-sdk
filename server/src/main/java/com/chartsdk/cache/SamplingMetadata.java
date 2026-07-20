package com.chartsdk.cache;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * 표본 설정(스펙)과 실행 통계를 캐시·Admin·임베드·SDK가 공유하는 정식 계약(v6).
 *
 * <p><b>스펙</b>(캐시 판정 대상 — builderConfig 만으로 결정): {@code mode·requestedMethod·rate·sizeTarget·seed}.
 * <b>실행</b>(표시용 — 런타임 해석 결과): {@code approximate·method·valueMode·populationEstimate·sampleSize·
 * sampledRowCount·confidenceLevel·groups·estimates·warnings}. {@link #matchesDefinition}은 스펙만 비교해
 * auto 해석이 INDEX_RANDOM/RESULT_RANDOM/SYSTEM/FULL_SCAN으로 갈려도 캐시가 영구 미스되지 않게 한다.
 */
public record SamplingMetadata(
        int version,
        // ── 스펙(캐시 판정) ──
        String mode,
        String requestedMethod,
        Double rate,
        Integer sizeTarget,
        Long seed,
        // ── 실행(표시) ──
        boolean approximate,
        String method,
        String valueMode,
        Long populationEstimate,
        Integer sampleSize,
        Long sampledRowCount,
        Double confidenceLevel,
        List<GroupSampleCount> groups,
        List<Estimate> estimates,
        List<String> warnings
) {
    public static final int CONTRACT_VERSION = 6;
    public static final double MIN_RATE = 0.1;
    public static final double MAX_RATE = 100.0;
    public static final long DEFAULT_SEED = 48_291L;
    public static final int MIN_SIZE = 1_000;
    public static final int MAX_SIZE = 50_000;
    public static final double CONFIDENCE_Z = 1.959964; // 95% 양측
    public static final double CONFIDENCE_LEVEL = 0.95;
    public static final String HIDDEN_GROUP_COUNT = "__chartsdk_sample_count";
    public static final String HIDDEN_TOTAL_COUNT = "__chartsdk_sample_total";
    public static final String HIDDEN_SERIES_COUNT_PREFIX = "__chartsdk_sample_n_";
    public static final String HIDDEN_MEAN_PREFIX = "__chartsdk_sample_mean_";
    public static final String HIDDEN_SD_PREFIX = "__chartsdk_sample_sd_";

    public record GroupSampleCount(Object key, long sampleCount) {}

    /** 차트의 한 그룹(점)에 대응하는 95% 추정 구간. */
    public record ConfidenceInterval(Object key, long sampleCount, double estimate,
                                     double lower95, double upper95, Double relativeErrorPct) {}

    /** 시리즈별 처리·경고 + (INDEX_RANDOM 한정) 95% 오차범위. moe/relPct 는 계산 불가 집계에서 null. */
    public record Estimate(String series, String aggregate, String treatment, String warning,
                           Double marginOfError, Double relativeErrorPct,
                           List<ConfidenceInterval> intervals) {
        public Estimate {
            intervals = intervals == null ? List.of() : List.copyOf(intervals);
        }
        public Estimate(String series, String aggregate, String treatment, String warning) {
            this(series, aggregate, treatment, warning, null, null, List.of());
        }
        public Estimate(String series, String aggregate, String treatment, String warning,
                        Double marginOfError, Double relativeErrorPct) {
            this(series, aggregate, treatment, warning, marginOfError, relativeErrorPct, List.of());
        }
        public Estimate withError(Double moe, Double relPct) {
            return new Estimate(series, aggregate, treatment, warning, moe, relPct, intervals);
        }
        public Estimate withConfidence(Double moe, Double relPct, List<ConfidenceInterval> groupIntervals) {
            return new Estimate(series, aggregate, treatment, warning, moe, relPct, groupIntervals);
        }
    }

    public SamplingMetadata {
        groups = groups == null ? List.of() : List.copyOf(groups);
        estimates = estimates == null ? List.of() : List.copyOf(estimates);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }

    // ── 스펙 팩토리 (DB 무접근) ─────────────────────────────
    /** builderConfig → 표본 스펙. 캐시 판정·정의 로딩·무플랜 SQL 경로가 공유한다. 표본 없으면 null. */
    public static SamplingMetadata fromBuilderConfig(Map<String, Object> builderConfig) {
        if (builderConfig == null || !(builderConfig.get("sample") instanceof Map<?, ?> sample)) return null;
        String mode = normalizedMode(sample.get("mode"));
        String requestedMethod = "system".equals(String.valueOf(sample.get("method"))) ? "system" : "auto";
        long seed = sample.get("seed") instanceof Number s ? s.longValue() : DEFAULT_SEED;
        if (seed < 0 || seed > Integer.MAX_VALUE) return null;
        Double rate = sample.get("rate") instanceof Number n ? n.doubleValue() : null;
        if (rate != null && !validRate(rate)) return null;
        Integer sizeTarget = sample.get("size") instanceof Number n ? clampSize(n.intValue()) : null;

        boolean exact = rate != null && rate >= MAX_RATE;
        // 레거시 %(rate)는 종전 SYSTEM 해석 유지(무플랜 SQL 경로 호환). count 경로는 INDEX_RANDOM 요청 스펙.
        String method = exact ? "FULL_SCAN"
                : (requestedMethod.equals("system") || rate != null ? "SYSTEM" : "INDEX_RANDOM");
        List<Estimate> estimates = estimates(builderConfig, exact);
        Set<String> warnings = new LinkedHashSet<>(warningsFor(method));
        for (Estimate e : estimates) if (e.warning() != null) warnings.add(e.warning());
        return new SamplingMetadata(
                CONTRACT_VERSION, mode, requestedMethod, rate, sizeTarget, exact ? null : seed,
                !exact, method, exact ? "exact" : "sample",
                null, null, null, null,
                List.of(), estimates, List.copyOf(warnings));
    }

    // ── 실행 해석 (스펙 필드 보존 + 실행 필드 갱신) ───────────
    /** 전량 정확 실행. 스펙 seed/rate 는 캐시 판정을 위해 보존한다. */
    public SamplingMetadata asExact() {
        List<Estimate> exact = estimates.stream()
                .map(e -> new Estimate(e.series(), e.aggregate(), "EXACT", null)).toList();
        return new SamplingMetadata(version, mode, requestedMethod, rate, sizeTarget, seed,
                false, "FULL_SCAN", "exact", null, null, null, null, List.of(), exact, List.of());
    }

    /** SYSTEM 블록 표본 폴백. popEst/sampleSize는 "전체 약 N행 중 표본 K행" 표시용이다. */
    public SamplingMetadata asSystem(long populationEstimate, int sampleSize) {
        return new SamplingMetadata(version, mode, requestedMethod, rate, sizeTarget, seed,
                true, "SYSTEM", "sample", populationEstimate,
                sampleSize > 0 ? sampleSize : null, null, null,
                List.of(), estimates, executionWarnings("SYSTEM", estimates));
    }

    /** 인덱스 키 무작위 표본. popEst/sampleSize는 표시·계획용이고 SUM/COUNT 외삽에는 쓰지 않는다. */
    public SamplingMetadata asIndexRandom(long populationEstimate, int sampleSize) {
        return new SamplingMetadata(version, mode, requestedMethod, rate, sizeTarget, seed,
                true, "INDEX_RANDOM", "sample", populationEstimate, sampleSize, null, CONFIDENCE_LEVEL,
                List.of(), estimates, executionWarnings("INDEX_RANDOM", estimates));
    }

    /** VIEW 또는 JOIN+WHERE 결과에서 뽑은 균일 행 표본. */
    public SamplingMetadata asResultRandom(long populationEstimate, int sampleSize) {
        return new SamplingMetadata(version, mode, requestedMethod, rate, sizeTarget, seed,
                true, "RESULT_RANDOM", "sample", populationEstimate > 0 ? populationEstimate : null,
                sampleSize, null, CONFIDENCE_LEVEL,
                List.of(), estimates, executionWarnings("RESULT_RANDOM", estimates));
    }

    /** 실행 통계(실측 표본수·그룹·오차범위·추가 경고) 주입. 정확 실행은 무시. */
    public SamplingMetadata withExecution(long sampledRowCount, List<GroupSampleCount> groupCounts,
                                          List<Estimate> withMoe, List<String> extraWarnings) {
        if (!approximate) return this;
        Set<String> merged = new LinkedHashSet<>(warnings);
        if (extraWarnings != null) merged.addAll(extraWarnings);
        return new SamplingMetadata(version, mode, requestedMethod, rate, sizeTarget, seed,
                approximate, method, valueMode, populationEstimate, sampleSize,
                Math.max(0, sampledRowCount), confidenceLevel,
                groupCounts == null ? List.of() : groupCounts,
                withMoe == null ? estimates : withMoe, List.copyOf(merged));
    }

    /** 레거시 수동 SYSTEM 팩토리(테스트·구 호출부). */
    public static SamplingMetadata system(double rate) {
        if (!validRate(rate) || rate >= MAX_RATE) return null;
        return new SamplingMetadata(CONTRACT_VERSION, "manual", "system", rate, null, DEFAULT_SEED,
                true, "SYSTEM", "sample", null, null, null, null,
                List.of(), List.of(), List.of("BLOCK_SAMPLE_CLUSTERING"));
    }

    /** 실행 통계는 무시하고 캐시가 현재 sample 스펙으로 계산됐는지만 비교한다(스펙 필드 한정). */
    public boolean matchesDefinition(SamplingMetadata expected) {
        if (expected == null) return false;
        return version == CONTRACT_VERSION && expected.version == CONTRACT_VERSION
                && Objects.equals(mode, expected.mode)
                && Objects.equals(requestedMethod, expected.requestedMethod)
                && Objects.equals(rate, expected.rate)
                && Objects.equals(sizeTarget, expected.sizeTarget)
                && Objects.equals(seed, expected.seed);
    }

    // ── 직렬화 ──────────────────────────────────────────────
    public static SamplingMetadata fromMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) return null;
        int version = map.get("version") instanceof Number n ? n.intValue() : 1;
        boolean approximate = !Boolean.FALSE.equals(map.get("approximate"));
        String method = string(map.get("method"), approximate ? "SYSTEM" : "FULL_SCAN");
        if (approximate == "FULL_SCAN".equals(method)) return null; // 정합성: 정확=FULL_SCAN, 근사=SYSTEM/INDEX_RANDOM/RESULT_RANDOM
        String requestedMethod = string(map.get("requestedMethod"), "SYSTEM".equals(method) ? "system" : "auto");
        String mode = normalizedMode(map.get("mode"));
        Double rate = map.get("rate") instanceof Number n ? n.doubleValue() : null;
        Integer sizeTarget = map.get("sizeTarget") instanceof Number n ? n.intValue() : null;
        Long seed = map.get("seed") instanceof Number n ? n.longValue() : null;
        String valueMode = string(map.get("valueMode"), approximate ? "sample" : "exact");
        Long populationEstimate = map.get("populationEstimate") instanceof Number n ? n.longValue() : null;
        Integer sampleSize = map.get("sampleSize") instanceof Number n ? n.intValue() : null;
        Long sampledRowCount = map.get("sampledRowCount") instanceof Number n ? n.longValue() : null;
        Double confidenceLevel = map.get("confidenceLevel") instanceof Number n ? n.doubleValue() : null;

        List<GroupSampleCount> groups = new ArrayList<>();
        if (map.get("groups") instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> g && g.get("sampleCount") instanceof Number n) {
                    groups.add(new GroupSampleCount(g.get("key"), n.longValue()));
                }
            }
        }
        List<Estimate> estimates = new ArrayList<>();
        if (map.get("estimates") instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> e) {
                    List<ConfidenceInterval> intervals = new ArrayList<>();
                    if (e.get("intervals") instanceof List<?> intervalItems) {
                        for (Object intervalItem : intervalItems) {
                            if (!(intervalItem instanceof Map<?, ?> interval)
                                    || !(interval.get("sampleCount") instanceof Number sampleCount)
                                    || !(interval.get("estimate") instanceof Number estimate)
                                    || !(interval.get("lower95") instanceof Number lower95)
                                    || !(interval.get("upper95") instanceof Number upper95)) continue;
                            intervals.add(new ConfidenceInterval(
                                    interval.get("key"), sampleCount.longValue(), estimate.doubleValue(),
                                    lower95.doubleValue(), upper95.doubleValue(),
                                    interval.get("relativeErrorPct") instanceof Number rel ? rel.doubleValue() : null));
                        }
                    }
                    estimates.add(new Estimate(
                            string(e.get("series"), ""), string(e.get("aggregate"), ""),
                            string(e.get("treatment"), approximate ? "SAMPLE_ESTIMATE" : "EXACT"),
                            e.get("warning") == null ? null : String.valueOf(e.get("warning")),
                            e.get("marginOfError") instanceof Number n ? n.doubleValue() : null,
                            e.get("relativeErrorPct") instanceof Number n ? n.doubleValue() : null,
                            intervals));
                }
            }
        }
        List<String> warnings = map.get("warnings") instanceof List<?> list
                ? list.stream().map(String::valueOf).toList() : List.of();
        return new SamplingMetadata(version, mode, requestedMethod, rate, sizeTarget, seed,
                approximate, method, valueMode, populationEstimate, sampleSize, sampledRowCount, confidenceLevel,
                groups, estimates, warnings);
    }

    public Map<String, Object> toMap() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("version", version);
        result.put("mode", mode);
        result.put("requestedMethod", requestedMethod);
        if (rate != null) result.put("rate", rate);
        if (sizeTarget != null) result.put("sizeTarget", sizeTarget);
        if (seed != null) result.put("seed", seed);
        result.put("approximate", approximate);
        result.put("method", method);
        result.put("valueMode", valueMode);
        if (populationEstimate != null) result.put("populationEstimate", populationEstimate);
        if (sampleSize != null) result.put("sampleSize", sampleSize);
        if (sampledRowCount != null) result.put("sampledRowCount", sampledRowCount);
        if (confidenceLevel != null) result.put("confidenceLevel", confidenceLevel);
        if (!groups.isEmpty()) result.put("groups", groups.stream().map(g -> Map.of(
                "key", g.key() == null ? "" : g.key(), "sampleCount", g.sampleCount())).toList());
        if (!estimates.isEmpty()) result.put("estimates", estimates.stream().map(e -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("series", e.series());
            item.put("aggregate", e.aggregate());
            item.put("treatment", e.treatment());
            if (e.warning() != null) item.put("warning", e.warning());
            if (e.marginOfError() != null) item.put("marginOfError", e.marginOfError());
            if (e.relativeErrorPct() != null) item.put("relativeErrorPct", e.relativeErrorPct());
            if (!e.intervals().isEmpty()) item.put("intervals", e.intervals().stream().map(interval -> {
                Map<String, Object> confidence = new LinkedHashMap<>();
                confidence.put("key", interval.key() == null ? "" : interval.key());
                confidence.put("sampleCount", interval.sampleCount());
                confidence.put("estimate", interval.estimate());
                confidence.put("lower95", interval.lower95());
                confidence.put("upper95", interval.upper95());
                if (interval.relativeErrorPct() != null) {
                    confidence.put("relativeErrorPct", interval.relativeErrorPct());
                }
                return confidence;
            }).toList());
            return item;
        }).toList());
        if (!warnings.isEmpty()) result.put("warnings", warnings);
        return result;
    }

    /** nested sampling 이 정식 계약이고 approximate/sampleRate 는 하위 호환 별칭이다. */
    public void putInto(Map<String, Object> response) {
        response.put("sampling", toMap());
        response.put("approximate", approximate);
        response.put("sampleRate", effectiveRate());
    }

    /** 레거시 sampleRate 별칭용 — INDEX_RANDOM 은 실측 K/N̂ 유효비율, SYSTEM 은 요청 rate, 정확은 100. */
    private double effectiveRate() {
        if (!approximate) return MAX_RATE;
        if (rate != null) return rate;
        if (populationEstimate != null && populationEstimate > 0 && sampleSize != null) {
            return Math.max(MIN_RATE, Math.round(1000.0 * sampleSize / populationEstimate) / 10.0);
        }
        return MIN_RATE;
    }

    // ── 헬퍼 ────────────────────────────────────────────────
    private static List<Estimate> estimates(Map<String, Object> builderConfig, boolean exact) {
        Object raw = builderConfig.get("yAxis");
        if (!(raw instanceof List<?> list)) return List.of();
        List<Estimate> estimates = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> y)) continue;
            String aggregate = string(y.get("agg"), "sum");
            String column = unqualified(string(y.get("column"), "value"));
            String series = string(y.get("alias"), "none".equals(aggregate) ? column : aggregate + "_" + column);
            estimates.add(new Estimate(series, aggregate,
                    exact ? "EXACT" : treatment(aggregate), exact ? null : warning(aggregate)));
        }
        return estimates;
    }

    private static List<String> warningsFor(String method) {
        return switch (method) {
            case "SYSTEM" -> List.of("BLOCK_SAMPLE_CLUSTERING");
            case "INDEX_RANDOM" -> List.of("INDEX_RANDOM_SAMPLE");
            case "RESULT_RANDOM" -> List.of("RESULT_RANDOM_SAMPLE");
            default -> List.of();
        };
    }

    private static List<String> executionWarnings(String method, List<Estimate> estimates) {
        Set<String> warnings = new LinkedHashSet<>(warningsFor(method));
        for (Estimate estimate : estimates) if (estimate.warning() != null) warnings.add(estimate.warning());
        return List.copyOf(warnings);
    }

    private static String treatment(String aggregate) {
        return switch (aggregate) {
            case "sum", "count" -> "SAMPLE_AGGREGATE";
            case "min", "max" -> "OBSERVED_EXTREME";
            case "count_distinct" -> "OBSERVED_DISTINCT";
            default -> "SAMPLE_ESTIMATE";
        };
    }

    private static String warning(String aggregate) {
        return switch (aggregate) {
            case "sum", "count" -> "SAMPLE_AGGREGATE_ONLY";
            case "min", "max" -> "OBSERVED_EXTREME_ONLY";
            case "count_distinct" -> "DISTINCT_COUNT_NOT_EXTRAPOLATED";
            default -> null;
        };
    }

    private static int clampSize(int size) {
        return Math.max(MIN_SIZE, Math.min(MAX_SIZE, size));
    }

    private static String normalizedMode(Object value) {
        return "auto".equals(String.valueOf(value)) ? "auto" : "manual";
    }

    private static boolean validRate(double rate) {
        return Double.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE
                && Math.abs(rate * 10 - Math.rint(rate * 10)) <= 0.0000001;
    }

    private static String unqualified(String column) {
        int dot = column.indexOf('.');
        return dot < 0 ? column : column.substring(dot + 1);
    }

    private static String string(Object value, String fallback) {
        return value == null || String.valueOf(value).isBlank() ? fallback : String.valueOf(value);
    }
}
