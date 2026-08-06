package com.chartsdk.federation;

import com.chartsdk.datasource.DatasourceCredentials;
import com.chartsdk.datasource.DatasourceService;
import com.chartsdk.query.QueryExecutor;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * Phase 2 — ATTACH SQL 생성의 순수 로직(외부 DB 불필요): 별칭 규약·read-only·자격증명 이스케이프·마스킹.
 * 실 페더레이션 실행은 Phase 0 스파이크 + 통합 스크립트로 검증한다.
 */
class DuckDbFederationTest {

    @Test
    void rawPreviewIsBoundedButChartExecutionIsComplete() {
        DuckDbFederation federation = new DuckDbFederation(
                mock(DatasourceService.class), mock(QueryExecutor.class));

        var preview = federation.execute(List.of(), "SELECT * FROM range(60000)", List.of());
        assertThat(preview.rowCount()).isEqualTo(QueryExecutor.MAX_ROWS);
        assertThat(preview.truncated()).isTrue();

        var chart = federation.executeChart(List.of(), "SELECT * FROM range(60000)", List.of());
        assertThat(chart.rowCount()).isEqualTo(60_000);
        assertThat(chart.truncated()).isFalse();
    }

    @Test
    void adaptivePointExecutionScansPopulationButRetainsOnlyTheReservoir() {
        DuckDbFederation federation = new DuckDbFederation(
                mock(DatasourceService.class), mock(QueryExecutor.class));

        var sampled = federation.executeAutoPointChart(
                List.of(), "SELECT * FROM range(60000)", List.of(), 10_000, 77);

        assertThat(sampled.populationCount()).isEqualTo(60_000);
        assertThat(sampled.rows().rowCount()).isEqualTo(10_000);
        assertThat(sampled.sampled()).isTrue();
        assertThat(sampled.rows().truncated()).isFalse();
    }

    @Test
    void buildsReadOnlyAttachWithDatasourceAlias() {
        DatasourceCredentials c = new DatasourceCredentials("127.0.0.1", 15432, "tandanji", "tandanji", "tandanji", 5);

        String sql = DuckDbFederation.attachSql(2, c);

        assertThat(sql).isEqualTo(
                "ATTACH 'dbname=''tandanji'' host=''127.0.0.1'' port=15432 user=''tandanji'' password=''tandanji''' "
                        + "AS \"ds2\" (TYPE postgres, READ_ONLY)");
    }

    @Test
    void aliasMatchesRefRendererConvention() {
        DatasourceCredentials c = new DatasourceCredentials("h", 5432, "db", "u", "p", 5);
        assertThat(DuckDbFederation.attachSql(7, c)).contains("AS \"ds7\"");
        assertThat(com.chartsdk.query.RefRenderer.attachAlias(7L)).isEqualTo("ds7");
    }

    @Test
    void maskedAttachOmitsPasswordForLogging() {
        DatasourceCredentials c = new DatasourceCredentials("h", 5432, "db", "u", "s3cr3t", 5);

        String masked = DuckDbFederation.maskedAttachSql(9, c);

        assertThat(masked).contains("password=''****''");
        assertThat(masked).doesNotContain("s3cr3t");
    }

    @Test
    void escapesSpacesQuotesAndBackslashesInCredentials() {
        // 공백·단일따옴표·백슬래시가 든 비밀번호도 libpq(\ 이스케이프) + SQL('' 이스케이프) 이중으로 안전.
        DatasourceCredentials c = new DatasourceCredentials("h", 5432, "db", "u", "a'b c\\d", 5);

        String sql = DuckDbFederation.attachSql(1, c);

        // libpq: a'b c\d → 'a\'b c\\d' ; SQL 리터럴 doubling: ' → ''
        assertThat(sql).contains("password=''a\\''b c\\\\d''");
        // 원본 비밀번호가 이스케이프 없이 그대로 노출되지 않는다.
        assertThat(sql).doesNotContain("password='a'b c");
    }
}
