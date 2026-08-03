# Embed Chart Data API Specification

**Version:** v1.9 (2026-07-20 — logical design size·font-aware responsive rendering)
**Endpoint:** `GET /api/v1/charts/data`  
**Caller:** `sdk.js` running in a customer-owned web page  
**Purpose:** Return a server-built Apache ECharts option JSON for one saved chart.

## 1. Contract Summary

| Category | Specification |
|---|---|
| Endpoint | `GET /api/v1/charts/data?chartId={chartId}` |
| Runtime | Spring Boot backend |
| Authentication | `Authorization: Bearer {JWT}` signed with server secret key |
| Query Logic | Resolve `chartId` to `mc_chart`, validate token user scope, use cache or execute the saved source query |
| Data Format | ECharts-ready JSON: `{ chartId, computedAt, option }` |
| SDK responsibility | DOM scan, fetch this endpoint, call `echarts.init()` and `chart.setOption(option)` |
| Server responsibility | Token validation, owner scoping, SQL execution/caching, ECharts option assembly |

## 2. Request

```http
GET /api/v1/charts/data?chartId=12 HTTP/1.1
Host: api.example.internal
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json
```

### Query Parameters

| Name | Type | Required | Rule |
|---|---:|---:|---|
| `chartId` | integer | yes | Must reference an active chart owned by the token user. Unknown, deleted, or out-of-scope charts return `404 CHART_NOT_FOUND`. |

### Headers

| Name | Required | Rule |
|---|---:|---|
| `Authorization` | yes | `Bearer {JWT}`. Missing or non-Bearer values return `401 TOKEN_INVALID`. |

## 3. JWT Authentication

### Signing

- Algorithm: `HS256`
- Secret source: `chartsdk.embed.jwt-secret`
- Environment override: `CHARTSDK_EMBED_JWT_SECRET`
- Production rule: the default development secret must never be used in production.

### Payload

```json
{
  "userId": 7,
  "jti": 42,
  "iat": 1782267053,
  "exp": 1813803053,
  "v": 1
}
```

| Claim | Type | Required | Rule |
|---|---:|---:|---|
| `userId` | integer | yes | Owner scope for chart lookup. |
| `jti` | integer | yes | Equals `mc_user_token.id`. Used for one-row revocation lookup. |
| `iat` | epoch seconds | yes | Issue time. Informational for v1. |
| `exp` | epoch seconds | yes | Token expiry. Expired token returns `401 TOKEN_EXPIRED`. |
| `v` | integer | yes | Token format version. Current value: `1`. |

### Validation Order

1. Parse `Authorization` header.
2. Verify JWT structure and `alg=HS256`.
3. Verify HMAC signature.
4. Verify `exp > now`.
5. Query `mc_user_token` by `jti` and `userId`.
6. Require `mc_user_token.is_active=true`, `mc_user_token.expires_at > now()`, and `mc_user.is_active=true`.
7. Use `userId` as the chart owner scope.

Implementation note: validation is centralized in `EmbedTokenInterceptor`. The controller receives a validated `EmbedPrincipal` request attribute and does not parse JWTs itself.

## 4. Chart Resolution

The server resolves the chart using the authenticated user scope:

```sql
SELECT id, datasource_id, sql_query, chart_type, options,
       refresh_mode, cache_ttl_seconds
  FROM mc_chart
 WHERE id = :chartId
   AND (owner_id = :userId OR owner_id IS NULL)
```

`owner_id IS NULL` is a temporary compatibility path for the current pre-login local seed. Once login is enforced, this should become `owner_id = :userId`.

## 5. Query and Cache Logic

The endpoint never accepts SQL from the SDK. It only executes the SQL already saved in `mc_chart.sql_query`.

| Refresh Mode | Behavior |
|---|---|
| `live` | Always execute `mc_chart.sql_query` against the registered datasource. Update `mc_chart_cache` with the successful result. |
| `ttl` | Return `mc_chart_cache` if `computed_at + cache_ttl_seconds` is still fresh. On miss, execute query and upsert cache. |
| `manual` | Prefer `mc_chart_cache`. If no cache exists, execute once to self-heal local/dev charts and seed cache. |

Execution guardrails:

