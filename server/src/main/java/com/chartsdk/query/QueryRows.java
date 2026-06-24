package com.chartsdk.query;

import java.util.List;
import java.util.Map;

public record QueryRows(
        List<Map<String, Object>> columns,
        List<List<Object>> rows,
        int rowCount,
        boolean truncated,
        long elapsedMs
) {
}
