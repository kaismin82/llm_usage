## Summary
- CodexBar is unusually broad open-source prior art: it covers Claude web usage and reset grants, ChatGPT/Codex, Z.ai, Poe, LiteLLM, and OpenRouter.
- Claude's undocumented usage endpoint has unusually concrete evidence, including 5-hour and 7-day utilization/reset fields and an explicit reset-grant opt-in query.
- CodexBar source uses ChatGPT's undocumented `/wham/usage` and `/wham/rate-limit-reset-credits`; both require the user's bearer access token.
- Exact day/week/month spend rollups, Poe historical points, and Z.ai voucher semantics are not established by the evidence collected here; do not assume one endpoint supplies them.
- The material below is research, not an extension implementation; private/authenticated payload behavior remains partly unverified.

## Findings - one line per fact, formatted exactly: `- CLAIM: <fact> | EVIDENCE: <URL, or file path+line in a repo, or the curl command and its captured output> | SOURCE DATE: <YYYY-MM or unknown> | CONFIDENCE: high|medium|low`
- CLAIM: CodexBar is a public multi-provider usage monitor; GitHub API reported repository last pushed 2026-09-30 and its current tree includes provider implementations for Claude, Codex, Z.ai, Poe, LiteLLM and OpenRouter. | EVIDENCE: https://github.com/steipete/CodexBar | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Claude web mode first discovers organizations, then GETs `https://claude.ai/api/organizations/{orgId}/usage`; it authenticates with `Cookie: sessionKey=<sessionKey>` and asks for reset grants with `?cedar_ember=1`, retrying without the query when necessary. | EVIDENCE: Sources/CodexBarCore/Providers/Claude/ClaudeWeb/ClaudeWebAPIFetcher.swift:647-665 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Claude parsing maps `five_hour.utilization` and `five_hour.resets_at` to session percentage/reset, and `seven_day.utilization` and `seven_day.resets_at` to weekly percentage/reset; reset timestamps are parsed as ISO 8601. | EVIDENCE: Sources/CodexBarCore/Providers/Claude/ClaudeWeb/ClaudeWebAPIFetcher.swift:697-728 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The Claude usage response's `cedar_ember` object is parsed into reset-credit state; unreadable grant data is ignored without losing the normal usage windows. | EVIDENCE: Sources/CodexBarCore/Providers/Claude/ClaudeWeb/ClaudeWebAPIFetcher.swift:734-760 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CodexBar's Codex OAuth fetch uses GET to `https://chatgpt.com/backend-api/wham/usage` by default, bearer authorization, JSON accept and optional `ChatGPT-Account-Id`; it also supports `/api/codex/usage` for non-ChatGPT backends. | EVIDENCE: Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift:379-420,564-579 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CodexBar calls ChatGPT `/wham/rate-limit-reset-credits` with bearer authorization plus `OpenAI-Beta: codex-1` and `originator: Codex Desktop`; parser models returned `credits` with reset type/status fields. | EVIDENCE: Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift:383,524-561,686-723 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CodexBar exposes z.ai/GLM with 5-hour and weekly presentation labels and routes quota/model-usage URLs by region; plugin settings publish those endpoint URLs to its runtime. | EVIDENCE: Sources/CodexBarCore/Providers/Zai/ZaiProviderDescriptor.swift:68-82,160-175 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CodexBar's Z.ai integration configures API-key authentication, supports personal/team usage scopes and team organization/workspace context; captured source here does not reveal the quota response schema or a voucher endpoint. | EVIDENCE: Sources/CodexBarCore/Providers/Zai/ZaiProviderDescriptor.swift:4-28,38-50 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CodexBar describes LiteLLM usage as spend/budget read from key, user and team info endpoints, with a configured proxy base URL and API key; it strips accepted `/v1` suffixes for management endpoints. | EVIDENCE: Sources/CodexBar/Sources/CodexBarCore/Providers/LiteLLM/LiteLLMProviderDescriptor.swift:5-11,53-70 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: LiteLLM presentation supports primary/secondary budget windows and displays reset only when the response provides a reset date; evidence here does not establish day/week/month totals as built-in fields. | EVIDENCE: Sources/CodexBar/Sources/CodexBarCore/Providers/LiteLLM/LiteLLMProviderDescriptor.swift:40-50 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: CodexBar's Poe descriptor uses a Poe API key and identifies its data as a points balance; it explicitly states usage history is unavailable. | EVIDENCE: Sources/CodexBar/Sources/CodexBarCore/Providers/Poe/PoeProviderDescriptor.swift:8-19 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CodexBar presents OpenRouter credits and usage and notes 30-day spend needs a management API key; API keys are the normal credential and an optional management key is carried separately. | EVIDENCE: Sources/CodexBar/Sources/CodexBarCore/Providers/OpenRouter/OpenRouterProviderDescriptor.swift:17-24,55-69,83-93 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: Claude OAuth is another CodexBar usage path distinct from Claude web-cookie mode, and source exposes separate OAuth fetching and rate-limit handling. | EVIDENCE: https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Claude/ClaudeOAuth/ClaudeOAuthUsageFetcher.swift | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: No voucher or provider-wide limit-reset handling was verified for ChatGPT or Z.ai in the inspected source; do not infer it from ordinary quota resets. | EVIDENCE: https://github.com/steipete/CodexBar/tree/main/Sources/CodexBarCore/Providers | SOURCE DATE: 2026-09 | CONFIDENCE: low