- Customer DB access is read-only.
- SQL is executed through a bounded statement.
- Query timeout is 10 seconds.
- Result row cap is 1,000 rows.
- Customer DB schema is never modified.
- The endpoint never creates views, materialized views, tables, indexes, or temporary persistent objects in customer DBs.

## 6. Response

### 200 OK

```json
{
  "chartId": 12,
  "computedAt": "2026-06-24T01:25:30Z",
  "sampling": {
    "version": 6,
    "approximate": true,
    "method": "RESULT_RANDOM",
    "mode": "manual",
    "requestedMethod": "auto",
    "sizeTarget": 10000,
    "seed": 48291,
    "valueMode": "sample",
    "sampleSize": 10000,
    "sampledRowCount": 9998,
    "groups": [{ "key": "food", "sampleCount": 500 }],
    "estimates": [{ "series": "sum_amount", "aggregate": "sum", "treatment": "SAMPLE_AGGREGATE" }],
    "warnings": ["RESULT_RANDOM_SAMPLE", "SAMPLE_AGGREGATE_ONLY"]
  },
  "approximate": true,
  "sampleRate": 10,
  "option": {
    "tooltip": { "trigger": "axis" },
    "xAxis": { "type": "category", "data": ["food", "goods"] },
    "yAxis": { "type": "value" },
    "series": [
      { "type": "bar", "name": "sum_amount", "data": [1200, 800] }
    ]
  }
}
```

### Response Fields

| Field | Type | Rule |
|---|---:|---|
| `chartId` | integer | Echoes the resolved chart id. |
| `computedAt` | ISO-8601 UTC | Time of the row result used to build `option`. |
| `rowCount` | integer | Number of rows used to build the option. |
| `truncated` | boolean | `true` when the row cap was reached and the result may be partial. |
| `sampling` | object, optional | Sampling execution metadata v7. Includes INDEX_RANDOM/RESULT_RANDOM/SYSTEM/FULL_SCAN, requested size/rate/seed, actual sampled input count, per-group counts, per-series treatment/error summary, optional statistical `intervals[]`, and warnings. RESULT_RANDOM means independent Bernoulli rows were selected after the VIEW or JOIN+WHERE result boundary; `sampleSize` is the target and `sampledRowCount` is the variable actual count. Sampled SUM/COUNT use `SAMPLE_AGGREGATE`; AVG/STDDEV/VARIANCE use `SAMPLE_ESTIMATE`. Persisted with the cached result. |
| `approximate` / `sampleRate` | boolean / number, optional | Backward-compatible aliases for older clients. New clients use `sampling`. |
| `option` | object | Complete Apache ECharts option. SDK must pass it to `chart.setOption(option)` without rebuilding. |

## 7. Error Responses

All errors use the common API error envelope:

```json
{
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "Token has expired."
  }
}
```

| HTTP | Code | Case |
|---:|---|---|
| 400 | `INVALID_REQUEST` | Missing or invalid `chartId`. |
| 401 | `TOKEN_INVALID` | Missing Bearer header, malformed JWT, unsupported algorithm, or signature mismatch. |
| 401 | `TOKEN_EXPIRED` | JWT `exp` is in the past. |
| 401 | `TOKEN_REVOKED` | DB token row is inactive, expired, missing, or user is inactive. |
| 404 | `CHART_NOT_FOUND` | Chart does not exist or is outside token user scope. |
| 408 | `QUERY_TIMEOUT` | Customer DB query exceeded timeout. |
| 422 | `SQL_ERROR` | Saved SQL failed in the datasource. |
| 500 | `INTERNAL_ERROR` | Unexpected server failure. |

## 8. Security Rules

- `chartId` is not authorization. It is only a lookup key.
- Authorization is always token `userId` plus server-side `mc_chart.owner_id` scope.
- Tokens are revocable by `mc_user_token.is_active=false`.
- The SDK never receives datasource credentials, SQL parameters, or raw DB connection metadata.
- CORS should be restricted to approved embedding domains before production deployment.
- The default development JWT secret must be rotated before production.

## 9. SDK Integration

The supported embed markup is:

