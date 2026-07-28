package com.chartsdk.chart;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.converter.SeriesPivot;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.QueryExecutor;
import com.chartsdk.query.SqlLiterals;
import com.chartsdk.web.ApiException;
import com.chartsdk.web.dto.ChartSaveRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Service
public class ChartService {
    private final ChartRepository charts;
    private final CurrentUserProvider currentUser;
    private final QueryExecutor queries;
    private final ChartComputeService compute;
    private final ChartOptionConverter converter;
    private final FederatedQueryRunner runner;

    public ChartService(ChartRepository charts, CurrentUserProvider currentUser, QueryExecutor queries,
                        ChartComputeService compute, ChartOptionConverter converter,
                        FederatedQueryRunner runner) {
        this.charts = charts;
        this.currentUser = currentUser;
        this.queries = queries;
        this.compute = compute;
        this.converter = converter;
        this.runner = runner;
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
        parseIds(ids).stream().limit(60).forEach((id) -> {
            try {
                // 목록 카드는 option만 필요하다. 최대 60개 카드 응답에 rows를 중복 싣지 않는다.
                previews.put(String.valueOf(id), previewPayload(id, false));
            } catch (ApiException e) {
                errors.put(String.valueOf(id), e.getMessage());
            } catch (RuntimeException e) {
                errors.put(String.valueOf(id), "Preview unavailable.");
            }
        });
        return Map.of("previews", previews, "errors", errors);
    }

    public Map<String, Object> create(ChartSaveRequest input) {
        Prepared prepared = prepareForSave(input);
        Long id = charts.create(ownerId(), prepared.request());
        charts.setChartDatasources(id, prepared.datasources());
        compute.seedQuietly(id);
        return charts.get(ownerId(), id);
    }

    public Map<String, Object> update(long id, ChartSaveRequest input) {
        Prepared prepared = prepareForSave(input);
        Long ownerId = ownerId();
        int updated = charts.update(ownerId, id, prepared.request());
        if (updated == 0) {
            if (charts.exists(ownerId, id)) {
                throw new ApiException(HttpStatus.CONFLICT, "VERSION_CONFLICT", "Chart was modified elsewhere; reload and retry.");
            }
            throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
        }
        charts.setChartDatasources(id, prepared.datasources());
        compute.seedQuietly(id);
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
        Long newId = charts.duplicate(ownerId, id);
        charts.copyCache(newId, id);
        return charts.get(ownerId, newId);
    }

    private Map<String, Object> previewPayload(long id, boolean includeRows) {
        ChartDefinition chart = charts.previewDefinition(ownerId(), id);
        // 서빙 경로 불변식(설계 §8)은 ChartComputeService.serve 에 단일화 — 다중 소스는 캐시 스냅샷만.
        CachedChartRows rows = compute.serve(chart.id(), chart.refreshMode(), chart.cacheTtlSeconds(),
                chart.version(), chart.sampling());
        Map<String, Object> response = new LinkedHashMap<>();
        var displayRows = SeriesPivot.pivot(rows.rows(), chart.builderConfig());
        response.put("chartId", chart.id());
        response.put("computedAt", rows.computedAt().toString());
        response.put("rowCount", displayRows.rowCount());
        response.put("truncated", rows.rows().truncated());
        response.put("option", converter.convert(displayRows, chart.chartType(), chart.options()));
        if (includeRows) {
            response.put("columns", displayRows.columns());
            response.put("rows", displayRows.rows());
            response.put("elapsedMs", rows.rows().elapsedMs());
        }
        if (rows.sampling() != null) rows.sampling().putInto(response);
        return response;
    }

    /** 저장 준비 결과 — 정규화된 요청 + 참조 데이터소스 집합(junction 영속화용). 소스 집합은 runBuilder 가 이미 계산한 값을 재사용(재계산 제거). */
    private record Prepared(ChartSaveRequest request, Set<Long> datasources) {
    }

    private Prepared prepareForSave(ChartSaveRequest input) {
        String defineMode = input.defineMode() == null ? "builder" : input.defineMode();
        String chartType = input.chartType() == null ? "bar" : input.chartType();
        if ("builder".equals(defineMode)) {
            if (input.builderConfig() == null) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "builderConfig is required.");
            }
            // 라우터로 검증·계산(단일→PG / 다중→DuckDB 페더레이션). 실행 실패 시 저장도 실패(§7.7).
            FederatedQueryRunner.BuiltResult built = runner.runBuilder(input.datasourceId(), input.builderConfig(), chartType, false);
            String storedSql = SqlLiterals.inline(built.sql().text(), built.sql().params());
            // 참조 소스 집합은 runBuilder 가 이미 확정(primary 폴백 포함) — junction 에 그대로 재사용.
            Set<Long> datasources = built.datasourceIds();
            // 다중 소스는 스냅샷 모델 → refresh_mode 를 manual 로 고정(임베드는 캐시-온리라 live 무의미, §7).
            String refreshMode = datasources.size() >= 2 ? "manual" : input.refreshMode();
            return new Prepared(copy(input, defineMode, storedSql, chartType, refreshMode), datasources);
        }
        String sql = input.sqlQuery() == null ? "" : input.sqlQuery().trim();
        assertSelectOnly(sql);
        queries.execute(input.datasourceId(), sql);
        // raw SQL 은 항상 단일 소스(primary) — 구조상 페더레이션 대상 아님.
        return new Prepared(copy(input, defineMode, sql, chartType, input.refreshMode()), Set.of(input.datasourceId()));
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
                input.cacheTtlSeconds(),
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
