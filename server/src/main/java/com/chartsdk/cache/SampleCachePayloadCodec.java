package com.chartsdk.cache;

import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class SampleCachePayloadCodec {
    private final ObjectMapper mapper;

    SampleCachePayloadCodec(ObjectMapper mapper) {
        this.mapper = mapper.copy()
                .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
                .enable(DeserializationFeature.USE_BIG_INTEGER_FOR_INTS);
    }

    String write(CachedResultSample sample) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("columns", sample.rows().columns());
            payload.put("rows", sample.rows().rows());
            payload.put("rowCount", sample.rows().rowCount());
            payload.put("truncated", sample.rows().truncated());
            payload.put("elapsedMs", sample.rows().elapsedMs());
            payload.put("sampling", sample.sampling().toMap());
            payload.put("sourceSql", Map.of(
                    "text", sample.sourceSql().text(),
                    "params", sample.sourceSql().params()
            ));
            return mapper.writeValueAsString(payload);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot encode L1 sample cache payload.", e);
        }
    }

    CachedResultSample read(String json) {
        try {
            Map<String, Object> payload = mapper.readValue(json, new TypeReference<>() {});
            if (!(payload.get("columns") instanceof List<?>) || !(payload.get("rows") instanceof List<?>)) return null;
            SamplingMetadata sampling = SamplingMetadata.fromMap(payload.get("sampling"));
            if (sampling == null || !(payload.get("sourceSql") instanceof Map<?, ?> source)) return null;
            String text = source.get("text") == null ? null : String.valueOf(source.get("text"));
            if (text == null || text.isBlank()) return null;
            List<Object> params = source.get("params") instanceof List<?> values
                    ? values.stream().map(value -> (Object) value).toList() : List.of();

            Map<String, Object> rowPayload = new LinkedHashMap<>();
            rowPayload.put("columns", payload.get("columns"));
            rowPayload.put("rows", payload.get("rows"));
            rowPayload.put("rowCount", payload.getOrDefault("rowCount", ((List<?>) payload.get("rows")).size()));
            rowPayload.put("truncated", payload.getOrDefault("truncated", false));
            rowPayload.put("elapsedMs", payload.getOrDefault("elapsedMs", 0));
            QueryRows rows = mapper.convertValue(rowPayload, QueryRows.class);
            if (rows.truncated()) return null;
            BuilderSqlBuilder.Sql sourceSql = new BuilderSqlBuilder.Sql(text, params, sampling);
            return new CachedResultSample(rows, sampling, sourceSql);
        } catch (Exception e) {
            return null;
        }
    }
}
