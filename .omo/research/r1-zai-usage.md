# r1: Z.ai GLM Coding Plan usage quota (5-hour / weekly windows)

Research date: 2026-10-01. Method: unauthenticated curl probes plus raw GitHub source of open-source tools. No web-search tool was available, so official docs were not consulted. All shape evidence is third-party code.

## Summary
- The quota endpoint is `GET https://api.z.ai/api/monitor/usage/quota/limit`. It is undocumented, exists, and answers HTTP 200 with a JSON `code:1001` body when no auth is sent. China uses the same path on `open.bigmodel.cn`.
- Auth is `Authorization: Bearer <API key>`. Current tools (pi-zai-usage, LogicIncZo/zai-usage) all use Bearer. Raw-key (no prefix) support is unverified.
- `data.limits[]` entries are distinguished by `type` plus `unit`. `TOKENS_LIMIT` unit 3 is the 5-hour window, `TOKENS_LIMIT` unit 6 is the weekly window, and `TIME_LIMIT` unit 5 is the monthly MCP/tool-call quota. `percentage` is an integer 0-100 (used) and `nextResetTime` is epoch milliseconds. `data.level` is the plan (e.g. "PRO").
- CORS is permissive. The server reflects any Origin, sends `Access-Control-Allow-Credentials: true`, and allows `GET` and the `authorization` header on preflight. An extension can call it directly with a user-pasted API key.
- The weekly window exists in 2026 but only on some plans, so the popup must render it when present and tolerate its absence. Launch date and eligible tiers are unconfirmed.
- Whether the web dashboard uses cookie/JWT instead of an API key is not confirmed.

