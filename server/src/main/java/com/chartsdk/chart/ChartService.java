package com.chartsdk.chart;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartCacheExpectation;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.cache.SamplingMetadata;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.converter.FieldDisplayNameResolver;
import com.chartsdk.converter.SeriesPivot;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.datasource.DatasourceRuntimeVersions;
import com.chartsdk.query.BuilderSqlBuilder;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.SqlLiterals;
import com.chartsdk.query.engine.DistinctCountCompositionPolicy;
import com.chartsdk.query.engine.SourceCompositionPolicy;
import com.chartsdk.web.ApiException;
import com.chartsdk.web.dto.ChartSaveRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
public class ChartService {
    /** 목록 카드 1회 응답이 다루는 차트 상한(API 방어선). 목록 UI 자체는 8개/페이지로 조회한다. */
    static final int MAX_PREVIEW_CARDS = 60;

    private final ChartRepository charts;
    private final CurrentUserProvider currentUser;
    private final QueryExecutor queries;
    private final ChartComputeService compute;
    private final ChartOptionConverter converter;
    private final FederatedQueryRunner runner;
    private final ChartDefinitionWriter writer;
    private final ChartVersionPolicy versionPolicy;
    private final DatasourceRuntimeVersions runtimeVersions;
    private final SourceCompositionPolicy composition;

    public ChartService(ChartRepository charts, CurrentUserProvider currentUser, QueryExecutor queries,
                        ChartComputeService compute, ChartOptionConverter converter,
                        FederatedQueryRunner runner, ChartDefinitionWriter writer,
                        ChartVersionPolicy versionPolicy) {
        this(charts, currentUser, queries, compute, converter, runner, writer, versionPolicy,
                new DatasourceRuntimeVersions());
    }

    public ChartService(ChartRepository charts, CurrentUserProvider currentUser, QueryExecutor queries,
                        ChartComputeService compute, ChartOptionConverter converter,
                        FederatedQueryRunner runner, ChartDefinitionWriter writer,
                        ChartVersionPolicy versionPolicy, DatasourceRuntimeVersions runtimeVersions) {
        this(charts, currentUser, queries, compute, converter, runner, writer, versionPolicy,
                runtimeVersions, new DistinctCountCompositionPolicy());
    }

    @Autowired
    public ChartService(ChartRepository charts, CurrentUserProvider currentUser, QueryExecutor queries,
                        ChartComputeService compute, ChartOptionConverter converter,
                        FederatedQueryRunner runner, ChartDefinitionWriter writer,
                        ChartVersionPolicy versionPolicy, DatasourceRuntimeVersions runtimeVersions,
                        SourceCompositionPolicy composition) {
        this.charts = charts;
        this.currentUser = currentUser;
        this.queries = queries;
        this.compute = compute;
        this.converter = converter;
        this.runner = runner;
        this.writer = writer;
        this.versionPolicy = versionPolicy;
        this.runtimeVersions = runtimeVersions;
        this.composition = composition;
    }

    public Map<String, Object> list(ChartListQuery query) {
        return charts.list(ownerId(), query);
    }

    public Map<String, Object> get(long id) {
        return charts.get(ownerId(), id);
    }

    public Map<String, Object> preview(long id) {
        // 편집 진입은 서빙 캐시의 차트와 집계 결과표를 함께 복원한다. 편집기가 run-builder를 자동 호출하지 않고
        // 사용자가 [실행]을 누르기 전부터 마지막 저장 상태를 보여주기 위한 단건 전용 계약이다.
        return previewPayload(id, true);
    }

    public Map<String, Object> previews(String ids) {
        Map<String, Object> previews = new LinkedHashMap<>();
        Map<String, Object> errors = new LinkedHashMap<>();
        List<Long> requested = parseIds(ids).stream().limit(MAX_PREVIEW_CARDS).toList();
        Map<Long, ChartDefinition> definitions = charts.previewDefinitions(ownerId(), requested);
        // live 카드는 재계산 결과만 쓰고 실패 시 에러 카드가 되므로(스냅샷 폴백 없음 — 목록이 장애를
        // 숨기지 않는다) 대형 JSONB 스냅샷을 배치 조회에서 아예 읽지 않는다. 목록 1회 요청의 live 재계산
        // 수는 목록 UI 페이지 크기(8)가 자연 상한이다 — 별도 상한을 두지 않는다(이력 N19.1 재평가).
        Map<Long, ChartCacheExpectation> expectations = new LinkedHashMap<>();
        definitions.forEach((id, chart) -> {
            if (!"live".equals(chart.refreshMode())) {
                expectations.put(id, new ChartCacheExpectation(chart.version(), chart.sampling()));
            }
        });
        Map<Long, CachedChartRows> cached = compute.cachedCompatible(expectations);
        for (Long id : requested) {
            try {
                // 목록 카드는 option만 필요하다. 최대 MAX_PREVIEW_CARDS 개 응답에 rows를 중복 싣지 않는다.
                ChartDefinition chart = definitions.get(id);
                if (chart == null) {
                    errors.put(String.valueOf(id), "Chart not found.");
                    continue;
                }
                CachedChartRows rows = "live".equals(chart.refreshMode())
                        ? compute.serve(chart.id(), chart.refreshMode(), chart.version(), chart.sampling())
                        : cached.get(id);
                if (rows == null) {
                    errors.put(String.valueOf(id), "Preview snapshot is not ready.");
                    continue;
                }
                previews.put(String.valueOf(id), previewPayload(chart, rows, false));
            } catch (ApiException e) {
                errors.put(String.valueOf(id), e.getMessage());
            } catch (RuntimeException e) {
                errors.put(String.valueOf(id), "Preview unavailable.");
            }
        }
        return Map.of("previews", previews, "errors", errors);
    }

