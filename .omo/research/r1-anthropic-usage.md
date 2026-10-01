# r1 - Anthropic (claude.ai) usage limits for a browser extension

Research date: 2026-10-01. Method: unauthenticated curl probes plus reading current GitHub source via raw.githubusercontent.com and the GitHub API. No web-search/web-fetch tool was available to this agent, so official docs and the claude.ai Settings page were NOT read directly. The per-field response shape below is inferred from extension source code, not from a captured live response (no credentials were used).

## Summary
- The claude.ai web endpoint is `GET https://claude.ai/api/organizations/{org_uuid}/usage`. Cookie-authenticated (`credentials:'include'`), no custom headers needed. Current in claude-monitor extension v1.14.3 (repo pushed 2026-08-30).
- org_uuid comes from `GET https://claude.ai/api/organizations` (array; take the org whose `capabilities` includes `chat`; field `uuid`). That response also carries `rate_limit_tier` and `capabilities` (plan: Pro/Max 5x/Max 20x).
- Buckets: legacy flat `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_omelette`, `extra_usage`, each `{utilization, resets_at}`. Since about 2026-07 there is also a `limits` array (`kind` = session | weekly_all | weekly_scoped, `percent`, `resets_at`, `scope.model.display_name`) which the Settings > Usage page uses. Prefer it, fall back to the flat buckets. Utilization is a percent (0-100, can exceed 100 with overage); `resets_at` is an ISO-8601 string parsed with `Date.parse`; a bucket is null or has null `resets_at` when the window is not started.
- A Chrome MV3 extension can do this from its service worker with host_permissions for claude.ai and `credentials:'include'`; sessionKey rides along as an HttpOnly cookie. Two shipping extensions do so. A plain curl without a browser is blocked by a Cloudflare challenge (403).
- The OAuth route `api.anthropic.com/api/oauth/usage` exists (curl returned a Cloudflare-fronted JSON 429 rate_limit_error with `Retry-After: 3600`, unauthenticated) but I found no current open-source code confirming its response shape. It needs a Claude Code OAuth token, which an extension cannot obtain legitimately. Not recommended.
- Poll every 5 minutes via chrome.alarms (claude-monitor default); 2 minutes default / 60 s minimum in another tool. Back off exponentially on 401/403.

