# r3 - Lead direct re-check (2026-09-30 16:27 GMT, curl -m 20, no credentials)

## Unauthenticated probes (unique temp file per probe)
- claude orgs: HTTP/1.1 403 Forbidden, Cf-Mitigated: challenge, text/html "Just a moment..."
- chatgpt wham/usage: 401 application/json | {"detail":"Unauthorized"}
- chatgpt reset-credits: 401 application/json | {"detail":"Unauthorized"}
- chatgpt bogus sibling: 404 application/json | {"detail":"Not Found"}
- zai quota: 200 application/json | {"code":1001,"msg":"Authentication parameter not received in Header, unable to authenticate","success":false}
- zai bogus: 200 application/json | {"code":500,"msg":"404 NOT_FOUND","success":false}
- zai reset list (bad bearer): 200 application/json | {"code":401,"msg":"token expired or incorrect","success":false}
- poe balance / history: 401 {"error":{"type":"authentication_error","code":"invalid_api_key"}}
- openrouter /api/v1/key: 401; /api/v1/keys: 401 "Missing Authentication header"
- status.claude.com/api/v2/incidents.json: 200 application/json (page tymt9n04zgry, time_zone Etc/UTC)

Reading: chatgpt wham/usage and wham/rate-limit-reset-credits are real authenticated routes (401 vs 404 for a bogus sibling). Z.ai returns app-level errors in HTTP 200 bodies (1001 no header, 401 bad token, 500 "404 NOT_FOUND" for a bogus route), so body.success must be checked.

## Source greps (raw.githubusercontent.com, HEAD/main, 2026-09-30)
### CodexBar ClaudeRateLimitResetCredits.swift
https://raw.githubusercontent.com/steipete/CodexBar/HEAD/Sources/CodexBarCore/Providers/Claude/ClaudeRateLimitResetCredits.swift
200 lines=154
12:    /// Expiry of each reset available at `updatedAt`; a grant with `resets_left: 2` contributes two entries.
55:/// Raw `cedar_ember` block. Only `eligible: true` yields an inventory. A malformed grant is dropped
64:    let eligible: Bool
68:        case eligible
74:        self.eligible = try container.decode(Bool.self, forKey: .eligible)

### CodexBar ClaudeWebAPIFetcher.swift
https://raw.githubusercontent.com/steipete/CodexBar/HEAD/Sources/CodexBarCore/Providers/Claude/ClaudeWeb/ClaudeWebAPIFetcher.swift
200 lines=1512
21:    /// For the usage response, whose `cedar_ember` block carries grant identifiers. The shared client's disk
111:/// - `GET https://claude.ai/api/organizations/{org_id}/usage` → usage percentages + reset times
200:        /// Whether the API reported a `five_hour` session object. When `false` (the API sent
201:        /// `five_hour: null`, as enterprise/credit accounts with no live session do), `sessionPercentUsed`
618:        // `cedar_ember=1` asks this usage response to include limit-reset grants in a `cedar_ember` block.

### openai/codex backend-client types.rs
https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/types.rs
200 lines=664
24:    pub available_count: i64,
30:    pub available_count: i64,
36:    pub reset_type: String,
38:    pub granted_at: String,
39:    pub expires_at: Option<String>,

### openai/codex rate_limit_resets.rs
https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client/rate_limit_resets.rs
200 lines=159
89:    pub async fn consume_rate_limit_reset_credit(
93:        self.consume_rate_limit_reset_credit_request(redeem_request_id, /*credit_id*/ None)
97:    pub async fn consume_rate_limit_reset_credit_by_id(
102:        self.consume_rate_limit_reset_credit_request(redeem_request_id, Some(credit_id))
106:    async fn consume_rate_limit_reset_credit_request(

### LogicIncZo zai-usage.ts
https://raw.githubusercontent.com/LogicIncZo/zai-usage/main/zai-usage.ts
200 lines=1466
6:const RESETS_URL = "https://api.z.ai/api/biz/customer-package-reset/list?targetType=PERSONAL";
71:      fiveHourResets: [
72:        { recordId: 910001, expireTime: "2026-10-18 23:59:59", available: false },
73:        { recordId: 910002, expireTime: "2026-11-07 23:59:59", available: true },
74:        { recordId: 910003, expireTime: "2026-11-07 23:59:59", available: true },

### pi-zai-usage lib/zai-usage.ts
https://raw.githubusercontent.com/danielgap/pi-zai-usage/HEAD/lib/zai-usage.ts
200 lines=286
43:	[3, 18_000],
44:	[6, 604_800],
79:	nextResetTime?: number;
94:	if (entry.type !== "TOKENS_LIMIT" && entry.type !== "CREDIT_LIMIT")
103:		resetAt: typeof entry.nextResetTime === "number" ? entry.nextResetTime : null,

### codenotch claude-resets.md
https://raw.githubusercontent.com/vinzdg/codenotch/HEAD/docs/providers/claude-resets.md
200 lines=69
4:one unused promotional reset expiring October 22. A read-only inspection of
5:their usage responses identified the optional `cedar_ember` block:
9:  "cedar_ember": {
14:      "resets_left": 1,
25:`GET /api/organizations/<organization>/usage?cedar_ember=1&skip_spend=1`.

### claude-monitor background.js
https://raw.githubusercontent.com/claude-monitor/claude-monitor-browser-extension/HEAD/extension/background.js
200 lines=853
13:// NOT in /usage. The route 404s without the ccr-triggers beta + anthropic-version
163:      usage = await fetchClaudeJson(`${API_BASE}/organizations/${orgId}/usage`);
170:        usage = await fetchClaudeJson(`${API_BASE}/organizations/${retriedOrgId}/usage`);
268:    credentials: 'include',
287:  const session = pickBucket(scoped.session, usage?.five_hour);

### opencodex anthropic-reset-grants.ts
https://raw.githubusercontent.com/lidge-jun/opencodex/HEAD/src/providers/anthropic-reset-grants.ts
200 lines=329
2: * Anthropic usage-limit reset grants (upstream program `cedar_ember`).
4: * Claude Pro/Max/Team subscriptions can carry a one-time grant that clears the
8: * - read:   GET  /api/oauth/usage?cedar_ember=1&skip_spend=1  (block `cedar_ember`)
10: * - redeem: POST /api/organizations/{org}/reset_rate_limits
11: *           body {program:"cedar_ember", grant_id, request_id}

### litellm internal_user_endpoints.py
https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/proxy/management_endpoints/internal_user_endpoints.py
200 lines=3096
1085:    `/user/daily/activity` or `/user/daily/activity/aggregated`, which read daily spend
2873:    "/user/daily/activity",
2907:    include_current_utc_day: bool = fastapi.Query(
2980:            include_current_utc_day=include_current_utc_day,
2995:    "/user/daily/activity/aggregated",
