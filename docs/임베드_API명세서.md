# Embed Chart Data API Specification

**Version:** v1.0  
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
<script src="https://cdn.example.com/sdk.js"></script>
```

SDK behavior:

1. Scan DOM for `[data-chart-id]`.
2. Read `data-chart-id` and `data-auth-token`.
3. Fetch `GET /api/v1/charts/data?chartId={id}` with Bearer token.
4. Create an ECharts instance with `echarts.init(hostElement)`.
5. Call `chart.setOption(response.option)`.
6. On failure, render an isolated error state inside the chart container only.
