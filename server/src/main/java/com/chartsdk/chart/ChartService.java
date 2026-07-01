package com.chartsdk.chart;

import com.chartsdk.auth.CurrentUserProvider;
import com.chartsdk.cache.CachedChartRows;
import com.chartsdk.cache.ChartCacheService;
import com.chartsdk.cache.ChartComputeService;
import com.chartsdk.converter.ChartOptionConverter;
import com.chartsdk.federation.FederatedQueryRunner;
import com.chartsdk.query.BuilderSqlBuilder;
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

@Service
public class ChartService {
    private final ChartRepository charts;
    private final CurrentUserProvider currentUser;
    private final QueryExecutor queries;
    private final ChartCacheService cache;
    private final ChartComputeService compute;
    private final ChartOptionConverter converter;
    private final FederatedQueryRunner runner;

    public ChartService(ChartRepository charts, CurrentUserProvider currentUser, QueryExecutor queries,
                        ChartCacheService cache, ChartComputeService compute, ChartOptionConverter converter,
                        FederatedQueryRunner runner) {
        this.charts = charts;
        this.currentUser = currentUser;
        this.queries = queries;
        this.cache = cache;
        this.compute = compute;
        this.converter = converter;
        this.runner = runner;
    }

    public Map<String, Object> list(String q, String type, Long datasourceId, String sort, Integer page, Integer pageSize) {
        return charts.list(ownerId(), q, type, datasourceId, sort, page, pageSize);
    }

    public Map<String, Object> get(long id) {
        return charts.get(ownerId(), id);
    }

    public Map<String, Object> preview(long id) {
        return previewPayload(id);
    }

    public Map<String, Object> previews(String ids) {
        Map<String, Object> previews = new LinkedHashMap<>();
        Map<String, Object> errors = new LinkedHashMap<>();
        parseIds(ids).stream().limit(60).forEach((id) -> {
            try {
                previews.put(String.valueOf(id), previewPayload(id));
            } catch (ApiException e) {
                errors.put(String.valueOf(id), e.getMessage());
            } catch (RuntimeException e) {
                errors.put(String.valueOf(id), "Preview unavailable.");
            }
        });
        return Map.of("previews", previews, "errors", errors);
    }

    public Map<String, Object> create(ChartSaveRequest input) {
        ChartSaveRequest prepared = prepareForSave(input);
        Long id = charts.create(ownerId(), prepared);
        charts.setChartDatasources(id, datasourceSet(prepared));
        compute.seedQuietly(id);
        return charts.get(ownerId(), id);
    }

    public Map<String, Object> update(long id, ChartSaveRequest input) {
        ChartSaveRequest prepared = prepareForSave(input);
        Long ownerId = ownerId();
        int updated = charts.update(ownerId, id, prepared);
        if (updated == 0) {
            if (charts.exists(ownerId, id)) {
                throw new ApiException(HttpStatus.CONFLICT, "VERSION_CONFLICT", "Chart was modified elsewhere; reload and retry.");
            }
            throw new ApiException(HttpStatus.NOT_FOUND, "CHART_NOT_FOUND", "Chart not found.");
        }
        charts.setChartDatasources(id, datasourceSet(prepared));
        compute.seedQuietly(id);
        return charts.get(ownerId, id);
    }

    public void delete(long id) {
        charts.delete(ownerId(), id);
    }

    public Map<String, Object> refresh(long id) {
        CachedChartRows rows = compute.recompute(id);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("chartId", id);
        result.put("computedAt", rows.computedAt().toString());
        result.put("rowCount", rows.rows().rowCount());
        result.put("elapsedMs", rows.rows().elapsedMs());
        return result;
    }

    public Map<String, Object> duplicate(long id) {
        Long ownerId = ownerId();
        Long newId = charts.duplicate(ownerId, id);
        charts.copyCache(newId, id);
        return charts.get(ownerId, newId);
    }

    private Map<String, Object> previewPayload(long id) {
        ChartDefinition chart = charts.previewDefinition(ownerId(), id);
        // 서빙 경로 불변식(설계 §8): 다중 소스는 목록/미리보기에서도 페더레이션 미호출 — 캐시 스냅샷만.
        CachedChartRows rows = charts.chartDatasources(chart.id()).size() >= 2
                ? cache.find(chart.id()).orElseThrow(() -> new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                        "SNAPSHOT_NOT_READY", "Multi-source chart snapshot is not ready; refresh the chart to compute it."))
                : cache.findUsable(chart.id(), chart.refreshMode(), chart.cacheTtlSeconds(), chart.version())
                        .orElseGet(() -> compute.refreshSingleFlight(
                                chart.id(), chart.datasourceId(), chart.sqlQuery(), chart.version(), !"live".equals(chart.refreshMode())));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("chartId", chart.id());
        response.put("computedAt", rows.computedAt().toString());
        response.put("rowCount", rows.rows().rowCount());
        response.put("truncated", rows.rows().truncated());
        response.put("option", converter.convert(rows.rows(), chart.chartType(), chart.options()));
        return response;
    }

    private ChartSaveRequest prepareForSave(ChartSaveRequest input) {
        String defineMode = input.defineMode() == null ? "builder" : input.defineMode();
        String chartType = input.chartType() == null ? "bar" : input.chartType();
        if ("builder".equals(defineMode)) {
            if (input.builderConfig() == null) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "builderConfig is required.");
            }
            // 라우터로 검증·계산(단일→PG / 다중→DuckDB 페더레이션). 실행 실패 시 저장도 실패(§7.7).
            FederatedQueryRunner.BuiltResult built = runner.runBuilder(input.datasourceId(), input.builderConfig(), chartType, false);
            String storedSql = SqlLiterals.inline(built.sql().text(), built.sql().params());
            // 다중 소스는 스냅샷 모델 → refresh_mode 를 manual 로 고정(임베드는 캐시-온리라 live 무의미, §7).
            String refreshMode = built.datasourceIds().size() >= 2 ? "manual" : input.refreshMode();
            return copy(input, defineMode, storedSql, chartType, refreshMode);
        }
        String sql = input.sqlQuery() == null ? "" : input.sqlQuery().trim();
        assertSelectOnly(sql);
        queries.execute(input.datasourceId(), sql);
        return copy(input, defineMode, sql, chartType, input.refreshMode());
    }

    /** 차트가 참조하는 데이터소스 집합 — builderConfig 명시 소스, 없으면 primary 단일. junction 영속화용. */
    private static java.util.Set<Long> datasourceSet(ChartSaveRequest req) {
        java.util.Set<Long> refs = req.builderConfig() == null
                ? java.util.Set.of()
                : BuilderSqlBuilder.referencedDatasources(req.builderConfig());
        return refs.isEmpty() ? java.util.Set.of(req.datasourceId()) : refs;
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
