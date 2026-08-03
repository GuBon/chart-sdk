package com.chartsdk.query;

/**
 * 표본 실행 계획 — {@link SamplingPlanner}가 DB 통계로 결정하고 {@link BuilderSqlBuilder}가 SQL·메타데이터로
 * 소비하는 순수 값(빌더는 DB 무접근 유지). keys/pkColumn 은 INDEX_RANDOM 에서만, blockRate 는 SYSTEM 에서만 쓴다.
 */
public record SamplePlan(Method method, long[] keys, String pkColumn,
                         long populationEstimate, int sampleSize, double blockRate,
                         long seed, String fallbackReason) {

    public enum Method { NONE, FULL_SCAN, SYSTEM, INDEX_RANDOM, RESULT_RANDOM }

    public static SamplePlan none() {
        return new SamplePlan(Method.NONE, null, null, 0, 0, 0, 0, null);
    }

    public static SamplePlan fullScan(long populationEstimate, long seed) {
        return new SamplePlan(Method.FULL_SCAN, null, null, populationEstimate, 0, 0, seed, null);
    }

    /** SYSTEM 블록 표본. blockRate=SQL 표본 비율, sampleSize="전체 약 N행 중 K행" 표시용 목표값. */
    public static SamplePlan system(long populationEstimate, int sampleSize, double blockRate, long seed, String reason) {
        return new SamplePlan(Method.SYSTEM, null, null, populationEstimate, sampleSize, blockRate, seed, reason);
    }

    public static SamplePlan indexRandom(long[] keys, String pkColumn, long populationEstimate, int sampleSize, long seed) {
        return new SamplePlan(Method.INDEX_RANDOM, keys, pkColumn, populationEstimate, sampleSize, 0, seed, null);
    }

    /** VIEW 또는 JOIN+WHERE 결과에서 집계 전에 뽑는 행 단위 무작위 표본. */
    public static SamplePlan resultRandom(long populationEstimate, int sampleSize, long seed, String reason) {
        return new SamplePlan(Method.RESULT_RANDOM, null, null, populationEstimate, sampleSize, 0, seed, reason);
    }

    /** EXPLAIN으로 얻은 VIEW 또는 JOIN+WHERE 결과 행 수 추정치를 기존 결과 표본 계획에 주입한다. */
    public SamplePlan withPopulationEstimate(long estimate) {
        return new SamplePlan(method, keys, pkColumn, Math.max(0, estimate), sampleSize, blockRate, seed, fallbackReason);
    }
}
