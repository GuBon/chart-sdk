package com.chartsdk.query;

import com.chartsdk.config.OptionDefaults;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.datasource.DatasourceCredentials;
import com.chartsdk.datasource.DatasourcePoolRegistry;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.federation.DuckDbFederation;
import com.chartsdk.federation.FederatedQueryRunner;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 별도 PostGIS 컨테이너(55433)에서 실제 Point·Polygon 공간 컬럼 조회와 차트 변환을 관통 검증한다. */
class SpatialPointIT {
    private static final long DATASOURCE_ID = 995L;
    private static final int PORT = 55433;
    private static final String DATABASE = "chartsdk_spatial_test";
    private static final String SCHEMA = "chartsdk_spatial_it";
    private static DatasourcePoolRegistry pools;
    private static FederatedQueryRunner runner;

    @BeforeAll
    static void setup() throws Exception {
        assumeTrue(reachable("localhost", PORT), "PostGIS 통합 테스트 컨테이너(55433) 미가동 — skip");
        try (Connection connection = adminConnection(); Statement statement = connection.createStatement()) {
            statement.execute("CREATE EXTENSION IF NOT EXISTS postgis");
            statement.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
            statement.execute("CREATE SCHEMA " + SCHEMA);
            statement.execute("""
                    CREATE TABLE chartsdk_spatial_it.places_geometry(
                        id BIGINT PRIMARY KEY,
                        name TEXT NOT NULL,
                        weight NUMERIC NOT NULL,
                        location geometry(Point, 3857) NOT NULL
                    )
                    """);
            // 1,205개의 실제 Point를 Web Mercator로 저장한다. 조회 SQL이 WGS84로 되돌리는지와 1,000행 초과 반환을 함께 검증한다.
            statement.execute("""
                    INSERT INTO chartsdk_spatial_it.places_geometry(id, name, weight, location)
                    SELECT i,
                           '지점-' || i,
                           10 + (i % 90),
                           ST_Transform(
                               ST_SetSRID(ST_MakePoint(
                                   126.8 + (i % 20) * 0.01,
                                   35.1 + ((i - 1) / 20) * 0.01
                               ), 4326),
                               3857
                           )
                      FROM generate_series(1, 1205) AS i
                    """);
            statement.execute("""
                    CREATE TABLE chartsdk_spatial_it.places_geography(
                        id BIGINT PRIMARY KEY,
                        location geography(Point, 4326) NOT NULL
                    )
                    """);
            statement.execute("""
                    INSERT INTO chartsdk_spatial_it.places_geography VALUES
                        (1, ST_SetSRID(ST_MakePoint(126.9780, 37.5665), 4326)::geography),
                        (2, ST_SetSRID(ST_MakePoint(129.0756, 35.1796), 4326)::geography),
                        (3, ST_SetSRID(ST_MakePoint(126.5312, 33.4996), 4326)::geography)
                    """);
            statement.execute("""
                    CREATE TABLE chartsdk_spatial_it.areas_geometry(
                        id BIGINT PRIMARY KEY,
                        name TEXT NOT NULL,
                        score NUMERIC NOT NULL,
                        boundary geometry(Polygon, 3857) NOT NULL
                    )
                    """);
            statement.execute("""
                    INSERT INTO chartsdk_spatial_it.areas_geometry VALUES
                        (1, '서부', 25, ST_Transform(ST_GeomFromText('POLYGON((126.8 37.3,127.0 37.3,127.0 37.5,126.8 37.5,126.8 37.3))', 4326), 3857)),
                        (2, '동부', 75, ST_Transform(ST_GeomFromText('POLYGON((127.0 37.3,127.2 37.3,127.2 37.5,127.0 37.5,127.0 37.3))', 4326), 3857))
                    """);
            statement.execute("""
                    INSERT INTO chartsdk_spatial_it.areas_geometry(id, name, score, boundary)
                    SELECT i,
                           'area-' || i,
                           10 + (i % 90),
                           ST_Transform(
                               ST_MakeEnvelope(
                                   126.0 + (i % 40) * 0.01,
                                   34.0 + ((i - 1) / 40) * 0.01,
                                   126.005 + (i % 40) * 0.01,
                                   34.005 + ((i - 1) / 40) * 0.01,
                                   4326
                               ),
                               3857
                           )
                      FROM generate_series(3, 5000) AS i
                    """);
            statement.execute("""
                    CREATE TABLE chartsdk_spatial_it.areas_geography(
                        id BIGINT PRIMARY KEY,
                        name TEXT NOT NULL,
                        score NUMERIC NOT NULL,
                        boundary geography(MultiPolygon, 4326) NOT NULL
                    )
                    """);
            statement.execute("""
                    INSERT INTO chartsdk_spatial_it.areas_geography VALUES
                        (1, '복합 권역', 50, ST_Multi(ST_GeomFromText('POLYGON((128.0 36.0,128.2 36.0,128.2 36.2,128.0 36.2,128.0 36.0))', 4326))::geography)
                    """);
            statement.execute("ANALYZE " + SCHEMA + ".places_geometry");
            statement.execute("ANALYZE " + SCHEMA + ".places_geography");
            statement.execute("ANALYZE " + SCHEMA + ".areas_geometry");
            statement.execute("ANALYZE " + SCHEMA + ".areas_geography");
        }

        DatasourceService datasources = mock(DatasourceService.class);
        when(datasources.credentials(DATASOURCE_ID)).thenReturn(
                new DatasourceCredentials("localhost", PORT, DATABASE, "postgres", "0218", 2));
        pools = new DatasourcePoolRegistry(datasources);
        QueryExecutor queries = new QueryExecutor(pools);
        runner = new FederatedQueryRunner(queries, new DuckDbFederation(datasources, queries), new SamplingPlanner(queries));
    }

