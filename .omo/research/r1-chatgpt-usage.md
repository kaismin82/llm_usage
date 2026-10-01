# R1 - ChatGPT / Codex subscription usage from a browser extension

Research date: 2026-10-01. Tools available were curl and `gh` (GitHub API/code search) only. No general web-search or web-fetch tool was available, so official OpenAI docs and forum pages were NOT read directly. Evidence is open-source GitHub code (mostly 2026) plus unauthenticated curl probes. No credentials were used.

## Summary
- The endpoint is `GET https://chatgpt.com/backend-api/wham/usage`. It is still live: an unauthenticated probe returned 401 on 2026-09-30. It is undocumented and internal, so it can change.
- Auth is `Authorization: Bearer <accessToken>` plus `ChatGPT-Account-Id: <id>`. In a browser the token comes from `GET https://chatgpt.com/api/auth/session` with the user's cookies (`accessToken` field). The account id can also be read from the JWT claim `https://api.openai.com/auth`.`chatgpt_account_id`. No API key exists for this.
- The 7-day window is the window whose `limit_window_seconds` is 604800. Classify windows by duration, NOT by primary/secondary slot. Some Plus/Codex accounts put the 7-day window in `primary_window` with no 5-hour window; others have primary = 18000 s (5 h) and secondary = 604800 s (7 d). `reset_at` is Unix epoch seconds (UTC).
- The response also carries `plan_type`, `rate_limit.allowed/limit_reached`, `credits`, `additional_rate_limits[]`, `spend_control`, `rate_limit_reached_type` and `rate_limit_reset_credits.available_count` (a cheap signal for banked reset credits; another node owns that topic).
- No verified endpoint exposes classic ChatGPT chat caps (GPT-5 message caps, Deep Research or agent quotas). `wham/usage` reports the Codex allowance; `/backend-api/conversation_limit` is only a probed guess.
- Poll at 5 min or slower (60 s floor while the popup is open; back off on 403/429). Cloudflare behavior from an MV3 service worker is only partly verified (see the open questions).

