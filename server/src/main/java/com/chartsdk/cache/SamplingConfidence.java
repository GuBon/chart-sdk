package com.chartsdk.cache;

import com.chartsdk.cache.SamplingMetadata.Estimate;
import com.chartsdk.cache.SamplingMetadata.ConfidenceInterval;
import org.apache.commons.math3.distribution.ChiSquaredDistribution;

import java.util.ArrayList;
import java.util.List;

/**
 * 인덱스 무작위 표본(INDEX_RANDOM)의 시리즈별 95% 오차범위(MOE) 계산기 — 순수 정적, 공유 픽스처로 검증.
 *
 * <p>그룹별 유효 n·평균(ȳ)·표본표준편차(s)를 사용한다. 시리즈 오차는 그룹별 상대오차의 최댓값(보수화),
 * n&lt;30 그룹은 제외한다. avg=z·s/√n. SUM·COUNT는 표본 관측값이므로 모집단 오차범위를 계산하지 않는다.
 * stddev·variance 는 그룹 값이 정규분포에 가깝다는 가정 아래 카이제곱 분포로 비대칭 구간을 계산한다.
 */
public final class SamplingConfidence {
    private static final int MIN_GROUP_N = 30;
    private static final double ALPHA = 1.0 - SamplingMetadata.CONFIDENCE_LEVEL;

    private SamplingConfidence() {}

    public record SeriesPoint(double value, Double mean, Double sd, Long sampleCount) {
        public SeriesPoint(double value, Double mean, Double sd) {
            this(value, mean, sd, null);
        }
    }
    public record GroupStat(Object key, long n, List<SeriesPoint> series) {
        public GroupStat(long n, List<SeriesPoint> series) {
            this(null, n, series);
        }
    }
    public record Result(List<Estimate> estimates, boolean smallSampleGroups, boolean normalityAssumed) {}

    private record Bounds(double lower, double upper) {}

    public static Result compute(List<Estimate> estimates, List<GroupStat> groups) {
        List<Estimate> out = new ArrayList<>();
        boolean smallSampleGroups = false;
        boolean normalityAssumed = false;
        for (int i = 0; i < estimates.size(); i++) {
            Estimate e = estimates.get(i);
            if (!eligible(e.aggregate())) { out.add(e); continue; }
            double maxRel = 0, worstMoe = 0;
            boolean any = false, sawSmall = false;
            List<ConfidenceInterval> intervals = new ArrayList<>();
            for (GroupStat g : groups) {
                if (i >= g.series().size()) continue;
                SeriesPoint p = g.series().get(i);
                long n = p.sampleCount() == null ? g.n() : p.sampleCount();
                if (n < MIN_GROUP_N) { sawSmall = true; continue; }
                if (isDispersion(e.aggregate())) {
                    Bounds bounds = dispersionBounds(e.aggregate(), n, p);
                    if (bounds == null) continue;
                    double denom = Math.abs(p.value());
                    double intervalMoe = Math.max(Math.abs(p.value() - bounds.lower()), Math.abs(bounds.upper() - p.value()));
                    Double relPct = denom < 1e-9 ? null : intervalMoe / denom * 100.0;
                    intervals.add(new ConfidenceInterval(g.key(), n, p.value(), bounds.lower(), bounds.upper(), relPct));
                    normalityAssumed = true;
                    if (relPct != null && Double.isFinite(relPct)) {
                        double rel = relPct / 100.0;
                        if (rel > maxRel) {
                            maxRel = rel;
                            worstMoe = intervalMoe;
                        }
                        any = true;
                    }
                    continue;
                }
                double moe = averageMoe(e.aggregate(), n, p);
                double denom = Math.abs(p.value());
                if (!Double.isFinite(moe) || denom < 1e-9) continue;
                double rel = moe / denom;
                if (rel > maxRel) { maxRel = rel; worstMoe = moe; }
                any = true;
            }
            if (sawSmall) smallSampleGroups = true;
            if (!intervals.isEmpty()) {
                out.add(e.withConfidence(any ? worstMoe : null, any ? maxRel * 100.0 : null, intervals));
            } else if (any) {
                out.add(e.withError(worstMoe, maxRel * 100.0));
            } else {
                out.add(e);
            }
        }
        return new Result(out, smallSampleGroups, normalityAssumed);
    }

    private static boolean eligible(String aggregate) {
        return "avg".equals(aggregate) || isDispersion(aggregate);
    }

    private static boolean isDispersion(String aggregate) {
        return "stddev".equals(aggregate) || "variance".equals(aggregate);
    }

    private static Bounds dispersionBounds(String aggregate, long n, SeriesPoint p) {
        if (p.sd() == null || n <= 1 || !Double.isFinite(p.sd()) || p.sd() < 0) return null;
        double degreesOfFreedom = n - 1.0;
        ChiSquaredDistribution chiSquared = new ChiSquaredDistribution(degreesOfFreedom);
        double lowerQuantile = chiSquared.inverseCumulativeProbability(ALPHA / 2.0);
        double upperQuantile = chiSquared.inverseCumulativeProbability(1.0 - ALPHA / 2.0);
        if (!(lowerQuantile > 0) || !(upperQuantile > 0)) return null;
        double sampleVariance = p.sd() * p.sd();
        double varianceLower = degreesOfFreedom * sampleVariance / upperQuantile;
        double varianceUpper = degreesOfFreedom * sampleVariance / lowerQuantile;
        if ("stddev".equals(aggregate)) {
            return new Bounds(Math.sqrt(varianceLower), Math.sqrt(varianceUpper));
        }
        return new Bounds(varianceLower, varianceUpper);
    }

    private static double averageMoe(String aggregate, long n, SeriesPoint p) {
        if (!"avg".equals(aggregate) || p.sd() == null || n <= 0) return Double.NaN;
        return SamplingMetadata.CONFIDENCE_Z * p.sd() / Math.sqrt(n);
    }
}
