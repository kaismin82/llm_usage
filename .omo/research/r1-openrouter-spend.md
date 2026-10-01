## Summary
- Per-key daily/weekly/monthly usage is exposed by `GET /api/v1/key`; key fields report accumulated USD usage, but are not a time-series ledger.
- OpenRouter exposes account activity separately, with a date range and model-level usage; aggregation is needed for account period totals.
- For reliable calendar daily/weekly/monthly totals, use activity rows and aggregate timestamps; weekly boundary and timezone semantics need explicit confirmation.
- `/credits` reports account credit balance, not spend history; `/keys` manages keys and does not replace usage analytics.
- Calls are bearer-authenticated and browser CORS appears permissive on tested API endpoints, but credentials in an extension remain a security concern.

## Findings
- CLAIM: `GET /api/v1/key` returns usage/limit information for the authenticated key, including usage, usage_daily, usage_weekly, usage_monthly, byok usage and rate limit fields where available. | EVIDENCE: https://openrouter.ai/docs/api-reference/overview | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: Key usage fields represent USD spent, and may not cover all historical billing dimensions; endpoint is key-scoped. | EVIDENCE: https://openrouter.ai/docs/api-reference/overview | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: `GET /api/v1/credits` is an account credit balance endpoint, not a daily/weekly/monthly spend report. | EVIDENCE: https://openrouter.ai/docs/api-reference/credits/get-credits | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: `GET /api/v1/activity` returns activity records with per-day/per-model data over a bounded recent history and uses an administrative/management credential. | EVIDENCE: https://openrouter.ai/docs/api-reference/activity/get-activity | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: `GET /api/v1/keys` lists provisioned API keys and requires key-management authority rather than being an aggregation endpoint. | EVIDENCE: https://openrouter.ai/docs/api-reference/keys/list-keys | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: OpenRouter API requests authenticate with `Authorization: Bearer <API_KEY>`. | EVIDENCE: https://openrouter.ai/docs/api-reference/overview | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: Unauthenticated HEAD probes to `/api/v1/key`, `/credits`, `/activity`, and `/keys` returned HTTP 401 on 2026-09-30, establishing reachable routes rather than 404s. | EVIDENCE: `curl.exe -sI -H "Origin: https://example.com" https://openrouter.ai/api/v1/key` (HTTP/1.1 401 Unauthorized); same command pattern for `/credits`, `/activity`, `/keys` captured 401 for each | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The tested key endpoint response headers included `Access-Control-Allow-Origin: *`, so wildcard CORS is advertised for this request. | EVIDENCE: `curl.exe -sI -H "Origin: https://example.com" https://openrouter.ai/api/v1/key` output: `Access-Control-Allow-Origin: *` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The tested API responses were served behind Cloudflare; this does not establish browser preflight behavior or guarantee access from an extension origin. | EVIDENCE: same four `curl.exe -sI` probes output `Server: cloudflare` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: No endpoint-specific request rate limit for these account/management routes was verified in this research. | EVIDENCE: https://openrouter.ai/docs/api-reference/overview | SOURCE DATE: unknown | CONFIDENCE: low
- CLAIM: Exact UTC/calendar period boundaries for `usage_daily`, `usage_weekly`, and `usage_monthly` were not independently confirmed. | EVIDENCE: https://openrouter.ai/docs/api-reference/overview | SOURCE DATE: unknown | CONFIDENCE: low

## Spec
### Key-level snapshot
```http
GET https://openrouter.ai/api/v1/key
Authorization: Bearer YOUR_OPENROUTER_KEY
Accept: application/json
```
No request parameters. Illustrative response (example values, not a captured response):
```json
{
  "data": {
    "label": "dashboard key",
    "usage": 12.34,
    "usage_daily": 1.23,
    "usage_weekly": 4.56,
    "usage_monthly": 12.34,
    "byok_usage": 0.4,
    "byok_usage_daily": 0.1,
    "byok_usage_weekly": 0.2,
    "byok_usage_monthly": 0.4,
    "limit": 100,
    "limit_remaining": 87.66,
    "limit_reset": "daily",
    "is_free_tier": false,
    "rate_limit": {"requests": 20, "interval": "10s"}
  }
}
```
Values are in USD except boolean/text/rate-limit metadata. Fields may be absent or null depending on key/configuration. `limit_reset` is a reset policy indicator, not a timestamp. Treat period timezone/boundaries as unconfirmed; do not label week as Monday/Sunday UTC without validation. Note these are key-level totals and do not necessarily distinguish all charge categories.

### Account credits, activity and keys
- Balance: `GET https://openrouter.ai/api/v1/credits` with the bearer auth header. Requires an authenticated account API key; distinguish ordinary API key vs provisioning/management key permissions by testing a properly authorized account in a controlled integration. Not suitable for spend totals.
- Activity: `GET https://openrouter.ai/api/v1/activity` with an account/management-authorized bearer key. Public docs describe a bounded period of activity (up to 30 days) and daily/model breakdown; request date-range parameters and aggregate returned costs. Verify exact parameter names/schema against current docs before shipping.
- Key inventory: `GET https://openrouter.ai/api/v1/keys`; use only when management UI needs key enumeration, not for per-account spend aggregation.
- Browser CORS probe: tested response had `Access-Control-Allow-Origin: *`; preflight (`OPTIONS`) and credentialed requests were not tested. API key must not be embedded in public extension source; user-entered secret storage still exposes it to extension compromise.

### Minimal endpoint set
- Per-key: `GET /api/v1/key` (daily/weekly/monthly snapshots where returned).
- Per-account: `GET /api/v1/activity` with authorized management credential, then sum cost by desired calendar windows; call `/api/v1/credits` only if the popup also displays remaining prepaid balance. `/api/v1/keys` is unnecessary unless selecting a key.

## Unverified / open questions
- Field existence and definitions from a live successful authenticated JSON response; probes were deliberately credential-free.
- Whether all mentioned usage/byok fields are currently returned together, and whether USD means billed amount before/after BYOK accounting.
- Exact daily timezone, week starting weekday, calendar vs rolling month, and reset-time representation.
- Exact activity request parameter names, retention/window limit, response schema and semantics of management/provisioning credentials.
- Whether `/credits` accepts a regular user API key or needs a provisioning key; current endpoint permission matrix not verified.
- Rate-limit values/headers for these endpoints and CORS OPTIONS behavior.
- Endpoint docs were inaccessible to reliably extract publication dates; date listed as unknown rather than claiming a 2026 doc revision.

## EXPAND leads
- OpenRouter API docs: https://openrouter.ai/docs/api-reference/overview
- Key endpoint docs: https://openrouter.ai/docs/api-reference/keys/get-user-provider-keys
- Credits docs: https://openrouter.ai/docs/api-reference/credits/get-credits
- Activity docs: https://openrouter.ai/docs/api-reference/activity/get-activity
- Keys list docs: https://openrouter.ai/docs/api-reference/keys/list-keys
- Search current OpenRouterTeam GitHub repositories for `usage_daily`, `/api/v1/activity`, and activity date parameters; cross-check endpoint behavior against current dashboard network calls only with an authorized account.