```html
<div data-chart-id="12"
     data-auth-token="{user-jwt-token}"></div>
<script src="https://charts.example.internal/sdk.js"
        data-api-base="https://api.example.internal"></script>
```

This is a **paste-ready contract**: no additional JavaScript global or initialization call is required. The Admin S3 modal fills all three runtime values (`chartId`, token, and API base). Admin `dev`/`build` first builds `sdk/dist/sdk.js` and publishes it as `admin/public/sdk.js`; `NEXT_PUBLIC_SDK_SRC` may override the script URL for a CDN, while `NEXT_PUBLIC_API_BASE` supplies `data-api-base` independently.

For manual local verification, run the backend and Admin, paste the S3 markup between the markers in `admin/public/embed-host.html`, and open `http://localhost:3000/embed-host.html`. No second static server is required. The host file intentionally contains no chart id, token, or embed script so the tester performs the real copy/paste flow.

API base resolution priority is `window.CHARTSDK_API_BASE` (imperative override) → the loading script's `data-api-base` → the `sdk.js` origin → the host page origin. Trailing slashes in `data-api-base` are removed. This separation is required when Admin/CDN and Spring API use different origins (for example, local `:3000` and `:8080`). The embedding page's origin must still be in the backend CORS allow-list.

SDK behavior:

1. Scan DOM for `[data-chart-id]`.
2. Read `data-chart-id` and `data-auth-token`.
3. Fetch `GET /api/v1/charts/data?chartId={id}` with Bearer token.
4. Replace the slot content with an internal chart host and create an ECharts instance with `echarts.init(chartHost)`.
5. If a title exists, merge its responsive width (`chartHost.clientWidth - 32`) and `overflow:'truncate'`, then call `chart.setOption(response.option)`.
6. If `sampling` exists, show `{samplingMethodLabel} {sampledRowCount}행 · 표본 결과` or `전체 데이터 · 정확한 결과`. RESULT_RANDOM is labeled `결과 무작위 행 표본`. Label sampled SUM/COUNT as `표본 합계`/`표본 개수` and state that they are not whole-population totals. If an AVG/STDDEV/VARIANCE confidence summary exists, append `95% 신뢰수준 · 오차 약 ±X%`. Render every `sampling.warnings` entry visibly; STDDEV/VARIANCE intervals require the normality-assumption warning and SYSTEM requires the block-clustering warning.
7. Observe the host size; on resize call `chart.resize()` and refresh only the title `width/overflow` patch. The option's title, legend, axis, data-label, and tooltip `fontSize` values remain fixed px; host CSS resizing never recalculates them.
8. On failure, render an isolated error state inside the chart container only.

SPA integrations can use the imperative API. Rendering the same element again disposes the previous ECharts instance and observer automatically; call `dispose` when the component unmounts.

```js
await ChartSDK.render(element, { chartId: '12', token });
ChartSDK.dispose(element);
```

## 10. Host Page Responsibilities & Style Isolation

The SDK renders directly into the host page's DOM (no iframe). The chart body is drawn on a `<canvas>`, so host CSS cannot corrupt bars, axes, or legends. The design goal is: **the client's intentional code wins; the client's unrelated global CSS cannot break the chart by accident.**

### 10.1 Host page must provide

| Concern | Rule |
|---|---|
| Container height | The chart follows its container size. Give `[data-chart-id]` an explicit height (`height`, `aspect-ratio`, or a sized flex/grid parent). If the container resolves to `0px` at render time, the SDK applies a `min-height: 320px` fallback so the chart never silently disappears. Note: a container that is hidden when rendered (e.g. `display: none`, an inactive tab/accordion) also measures `0px`, so it inherits the 320px floor — if you render into a hidden slot and later reveal it at a shorter height, set an explicit height so the floor does not win. |
| Container content | On render the SDK **replaces the container's inner content**. Do not keep meaningful child nodes inside `[data-chart-id]`; use it as a dedicated chart slot. |
| Positioning | The SDK adds `position: relative` **only when** the container computes to `position: static`. Any positioning you set via CSS (class or inline) is respected. |

### 10.2 What the SDK guarantees (defensive)