## Findings
- CLAIM: The quota endpoint is GET https://api.z.ai/api/monitor/usage/quota/limit and exists; unauthenticated it returns HTTP 200 with body {"code":1001,"msg":"Authentication parameter not received in Header, unable to authenticate","success":false} | EVIDENCE: curl -s -i -H 'Origin: chrome-extension://abcdef' https://api.z.ai/api/monitor/usage/quota/limit -> "HTTP/1.1 200 OK ... {"code":1001,"msg":"Authentication parameter not received in Header, unable to authenticate","success":false}" (captured 2026-09-30 15:55 GMT) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: /api/monitor/usage/model-usage and /api/monitor/usage/tool-usage exist on api.z.ai and give the same code 1001 when unauthenticated | EVIDENCE: curl -s -i https://api.z.ai/api/monitor/usage/model-usage and .../tool-usage -> both return {"code":1001,"msg":"Authentication parameter not received in Header, unable to authenticate","success":false} | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: A nonexistent path returns {"code":500,"msg":"404 NOT_FOUND","success":false}, so the code-1001 answer proves the monitor routes are real | EVIDENCE: curl -s -i https://api.z.ai/api/nonexistent -> {"code":500,"msg":"404 NOT_FOUND","success":false} | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The China domain open.bigmodel.cn serves the same path; its error message is Chinese and names the header "Authorization" | EVIDENCE: curl -s -i https://open.bigmodel.cn/api/monitor/usage/quota/limit -> {"code":1001,"msg":"Header中未收到Authorization参数，无法进行身份验证。","success":false} | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Domain variants used by tools: api.z.ai (international) and open.bigmodel.cn (China), each with modelUsage, toolUsage and quotaLimit under /api/monitor/usage/ | EVIDENCE: https://raw.githubusercontent.com/guyinwonder168/opencode-glm-quota/HEAD/scripts/query-usage.mjs lines 35-42 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CORS: the server reflects the request Origin in Access-Control-Allow-Origin, sends Access-Control-Allow-Credentials: true, and adds Vary: Origin | EVIDENCE: curl -s -i -H 'Origin: chrome-extension://abcdef' https://api.z.ai/api/monitor/usage/quota/limit -> "Access-Control-Allow-Origin: chrome-extension://abcdef", "Access-Control-Allow-Credentials: true" | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CORS preflight is accepted: OPTIONS returns 200 with Access-Control-Allow-Methods: GET, Access-Control-Allow-Headers: authorization, Access-Control-Max-Age: 3600 | EVIDENCE: curl -s -i -X OPTIONS -H 'Origin: chrome-extension://abcdef' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization' https://api.z.ai/api/monitor/usage/quota/limit -> "HTTP/1.1 200 OK ... Access-Control-Allow-Methods: GET ... Access-Control-Allow-Headers: authorization ... Access-Control-Max-Age: 3600" | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The same CORS behavior holds on open.bigmodel.cn (Origin reflected, credentials true) | EVIDENCE: curl -s -i -H 'Origin: chrome-extension://abcdef' https://open.bigmodel.cn/api/monitor/usage/quota/limit -> "Access-Control-Allow-Origin: chrome-extension://abcdef" | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Responses set an acw_tc cookie (HttpOnly, Max-Age 1800), which looks like an Alibaba Cloud WAF cookie, and the JSON error does not require it | EVIDENCE: curl -s -i https://api.z.ai/api/monitor/usage/quota/limit -> "Set-Cookie: acw_tc=...;path=/;HttpOnly;Max-Age=1800" | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: The authenticated call uses `Authorization: Bearer <key>` in current tools | EVIDENCE: https://raw.githubusercontent.com/danielgap/pi-zai-usage/HEAD/lib/zai-usage.ts (fetchZaiUsage: headers: { Authorization: `Bearer ${key}` }); https://raw.githubusercontent.com/LogicIncZo/zai-usage/HEAD/zai-usage.ts line 198 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: opencode-glm-quota sends a variable `authToken` as the Authorization value; the grep output does not show whether it adds "Bearer", so a raw-key form may work | EVIDENCE: https://raw.githubusercontent.com/guyinwonder168/opencode-glm-quota/HEAD/scripts/query-usage.mjs line 166 `'Authorization': authToken,` | SOURCE DATE: 2026-09 | CONFIDENCE: low
- CLAIM: The response envelope is {code, msg, success, data:{level, limits[]}} | EVIDENCE: LogicIncZo/zai-usage zai-usage.ts demoQuota() (lines ~48-62): `{ code: 200, msg: "Operation successful", success: true, data: { level: "PRO", limits: [...] } }`; type RawZaiUsage in danielgap/pi-zai-usage lib/zai-usage.ts | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: A limits[] entry carries type, unit, percentage, nextResetTime; TOKENS_LIMIT is the token window and older plans labelled it CREDIT_LIMIT | EVIDENCE: danielgap/pi-zai-usage lib/zai-usage.ts (interface RawZaiLimit {type, unit, percentage, nextResetTime}; `entry.type !== "TOKENS_LIMIT" && entry.type !== "CREDIT_LIMIT"`; header comment "older plans labelled them CREDIT_LIMIT") | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: unit 3 = 5-hour rolling window (18000 s) and unit 6 = weekly window (604800 s), both type TOKENS_LIMIT | EVIDENCE: danielgap/pi-zai-usage lib/zai-usage.ts `ZAI_TOKEN_UNITS = new Map([[3, 18_000],[6, 604_800]])` with comment "3 is the 5-hour rolling window, 6 the weekly one"; LogicIncZo/zai-usage zai-usage.ts line 274 `QUOTA_LABELS = {3:"5-hour quota", 6:"Weekly quota", 5:"Monthly tool calls"}` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The API also gives a `number` field alongside unit (unit 3 number 5 = 5 hours; unit 6 number 1 = 1 week) | EVIDENCE: https://raw.githubusercontent.com/guyinwonder168/opencode-glm-quota/HEAD/CHANGELOG.md lines 73-77 ("unit: 3, number: 5 -> Token usage(5 Hour)"; "unit: 6, number: 1 -> Token usage(Weekly)") | SOURCE DATE: 2026 (exact month unknown) | CONFIDENCE: medium
- CLAIM: The weekly token quota was added to the API after the 5-hour one: the changelog says "API now returns multiple token limit windows" and fixes weekly being mislabelled as 5-hour (#26) | EVIDENCE: guyinwonder168/opencode-glm-quota CHANGELOG.md lines 73-87 | SOURCE DATE: 2026 (exact month unknown) | CONFIDENCE: medium
- CLAIM: The weekly window is plan-dependent ("on plans that have one") | EVIDENCE: https://raw.githubusercontent.com/ulmen/kilo-zai-usage/HEAD/README.md line 13 "Weekly quota and its reset time, on plans that have one" | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: `percentage` is the USED percent, an integer 0-100 (parsers name it usedPercent, clamp to 0-100, and flag limitReached at >= 100) | EVIDENCE: danielgap/pi-zai-usage lib/zai-usage.ts zaiWindow() and parseZaiUsage() | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `nextResetTime` is an epoch timestamp in MILLISECONDS (the parser subtracts it from a ms `now` and divides by 1000) | EVIDENCE: danielgap/pi-zai-usage lib/zai-usage.ts formatReset(): `Math.floor((resetAt - now) / 1000)`; header comment "epoch-millisecond resets" | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The monthly MCP/tool quota is `type:"TIME_LIMIT", unit:5` with currentValue, usage (the cap), remaining, percentage, usageDetails[{modelCode, usage}] (search-prime, web-reader, zread) and its own nextResetTime | EVIDENCE: LogicIncZo/zai-usage zai-usage.ts demoQuota() lines 57-59; QUOTA_LABELS unit 5 "Monthly tool calls" line 274 | SOURCE DATE: 2026-09 | CONFIDENCE: medium (field layout comes from a demo fixture)
- CLAIM: model-usage takes startTime and endTime query params formatted "YYYY-MM-DD HH:mm:ss" in UTC+8 (the tool builds stamps with +08:00) and returns rows with modelName, totalTokens, calls | EVIDENCE: LogicIncZo/zai-usage zai-usage.ts fetchModelUsage() (~line 327) and demoModelUsage() (`+ "+08:00"`) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: A separate authenticated endpoint GET https://api.z.ai/api/biz/customer-package-reset/list?targetType=PERSONAL returns lastFiveHourResetTime, lastWeekResetTime, fiveHourResets[] and weekResets[] ({recordId, expireTime, available}) with "YYYY-MM-DD HH:mm:ss" strings (treated as UTC+8); this belongs to the voucher node and is noted only for cross-reference | EVIDENCE: LogicIncZo/zai-usage zai-usage.ts line 6 and demoResets() lines 65-85 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: The quota endpoint needs only the API key that authenticates the coding API; the tools use no dashboard login | EVIDENCE: danielgap/pi-zai-usage lib/zai-usage.ts comment "the API key pi already holds is the only thing it needs" | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Active open-source consumers exist (pushed in 2026-09): LogicIncZo/zai-usage (2026-09-28), ulmen/kilo-zai-usage (2026-09-27), danielgap/pi-zai-usage (2026-09-25), guyinwonder168/opencode-glm-quota (2026-09-13) | EVIDENCE: curl -s 'https://api.github.com/search/repositories?q=zai+quota+usage+glm+coding+plan&per_page=15' -> pushed_at fields | SOURCE DATE: 2026-09 | CONFIDENCE: high

## Spec
Quota request:
```
GET https://api.z.ai/api/monitor/usage/quota/limit      (China: https://open.bigmodel.cn/api/monitor/usage/quota/limit)
Authorization: Bearer <Z.ai API key>
Accept: application/json
```
No query params. Call it with `fetch` from the extension service worker. Add `https://api.z.ai/*` (and `https://open.bigmodel.cn/*` for China) to `host_permissions`. CORS also passes from any origin. Failure is signalled in the body (`success:false`, `code:1001` = auth missing) while the HTTP status stays 200, so check `body.success`.

Realistic response (layout from tool fixtures and parsers; values are illustrative):
```json
{
  "code": 200,
  "msg": "Operation successful",
  "success": true,
  "data": {
    "level": "PRO",
    "limits": [
      { "type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 47,
        "nextResetTime": 1790790000000 },
      { "type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 18,
        "nextResetTime": 1791300000000 },
      { "type": "TIME_LIMIT", "unit": 5, "number": 1, "percentage": 38,
        "currentValue": 38, "usage": 100, "remaining": 62,
        "usageDetails": [ { "modelCode": "search-prime", "usage": 31 },
                          { "modelCode": "web-reader", "usage": 5 },
                          { "modelCode": "zread", "usage": 2 } ],
        "nextResetTime": 1792200000000 }
    ]
  }
}
```
Field meanings:
- `data.level`: plan tier string (e.g. "PRO"; other values are likely but unconfirmed).
- `type`: TOKENS_LIMIT (token quota; older plans CREDIT_LIMIT) or TIME_LIMIT (MCP/tool-call count).
- `unit`: window class. 3 = 5-hour rolling, 6 = weekly, 5 = monthly tool calls. Identify a window by `type`+`unit`, never by array order.
- `number`: window length in units (5 for the 5-hour, 1 for the week); confirmed only via the opencode-glm-quota changelog.
- `percentage`: integer percent USED (0-100). The parsers examined show no absolute token counts for TOKENS_LIMIT.
- `nextResetTime`: epoch milliseconds, an absolute UTC instant, so no timezone conversion is needed. Optional.
- `currentValue` / `usage` / `remaining` (TIME_LIMIT): calls used, cap, calls left. `usageDetails`: per-tool breakdown.

Popup mapping: 5-hour = TOKENS_LIMIT with unit 3; weekly = TOKENS_LIMIT with unit 6 (show "no weekly limit" if missing); countdown = `nextResetTime - Date.now()`.

Other endpoints (same host and auth):
- `GET /api/monitor/usage/model-usage?startTime=YYYY-MM-DD HH:mm:ss&endTime=...` (URL-encoded, UTC+8 wall clock) gives per-model totalTokens and calls.
- `GET /api/monitor/usage/tool-usage?startTime=...&endTime=...` for MCP tool calls (params assumed to match model-usage; response shape not captured).

## Unverified / open questions
- No official Z.ai documentation for the monitor endpoints was read. All shape evidence is third-party, and Z.ai may change fields without notice.
- I never used credentials, so the live response, `number`, real `usage`/`remaining` for TOKENS_LIMIT, and exact plan-level strings are unobserved.
- Bearer versus raw key: current tools use Bearer. Whether a bare key is accepted is unknown (opencode-glm-quota line 166 is ambiguous).
- The weekly limit's launch date and eligible tiers (Lite/Pro/Max, new versus old subscribers) were not found. The changelog lines read carry no date.
- Whether the weekly window draws on the same token pool as the 5-hour window is unknown.
- Dashboard (z.ai web) auth was not inspected. It probably uses a login session (cookie/JWT). Unconfirmed.
- Any rate limit on polling this endpoint is unknown.
- open.bigmodel.cn uses separate keys from international Z.ai, and its response shape was not compared.
- The `tool-usage` response shape and current `TIME_LIMIT` numbers are unconfirmed.

## EXPAND leads
- Read the full source of https://github.com/danielgap/pi-zai-usage, https://github.com/LogicIncZo/zai-usage and https://github.com/guyinwonder168/opencode-glm-quota (CHANGELOG.md, docs/, issue #26) for dated real-response fixtures and the weekly launch date.
- Check the Z.ai docs and changelog for the GLM Coding Plan (docs.z.ai, "usage limits", "weekly quota") and Z.ai announcements for the weekly-limit rollout.
- Capture the z.ai dashboard's own XHR calls to learn cookie versus token auth; GitHub code search for `customer-package-reset` and `monitor/usage` needs a logged-in session (the unauthenticated search API returned 401).
- Other consumers: n1majne3/zai-quota-hud, slivenred/zai-quota-monitor, Fahim-Yusuf/zai-glm-usage-tracker, zeljkoavramovic/glm-quota, victorhdchagas/zai_quotecheck, tissak/sketchybar-zai-quota.