    public Map<String, Object> create(ChartSaveRequest input) {
        Prepared prepared = prepareForSave(input);
        Long ownerId = ownerId();
        ChartDefinitionWriter.SavedChart saved = writer.create(ownerId, prepared.request(), prepared.datasources());
        compute.seedPreparedQuietly(saved.id(), prepared.rows(), saved.version(), prepared.sampling(),
                prepared.datasourceVersions());
        return charts.get(ownerId, saved.id());
    }

    public Map<String, Object> update(long id, ChartSaveRequest input) {
        if (versionPolicy != null) versionPolicy.validate(input.version());
        Prepared prepared = prepareForSave(input);
        Long ownerId = ownerId();
        ChartDefinitionWriter.SavedChart saved = writer.update(ownerId, id, prepared.request(), prepared.datasources());
        compute.seedPreparedQuietly(id, prepared.rows(), saved.version(), prepared.sampling(),
                prepared.datasourceVersions());
        return charts.get(ownerId, id);
    }

    public void delete(long id) {
        charts.delete(ownerId(), id);
    }

    public Map<String, Object> refresh(long id) {
        // 수동 갱신도 조회·수정·삭제와 같은 owner scope를 먼저 통과해야 한다.
        // 실제 재계산은 임베드 핫패스와 공유하므로 ChartComputeService에는 owner 개념을 섞지 않는다.
        charts.previewDefinition(ownerId(), id);
        CachedChartRows rows = compute.recompute(id);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("chartId", id);
        result.put("computedAt", rows.computedAt().toString());
        result.put("rowCount", rows.rows().rowCount());
        result.put("elapsedMs", rows.rows().elapsedMs());
        if (rows.sampling() != null) rows.sampling().putInto(result);
        return result;
    }

    public Map<String, Object> duplicate(long id) {
        Long ownerId = ownerId();
        Long newId = writer.duplicate(ownerId, id);
        return charts.get(ownerId, newId);
    }

    private Map<String, Object> previewPayload(long id, boolean includeRows) {
        ChartDefinition chart = charts.previewDefinition(ownerId(), id);
        // 서빙 경로 불변식(설계 §8)은 ChartComputeService.serve 에 단일화 — 다중 소스는 캐시 스냅샷만.
        CachedChartRows rows = compute.serve(
                chart.id(), chart.refreshMode(), chart.version(), chart.sampling());
        return previewPayload(chart, rows, includeRows);
    }

    private Map<String, Object> previewPayload(ChartDefinition chart, CachedChartRows rows,
                                               boolean includeRows) {
        Map<String, Object> response = new LinkedHashMap<>();
        var displayRows = SeriesPivot.pivot(rows.rows(), chart.builderConfig(), chart.chartType());
        response.put("chartId", chart.id());
        response.put("computedAt", rows.computedAt().toString());
        response.put("rowCount", displayRows.rowCount());
        response.put("truncated", rows.rows().truncated());
        response.put("option", converter.convert(
                displayRows,
                chart.chartType(),
                chart.options(),
                chart.builderConfig(),
                chart.refreshMode()
        ));
        if (includeRows) {
            response.put("columns", FieldDisplayNameResolver.displayColumns(
                    chart.builderConfig(),
                    displayRows.columns(),
                    chart.builderConfig().get("seriesBy") != null
            ));
            response.put("rows", displayRows.rows());
            response.put("elapsedMs", rows.rows().elapsedMs());
        }
        if (rows.sampling() != null) rows.sampling().putInto(response);
        return response;
    }

    /**
     * 저장 준비 결과. 검증 과정에서 얻은 전체 차트 결과까지 보존해 저장 직후 캐시 시드가
     * 원본 데이터소스를 두 번째로 조회하지 않도록 한다.
     */
    private record Prepared(ChartSaveRequest request, Set<Long> datasources,
                            com.chartsdk.query.QueryRows rows, SamplingMetadata sampling,
                            Map<Long, Long> datasourceVersions) {
    }

