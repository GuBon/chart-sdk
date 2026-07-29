package com.chartsdk.converter;

import com.chartsdk.config.OptionDefaults;
import com.chartsdk.query.QueryRows;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

class TransformParityAuditTest {
    private record Dataset(List<Map<String, Object>> columns, List<List<Object>> rows) {}
    private record ParityCase(String name, String chartType, String dataset, Map<String, Object> options) {}
    private record ParityContract(Map<String, Dataset> datasets, List<ParityCase> cases) {}

    @Test
    void writesJavaDefaultsAndConfiguredCasesForAllChartTypes() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        Map<String, Map<String, Object>> byType;
        try (InputStream in = getClass().getResourceAsStream("/chart-defaults.json")) {
            byType = mapper.readValue(in, new TypeReference<>() {});
        }
        ChartOptionConverter converter = new ChartOptionConverter(new OptionDefaults(byType));
        Map<String, Object> defaults = new LinkedHashMap<>();
        for (String chartType : List.of("bar", "line", "pie", "scatter", "boxplot", "heatmap", "map", "geoscatter")) {
            defaults.put(chartType, converter.convert(rowsFor(chartType), chartType, Map.of()));
        }
        ParityContract contract;
        try (InputStream in = getClass().getResourceAsStream("/transform-parity-contract-cases.json")) {
            contract = mapper.readValue(in, ParityContract.class);
        }
        Map<String, Object> configured = new LinkedHashMap<>();
        for (ParityCase testCase : contract.cases()) {
            Dataset dataset = contract.datasets().get(testCase.dataset());
            QueryRows rows = rows(dataset.columns(), dataset.rows());
            configured.put(
                    testCase.name(),
                    converter.convert(rows, testCase.chartType(), testCase.options())
            );
        }
        Map<String, Object> snapshots = Map.of("defaults", defaults, "configured", configured);
        Path outputDir = Path.of("..", ".tmp_transform");
        Files.createDirectories(outputDir);
        mapper.writerWithDefaultPrettyPrinter()
                .writeValue(outputDir.resolve("java.json").toFile(), snapshots);
    }

    private QueryRows rowsFor(String chartType) {
        if ("scatter".equals(chartType)) {
            return rows(
                    List.of(column("x", "number"), column("y", "number"), column("size", "number")),
                    List.of(List.of(1, 10, 3), List.of(2, 20, 9))
            );
        }
        if ("boxplot".equals(chartType)) {
            return rows(
                    List.of(column("category", "text"), column("value", "number")),
                    List.of(
                            List.of("A", 1), List.of("A", 2), List.of("A", 3), List.of("A", 20),
                            List.of("B", 4), List.of("B", 5), List.of("B", 6)
                    )
            );
        }
        if ("geoscatter".equals(chartType)) {
            return rows(
                    List.of(column("lng", "number"), column("lat", "number"), column("size", "number")),
                    List.of(List.of(126.978, 37.5665, 10), List.of(129.0756, 35.1796, 30))
            );
        }
        return rows(
                List.of(column("category", "text"), column("s1", "number"), column("s2", "number")),
                List.of(List.of("A", 10, 30), List.of("B", 20, 20))
        );
    }

    private QueryRows rows(List<Map<String, Object>> columns, List<List<Object>> rows) {
        return new QueryRows(columns, rows, rows.size(), false, 0);
    }

    private Map<String, Object> column(String name, String type) {
        return Map.of("name", name, "type", type);
    }
}