- Tooltips use `confine: true` so they stay inside the container instead of being clipped by an ancestor `overflow: hidden` or misplaced under an ancestor `transform`.
- The rendered `<canvas>` is pinned with `max-width/height: none` so a global `canvas { max-width: 100% }` reset cannot shrink it and break click/hover coordinates.
- The chart option carries an opaque `backgroundColor` (default `#ffffff`) so the chart is self-contained on any host background, including dark themes.
- Long titles stay inside the canvas: the SDK preserves existing title text styles, injects the current chart-host width minus a 32px horizontal inset, applies `overflow:'truncate'`, and recalculates it through `ResizeObserver`.
- Saved `options.display` is a logical design target used to choose typography and to reproduce the same design canvas in Admin. The SDK never assigns that width or height to the host element; host CSS remains authoritative. Font sizes and font-derived title/legend/grid margins arrive in the server-built ECharts option, while `ResizeObserver` adapts the chart and title width to the actual host container.

### 10.3 Map (영역 지도·포인트 지도) charts — GeoJSON assets

Geo charts need a GeoJSON registered with `echarts.registerMap(name, geoJson)` before render. The SDK does this automatically:

1. After fetching the chart option, the SDK scans it for map names — both `series[].map` (choropleth `type:'map'`) and `option.geo.map` (geo-scatter point charts).
2. For each not-yet-registered name it fetches `GET {apiBase}/maps/{name}.json?v={assetVersion}` **once** (cached module-side; re-renders do not re-fetch), then calls `registerMap`.
3. `apiBase` is resolved with the same priority as chart data (`window.CHARTSDK_API_BASE` → `script[data-api-base]` → `sdk.js` origin → host origin).

The `/maps/**` path is a **public static asset** (no token), served by the backend from `classpath:/static/maps/` and CORS-enabled for embedding hosts (same allow-list as `/api/**`). A versioned request receives a one-year `immutable` cache policy; an unversioned direct request must revalidate after one hour. Bundled maps use the official SGIS boundaries and MOIS administrative codes; the exact sources, effective dates, and 2026 boundary derivation are documented in `chart-options/maps/LICENSE.md`.

| Asset | Regions | Region name format in chart data |
|---|---|---|
| `kr-sido.json` | 2026-07-20 기준 대한민국 16개 시·도 | 정식 시·도명 — `서울특별시`, `전남광주통합특별시` |
| `kr-sigungu.json` | 253개 시·군·구(일반구 포함) | `시도명 시군구명` — `인천광역시 제물포구`, `경기도 수원시 장안구` |

Region names must match the GeoJSON `properties.name` exactly. Geo-scatter (포인트 지도) charts use raw `[경도, 위도(, 크기값)]` coordinates instead of region names; per-point `symbolSize` is precomputed server-side (JSON cannot carry callbacks). Geo-scatter builder execution returns every coordinate row matching its JOIN/WHERE conditions without the default 1,000-row result cap, so the saved cache and embed payload preserve the same complete point set.

### 10.4 Official customization surface

Only the hooks below are supported. Internal DOM structure and inline defaults are private and may change between versions.

| Hook | How | Example |
|---|---|---|
| `.chartsdk-caption` | CSS class on the "데이터 기준 …" caption. Defaults are inline, so override with `!important`. | `.chartsdk-caption { color: #ccc !important; }` |
| `.chartsdk-error` | CSS class on the error state box. Same `!important` rule. | `.chartsdk-error { color: #f66 !important; }` |
| `data-chart-background` | Attribute on `[data-chart-id]`. Overrides the chart background (e.g. `transparent` to blend into a dark site, or a custom color). | `<div data-chart-id="12" data-auth-token="…" data-chart-background="transparent"></div>` |

> The `!important` requirement is intentional: because defaults are inline, an ordinary (non-`!important`) global rule such as `.card div { font-size: 18px }` can never touch the caption or error text by accident. A deliberate override must name the SDK class **and** use `!important` — a combination that cannot occur unintentionally.
>
> Residual limitation: a host page that applies a *global `!important`* rule to a broad selector (e.g. `div { color: red !important }`) can still bleed into the caption/error text, since `!important` outranks inline styles. The chart body (canvas) is never affected. Full isolation from such extreme resets would require a Shadow DOM or iframe wrapper, which is intentionally out of scope for the current embed model.