    private Prepared prepareForSave(ChartSaveRequest input) {
        assertMainTable(input.builderConfig());
        String defineMode = input.defineMode() == null ? "builder" : input.defineMode();
        String chartType = input.chartType() == null ? "bar" : input.chartType();
        if ("builder".equals(defineMode)) {
            if (input.builderConfig() == null) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "builderConfig is required.");
            }
            // 라우터로 검증·계산(단일→PG / 다중→DuckDB 페더레이션). 실행 실패 시 저장도 실패(§7.7).
            Set<Long> configured = BuilderSqlBuilder.referencedDatasources(input.builderConfig());
            Set<Long> expectedDatasources = configured.isEmpty()
                    ? Set.of(input.datasourceId()) : configured;
            Map<Long, Long> sourceVersions = runtimeVersions.snapshot(expectedDatasources);
            int sampleCacheMaxAge = "live".equals(input.refreshMode())
                    ? 0 : ChartComputeService.MANUAL_SAMPLE_CACHE_MAX_AGE_SECONDS;
            FederatedQueryRunner.BuiltResult built = runner.runBuilder(
                    input.datasourceId(), input.builderConfig(), chartType, false, sampleCacheMaxAge);
            String storedSql = SqlLiterals.inline(built.sql().text(), built.sql().params());
            // 참조 소스 집합은 runBuilder 가 이미 확정(primary 폴백 포함) — junction 에 그대로 재사용.
            Set<Long> datasources = built.datasourceIds();
            // 스냅샷 필수 구성은 refresh_mode 를 manual 로 고정(임베드는 캐시-온리라 live 무의미, §7).
            // 판정 규칙은 SourceCompositionPolicy 가 단일 소유한다(설계 §4.4).
            String refreshMode = composition.normalizeRefreshMode(datasources, input.refreshMode());
            return new Prepared(
                    copy(input, defineMode, storedSql, chartType, refreshMode),
                    datasources,
                    built.rows(),
                    built.sampling(),
                    sourceVersions
            );
        }
        String sql = input.sqlQuery() == null ? "" : input.sqlQuery().trim();
        assertSelectOnly(sql);
        // 캐시에는 전체 차트 결과가 필요하므로 제한 실행 후 재조회하지 않고 처음부터 한 번만 전체 실행한다.
        Set<Long> rawDatasource = Set.of(input.datasourceId());
        Map<Long, Long> sourceVersions = runtimeVersions.snapshot(rawDatasource);
        var rows = queries.executeChart(input.datasourceId(), sql, List.of());
        // raw SQL 은 항상 단일 소스(primary) — 구조상 페더레이션 대상 아님.
        return new Prepared(
                copy(input, defineMode, sql, chartType, input.refreshMode()),
                rawDatasource,
                rows,
                null,
                sourceVersions
        );
    }

    private static void assertMainTable(Map<String, Object> builderConfig) {
        Object table = builderConfig == null ? null : builderConfig.get("table");
        boolean valid = table instanceof String relation && !relation.isBlank();
        if (table instanceof Map<?, ?> relation) {
            valid = relation.get("name") instanceof String name && !name.isBlank();
        }
        if (!valid) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "MAIN_TABLE_REQUIRED",
                    "A primary table is required to save a chart."
            );
        }
    }

    private static ChartSaveRequest copy(ChartSaveRequest input, String defineMode, String sqlQuery, String chartType, String refreshMode) {
        return new ChartSaveRequest(
                input.name(),
                input.description(),
                input.datasourceId(),
                defineMode,
                sqlQuery,
                input.builderConfig(),
                chartType,
                input.options(),
                refreshMode,
                input.version()
        );
    }

    private static void assertSelectOnly(String sql) {
        String lower = sql.toLowerCase(Locale.ROOT).strip();
        if (lower.isEmpty() || !(lower.startsWith("select") || lower.startsWith("with"))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SQL_NOT_SELECT", "Only SELECT statements are allowed.");
        }
        String body = lower.endsWith(";") ? lower.substring(0, lower.length() - 1) : lower;
        if (body.contains(";")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "SQL_NOT_SELECT", "Multiple statements are not allowed.");
        }
    }

    private Long ownerId() {
        return currentUser.currentUserId().isPresent() ? currentUser.currentUserId().getAsLong() : null;
    }

    private static List<Long> parseIds(String ids) {
        if (ids == null || ids.isBlank()) return List.of();
        java.util.ArrayList<Long> parsed = new java.util.ArrayList<>();
        for (String part : ids.split(",")) {
            String s = part.trim();
            if (s.isEmpty()) continue;
            try {
                long id = Long.parseLong(s);
                if (!parsed.contains(id)) parsed.add(id);
            } catch (NumberFormatException ignored) {
                // Ignore malformed ids; valid ids in the same request should still render.
            }
        }
        return parsed;
    }
}