    @AfterAll
    static void cleanup() throws Exception {
        if (pools != null) pools.evict(DATASOURCE_ID);
        if (!reachable("localhost", PORT)) return;
        try (Connection connection = adminConnection(); Statement statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
        }
    }

    @Test
    void geometryPointIsTransformedToWgs84AndRenderedBeyondOneThousandRows() {
        Map<String, Object> config = Map.of(
                "table", ref("places_geometry"),
                "yAxis", List.of(),
                "where", List.of(Map.of("column", "id", "op", "lte", "value", 1_205)),
                "geoPoint", Map.of("mode", "spatial", "spatialColumn", "location", "sizeColumn", "weight"));

        FederatedQueryRunner.BuiltResult result = runner.runBuilder(DATASOURCE_ID, config, "geoscatter", false);

        assertThat(result.sql().text())
                .contains("ST_Transform")
                .contains("__chartsdk_longitude")
                .contains("__chartsdk_latitude")
                .doesNotContain("LIMIT 1000");
        assertThat(result.rows().rowCount()).isEqualTo(1_205);
        assertThat(result.rows().truncated()).isFalse();
        assertThat(result.rows().columns()).extracting(column -> column.get("name"))
                .containsExactly("__chartsdk_longitude", "__chartsdk_latitude", "__chartsdk_size");
        assertCoordinate(result.rows().rows().get(0), 126.81, 35.1);

        Map<String, Object> option = new ChartOptionConverter(new OptionDefaults(Map.of()))
                .convert(result.rows(), "geoscatter", Map.of());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> series = (List<Map<String, Object>>) option.get("series");
        assertThat(series).hasSize(1);
        assertThat(series.get(0)).containsEntry("type", "scatter").containsEntry("coordinateSystem", "geo");
        assertThat((List<?>) series.get(0).get("data")).hasSize(1_205);
    }

    @Test
    void geographyPointUsesTheSameLongitudeLatitudeContract() {
        Map<String, Object> config = Map.of(
                "table", ref("places_geography"),
                "yAxis", List.of(),
                "where", List.of(),
                "geoPoint", Map.of("mode", "spatial", "spatialColumn", "location"));

        FederatedQueryRunner.BuiltResult result = runner.runBuilder(DATASOURCE_ID, config, "geoscatter", false);

        assertThat(result.rows().rowCount()).isEqualTo(3);
        assertThat(result.rows().columns()).extracting(column -> column.get("name"))
                .containsExactly("__chartsdk_longitude", "__chartsdk_latitude");
        assertCoordinate(result.rows().rows().get(0), 126.9780, 37.5665);
    }

