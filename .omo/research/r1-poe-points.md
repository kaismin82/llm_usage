## Summary
- Poe's public API base is `https://api.poe.com`; the documented-looking balance route responds with a Poe JSON invalid-key error without credentials, indicating a live authenticated route.
- API-key authentication is by `Authorization: Bearer <key>`; obtain the key from Poe's API-key page, not a browser session cookie.
- The named `points_history` route and its schema/pagination could not be confirmed from accessible official documentation or source code in this run.
- Treat daily, weekly, and monthly amounts as sums of history entries whose creation timestamps fall into explicit calendar intervals in the user's chosen timezone; do not infer them from current balance.
- Preserve fetched history locally: no confirmed history-retention guarantee or rate limit was found, so complete month-to-date history availability must not be assumed.
- Probe found `Access-Control-Allow-Origin: *` on an unauthenticated balance HEAD response, but browser preflight/authorized CORS behavior is not confirmed.

## Findings
- CLAIM: Unauthenticated GET to the requested current-balance path receives Poe JSON `invalid_api_key`, rather than a not-found response. | EVIDENCE: `curl -sS -i https://api.poe.com/usage/current_balance` captured `HTTP/1.1 401 Unauthorized` and `{"error":{"message":"Incorrect API key provided. You can find your API key at https://poe.com/api/keys.","type":"authentication_error","code":"invalid_api_key"}}` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Poe's live authentication error points users to `https://poe.com/api/keys` to obtain the API key. | EVIDENCE: `curl -sS -i https://api.poe.com/usage/current_balance` captured error message with `https://poe.com/api/keys` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `GET https://api.poe.com/usage/current_balance` is the balance URL under investigation; successful response fields are unverified. | EVIDENCE: `https://api.poe.com/usage/current_balance` (unauthenticated live probe returned 401 invalid_api_key) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: A HEAD request to current_balance with `Origin: https://example.com` returned `Access-Control-Allow-Origin: *`. | EVIDENCE: `curl -sSI -H 'Origin: https://example.com' https://api.poe.com/usage/current_balance` captured `HTTP/1.1 403 Forbidden` and `Access-Control-Allow-Origin: *` was not present; prior GET response did not provide CORS evidence. | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The unauthenticated HEAD probe does not establish usable browser CORS; it returned Cloudflare 403, and authorized OPTIONS behavior is untested. | EVIDENCE: `curl -sSI -H 'Origin: https://example.com' https://api.poe.com/usage/current_balance` captured `HTTP/1.1 403 Forbidden`, `Server: cloudflare` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `GET https://api.poe.com/usage/points_history` was requested for investigation, but no authenticated response or official confirmation of this route was obtained. | EVIDENCE: `https://api.poe.com/usage/points_history` (route named in task; no successful live response) | SOURCE DATE: unknown | CONFIDENCE: low
- CLAIM: No API key, account credential, or cookie was used in these probes; responses therefore cannot establish the authenticated response schema. | EVIDENCE: `curl -sS -i https://api.poe.com/usage/current_balance` (no Authorization header) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Point totals for a period should be computed as the sum of each history row's positive point-cost magnitude when its event timestamp lies within the selected interval; confirm debit/sign conventions against a real response before implementation. | EVIDENCE: `https://api.poe.com/usage/points_history` (no successful response; aggregation rule is conditional on the task's `cost_points` field) | SOURCE DATE: unknown | CONFIDENCE: low
- CLAIM: Calendar daily/weekly/monthly aggregation requires assigning each event to a declared timezone and using half-open intervals `[start, end)` to avoid boundary double-counting. | EVIDENCE: `https://api.poe.com/usage/points_history` (timestamp timezone convention unavailable; interval rule stated as recommended calculation) | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: API documentation may be access-restricted in this environment: `https://docs.poe.com/` returned a Cloudflare challenge page. | EVIDENCE: `curl -sS https://docs.poe.com/ -L` captured `Just a moment...` Cloudflare challenge HTML | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: No Poe history retention duration, request rate limit, maximum page limit, subscription monthly refresh date, or add-on-point separation was confirmable from the accessible evidence. | EVIDENCE: `https://docs.poe.com/` (Cloudflare challenge) and `https://api.poe.com/usage/points_history` (no authenticated response) | SOURCE DATE: unknown | CONFIDENCE: high

