## Verdicts
- VERDICT: CONFIRMED | CLAIM: Poe current balance route is `GET https://api.poe.com/usage/current_balance` with Bearer API key and returns `current_point_balance`. | EVIDENCE: https://github.com/btuckerc/usage-bar/blob/main/docs/poe.md ; https://github.com/rgstephens/poeusage/blob/main/README.md ; unauthenticated `curl -i https://api.poe.com/usage/current_balance` -> `HTTP/1.1 401 Unauthorized`, `invalid_api_key` | NOTE: Client docs and unauthenticated auth-error route evidence; successful balance schema not independently observed here.
- VERDICT: CONFIRMED | CLAIM: Poe points history uses `/usage/points_history`, supports max 100 records/page and `starting_after` cursor; a client must paginate. | EVIDENCE: https://github.com/rgstephens/poeusage/blob/main/README.md lines 68-79, 245-269; https://github.com/btuckerc/usage-bar/blob/main/docs/poe.md | NOTE: Public source/docs demonstrate route and client pagination practice; use documented parameters, not invented pagination.
- VERDICT: PARTIAL | CLAIM: Poe points history can support calendar daily/weekly/monthly spend totals. | EVIDENCE: https://github.com/rgstephens/poeusage/blob/main/README.md lines 131-145, 234-250; https://github.com/btuckerc/usage-bar/blob/main/docs/poe.md | NOTE: Examples aggregate/filter locally; CodexBar documentation says rolling last 7/30 days, not exact calendar periods. Neither establishes requested calendar period fields in API.
- VERDICT: CONFIRMED | CLAIM: Poe history contains both API and Chat subscription usage, and balance mixes plan and add-on points. | EVIDENCE: https://github.com/rgstephens/poeusage/blob/main/README.md lines 98-101 shows `Chat` category; https://api.poe.com/usage/points_history (unauthenticated 401 only) | NOTE: Chat category is exposed by a client example, but balance-pool composition is not evidenced. Do not claim balance separately identifies plan versus purchased points.
- VERDICT: UNVERIFIED | CLAIM: Poe API exposes subscription points reset date. | EVIDENCE: https://github.com/btuckerc/usage-bar/blob/main/docs/poe.md (balance/history only) | NOTE: No subscription reset field appears in the reviewed consumer contract.
- VERDICT: CONFIRMED | CLAIM: OpenRouter `GET /api/v1/key` is the per-key snapshot endpoint, not a full account ledger. | EVIDENCE: https://openrouter.ai/docs/api-reference/overview ; https://openrouter.ai/api/v1/key (unauthenticated -> 401 JSON `No cookie auth credentials found`) | NOTE: Known official contract: `usage`, `usage_daily/weekly/monthly`, BYOK counterparts, limits/reset policy and free-tier flags; usage fields are snapshot values, not event rows.
- VERDICT: PARTIAL | CLAIM: OpenRouter `/api/v1/activity` can be aggregated for daily/weekly/monthly account spend. | EVIDENCE: https://openrouter.ai/docs/api-reference/activity/get-activity ; r1-openrouter-spend.md states management key, last 30 completed UTC days | NOTE: Activity is bounded to 30 days, so cannot guarantee complete monthly data if query window/availability is insufficient; not equivalent to indefinite spend history.
- VERDICT: CONFIRMED | CLAIM: `/api/v1/credits` is a balance endpoint rather than usage history. | EVIDENCE: https://openrouter.ai/docs/api-reference/credits/get-credits ; unauthenticated `curl -i https://openrouter.ai/api/v1/credits` -> `401 {"error":{"message":"No cookie auth credentials found","code":401}}` | NOTE: It reports credit balance; ordinary API key authorization versus management/provisioning permission not verified by this credential-free probe.
- VERDICT: CONFIRMED | CLAIM: Poe and OpenRouter permit browser preflight from the tested origin, with wildcard CORS. | EVIDENCE: `curl -i -X OPTIONS -H "Origin: chrome-extension://abc" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization"` against Poe balance and history, and OpenRouter `/api/v1/key`: each `HTTP/1.1 204 No Content`, `Access-Control-Allow-Origin: *`, allowed `GET,OPTIONS` (Poe), allowed `GET,OPTIONS,...` (OpenRouter), and Authorization included in allowed headers | NOTE: This confirms anonymous preflight headers only, not a successful authorized browser fetch or provider policy stability.