    @Test
    void ordinaryBarRendersAllFiveThousandGroupsWithoutSampling() {
        Map<String, Object> config = Map.of(
                "table", ref("areas_geometry"),
                "xAxis", "name",
                "yAxis", List.of(Map.of("column", "score", "agg", "sum")),
                "where", List.of());

        FederatedQueryRunner.BuiltResult result = runner.runBuilder(DATASOURCE_ID, config, "bar", false);

        assertThat(result.sql().text()).doesNotContain("LIMIT 1000");
        assertThat(result.rows().rowCount()).isEqualTo(5_000);
        assertThat(result.rows().truncated()).isFalse();

        Map<String, Object> option = new ChartOptionConverter(new OptionDefaults(Map.of()))
                .convert(result.rows(), "bar", Map.of());
        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat((List<?>) series.get("data")).hasSize(5_000);
    }

    @Test
    void allFiveThousandGeometryAreasAndGeographyAreasBecomeEmbeddedDynamicMaps() {
        Map<String, Object> geometryConfig = Map.of(
                "table", ref("areas_geometry"),
                "where", List.of(),
                "geoArea", Map.of(
                        "mode", "spatial",
                        "spatialColumn", "boundary",
                        "nameColumn", "name",
                        "valueColumn", "score"));

        FederatedQueryRunner.BuiltResult geometry = runner.runBuilder(DATASOURCE_ID, geometryConfig, "map", false);
        assertThat(geometry.sql().text()).doesNotContain("LIMIT 1000");
        assertThat(geometry.rows().rowCount()).isEqualTo(5_000);
        assertThat(geometry.rows().truncated()).isFalse();
        assertThat(geometry.rows().columns()).extracting(column -> column.get("name"))
                .containsExactly("__chartsdk_area_name", "__chartsdk_area_value", "__chartsdk_geojson");
        assertThat(geometry.rows().rows()).hasSize(5_000);
        assertThat(String.valueOf(geometry.rows().rows().get(0).get(2))).contains("\"type\":\"Polygon\"");

        Map<String, Object> option = new ChartOptionConverter(new OptionDefaults(Map.of()))
                .convert(geometry.rows(), "map", Map.of());
        Map<?, ?> series = (Map<?, ?>) ((List<?>) option.get("series")).get(0);
        assertThat(series.get("map")).asString().startsWith("chartsdk-dynamic-");
        assertThat((List<?>) series.get("data")).hasSize(5_000);
        assertThat((List<?>) option.get("__chartsdkMaps")).hasSize(1);
        Map<?, ?> embeddedMap = (Map<?, ?>) ((List<?>) option.get("__chartsdkMaps")).get(0);
        Map<?, ?> geoJson = (Map<?, ?>) embeddedMap.get("geoJSON");
        assertThat((List<?>) geoJson.get("features")).hasSize(5_000);

        Map<String, Object> geographyConfig = Map.of(
                "table", ref("areas_geography"),
                "where", List.of(),
                "geoArea", Map.of(
                        "mode", "spatial",
                        "spatialColumn", "boundary",
                        "nameColumn", "name",
                        "valueColumn", "score"));
        FederatedQueryRunner.BuiltResult geography = runner.runBuilder(DATASOURCE_ID, geographyConfig, "map", false);
        assertThat(String.valueOf(geography.rows().rows().get(0).get(2))).contains("\"type\":\"MultiPolygon\"");
    }

    private static void assertCoordinate(List<Object> row, double longitude, double latitude) {
        assertThat(((Number) row.get(0)).doubleValue()).isCloseTo(longitude, within(0.000_001));
        assertThat(((Number) row.get(1)).doubleValue()).isCloseTo(latitude, within(0.000_001));
    }

    private static org.assertj.core.data.Offset<Double> within(double value) {
        return org.assertj.core.data.Offset.offset(value);
    }

    private static Map<String, Object> ref(String name) {
        return Map.of("datasourceId", DATASOURCE_ID, "schema", SCHEMA, "name", name);
    }

    private static Connection adminConnection() throws Exception {
        return DriverManager.getConnection("jdbc:postgresql://localhost:" + PORT + "/" + DATABASE, "postgres", "0218");
    }

    private static boolean reachable(String host, int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 1_000);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