## Findings
- CLAIM: The usage endpoint is GET https://claude.ai/api/organizations/{orgId}/usage, called from an MV3 service worker | EVIDENCE: https://raw.githubusercontent.com/claude-monitor/claude-monitor-browser-extension/HEAD/extension/background.js (API_BASE='https://claude.ai/api'; line ~205 `fetchClaudeJson(`${API_BASE}/organizations/${orgId}/usage`)`) | SOURCE DATE: 2026-08 | CONFIDENCE: high
- CLAIM: The extension's host_permissions are only claude.ai/api/organizations, .../organizations/*/usage, .../prepaid/credits, .../overage_spend_limit and /v1/code/routines/run-budget; permissions are just storage + alarms (no cookies permission needed) | EVIDENCE: https://raw.githubusercontent.com/claude-monitor/claude-monitor-browser-extension/HEAD/extension/manifest.json (v1.14.3) | SOURCE DATE: 2026-08 | CONFIDENCE: high
- CLAIM: Auth is via browser cookies: fetch uses `credentials:'include'` with only `Accept: application/json, text/plain, */*`; no anthropic-client-* headers are sent | EVIDENCE: claude-monitor background.js `fetchClaudeJson` (lines ~264-282) | SOURCE DATE: 2026-08 | CONFIDENCE: high
- CLAIM: Another extension instead reads the `sessionKey` cookie via chrome.cookies.get({url:'https://claude.ai',name:'sessionKey'}) and sends `cookie: sessionKey=...` explicitly to /api/organizations/{orgId}/usage | EVIDENCE: https://raw.githubusercontent.com/yahyashareef48/claude-usage-monitor/HEAD/chrome-extension/background.js (lines ~84-98) | SOURCE DATE: 2026-09 | CONFIDENCE: medium (repo pushed 2026-09-19; file line numbers from grep)
- CLAIM: org_uuid discovery: GET https://claude.ai/api/organizations returns an array (or {organizations:[...]}); pick the org whose capabilities includes 'chat', else first; id field is `uuid` (fallbacks organization_uuid, id); cached 24 h, cache cleared and re-fetched on a 404 from /usage | EVIDENCE: claude-monitor background.js `getClaudeOrgId`/`selectOrg` (lines ~213-235) | SOURCE DATE: 2026-08 | CONFIDENCE: high
- CLAIM: The yahyashareef48 extension also captures orgId from request URLs via a webRequest filter on `*://claude.ai/api/*` (alternative discovery) | EVIDENCE: yahyashareef48 chrome-extension/background.js lines ~43-61 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: The organizations payload carries `rate_limit_tier` (contains max_20x / max_5x / max / team / enterprise / pro / free|default) and `capabilities` (claude_max, claude_pro, chat) used to derive the plan label | EVIDENCE: claude-monitor background.js `planLabel`/`derivePlan` (lines ~240-262) | SOURCE DATE: 2026-08 | CONFIDENCE: high
- CLAIM: Flat response fields consumed: five_hour, seven_day, seven_day_opus, seven_day_sonnet, seven_day_omelette (each {utilization, resets_at}), extra_usage | EVIDENCE: claude-monitor background.js `mapApiUsageToStoredShape` lines 286-324 | SOURCE DATE: 2026-08 | CONFIDENCE: high
- CLAIM: A `limits` array was added to /usage around 2026-07 and is "what claude.ai/settings/usage renders": items `{kind, group, percent, severity, resets_at, scope, is_active}`, kind in session | weekly_all | weekly_scoped; per-model caps (e.g. "Fable") exist only there with scope.model.display_name; the extension prefers it and falls back to flat buckets | EVIDENCE: claude-monitor background.js comments lines 333-364 (`mapLimitsArray`, `pickBucket`) | SOURCE DATE: 2026-08 | CONFIDENCE: medium (comment by a third-party author, no captured JSON)
- CLAIM: Utilization is a percentage number 0-100, not 0-1; it can exceed 100 during overage so the extension clamps to 100; null bucket means it does not apply to the plan | EVIDENCE: claude-monitor background.js `normalizePct` lines 806-816 (`Math.min(num,100)`, null handling comment) | SOURCE DATE: 2026-08 | CONFIDENCE: medium-high (inferred from client clamp, not from a raw payload)
- CLAIM: resets_at is a string parsed by Date.parse (so ISO-8601 with offset/Z); it carries sub-second jitter between calls, so a new window must be detected by rounding/tolerance, not equality | EVIDENCE: claude-monitor background.js `parseApiTime` lines 488-492 and comment at line ~670 | SOURCE DATE: 2026-08 | CONFIDENCE: medium (exact timezone suffix not captured)
- CLAIM: When a window has not started, resets_at is null ("Not yet used" label for session; five_hour bucket may be null) | EVIDENCE: claude-monitor background.js lines 293-322 (`label: session?.resets_at ? null : 'Not yet used'`) | SOURCE DATE: 2026-08 | CONFIDENCE: medium
- CLAIM: extra_usage money values are in cents (comment "10197/10000 ="), scoped to the signed-in member; used_credits/monthly_limit used to compute utilization; extra endpoints exist: /api/organizations/{id}/overage_spend_limit and /prepaid/credits | EVIDENCE: claude-monitor background.js lines 180-185, 366-385, 458; manifest host_permissions | SOURCE DATE: 2026-08 | CONFIDENCE: medium
- CLAIM: Unauthenticated curl to https://claude.ai/api/organizations and /api/bootstrap returns HTTP 403 with `Cf-Mitigated: challenge`, `Server: cloudflare`, body "Just a moment..." (Cloudflare managed challenge) | EVIDENCE: `curl -s -i https://claude.ai/api/organizations` captured 2026-09-30 15:55 GMT: `HTTP/1.1 403 Forbidden ... Cf-Mitigated: challenge ... Server: cloudflare ... <title>Just a moment...</title>` (same for /api/bootstrap) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Extensions avoid the challenge because requests go out from the user's real browser with its cf_clearance/__cf_bm cookies and TLS fingerprint; both shipping extensions do plain fetch from the service worker with no extra bypass | EVIDENCE: claude-monitor background.js `fetchClaudeJson`; yahyashareef48 background.js (fetch with cookie header) | SOURCE DATE: 2026-09 | CONFIDENCE: medium (inference: the extensions work in production; no vendor statement)
- CLAIM: claude-monitor treats HTTP 401/403 as auth failure and backs off 2^fails-1 polling ticks (max 6 fails, ~5 h at 5-min poll) | EVIDENCE: claude-monitor background.js lines 122-140 | SOURCE DATE: 2026-08 | CONFIDENCE: high
- CLAIM: Poll intervals in practice: 5 min via chrome.alarms (claude-monitor, POLL_MIN=5); VS Code tool default 120 s, min 60 s, max 3600 s | EVIDENCE: claude-monitor background.js line 7; yahyashareef48 src/extension.ts lines 10-12 | SOURCE DATE: 2026-09 | CONFIDENCE: high (as observed practice; no official rate limit published)
- CLAIM: https://api.anthropic.com/api/oauth/usage exists behind Cloudflare; unauthenticated call returned HTTP 429 JSON `{"error":{"type":"rate_limit_error","message":"Rate limited. Please try again later."}}` with `Retry-After: 3600` (not 401, so existence is shown but auth behaviour was not clean-confirmed) | EVIDENCE: `curl -s -i https://api.anthropic.com/api/oauth/usage` captured 2026-09-30 15:55 GMT | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: A currently maintained open-source device (usage-chan) does NOT call /api/oauth/usage; it POSTs a 1-token message to the Messages endpoint with `Authorization: Bearer <oauth token>`, `anthropic-version`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: claude-code/2.1.5`, then reads `anthropic-ratelimit-unified-5h-utilization`, `-7d-utilization`, `-overage-utilization`, `-representative-claim` and reset headers; utilization there is a 0.0-1.0 fraction converted to percent | EVIDENCE: https://raw.githubusercontent.com/jplummer/usage-chan/HEAD/src/api.cpp (lines 5-36, 104-150, 178; vendored from github.com/oauramos/claude-usage-stick) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The OAuth route needs a Claude Code OAuth token (stored by the CLI locally); a web extension has no legitimate way to obtain it, and probing via the Messages endpoint consumes quota and an impersonated claude-code User-Agent | EVIDENCE: usage-chan api.cpp lines 117-121 (token + UA header, POST body max_tokens:1) | SOURCE DATE: 2026-09 | CONFIDENCE: medium (reasoned conclusion)

