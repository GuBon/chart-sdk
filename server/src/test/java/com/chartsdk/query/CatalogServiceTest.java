package com.chartsdk.query;

import com.chartsdk.testing.FakeCatalogPort;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 카탈로그 TTL 캐시가 포트 뒤에서 소스 종류 무관으로 동작함을 {@link FakeCatalogPort}
 * (두 번째 CatalogPort 구현)로 검증한다 — 포트가 진짜 이음매라는 증명을 겸한다(설계 §5 P5).
 */
class CatalogServiceTest {

    private static SchemaCatalog catalogOf(String table) {
        return new SchemaCatalog(Map.of(
                new SchemaCatalog.Key("public", table), Map.of("id", "bigint")));
    }

    @Test
    void cachesWithinTtlAndReloadsAfterInvalidate() {
        SchemaCatalog catalog = catalogOf("sales");
        FakeCatalogPort port = new FakeCatalogPort().with(7L, catalog);
        CatalogService service = new CatalogService(port);

        assertThat(service.catalog(7L)).isSameAs(catalog);
        assertThat(service.catalog(7L)).isSameAs(catalog);
        assertThat(port.loadCount(7L)).isEqualTo(1); // TTL 내 재사용 — 포트 재조회 없음

        service.invalidate(7L);
        assertThat(service.catalog(7L)).isSameAs(catalog);
        assertThat(port.loadCount(7L)).isEqualTo(2); // 무효화 후에만 다시 로드
    }

    @Test
    void cachesPerDatasourceIndependently() {
        FakeCatalogPort port = new FakeCatalogPort()
                .with(1L, catalogOf("orders"))
                .with(2L, catalogOf("users"));
        CatalogService service = new CatalogService(port);

        service.catalog(1L);
        service.catalog(2L);
        service.invalidate(1L);
        service.catalog(1L);
        service.catalog(2L);

        assertThat(port.loadCount(1L)).isEqualTo(2);
        assertThat(port.loadCount(2L)).isEqualTo(1); // 다른 소스 무효화의 영향 없음
    }

    @Test
    void estimatedRowCountsComeFromTheLoadedCatalog() {
        SchemaCatalog.Key key = new SchemaCatalog.Key("public", "sales");
        SchemaCatalog catalog = new SchemaCatalog(
                Map.of(key, Map.of("id", "bigint")),
                Map.of(key, RelationType.TABLE),
                Map.of(key, 5_000L),
                Map.of());
        CatalogService service = new CatalogService(new FakeCatalogPort().with(3L, catalog));

        assertThat(service.estimatedRowCounts(3L)).containsEntry(key, 5_000L);
    }
}