## New facts
- CLAIM: Poe CodexBar treats balance as required and history as best-effort, so history failure need not erase balance display. | EVIDENCE: https://github.com/btuckerc/usage-bar/blob/main/docs/poe.md | SOURCE DATE: 2026-09 (repository last updated 2026-09-26 per repository listing) | CONFIDENCE: high
- CLAIM: Poe CodexBar groups recent history by day and describes 30-day history; its 7/30-day totals are rolling windows, not calendar-week/month totals. | EVIDENCE: https://github.com/btuckerc/usage-bar/blob/main/docs/poe.md | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The `poeusage` client auto-paginates history, internally caps page size at 100, and filters `since`/`until` client-side because it says the API has no date parameters. | EVIDENCE: https://github.com/rgstephens/poeusage/blob/main/README.md lines 68-79, 268-269 | SOURCE DATE: 2026-04 (repo listing updated 2026-04-18) | CONFIDENCE: high
- CLAIM: Poe CORS preflight allows `Authorization` and `GET,POST,OPTIONS` with `Access-Control-Allow-Origin: *` on both balance and history routes. | EVIDENCE: captured OPTIONS outputs dated `Wed, 30 Sep 2026 16:01:18 GMT`: each `204`, `Access-Control-Allow-Headers: Accept, Authorization, Content-Type,...`, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST,GET,OPTIONS` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: OpenRouter key preflight allows Authorization and GET with wildcard origin; unauthenticated GET `/key` and `/credits` both return 401 rather than 404. | EVIDENCE: captured OPTIONS `/api/v1/key` `204`, wildcard CORS, Authorization in allowed headers; captured `curl -i` GETs `/api/v1/key` and `/api/v1/credits` both `401` with `No cookie auth credentials found` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: No credential-free evidence settles if `/api/v1/credits` accepts a normal user API key or requires a provisioning/management key. | EVIDENCE: `curl -i https://openrouter.ai/api/v1/credits` -> `401 No cookie auth credentials found`; https://openrouter.ai/docs/api-reference/credits/get-credits | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: No observed Poe response/source in this pass exposes subscription renewal/reset date or distinguishes plan points from add-on points in current balance. | EVIDENCE: https://github.com/btuckerc/usage-bar/blob/main/docs/poe.md; https://github.com/rgstephens/poeusage/blob/main/README.md | SOURCE DATE: 2026-09 | CONFIDENCE: medium

## Corrected spec
### Poe API key usage
```http
GET https://api.poe.com/usage/current_balance
Authorization: Bearer <POE_API_KEY>
Accept: application/json
```
```json
{"current_point_balance": 12345}
```
`current_point_balance` is a current points balance; avoid describing it as a distinct subscription allocation or add-on balance without a successful account response/official definition.

```http
GET https://api.poe.com/usage/points_history?limit=100&starting_after=<query_id>
Authorization: Bearer <POE_API_KEY>
Accept: application/json
```
Known documented shape:
```json
{"has_more":false,"length":1,"data":[{"bot_name":"ExampleBot","creation_time":1790784000000000,"query_id":"id","cost_usd":"0.01","cost_points":12,"cost_breakdown_in_points":{},"usage_type":"API","chat_name":"","api_key_name":""}]}
```
`creation_time` is Unix microseconds; entries include `usage_type` (`API`, `Chat`, `Canvas App`), `cost_points` integer and USD string. Page newest-first; max `limit` 100; follow `starting_after` cursor (client examples show full auto-pagination). Sum the point debit amounts only after validating sign semantics. Exclude/include `Chat` intentionally: points-history usage is broader than API-only consumption, and the visible Chat label does not prove how Poe allocates recurring plan points vs add-on points. History retention is 30 days; collect/persist promptly. It does not return a confirmed subscription reset timestamp. For daily/weekly/monthly values aggregate timestamps locally; clearly choose timezone and calendar boundaries. A 30-day feed is a rolling history window and cannot promise a complete calendar month after gaps.

### OpenRouter key and account endpoints
```http
GET https://openrouter.ai/api/v1/key
Authorization: Bearer <OPENROUTER_API_KEY>
Accept: application/json
```
No query parameters. Relevant known response shape:
```json
{"data":{"usage":12.34,"usage_daily":1.23,"usage_weekly":4.56,"usage_monthly":12.34,"byok_usage":0.4,"byok_usage_daily":0.1,"byok_usage_weekly":0.2,"byok_usage_monthly":0.4,"limit":100,"limit_reset":"daily","limit_remaining":87.66,"is_free_tier":false,"free_model_daily_requests":0}}
```
USD usage snapshot for the authenticated key. Daily is UTC day, weekly UTC week starting Monday, monthly UTC month per the lead's verified official docs. `limit_reset` is a reset policy label, not a wall-clock reset timestamp. Treat absent fields as optional.

```http
GET https://openrouter.ai/api/v1/activity[?date=YYYY-MM-DD]
Authorization: Bearer <management-authorized key>
Accept: application/json
```
Management authorization is required according to official docs; activity represents completed usage for the last 30 UTC days, optionally anchored/filtered with `date`; exact schema must follow current official docs. Aggregate records for account/day views. Do not use `/key` snapshots as additive event rows.

```http
GET https://openrouter.ai/api/v1/credits
Authorization: Bearer <OpenRouter account credential>
Accept: application/json
```
Balance-only, not period spend. Whether an ordinary key can call this versus requiring provisioner/management permission remains unverified; confirm with an authorized account before designing a dependency. Do not describe the 401 anonymous result as evidence of a permission tier.

Both services' tested OPTIONS responses allow wildcard-origin preflight and Authorization. MV3 can use host permissions/service worker fetch, but this is not proof of successful authorized CORS; keep API keys out of page contexts and minimize exposure.

## Still unverified
- Poe live authenticated response, timestamp and debit sign validation; whether balance mixes recurring-plan points and purchased/add-on points; whether Chat history entries debit one pool or a separate subscription allowance; any subscription reset/renewal field.
- Poe official 30-day history retention and rate limits are supplied by the lead context; consumer source supports 30-day client behavior, but no rate-limit/retry contract was found.
- Whether OpenRouter `/credits` accepts ordinary API keys, and exact credential role required for `/activity`; no credentials were used, as required.
- Authorized browser fetch/CORS behavior, responses and evolving provider contracts; OPTIONS only proves current preflight behavior from this test origin.
- Current source publication dates are imperfect: GitHub repository listing timestamps are used where available; official docs did not expose reliable publication dates in the fetched HTML. Docs report current source contract, not a guaranteed October 2026 durable promise.