## Spec

### A. Recommended: claude.ai web API (cookie session)
Preconditions: user is logged in to claude.ai in the same Chrome profile; manifest has `host_permissions: ["https://claude.ai/api/organizations", "https://claude.ai/api/organizations/*/usage"]` (claude-monitor's exact minimal set, plus optional extras) and permissions `storage`, `alarms`.

1. Discover org:
   - `GET https://claude.ai/api/organizations`
   - `fetch(url,{method:'GET',credentials:'include',headers:{Accept:'application/json, text/plain, */*'}})` from the service worker.
   - Response: array of orgs, each with `uuid`, `capabilities` (e.g. ["chat","claude_pro"] or "claude_max"), `rate_limit_tier` (string containing `max_5x`, `max_20x`, `pro`, `team`, ...). Choose the org with `capabilities` containing `chat`; else first. Cache `uuid` up to 24 h; on 404 re-discover.
2. Usage:
   - `GET https://claude.ai/api/organizations/{uuid}/usage` with the same fetch options. No `anthropic-client-*` header needed per claude-monitor.
3. Status handling: 401/403 -> logged out or Cloudflare challenge: show "open claude.ai", back off exponentially; 404 -> stale org id; other -> transient.
4. Cookies: `sessionKey` (HttpOnly) is attached automatically when `credentials:'include'` and claude.ai host permission is granted. Reading it manually needs the `cookies` permission (only one of two extensions does that); avoid, it is unnecessary and more invasive.

Reconstructed response (shape from client code, values illustrative - NOT a captured live payload):
```json
{
  "five_hour":  { "utilization": 37.0, "resets_at": "2026-10-01T05:00:00.123456+00:00" },
  "seven_day":  { "utilization": 12.0, "resets_at": "2026-10-06T09:00:00.123456+00:00" },
  "seven_day_opus":   null,
  "seven_day_sonnet": { "utilization": 5.0, "resets_at": "2026-10-06T09:00:00+00:00" },
  "seven_day_omelette": null,
  "extra_usage": { "is_enabled": true, "monthly_limit": 10000, "used_credits": 10197, "utilization": 101.97 },
  "limits": [
    { "kind": "session",       "group": "...", "percent": 37.0, "severity": "...", "resets_at": "2026-10-01T05:00:00+00:00", "scope": null, "is_active": true },
    { "kind": "weekly_all",    "percent": 12.0, "resets_at": "2026-10-06T09:00:00+00:00" },
    { "kind": "weekly_scoped", "percent": 5.0,  "resets_at": "2026-10-06T09:00:00+00:00", "scope": { "model": { "display_name": "Sonnet" } } }
  ]
}
```
Field meaning:
- `five_hour` / `limits[kind=session]`: rolling 5-hour session window; percent used 0-100 (may exceed 100 in overage); `resets_at` = when window ends (null if no active window).
- `seven_day` / `limits[kind=weekly_all]`: 7-day all-models cap.
- `seven_day_opus`, `seven_day_sonnet`, `limits[kind=weekly_scoped].scope.model.display_name`: per-model weekly sub-caps; null when not applicable to plan. No flat `seven_day_fable`; Fable exists only in `limits`.
- `seven_day_omelette`: unknown-purpose bucket the extension maps to a "design" card (name is an internal codename).
- `extra_usage`: extra-usage credits; money in cents; scoped to the signed-in member; null when suspended (then use /overage_spend_limit).
- `resets_at`: ISO-8601 string; parse with `Date.parse`; exact offset (Z vs +00:00) unconfirmed, treat as absolute instant. Has sub-second jitter; round to the minute before comparing.
- `seven_day_oauth_apps` (named in the brief): NOT seen in current client code; unconfirmed, ignore unless it appears.

Polling: 5 min via `chrome.alarms.create(name,{periodInMinutes:5})` (alarms minimum is 30 s in Chrome 120+, use >= 1 min). Also refresh on popup open with a short debounce (e.g. 30-60 s). Do not go below 60 s (no published limit; the shipping tools use 60 s as floor).

### B. OAuth route (not recommended for extension)
- `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <Claude Code OAuth access token>`, `anthropic-beta: oauth-2025-04-20`. Existence shown by curl 429 (see findings). Response shape not confirmed in this research.
- Alternative observed in code: POST Messages with OAuth bearer and read `anthropic-ratelimit-unified-{5h,7d,overage}-{utilization,reset,status}` and `-representative-claim` headers; utilization is 0.0-1.0 here (opposite scale to the web endpoint). Costs a real (1-token) request.
- The token lives in the Claude Code CLI credential store on disk; Chrome extensions cannot read it (no file access; native messaging host would be required). Conclusion: skip, use A.

### C. Cloudflare behaviour
- Non-browser clients get `403` + `Cf-Mitigated: challenge` (verified by curl).
- Service-worker fetch with host permission and the user's cookies works in production extensions (claude-monitor v1.14.3). Content-script fetch from a claude.ai tab is same-origin and therefore also works (yahyashareef48 ships a content.js, content not read). Neither was tested by me with credentials; if the challenge ever triggers for the worker (403 HTML), fallback is to run the fetch from a content script in an open claude.ai tab or to ask the user to open claude.ai to refresh the clearance cookie.

### D. Settings > Usage page
Not read directly. Per the claude-monitor comment, `claude.ai/settings/usage` renders the `limits` array (session, weekly all-models, weekly per-model, each with percent and reset time), plus extra-usage credits. Treated as medium confidence.

## Unverified / open questions
- No authenticated live response was captured; all field semantics come from third-party client code. Exact key list of the current `limits` array items (group, severity values) is unknown.
- Exact resets_at format (Z vs +00:00, microseconds) and timezone: assumed UTC instant; not observed.
- Whether utilization is integer or float, and whether it is percent for every bucket in raw payload (client clamps to 100, suggesting percent); `limits[].percent` vs flat `utilization` both percent per client code.
- `seven_day_oauth_apps` field: not found in any current code I read.
- `anthropic-client-*` headers: claude-monitor sends none and works, so they appear not required; I did not test.
- The shape/behaviour of `/api/oauth/usage` (required headers, response JSON, rate limit) is unconfirmed; only the unauthenticated 429 was seen. The `Retry-After: 3600` hints at strict rate limiting.
- Content-script vs service-worker Cloudflare differences were not tested; evidence is only that extensions using the service worker ship in production.
- Anthropic's terms of service regarding automated use of internal endpoints were not reviewed. Endpoints are undocumented and have changed (e.g. `limits` array added ~2026-07), so expect breakage.
- Official docs/changelog and the Settings > Usage UI text were not fetched (no web tool available).

## EXPAND leads
- Read claude-monitor `popup.js` and docs for displayed labels, and https://claude-monitor.com/ for changelog of API shape changes.
- Read yahyashareef48 `chrome-extension/content.js` and `background.js` for the content-script path and any header requirements.
- GitHub code search `"organizations" "usage" "five_hour"` and `"oauth/usage"` (needs authenticated GitHub API, not available here) to find a captured raw JSON example, e.g. in test fixtures.
- Check candidates found via repo search: dturovskiy/deus-ai-limits-extension (2026-08), PanithanNanti/claude-usage-widget (2026-09), lapurryt/LimitsChecker, njsm8/ClaudeUsageBar, developer0hye/minimal-claude-hud (pushed 2026-09-28; may use /api/oauth/usage).
- Anthropic support articles on usage and length limits, and Claude Code docs (`/usage`, `/status`) for what the official UI shows.
- Reset vouchers/limit-reset gifts: out of scope here (other node).
