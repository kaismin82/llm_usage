## Summary
- For a holder of only a normal virtual key, use `GET /user/daily/activity` for daily rows over a chosen 7- or 30-day range; sum `results[].metrics.spend` locally. It is the least-privilege spend surface found.
- `GET /spend/logs` also accepts a normal authenticated key but is deprecated, capped at 10,000 rows, and must be locally aggregated; prefer the daily endpoint.
- For an admin, use enterprise `GET /global/spend/report` with UTC `YYYY-MM-DD` bounds for daily/weekly/monthly rollups; it supplies a `breakdown` by models and keys.
- `/global/spend/logs` is explicitly admin-only, returns daily global spend for the last 30 days, and is unsuitable for arbitrary historical monthly periods.
- `/key/info` is useful for a key's budget/reset state, not historical calendar spend. It permits the key owner to inspect its own key; `/user/info` is similarly a budget-state lookup, not a daily ledger.
- A Chrome MV3 popup must not assume browser CORS is safe: proxy CORS is operator-configured. Default is wildcard origins without credentials; Authorization requests still require the proxy to admit the extension origin/preflight.

## Findings
- CLAIM: `GET /user/daily/activity` requires `start_date` and `end_date` in `YYYY-MM-DD`, pages results, accepts a JS-style UTC offset in minutes, and is intended for user analytics. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/internal_user_endpoints.py#L2872-L2919 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: A non-admin calling `/user/daily/activity` must supply their own `user_id`; an admin may select any user or omit it for global view. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/internal_user_endpoints.py#L2896-L2899 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/user/daily/activity` reads accumulating daily records, not the budget running counter, so its total can exceed `/v2/user/info`'s resettable `spend`. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/internal_user_endpoints.py#L2917-L2924 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/team/daily/activity` accepts comma-separated `team_ids`, `start_date`/`end_date` as `YYYY-MM-DD`, model/key filters, page/page_size, and optional excluded teams. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/team_endpoints.py#L6650-L6679 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: A team member without team-admin status or explicit `/team/daily/activity` permission is restricted to their own API keys when viewing team activity. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/team_endpoints.py#L6617-L6641 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/tag/daily/activity` is authenticated, takes comma-separated `tags`, YYYY-MM-DD bounds, model/key filters, and pagination; tag spend is documented in source as LiteLLM Enterprise. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/tag_management_endpoints.py#L722-L751 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: Daily-activity output is `{results, metadata}`; metadata includes total spend/tokens/request counts plus `page`, `total_pages`, and `has_more`. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/common_daily_activity.py#L1279-L1302 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `GET /spend/logs` accepts `api_key`, `user_id`, `request_id`, date bounds and `summarize`; with both dates, default `summarize=true` groups by date. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/spend_management_endpoints.py#L3442-L3489 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/spend/logs` is deprecated, not paginated, and capped at 10,000 recent rows; `/spend/logs/v2` is the paginated replacement. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/spend_management_endpoints.py#L3479-L3484 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/spend/logs/v2` supports `page` (>=1) and `page_size` (1..1000), date bounds, and filters including key/user/team/model; its code example uses `YYYY-MM-DD HH:MM:SS` start/end values. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/spend_management_endpoints.py#L2453-L2557 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `GET /global/spend/report` requires start/end `YYYY-MM-DD`, parses them as UTC, and is enterprise/premium-only. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/spend_management_endpoints.py#L1401-L1489 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/global/spend/report` can group by `team`, `customer`, or `api_key`, and filter by `api_key`, `internal_user_id`, `team_id`, or `customer_id`. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/spend_management_endpoints.py#L1409-L1437 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/global/spend/logs` is an authenticated but hidden beta admin-only endpoint for global daily spend over the last 30 days. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/spend_management_endpoints.py#L3807-L3825 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/key/list` uses `page`/`size` (not page_size), supports user/team/org/key filters and `return_full_object`, and authenticates via `user_api_key_auth`. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/key_management_endpoints.py#L6498-L6548 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `/key/info` and `/v2/key/info` are authenticated key-management endpoints; source examples use `Authorization: Bearer sk-...`. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/key_management_endpoints.py#L4258-L4266 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The proxy CORS middleware permits all methods/headers, exposes UI headers, and derives origins/credential policy from proxy configuration rather than an endpoint-specific fixed policy. | EVIDENCE: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py#L2387-L2394 | SOURCE DATE: 2026-09 | CONFIDENCE: high

## Spec

**Common request.** Replace `PROXY` with the operator's proxy origin. Use `Authorization: Bearer sk-...` (the documented virtual/master-key header); do not treat `x-litellm-api-key` as a confirmed interchangeable header for these routes. All listed routes depend on `user_api_key_auth`. A normal virtual key is not automatically an `internal_user`; access is additionally scoped by its associated user/team and route permissions.

**Best popup calls.** For a virtual-key holder, first call:

```http
GET PROXY/user/daily/activity?user_id=ME&start_date=2026-09-01&end_date=2026-09-30&page=1&page_size=1000&timezone=0
Authorization: Bearer sk-virtual
```