## Findings
- CLAIM: GET https://chatgpt.com/backend-api/wham/usage exists and requires auth; unauthenticated it returns 401, and HEAD returns 405 with `allow: GET`, served via Cloudflare | EVIDENCE: `curl -s -o /dev/null -w '%{http_code}' https://chatgpt.com/backend-api/wham/usage` -> `401`; `curl -sI` -> `HTTP/1.1 405 Method Not Allowed ... allow: GET ... Server: cloudflare` (probed 2026-09-30) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `https://chatgpt.com/api/auth/session` returns 403 to a bare curl (no cookies, no browser fingerprint), so it is Cloudflare-fronted and likely needs browser context | EVIDENCE: `curl -s -o /dev/null -w '%{http_code}' https://chatgpt.com/api/auth/session` -> `403` (2026-09-30); the body was not inspected, so challenge vs WAF block is unknown | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: `/backend-api/codex/usage` on chatgpt.com returns 403 to bare curl while `/wham/usage` returns 401, so `/wham/usage` is the path that reaches the app | EVIDENCE: `curl -s -o /dev/null -w '%{http_code}' https://chatgpt.com/backend-api/codex/usage` -> `403` (2026-09-30) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: Dozens of independent 2026 tools use the same URL with a bearer token (icebear0828/codex-proxy, 0xtbug/zero-limit, opgginc/opencode-bar, vbgate/opencode-mystatus, michellzappa/headroom, patlux/pi-chatgpt-limit, and others) | EVIDENCE: `gh search code "wham/usage"`, e.g. https://github.com/0xtbug/zero-limit/blob/main/src/constants/api.ts (`CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'`) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The official Codex client (Rust) sends `Authorization: Bearer` plus `chatgpt-account-id` to a usage path (`/api/codex/usage` in its mock, the `<base>/api/codex/usage` style; `/wham/usage` is the same handler under the chatgpt.com/backend-api base) | EVIDENCE: https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/rate_limits.rs (mock matches `path("/api/codex/usage")`, `header("authorization","Bearer chatgpt-token")`, `header("chatgpt-account-id","account-123")`) | SOURCE DATE: 2026-06 | CONFIDENCE: medium
- CLAIM: Official schema `RateLimitStatusPayload` has fields plan_type, rate_limit, credits, spend_control, additional_rate_limits, rate_limit_reached_type | EVIDENCE: https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `RateLimitStatusDetails` = {allowed: bool, limit_reached: bool, primary_window: snapshot|null, secondary_window: snapshot|null}; both windows are nullable | EVIDENCE: https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_details.rs | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Window snapshot fields are used_percent, limit_window_seconds, reset_after_seconds, reset_at (epoch seconds) | EVIDENCE: https://github.com/baggiiiie/pi-stuff/blob/main/docs/codex-usage.md (real sample: `"limit_window_seconds": 604800, "reset_at": 1776364028`, i.e. 2026-04-16 UTC) and the openai/codex rate_limits.rs fixture | SOURCE DATE: 2026-04 | CONFIDENCE: high
- CLAIM: A real Plus sample has primary = 18000 s (5 h) and secondary = 604800 s (7 d), `additional_rate_limits: null`, and `credits: {has_credits:false, unlimited:false, balance:"0"}` | EVIDENCE: https://github.com/baggiiiie/pi-stuff/blob/main/docs/codex-usage.md | SOURCE DATE: 2026-04 | CONFIDENCE: high
- CLAIM: The 5-hour window still existed in June 2026 (CLI output shows `primary: window=5.0h`, `secondary: window=7.0d`) | EVIDENCE: https://github.com/aaamosh/codex-reset/blob/main/README.md (sample output; the tool reads `/wham/usage`) | SOURCE DATE: 2026-06 | CONFIDENCE: medium
- CLAIM: Some Plus/Codex responses put only a 7-day (10080 min) window in `primary_window` with no 5-hour session, so consumers classify by `limit_window_seconds` (<=12 h session, ~3-14 d weekly, >=20 d monthly) | EVIDENCE: https://github.com/ttaatoo/quotabar/blob/main/QuotaBar/Models/UsageModels.swift (comment on `QuotaWindowKind`, lines ~129-155) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: `plan_type` enum includes guest, free, go, plus, pro, prolite, promax, free_workspace, team, self_serve_business_prolite, self_serve_business_usage_based, business, ent26, enterprise_cbp_automation, enterprise_cbp_usage_based (my read of the list was truncated, so there may be more) | EVIDENCE: https://github.com/openai/codex/blob/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `additional_rate_limits` is an array of `{limit_name, metered_feature, rate_limit:{allowed, limit_reached, primary_window, ...}}` (per-feature buckets such as `codex_other`) | EVIDENCE: openai/codex rate_limits.rs fixture (`"limit_name": "codex_other"`); https://github.com/icebear0828/codex-proxy/blob/main/src/auth/types.ts lines 150-163 | SOURCE DATE: 2026-06 | CONFIDENCE: high
- CLAIM: `credits` = {has_credits: bool, unlimited: bool, balance: string|null, approx_local_messages?: array, approx_cloud_messages?: array}; codex-proxy notes credits are Pro/PAYG only and null for Plus | EVIDENCE: openai/codex credit_status_details.rs (codex-rs/codex-backend-openapi-models/src/models/); codex-proxy types.ts line 148 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: `code_review_rate_limit` is {allowed, limit_reached, used_percent, remaining_percent?, reset_at, limit_window_seconds} or null (a consumer's typing; not in the official payload struct I read) | EVIDENCE: https://github.com/icebear0828/codex-proxy/blob/main/src/auth/types.ts lines 139-146 | SOURCE DATE: 2026-09 | CONFIDENCE: low
- CLAIM: `rate_limit_reached_type.type` values: rate_limit_reached, workspace_owner_credits_depleted, workspace_member_credits_depleted, workspace_owner_usage_limit_reached, workspace_member_usage_limit_reached, unknown | EVIDENCE: openai/codex rate_limit_status_payload.rs (URL above) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `spend_control` holds {reached, individual_limit:{source, limit, used, remaining, used_percent, remaining_percent, reset_after_seconds, reset_at}} for workspace plans; limit/used/remaining are strings | EVIDENCE: openai/codex rate_limits.rs fixture (URL above) | SOURCE DATE: 2026-06 | CONFIDENCE: medium
- CLAIM: The usage payload includes `rate_limit_reset_credits.available_count`, and a separate `GET /backend-api/wham/rate-limit-reset-credits` lists credits ({id, reset_type, status, granted_at, expires_at, title, description}); savable resets were rolled out 2026-06-12 | EVIDENCE: openai/codex rate_limits.rs fixture; https://github.com/aaamosh/codex-reset/blob/main/README.md; https://github.com/michellzappa/headroom/blob/main/host/codex_usage.py (`CREDITS_URL`) | SOURCE DATE: 2026-06 | CONFIDENCE: medium
- CLAIM: In a browser, the bearer token comes from `GET https://chatgpt.com/api/auth/session` with session cookies; the JSON has `accessToken` and, on some accounts, an account id under `account.account_id`/`account.id`; logged-out returns `{}` | EVIDENCE: https://github.com/ViuMP/Walder/blob/main/src/providers/chatgpt-web.ts (`parseSession`, comments dated 2026-09-08); https://github.com/NateBJones-Projects/OB1/blob/main/integrations/chrome-capture-extension/lib/sync-chatgpt.js line 77 (`credentials: 'include'`) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The account id can be derived from the access-token JWT: `payload["https://api.openai.com/auth"].chatgpt_account_id`; the plan is at `chatgpt_plan_type` in the same claim | EVIDENCE: https://github.com/vbgate/opencode-mystatus/blob/main/plugin/lib/openai.ts (`getAccountIdFromJwt`); https://github.com/opgginc/opencode-bar/blob/main/scripts/query-codex.sh | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: An MV3 Chrome extension already fetches `/api/auth/session` from its service worker using `host_permissions` for https://chatgpt.com/ and treats 401/403 as unauthorized | EVIDENCE: https://github.com/zhishile/codex-auth-helper/blob/main/extension/background.js lines 42-67 | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: Challenge/logged-out states can return 200 with an HTML page from `/api/auth/session`, so `response.json()` must be guarded | EVIDENCE: https://github.com/NateBJones-Projects/OB1/blob/main/integrations/chrome-capture-extension/lib/sync-chatgpt.js lines 82-90 | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: Non-browser clients hit Cloudflare bot detection on chatgpt.com; botfarm uses `curl_cffi` browser TLS impersonation, and codex-reset saw 403 / non-JSON challenge responses on related endpoints with incomplete headers | EVIDENCE: https://github.com/AlexDobrushskiy/botfarm/blob/main/botfarm/codex_usage.py (docstring line 8, line 177); https://github.com/aaamosh/codex-reset/blob/main/README.md lines ~122-140 | SOURCE DATE: 2026 | CONFIDENCE: medium
- CLAIM: `wham/usage` reports the Codex allowance, not the ChatGPT chat allowance; no documented endpoint exposes chat caps. Walder falls back to guesses (`/backend-api/conversation_limit`, `/backend-api/models`) and reports "endpoint-changed" when no percentage is found | EVIDENCE: https://github.com/ViuMP/Walder/blob/main/src/providers/chatgpt-web.ts and src/providers/endpoint-discovery.ts headers (BUILD_LOG 2026-09-08) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: `/backend-api/conversation_limit` is probed by ai-quota-tracker and Walder, but no confirmed response shape exists | EVIDENCE: https://github.com/oscasrhiah/ai-quota-tracker/blob/main/src/main/providers/chatgpt.ts (candidate list only) | SOURCE DATE: unknown | CONFIDENCE: low
- CLAIM: Existing tools poll gently: headroom caches 60 s (20 s after failure), botfarm defaults to 300 s; refresh tokens are single-use so tools refresh only on 401/403 | EVIDENCE: https://github.com/michellzappa/headroom/blob/main/host/codex_usage.py (`CACHE_TTL_S = 60`, `FAIL_TTL_S = 20`); https://github.com/AlexDobrushskiy/botfarm/blob/main/botfarm/codex_usage.py line 32 (`DEFAULT_POLL_INTERVAL = 300`) | SOURCE DATE: 2026 | CONFIDENCE: medium
- CLAIM: Other wham paths seen in the wild: `/backend-api/wham/rate-limit-reset-credits` (+ `/consume`), `/wham/profiles/me`, `/wham/apps`, `/wham/remote/control/server` (+ `/enroll`) | EVIDENCE: `gh search code "backend-api/wham"` path counts (usage 41, rate-limit-reset-credits 8, remote/control/server 4, enroll 3, consume 1, profiles/me 1, apps 1) | SOURCE DATE: 2026-09 | CONFIDENCE: medium

## Spec

### Request
- Step 1 (token): `GET https://chatgpt.com/api/auth/session`, `credentials: 'include'`, from the extension (host permission `https://chatgpt.com/*`) or from a content script in a chatgpt.com tab. Read `accessToken` (short-lived JWT). If the body is `{}`, not JSON, or has no `accessToken`, treat it as "not logged in / challenge".
- Step 2 (usage): `GET https://chatgpt.com/backend-api/wham/usage`
  - `Authorization: Bearer <accessToken>`
  - `ChatGPT-Account-Id: <account id>` (from `session.account.*` or the JWT claim). Needed for team/workspace accounts; harmless for personal ones.
  - `Accept: application/json`; no query parameters, no body.
- Optional (voucher node's topic): `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` with the same headers.
- Never persist the token; hold it in memory for one poll.

### Response (composed from the official schema and real samples; values invented, not captured live)
```json
{
  "plan_type": "plus",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": {
      "used_percent": 46,
      "limit_window_seconds": 18000,
      "reset_after_seconds": 4269,
      "reset_at": 1776098704
    },
    "secondary_window": {
      "used_percent": 44,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 269592,
      "reset_at": 1776364028
    }
  },
  "code_review_rate_limit": {
    "allowed": true, "limit_reached": false, "used_percent": 0,
    "limit_window_seconds": 604800, "reset_at": 1776364028
  },
  "additional_rate_limits": [
    {
      "limit_name": "codex_other",
      "metered_feature": "codex_other",
      "rate_limit": {
        "allowed": true, "limit_reached": false,
        "primary_window": {"used_percent": 88, "limit_window_seconds": 1800, "reset_after_seconds": 600, "reset_at": 1735693200}
      }
    }
  ],
  "credits": {"has_credits": false, "unlimited": false, "balance": "0"},
  "spend_control": null,
  "rate_limit_reached_type": null,
  "rate_limit_reset_credits": {"available_count": 1}
}
```

### Field meanings
- `plan_type`: lowercase string enum (free, go, plus, pro, prolite, promax, team, business, ...).
- `rate_limit.allowed` / `limit_reached`: booleans. Show "blocked" when `limit_reached` is true or `allowed` is false.
- `used_percent`: number 0-100, percent consumed (not remaining).
- `limit_window_seconds`: window length in seconds; 18000 = 5 h, 604800 = 7 d. Classify by this value.
- `reset_after_seconds`: relative seconds until reset at response time; compute the absolute time from the fetch time.
- `reset_at`: absolute Unix epoch in SECONDS, UTC. Multiply by 1000 for JS `Date`; display in local time.
- `credits.balance`: decimal string, not a number. `additional_rate_limits[].rate_limit`: same shape as `rate_limit`, one bucket per metered feature.
- Either window may be null. The 7-day window may be in `primary_window` or `secondary_window`.

### 7-day extraction rule
Collect the windows from `rate_limit` and from every `additional_rate_limits[].rate_limit`. Treat `limit_window_seconds` roughly in 500000..700000 as the weekly window and <= 43200 as the session window. Do not rely on slot position.

### Cloudflare / execution context
- Background service worker with `host_permissions` for chatgpt.com: precedent exists (codex-auth-helper) for `/api/auth/session`. Not verified for `wham/usage`.
- Content script in a chatgpt.com tab: same-origin requests carry the page's real browser fingerprint and Cloudflare cookies, so this is the most robust route but needs an open chatgpt.com tab. Not verified end-to-end here.
- Expected failures: 403 or an HTML challenge (needs a real browser context), `{}` from the session (logged out), 401 (expired token; refetch the session once), 429 (back off).

### Polling
Default 5 min; 60 s minimum while the popup is open; exponential backoff up to 30 min on 403/429; cache the last good result. Use `chrome.alarms` rather than `setInterval` in the service worker. This is engineering judgment based on the intervals above; OpenAI publishes no limit for this endpoint.

## Unverified / open questions
- I had no web-search or web-fetch tool, so official OpenAI help pages, changelogs and forum posts were not read. Plan-by-plan 5-hour vs 7-day rules come only from open-source samples (Plus in 2026-04, an unspecified plan in 2026-06). Whether Free, Go, Pro and Team each still have a 5-hour window in October 2026 is NOT confirmed.
- I never received an authenticated response. The example JSON is composed from source code and third-party samples, not captured from the live API. The list of `plan_type` values I read was truncated.
- Whether a plain extension service-worker fetch to `/backend-api/wham/usage` passes Cloudflare (versus a content script in a chatgpt.com tab) is untested. Bare curl gets 403 on `/api/auth/session`, and I did not inspect the body.
- CORS headers of `wham/usage` were not checked (same-origin from a chatgpt.com tab makes this moot; the service worker relies on host_permissions).
- Access-token lifetime is not measured. Which account is the default for multi-workspace users, and how `ChatGPT-Account-Id` behaves then, is unconfirmed.
- No verified endpoint for classic chat caps (GPT-5 message caps), Deep Research or agent quotas. `/backend-api/conversation_limit` and `/backend-api/models` are only candidates.
- `code_review_rate_limit` is not in the official payload struct I read; it may be newer or renamed.
- The safe polling rate is a judgment call. Terms-of-service risk of reading undocumented endpoints with the user's own session was not assessed.

## EXPAND leads
- Read the current openai/codex Rust `backend-client` (`client.rs`, `types.rs`) for base-URL/path selection and the headers (`originator`, `User-Agent`) the official client sends.
- Inspect ViuMP/Walder (cookie session plus full parsing in `core/buckets.ts`), oscasrhiah/ai-quota-tracker, ttaatoo/quotabar and killervillsy/SessionToJson (extension popup).
- Check CodexBar (steipete) and its docs for per-plan window behavior.
- Read the OpenAI help center "Using Codex with your ChatGPT plan", the Codex changelog, and the community.openai.com thread "Flexible rate limit resets for Codex" (1383470).
- Watch the ChatGPT web app's network tab for real chat-cap endpoints; Walder's endpoint-discovery approach (recording only quota-like paths) is a good model.
- Look for 429/403 reports in issues of the tools above to size a safe polling interval.
