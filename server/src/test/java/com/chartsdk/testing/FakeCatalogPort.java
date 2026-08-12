package com.chartsdk.testing;

import com.chartsdk.datasource.spi.CatalogPort;
import com.chartsdk.query.SchemaCatalog;

import java.util.HashMap;
import java.util.Map;

/**
 * {@link CatalogPort}의 두 번째 구현(테스트 전용) — "새 소스 종류가 이 포트 하나로 카탈로그
 * 파이프라인에 합류한다"는 확장 계약을 기능 추가 없이 컴파일·실행으로 증명한다(설계 §5 P5).
 */
public final class FakeCatalogPort implements CatalogPort {

    private final Map<Long, SchemaCatalog> catalogs = new HashMap<>();
    private final Map<Long, Integer> loads = new HashMap<>();

    public FakeCatalogPort with(long datasourceId, SchemaCatalog catalog) {
        catalogs.put(datasourceId, catalog);
        return this;
    }

    /** TTL 캐시 검증용 — 이 포트가 실제로 몇 번 조회됐는가. */
    public int loadCount(long datasourceId) {
        return loads.getOrDefault(datasourceId, 0);
    }

    @Override
    public SchemaCatalog load(long datasourceId) {
        loads.merge(datasourceId, 1, Integer::sum);
        SchemaCatalog catalog = catalogs.get(datasourceId);
        if (catalog == null) {
            throw new IllegalStateException("No fake catalog registered for datasource " + datasourceId);
        }
        return catalog;
    }
}
