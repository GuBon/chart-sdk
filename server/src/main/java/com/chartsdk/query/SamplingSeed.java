package com.chartsdk.query;

/** PostgreSQL과 DuckDB setseed가 받는 [-1, 1] 범위로 공개 sampling seed를 변환한다. */
public final class SamplingSeed {
    private SamplingSeed() {}

    public static double unit(long seed) {
        return Math.max(-1.0, Math.min(1.0, (seed / (double) Integer.MAX_VALUE) * 2.0 - 1.0));
    }
}