Use calendar UTC dates (or pass the browser's `Date.getTimezoneOffset()` and retain the returned dates); sum daily `metrics.spend` for day/week/month. Do not use a budget counter as calendar spend. If the proxy's user mapping is unavailable, `/spend/logs/v2?api_key=<key>&start_date=2026-09-01%2000:00:00&end_date=2026-09-30%2023:59:59&page=1&page_size=1000` is the paged fallback, subject to route permission/scoping. `/spend/logs` is legacy only.

For an admin on Enterprise:

```http
GET PROXY/global/spend/report?start_date=2026-09-01&end_date=2026-09-30&group_by=api_key
Authorization: Bearer sk-master-or-proxy-admin
```

Use separate UTC inclusive date ranges for the desired day/week/month. Use `/global/spend/logs` only for its fixed recent-30-day daily series. `/team/daily/activity` and `/tag/daily/activity` are scoped alternate views; tag view should be treated as Enterprise. `/key/list` inventories keys; it is not a spend aggregation endpoint.

**Representative daily response (field meanings).** The exact inner `breakdown` keys vary by endpoint/version; this is a realistic shape inferred from the typed common aggregator:

```json
{
  "results": [{
    "date": "2026-09-30",
    "metrics": {"spend": 1.2345, "prompt_tokens": 1000, "completion_tokens": 500, "total_tokens": 1500, "api_requests": 12},
    "breakdown": {"models": {"gpt-4.1": {"spend": 1.2345}}, "api_keys": {"key-alias-or-hash": {"spend": 1.2345}}}
  }],
  "metadata": {"total_spend": 1.2345, "total_prompt_tokens": 1000, "total_completion_tokens": 500, "total_tokens": 1500, "total_api_requests": 12, "total_successful_requests": 12, "total_failed_requests": 0, "page": 1, "total_pages": 1, "has_more": false}
}
```

`date` is a date bucket (the daily-query timezone rules above apply); `spend`/`total_spend` are proxy-recorded monetary cost in the proxy's configured currency convention (normally USD, not a token count); token and request fields are counts; `page` is one-based. `breakdown` is only useable when present--the client must tolerate its absence and unknown dimensions.

**Budget state.** Call `GET /key/info` with no `key` to inspect the caller key, or `/user/info` for the associated user where policy allows. Persist/display these fields as budget state rather than calendar usage: `max_budget` = monetary limit; `budget_duration` = reset interval string; `budget_reset_at` = next reset timestamp; `soft_budget` = alert threshold. The current source also distinguishes accumulated daily spend from resettable budget spend. Do not infer a provider subscription reset from any of these LiteLLM fields.

**Role matrix.** `/key/info`: regular key may read itself; another key requires owner/admin authorization. `/user/info`: regular key is expected to be scoped to itself; admin can inspect broader scope. `/user/daily/activity`: ordinary internal user only own `user_id`; admin global/any user. `/team/daily/activity`: team admin or explicit team permission sees team; otherwise own-key-filtered. `/tag/daily/activity`: authenticated but key-scoped; Enterprise feature wording. `/spend/logs` and v2: authenticated, but ordinary callers are scoped; admin sees wider scope. `/global/spend/report`: premium/Enterprise and admin-oriented global report. `/global/spend/logs`: proxy admin (including view-only admin in current role tests), not internal user. `/key/list`: non-admin is owner/team/org scoped, not an unrestricted inventory.

## Unverified / open questions

- I could not reliably establish the LiteLLM release version in which each of the nine named endpoints first appeared. Do not manufacture versions from current main; pin the deployed proxy version and inspect its OpenAPI schema/release changelog.
- I did not obtain a live authenticated response, so the full field-level schemas for `/key/info`, `/user/info`, `/global/spend/report`, `/global/spend/logs`, `/spend/logs/v2`, and every `breakdown` variant remain unverified. Generate types from `PROXY/openapi.json` for the actual deployment.
- Whether `x-litellm-api-key` is accepted on these routes, the precise default origin list, and the proxy currency cannot be confirmed generically: they are deployment/configuration dependent.
- The exact enterprise gate and role behavior for `/tag/daily/activity`, `/key/list`, and raw logs can vary with LiteLLM version, configured team permissions, and license. Test with a disposable virtual key and a proxy-admin key against the target proxy.
- `/user/info` route signature and the exact source-defined budget field placement were not independently retrieved in this pass; treat the budget-field list as a design target to validate from that deployment's schema.

## EXPAND leads

- Fetch `PROXY/openapi.json` and test OPTIONS plus unauthenticated/authenticated GETs against each route; record 401/403/200 and CORS `access-control-*` headers without exposing credentials.
- Review the deployed image tag's GitHub release/changelog and `git log --follow` for each route file to fill the endpoint-introduced-version column.
- Inspect `litellm/proxy/_types.py` and the generated OpenAPI schemas for `SpendAnalyticsPaginatedResponse`, key/user info and spend-report models before freezing popup TypeScript types.
- For admin scope claims, inspect the current role tests: https://github.com/BerriAI/litellm/blob/main/tests/proxy_admin_ui_tests/test_role_based_access.py and test with the target proxy policy.
