package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;

/** 캐시 result JSONB 직렬화 경계. 신규 sampling 필드와 sampling 없는 레거시 payload를 함께 처리한다. */
final class CachedChartPayloadCodec {
    record Decoded(QueryRows rows, SamplingMetadata sampling) {}

    private final ObjectMapper mapper;

    CachedChartPayloadCodec(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    String write(QueryRows rows, SamplingMetadata sampling) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("columns", rows.columns());
            payload.put("rows", rows.rows());
            payload.put("rowCount", rows.rowCount());
            payload.put("truncated", rows.truncated());
            payload.put("elapsedMs", rows.elapsedMs());
            if (sampling != null) payload.put("sampling", sampling.toMap());
            return mapper.writeValueAsString(payload);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    Decoded read(String json) {
        try {
            Map<String, Object> payload = mapper.readValue(json, new TypeReference<>() {});
            if (!(payload.get("columns") instanceof java.util.List) || !(payload.get("rows") instanceof java.util.List)) {
                return null;
            }
            Map<String, Object> rowPayload = new LinkedHashMap<>(payload);
            rowPayload.remove("sampling");
            QueryRows rows = mapper.convertValue(rowPayload, QueryRows.class);
            return new Decoded(rows, SamplingMetadata.fromMap(payload.get("sampling")));
        } catch (Exception e) {
            return null;
        }
    }
}
