package com.chartsdk.cache;

import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class CachedChartPayloadCodecTest {
    private final CachedChartPayloadCodec codec = new CachedChartPayloadCodec(new ObjectMapper());
    private final QueryRows rows = new QueryRows(
            List.of(Map.of("name", "category", "type", "text"), Map.of("name", "sum", "type", "numeric")),
            List.of(List.of("A", 1200.0)), 1, false, 7);

    @Test
    void roundTripsSamplingMetadataInsideCachePayload() {
        SamplingMetadata sampling = SamplingMetadata.fromBuilderConfig(
                        Map.of("sample", Map.of("mode", "auto", "rate", 10, "seed", 77)))
                .withExecution(123, List.of(new SamplingMetadata.GroupSampleCount("A", 123)), List.of(), List.of());
        String json = codec.write(rows, sampling);
        CachedChartPayloadCodec.Decoded decoded = codec.read(json);

        assertThat(json).contains("\"sampling\"").contains("\"method\":\"SYSTEM\"")
                .contains("\"rate\":10").contains("\"seed\":77")
                .contains("\"sampledRowCount\":123");
        assertThat(decoded).isNotNull();
        assertThat(decoded.rows()).isEqualTo(rows);
        assertThat(decoded.sampling()).isEqualTo(sampling);
    }

    @Test
    void readsLegacyPayloadWithoutSamplingMetadata() {
        String legacy = """
                {"columns":[],"rows":[],"rowCount":0,"truncated":false,"elapsedMs":1}
                """;
        CachedChartPayloadCodec.Decoded decoded = codec.read(legacy);

        assertThat(decoded).isNotNull();
        assertThat(decoded.sampling()).isNull();
    }

    @Test
    void corruptPayloadIsTreatedAsCacheMiss() {
        assertThat(codec.read("{\"sampling\":{\"rate\":10}}")).isNull();
        assertThat(codec.read("not-json")).isNull();
    }
}
