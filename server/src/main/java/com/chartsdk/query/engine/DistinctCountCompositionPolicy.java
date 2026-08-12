package com.chartsdk.query.engine;

import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * 현행 규칙 — distinct 데이터소스 2개 이상이면 페더레이션 실행·스냅샷 서빙·manual 고정.
 * 규칙 값은 이 클래스에만 존재한다(기존 3곳 분산 판정을 이관, 설계 §1.2).
 */
@Component
public class DistinctCountCompositionPolicy implements SourceCompositionPolicy {

    private static final int FEDERATION_THRESHOLD = 2;

    @Override
    public boolean requiresFederation(Set<Long> datasourceIds) {
        return datasourceIds != null && datasourceIds.size() >= FEDERATION_THRESHOLD;
    }

    @Override
    public boolean requiresSnapshot(int distinctSourceCount) {
        return distinctSourceCount >= FEDERATION_THRESHOLD;
    }
}
