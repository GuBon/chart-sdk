package com.chartsdk.chart;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ChartListQueryTest {
    @Test
    void appliesStablePaginationDefaultsAndBounds() {
        ChartListQuery defaults = new ChartListQuery(null, null, null, null, null, null, null, null);
        ChartListQuery oversized = new ChartListQuery(null, null, null, null, null, null, 99, 500);

        assertThat(defaults.resolvedPageSize()).isEqualTo(8);
        assertThat(defaults.resolvedPage(3)).isEqualTo(1);
        assertThat(oversized.resolvedPageSize()).isEqualTo(60);
        assertThat(oversized.resolvedPage(4)).isEqualTo(4);
    }

    @Test
    void relationWithoutSchemaUsesPublic() {
        ChartListQuery query = new ChartListQuery(null, null, 1L, null, "sales", null, 1, 12);

        assertThat(query.hasRelation()).isTrue();
        assertThat(query.hasSchema()).isTrue();
        assertThat(query.relationSchema()).isEqualTo("public");
    }

    @Test
    void blankRelationDoesNotEnableRelationFilter() {
        ChartListQuery query = new ChartListQuery(null, null, 1L, "analytics", "  ", null, 1, 12);

        assertThat(query.hasRelation()).isFalse();
        assertThat(query.hasSchema()).isTrue();
        assertThat(query.relationSchema()).isEqualTo("analytics");
    }

    @Test
    void blankSchemaAndRelationDoNotEnableScopedFilter() {
        ChartListQuery query = new ChartListQuery(null, null, 1L, "  ", "  ", null, 1, 12);

        assertThat(query.hasSchema()).isFalse();
        assertThat(query.hasRelation()).isFalse();
    }
}