## Spec - the concrete, copy-ready details: method, URL, auth/headers, request params, a realistic response JSON example with every field and its meaning/unit/timezone

### Anthropic Claude subscription (web session)
- Request 1: `GET https://claude.ai/api/organizations` with `Cookie: sessionKey=<sessionKey>` and `Accept: application/json`; choose the organization with Chat capability. Request 2: `GET https://claude.ai/api/organizations/{orgId}/usage?cedar_ember=1` with the same cookie and accept header. The code retries request 2 without `cedar_ember=1` for selected unsuccessful responses. This is an undocumented authenticated web API; a session cookie must not be hardcoded or shared.
- Example shape, derived from source field names (values below illustrative, not a captured live response):
```json
{
  "five_hour": {"utilization": 37.5, "resets_at": "2026-10-01T15:00:00Z"},
  "seven_day": {"utilization": 61, "resets_at": "2026-10-05T00:00:00Z"},
  "seven_day_sonnet": {"utilization": 22},
  "extra_usage": {"used_credits": 1200, "monthly_limit": 5000, "currency": "USD"},
  "cedar_ember": {"grants": []}
}
```
`utilization` is percent (not token count); `resets_at` is an ISO-8601 instant (UTC `Z` shown; display in chosen local timezone). `seven_day_sonnet` is optional model-specific utilization. Extra-usage credit units are cents in the implementation. `cedar_ember` is grant/reset-credit state, but its full response schema is not specified here.

### ChatGPT subscription / Codex
- Default request: `GET https://chatgpt.com/backend-api/wham/usage`; headers `Authorization: Bearer <ChatGPT access token>`, `Accept: application/json`, `User-Agent: CodexBar`, and optional `ChatGPT-Account-Id: <account id>`. User token retrieval is outside the report. For reset grants, use `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` with the same bearer token and `OpenAI-Beta: codex-1`, `originator: Codex Desktop`, optionally `ChatGPT-Account-ID` (note source casing differs). No request params.
- Exact usage JSON sample not reproduced: source decodes `rate_limit`/window snapshots and flexible spend-control variants, but source excerpt inspected does not establish a complete stable wire example. The confirmed reset-credit root is `credits`; items include `reset_type` and `status`. Reset timestamps in quota snapshots are Unix seconds (`reset_at`). Credits schema/units and current statuses need live authenticated confirmation.

### Z.ai / GLM
- CodexBar supports a configured region, API key, usage scope and (team scope) organization/workspace IDs. It resolves quota, model-usage and optional balance endpoint URLs through `ZaiEndpointRouter`; exact resolved URL and wire schema were not captured in this survey, so no safe copy-ready authenticated request or truthful realistic JSON sample can be given.

### Poe, LiteLLM, OpenRouter
- Poe: CodexBar descriptor confirms API-key access and points balance but not a public response schema or historical point-period endpoints. No verifiable copy-ready method/URL/schema found here.
- LiteLLM: configured proxy base URL plus virtual API key; source says key/user/team info endpoints, but this inspection did not capture the exact routes, headers or full response schema. No defensible day/week/month mapping sample.
- OpenRouter: API-key usage and optional management key for 30-day spend are established by descriptor; actual routes/schema were not inspected. Don't label computed calendar periods as server-provided reset windows without verifying endpoints.

## Unverified / open questions - everything you could not confirm, stated plainly
- Live authenticated endpoint responses and CORS behavior were not tested; no credentials were used or sought. No unauthenticated curl probes captured in this report.
- The complete latest CodexBar commit date was observed as repository pushed date (2026-09-30); GitHub API rate limiting prevented resolving the commit's authored date.
- Z.ai route constants and quota response/reset/voucher mappings, Poe points history period endpoints, LiteLLM route details, and OpenRouter usage/spend routes require direct source inspection and/or official documentation.
- Claude grant/voucher payload field meanings, expiry/consumption transitions, and whether a popup can receive an immediate event without polling/push are not confirmed. The implementation requests the grant block during normal usage fetch.
- ChatGPT reset-credit schema, unit, eligibility and whether it represents user-specific vouchers or a provider-wide reset require authenticated validation. ChatGPT plan subscription windows and Codex quota semantics should not be conflated.
- No official 2026 provider docs/changelog confirming these private endpoints was obtained; all endpoint claims above rely on current open-source source code.

## EXPAND leads - further sources or angles worth checking
- Inspect current CodexBar implementation and tests for endpoint contracts, reset-credit deduplication/notification behavior, Z.ai router targets, LiteLLM and OpenRouter request code: https://github.com/steipete/CodexBar
- Search GitHub for exact strings `cedar_ember`, `/wham/rate-limit-reset-credits`, `Z_AI_QUOTA_ENDPOINT`, `PoeUsageFetcher`, `LiteLLMUsageFetcher`, and OpenRouter management-usage paths.
- Check official Anthropic, OpenAI, Z.ai, Poe, LiteLLM and OpenRouter docs/changelogs dated 2026, prioritizing vendor-supported access over undocumented web endpoints.
- Survey CodexBar's desktop usage against the MV3 boundary: cookie access, bearer-token custody, CORS, host permissions, and whether background refresh/push can make reset grants immediate.
- Clarify the product definition of day/week/month (calendar buckets vs rolling windows) for Poe/LiteLLM/OpenRouter before choosing aggregation semantics.