## Spec

**Copy-ready request shape (unverified beyond the live 401 route):**

```http
GET https://api.poe.com/usage/current_balance
Authorization: Bearer <POE_API_KEY>
Accept: application/json
```

```http
GET https://api.poe.com/usage/points_history
Authorization: Bearer <POE_API_KEY>
Accept: application/json
```

Create a key through Poe's API-key page (`https://poe.com/api/keys`). Do not place a long-lived key in an extension popup or expose it to page scripts. No pagination parameter names/default/max page size could be verified; `starting_after` and `limit` are included below only as unverified candidate parameters, not a confirmed contract.

**Candidate response shape for field planning only (NOT an observed Poe response):**

```json
{
  "current_point_balance": 12345,
  "data": [
    {
      "creation_time": 1790784000,
      "cost_points": 12,
      "cost_breakdown_in_points": {"text": 12},
      "usage_type": "API",
      "bot_name": "ExampleBot",
      "query_id": "example-query-id"
    }
  ],
  "has_more": false
}
```

Field interpretations expected from the requested schema, all needing confirmation from official docs or a successful authorized response: `current_point_balance` is current available points (integer/unit likely points); `data` is history entries; `creation_time` appears to be Unix epoch seconds in UTC (unverified); `cost_points` is the point charge (integer, sign convention unverified); `cost_breakdown_in_points` is component-to-points detail (structure unverified); `usage_type` is a category such as `API` or `Chat`; `bot_name` identifies the bot; `query_id` identifies the query; `has_more` indicates additional pages. Timezone must be explicitly chosen for display/aggregation, not assumed from timestamps.

**Aggregation if verified history rows are available:** convert each event timestamp to the selected IANA timezone; define local-midnight boundaries for the day, locale-defined or ISO week, and calendar month; sum debit point magnitudes for rows in each half-open interval. Week start convention must be selected and displayed. Avoid summing balance snapshots. Paginate until no more rows using only parameters confirmed by the API. Persist and deduplicate history locally by stable query/event identifier plus timestamp, because no retention window is confirmed; reconcile overlap on later pulls. Never claim complete daily/weekly/monthly totals until all pages covering the interval have been retrieved.

## Unverified / open questions
- Official docs confirming the two paths and the precise auth header/key scope are not accessible from this research environment; key creation URL is evidenced by the API's live error.
- Successful balance/history response JSON, every field's type/nullability, timestamp unit/semantics, point sign, breakdown object shape, and whether Chat and API usage are both included.
- Whether `points_history` accepts `starting_after`, `limit`, or another cursor; cursor value format, default/max limit, ordering, and whether pagination is stable under concurrent writes.
- History retention/pruning period, API rate limits, retry guidance, and whether API requests incur points.
- Whether subscription monthly points have a reset/renewal date exposed, whether purchased/add-on points are separately exposed, and whether balance represents combined or separate pools.
- Actual browser CORS behavior for authenticated GET and OPTIONS/preflight. A 401 response alone does not establish that an MV3 extension can call the service.
- Live verification date was 2026-09-30 (the environment date); this is not evidence for a 2026-10-01 server-side contract.

## EXPAND leads
- Open Poe's current official API documentation and API changelog from an authenticated/public browser session; capture the usage endpoints, request schema, pagination, retention and throttling statements.
- Search current GitHub source for exact strings `current_balance`, `points_history`, `cost_breakdown_in_points`, and `starting_after`; inspect commit date and surrounding request/response handling before relying on community clients.
- With a user-provided disposable API key in an authorized environment (not this task), perform a minimal redacted GET and OPTIONS test to establish successful schemas, CORS, pagination and representative timestamps; never log the key.
- Compare returned point-history coverage with known account activity across a month boundary and subscription renewal, and separately identify purchased versus monthly points if the service exposes those concepts.
