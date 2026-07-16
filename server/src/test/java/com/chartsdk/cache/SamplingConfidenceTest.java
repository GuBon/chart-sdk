package com.chartsdk.cache;

import com.chartsdk.cache.SamplingConfidence.GroupStat;
import com.chartsdk.cache.SamplingConfidence.SeriesPoint;
import com.chartsdk.cache.SamplingMetadata.Estimate;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class SamplingConfidenceTest {

    @Test
    void averageMarginIsZTimesStandardErrorOfTheMean() {
        // n=100, s=10 → MOE=1.96·10/√100=1.96, rel=1.96/50 → 3.92%
        SamplingConfidence.Result r = SamplingConfidence.compute(
                List.of(new Estimate("avg_amount", "avg", "SAMPLE_ESTIMATE", null)),
                List.of(new GroupStat(100, List.of(new SeriesPoint(50.0, 50.0, 10.0)))));
        assertThat(r.estimates().get(0).relativeErrorPct()).isCloseTo(3.9199, within(0.001));
        assertThat(r.smallSampleGroups()).isFalse();
    }

    @Test
    void sampleSumAndCountDoNotGetPopulationConfidenceIntervals() {
        SamplingConfidence.Result r = SamplingConfidence.compute(
                List.of(
                        new Estimate("total", "sum", "SAMPLE_AGGREGATE", "SAMPLE_AGGREGATE_ONLY"),
                        new Estimate("cnt", "count", "SAMPLE_AGGREGATE", "SAMPLE_AGGREGATE_ONLY")),
                List.of(new GroupStat(100, List.of(
                        new SeriesPoint(5_000.0, null, null),
                        new SeriesPoint(100.0, null, null)))));

        assertThat(r.estimates()).allSatisfy(estimate -> {
            assertThat(estimate.marginOfError()).isNull();
            assertThat(estimate.relativeErrorPct()).isNull();
            assertThat(estimate.intervals()).isEmpty();
        });
        assertThat(r.normalityAssumed()).isFalse();
    }

    @Test
    void smallGroupsBelow30AreExcludedAndFlagged() {
        SamplingConfidence.Result r = SamplingConfidence.compute(
                List.of(new Estimate("avg_amount", "avg", "SAMPLE_ESTIMATE", null)),
                List.of(new GroupStat(20, List.of(new SeriesPoint(50.0, 50.0, 10.0)))));
        assertThat(r.estimates().get(0).relativeErrorPct()).isNull();
        assertThat(r.smallSampleGroups()).isTrue();
    }

    @Test
    void standardDeviationGetsPerGroupChiSquaredInterval() {
        SamplingConfidence.Result r = SamplingConfidence.compute(
                List.of(new Estimate("stddev_amount", "stddev", "SAMPLE_ESTIMATE", null)),
                List.of(new GroupStat("A", 100, List.of(new SeriesPoint(10.0, 50.0, 10.0, 100L)))));

        Estimate estimate = r.estimates().get(0);
        assertThat(estimate.relativeErrorPct()).isCloseTo(16.2, within(0.2));
        assertThat(estimate.intervals()).hasSize(1);
        assertThat(estimate.intervals().get(0).key()).isEqualTo("A");
        assertThat(estimate.intervals().get(0).sampleCount()).isEqualTo(100);
        assertThat(estimate.intervals().get(0).lower95()).isCloseTo(8.78, within(0.02));
        assertThat(estimate.intervals().get(0).upper95()).isCloseTo(11.62, within(0.02));
        assertThat(r.normalityAssumed()).isTrue();
        assertThat(r.smallSampleGroups()).isFalse();
    }

    @Test
    void varianceGetsAsymmetricIntervalOnVarianceScale() {
        SamplingConfidence.Result r = SamplingConfidence.compute(
                List.of(new Estimate("variance_amount", "variance", "SAMPLE_ESTIMATE", null)),
                List.of(new GroupStat("A", 100, List.of(new SeriesPoint(100.0, 50.0, 10.0, 100L)))));

        assertThat(r.estimates().get(0).intervals().get(0).lower95()).isCloseTo(77.1, within(0.2));
        assertThat(r.estimates().get(0).intervals().get(0).upper95()).isCloseTo(135.0, within(0.2));
    }

    @Test
    void nullableSeriesUsesItsOwnNonNullCountAndKeepsSmallGroupWarning() {
        SamplingConfidence.Result r = SamplingConfidence.compute(
                List.of(new Estimate("avg_amount", "avg", "SAMPLE_ESTIMATE", null)),
                List.of(
                        new GroupStat("enough", 100,
                                List.of(new SeriesPoint(50.0, 50.0, 10.0, 36L))),
                        new GroupStat("small", 100,
                                List.of(new SeriesPoint(50.0, 50.0, 10.0, 20L)))));

        // 유효 n=36 → 1.96·10/√36 / 50 ≈ 6.53%. 그룹 행수 100을 쓰면 잘못 3.92%가 된다.
        assertThat(r.estimates().get(0).relativeErrorPct()).isCloseTo(6.533, within(0.01));
        assertThat(r.smallSampleGroups()).isTrue();
    }

    @Test
    void seriesMarginIsTheWorstGroupRelativeError() {
        // 그룹A rel 작음(0.2%), 그룹B rel 큼(3.92%) → 시리즈는 최댓값(보수화).
        SamplingConfidence.Result r = SamplingConfidence.compute(
                List.of(new Estimate("avg_amount", "avg", "SAMPLE_ESTIMATE", null)),
                List.of(
                        new GroupStat(100, List.of(new SeriesPoint(1000.0, 1000.0, 10.0))),
                        new GroupStat(100, List.of(new SeriesPoint(50.0, 50.0, 10.0)))));
        assertThat(r.estimates().get(0).relativeErrorPct()).isCloseTo(3.9199, within(0.001));
    }
}
