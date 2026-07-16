package com.chartsdk.cache;

import com.chartsdk.cache.SamplingMetadata.Estimate;
import com.chartsdk.cache.SamplingMetadata.GroupSampleCount;
import com.chartsdk.query.QueryRows;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** SQL의 숨은 표본 계수·통계 열을 실행 메타데이터(표본수·그룹·95% 오차범위)로 옮기고 차트용 rows에서는 제거한다. */
public final class SamplingQueryRows {
    private SamplingQueryRows() {}

    public record Result(QueryRows rows, SamplingMetadata sampling) {}

    public static Result extract(QueryRows source, SamplingMetadata sampling) {
        if (sampling == null || !sampling.approximate()) return new Result(source, sampling);
        List<Map<String, Object>> columns = source.columns();
        int groupIndex = lastIndexOf(columns, SamplingMetadata.HIDDEN_GROUP_COUNT);
        int totalIndex = lastIndexOf(columns, SamplingMetadata.HIDDEN_TOTAL_COUNT);
        if (groupIndex < 0 || totalIndex < 0) return new Result(source, sampling);

        boolean indexRandom = "INDEX_RANDOM".equals(sampling.method());
        Map<Integer, Integer> seriesCountCols = prefixIndices(columns, SamplingMetadata.HIDDEN_SERIES_COUNT_PREFIX);
        Map<Integer, Integer> meanCols = prefixIndices(columns, SamplingMetadata.HIDDEN_MEAN_PREFIX); // series → col
        Map<Integer, Integer> sdCols = prefixIndices(columns, SamplingMetadata.HIDDEN_SD_PREFIX);
        Set<Integer> hidden = new HashSet<>(List.of(groupIndex, totalIndex));
        hidden.addAll(seriesCountCols.values());
        hidden.addAll(meanCols.values());
        hidden.addAll(sdCols.values());

        List<Map<String, Object>> visibleColumns = new ArrayList<>();
        for (int i = 0; i < columns.size(); i++) if (!hidden.contains(i)) visibleColumns.add(columns.get(i));
        int seriesCount = Math.max(0, visibleColumns.size() - 1); // x + S 시리즈

        List<List<Object>> visibleRows = new ArrayList<>();
        List<GroupSampleCount> groups = new ArrayList<>();
        List<SamplingConfidence.GroupStat> stats = new ArrayList<>();
        long sampledRowCount = 0;
        List<List<Object>> rows = source.rows();
        for (int r = 0; r < rows.size(); r++) {
            List<Object> raw = rows.get(r);
            long n = toLong(raw.get(groupIndex));
            if (r == 0) sampledRowCount = toLong(raw.get(totalIndex));
            List<Object> visible = new ArrayList<>();
            for (int i = 0; i < raw.size(); i++) if (!hidden.contains(i)) visible.add(raw.get(i));
            visibleRows.add(visible);
            groups.add(new GroupSampleCount(visible.isEmpty() ? null : visible.get(0), n));
            if (indexRandom) {
                List<SamplingConfidence.SeriesPoint> series = new ArrayList<>();
                for (int s = 0; s < seriesCount; s++) {
                    double value = toDouble(visible.get(1 + s));
                    Double mean = meanCols.containsKey(s) ? toDoubleOrNull(raw.get(meanCols.get(s))) : null;
                    Double sd = sdCols.containsKey(s) ? toDoubleOrNull(raw.get(sdCols.get(s))) : null;
                    Long seriesN = seriesCountCols.containsKey(s) ? toLong(raw.get(seriesCountCols.get(s))) : null;
                    series.add(new SamplingConfidence.SeriesPoint(value, mean, sd, seriesN));
                }
                stats.add(new SamplingConfidence.GroupStat(visible.isEmpty() ? null : visible.get(0), n, series));
            }
        }
        if (rows.isEmpty()) sampledRowCount = 0;
        QueryRows visible = new QueryRows(visibleColumns, visibleRows, visibleRows.size(), source.truncated(), source.elapsedMs());

        List<Estimate> estimates = sampling.estimates();
        List<String> extraWarnings = new ArrayList<>();
        if (indexRandom && !estimates.isEmpty()) {
            SamplingConfidence.Result confidence = SamplingConfidence.compute(estimates, stats);
            estimates = confidence.estimates();
            if (confidence.smallSampleGroups()) extraWarnings.add("SMALL_SAMPLE_GROUPS");
            if (confidence.normalityAssumed()) extraWarnings.add("STDDEV_CI_NORMALITY_ASSUMED");
        }
        return new Result(visible, sampling.withExecution(sampledRowCount, groups, estimates, extraWarnings));
    }

    /** 숨은 계수 열은 SELECT 끝에 추가된다. 원본 X축 컬럼명이 우연히 같아도 마지막 항목을 택한다. */
    private static int lastIndexOf(List<Map<String, Object>> columns, String name) {
        for (int i = columns.size() - 1; i >= 0; i--) {
            if (name.equalsIgnoreCase(String.valueOf(columns.get(i).get("name")))) return i;
        }
        return -1;
    }

    /** {prefix}{seriesIndex} 형태 숨은 열 → (seriesIndex → columnIndex). */
    private static Map<Integer, Integer> prefixIndices(List<Map<String, Object>> columns, String prefix) {
        Map<Integer, Integer> result = new LinkedHashMap<>();
        for (int i = 0; i < columns.size(); i++) {
            String name = String.valueOf(columns.get(i).get("name"));
            if (name.startsWith(prefix)) {
                try {
                    result.put(Integer.parseInt(name.substring(prefix.length())), i);
                } catch (NumberFormatException ignored) {
                    // 접두는 맞지만 접미가 정수가 아님 — 무시
                }
            }
        }
        return result;
    }

    private static long toLong(Object value) {
        return value instanceof Number number ? number.longValue() : 0;
    }

    private static double toDouble(Object value) {
        return value instanceof Number number ? number.doubleValue() : 0;
    }

    private static Double toDoubleOrNull(Object value) {
        return value instanceof Number number ? number.doubleValue() : null;
    }
}
