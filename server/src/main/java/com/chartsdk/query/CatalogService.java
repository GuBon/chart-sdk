package com.chartsdk.query;

import com.chartsdk.datasource.spi.CatalogPort;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 카탈로그 TTL 캐시·무효화의 단일 관리자 — 소스 종류 무관. 실제 메타데이터 로딩은
 * {@link CatalogPort} 구현(종류별 확장점)에 위임한다.
 *
 * <p>짧은 TTL 은 편집 세션 중 반복 검증(스키마 탐색·빌더 검증·표본 계획)이 고객 DB 카탈로그를
 * 매번 다시 읽지 않게 하고, 데이터소스 변경 이벤트는 {@link #invalidate}로 즉시 반영한다.
 */
@Service
public class CatalogService {

    private static final long CATALOG_TTL_NANOS = TimeUnit.SECONDS.toNanos(30);

    private final CatalogPort port;
    private final ConcurrentHashMap<Long, CachedCatalog> catalogs = new ConcurrentHashMap<>();

    private record CachedCatalog(SchemaCatalog value, long expiresAtNanos) {
        boolean valid(long now) {
            return now < expiresAtNanos;
        }
    }

    public CatalogService(CatalogPort port) {
        this.port = port;
    }

    public SchemaCatalog catalog(long datasourceId) {
        long now = System.nanoTime();
        CachedCatalog cached = catalogs.get(datasourceId);
        if (cached != null && cached.valid(now)) return cached.value();
        return catalogs.compute(datasourceId, (id, current) -> {
            long checkedAt = System.nanoTime();
            if (current != null && current.valid(checkedAt)) return current;
            return new CachedCatalog(port.load(id), checkedAt + CATALOG_TTL_NANOS);
        }).value();
    }

    /** 데이터소스 관리 흐름이 메타데이터 변경을 즉시 반영할 수 있게 한다. */
    public void invalidate(long datasourceId) {
        catalogs.remove(datasourceId);
    }

    /**
     * planner 통계 기반 테이블 행 수 추정치. 정확한 COUNT(*)를 실행하지 않아
     * 스키마 탐색·표본 계획·UI 안내가 대용량 테이블을 다시 스캔하지 않는다.
     */
    public Map<SchemaCatalog.Key, Long> estimatedRowCounts(long datasourceId) {
        return catalog(datasourceId).estimatedRowCounts();
    }
}
