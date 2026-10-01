## Summary
- Z.ai exposes a distinct authenticated `customer-package-reset/list?targetType=PERSONAL` endpoint whose current open-source client calls it as “RESET PACKS”; this is the strongest machine-readable lead for occasional Coding Plan reset grants.
- The current client schema has separate `fiveHourResets` and `weekResets` arrays with `recordId`, UTC+8-like `expireTime`, and `available`; it also reports last-used reset times. A new `available:true` record is the best immediate signal.
- Treat the endpoint as a reset-pack inventory, not proof that Z.ai grants it to every subscriber: the publicly available schema fixture is not a captured production entitlement and no official 2025-2026 grant announcement was found in this review.
- Poll/reset endpoint comparison while the user is authenticated is more reliable than email, dashboard UI scraping, Discord/X/WeChat monitoring, or inferring a provider-wide reset from quota changes.
- No public evidence here establishes an activation/redeem POST. `available` indicates an unused pack; whether use is automatic or dashboard-triggered remains unverified.
- The normal quota response is still useful corroboration: units 3 and 6 identify the five-hour and weekly token windows and include `nextResetTime`, but it does not expose reset-pack inventory in the reviewed implementation.

## Findings
- CLAIM: `GET https://api.z.ai/api/biz/customer-package-reset/list?targetType=PERSONAL` is an authenticated Z.ai endpoint specifically used by a current open-source Coding Plan client to fetch reset packs. | EVIDENCE: https://github.com/LogicIncZo/zai-usage/blob/main/zai-usage.ts#L5-L6 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The reset-pack client sends `Authorization: Bearer <API key>` when requesting the personal reset list. | EVIDENCE: https://github.com/LogicIncZo/zai-usage/blob/main/zai-usage.ts#L629-L630 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: An unauthenticated probe of the personal reset-list URL returned HTTP 200 with JSON `{"code":1001,"msg":"Authentication parameter not received in Header, unable to authenticate","success":false}`; the route exists and requires Authorization. | EVIDENCE: curl -sS --max-time 20 'https://api.z.ai/api/biz/customer-package-reset/list?targetType=PERSONAL' => {"code":1001,"msg":"Authentication parameter not received in Header, unable to authenticate","success":false} | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The reviewed reset-list schema contains `lastFiveHourResetTime`, `lastWeekResetTime`, `fiveHourResets`, and `weekResets`. | EVIDENCE: https://github.com/LogicIncZo/zai-usage/blob/main/zai-usage.ts#L66-L82 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: Each illustrated reset-pack record has `recordId`, `expireTime`, and boolean `available`; the client filters `available` records to count usable reset packs. | EVIDENCE: https://github.com/LogicIncZo/zai-usage/blob/main/zai-usage.ts#L71-L81 and https://github.com/LogicIncZo/zai-usage/blob/main/zai-usage.ts#L970-L983 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: The client presents reset packs separately for five-hour and weekly windows, so an extension should preserve that scope rather than label every grant as a generic quota reset. | EVIDENCE: https://github.com/LogicIncZo/zai-usage/blob/main/zai-usage.ts#L479-L482 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: Z.ai's current Coding Plan quota endpoint is `GET https://api.z.ai/api/monitor/usage/quota/limit` and accepts an Authorization header. | EVIDENCE: https://github.com/slkiser/opencode-quota/blob/main/src/lib/zai.ts#L4-L10 and https://github.com/slkiser/opencode-quota/blob/main/src/lib/glm-coding-plan.ts#L26-L33 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The quota client maps token-limit records with `unit===3` to five-hour and `unit===6` to weekly, and converts `nextResetTime` to an ISO reset instant. | EVIDENCE: https://github.com/slkiser/opencode-quota/blob/main/src/lib/glm-coding-plan.ts#L52-L76 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: An unauthenticated quota probe returned `code:1001` and `success:false`, confirming the live endpoint requires Authorization. | EVIDENCE: curl -sS --max-time 20 'https://api.z.ai/api/monitor/usage/quota/limit' => {"code":1001,"msg":"Authentication parameter not received in Header, unable to authenticate","success":false} | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The China-domain equivalent `https://open.bigmodel.cn/api/monitor/usage/quota/limit` returned the same unauthenticated-authentication failure in Chinese, showing a parallel BigModel/Zhipu monitor route exists. | EVIDENCE: curl -sS --max-time 20 'https://open.bigmodel.cn/api/monitor/usage/quota/limit' => {"code":1001,"msg":"Header中未收到Authorization参数，无法进行身份验证。","success":false} | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The reviewed Z.ai quota parser accepts either `data.limits` or top-level `limits`, and recognizes `TOKENS_LIMIT`, `CREDIT_LIMIT`, and `TIME_LIMIT`; do not hard-code a single envelope or only token quota types. | EVIDENCE: https://github.com/slkiser/opencode-quota/blob/main/src/lib/glm-coding-plan.ts#L45-L75 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: No official Z.ai/bigmodel.cn public source reviewed here confirms a 2025-2026 provider-wide reset campaign, compensation formula, email/dashboard/Discord/X/WeChat notification channel, or a voucher redemption action. | EVIDENCE: public-web review recorded in this report; no corroborating official URL located | SOURCE DATE: 2026-09 | CONFIDENCE: medium

## Spec - the concrete, copy-ready details: method, URL, auth/headers, request params, a realistic response JSON example with every field and its meaning/unit/timezone

**Ranked detection method 1 (recommended; direct entitlement state).** On popup open and authenticated refresh, request:

```http
GET https://api.z.ai/api/biz/customer-package-reset/list?targetType=PERSONAL
Authorization: Bearer <Z.ai Coding Plan API key>
Accept: application/json
```

`targetType=PERSONAL` is required by the current public client. Do not infer grants from an HTTP 200: API-level `success` must be true. Keep the previous successful normalized inventory in extension storage. Immediately display a “Z.ai reset pack granted” event when a previously absent `recordId` appears, or a known record changes `available:false -> true`. Display a warning for every `available:true` record and include its expiry. This detects a user-specific grant as soon as the next authenticated refresh receives it; it does not require an email or a human noticing a dashboard banner.

Realistic **schema example reconstructed from the current public client's explicitly marked demo fixture, not a captured subscriber response**:

```json
{
  "code": 200,
  "success": true,
  "data": {
    "customerId": 41002358991004410,
    "targetType": "PERSONAL",
    "organizationId": null,
    "projectId": null,
    "lastFiveHourResetTime": "2026-09-11 06:02:16",
    "lastWeekResetTime": null,
    "fiveHourResets": [
      { "recordId": 910002, "expireTime": "2026-11-07 23:59:59", "available": true }
    ],
    "weekResets": [
      { "recordId": 920001, "expireTime": "2026-11-07 23:59:59", "available": true }
    ]
  }
}
```

Field meanings: `code` is application status (200 in the fixture); `success` is the application success boolean; `customerId` identifies the account (preserve as a string because it can exceed JavaScript safe-integer range); `targetType` scopes the query; `organizationId`/`projectId` scope non-personal contexts when non-null; `lastFiveHourResetTime` and `lastWeekResetTime` are last-use/reset timestamps; `fiveHourResets` and `weekResets` are inventories scoped to those windows; `recordId` is the durable comparison key; `available=true` means unused/usable according to the client; `expireTime` is pack expiry. The client parses these date strings as UTC+8, so interpret unoffset strings as `Asia/Shanghai` (`UTC+08:00`) and render in the user's timezone while retaining the raw stri
ng.

**Ranked detection method 2 (corroboration).** Request quota immediately after a detected pack change and compare before/after:

```http
GET https://api.z.ai/api/monitor/usage/quota/limit
Authorization: Bearer <Z.ai Coding Plan API key>
Content-Type: application/json
User-Agent: <extension name/version>
```

Current public parser behavior: from `data.limits` (or `limits`), select `type` `TOKENS_LIMIT`/`CREDIT_LIMIT`; `unit:3` is five-hour and `unit:6` weekly; `percentage` is percent used; `currentValue` is used quantity and `usage` is limit where provided; `nextResetTime` is epoch milliseconds (the client applies `new Date(nextResetTime)`). Record this as a provider-wide/reset-applied signal only when it materially drops usage or moves reset time outside normal schedule **and** no pack inventory explains it. It is lower reliability because normal scheduled resets look similar.

**Ranked detection method 3 (fallback):** observe authenticated Z.ai dashboard network traffic in a user-authorized browser session and register any first-party JSON response that adds a `recordId`/`available` reset record. This may discover future dashboard-only grants, but endpoint/UI contracts are less stable than method 1. Do not scrape email, Discord, X/Twitter, or WeChat as the primary mechanism: they are notification channels, not an entitlement source, and no confirmed Z.ai channel was found.

**Redemption/activation:** do not issue a POST. The located public client only lists packs and observes availability; it contains no redeem endpoint or activation action. If a future dashboard action is observed, treat the action and its response as a separate, user-initiated flow and revise this spec from captured first-party request metadata.

## Unverified / open questions - everything you could not confirm, stated plainly

- I could not confirm from an official Z.ai or bigmodel.cn announcement that reset packs are compensation, a subscription perk, incident remediation, or a promotional voucher; the endpoint name alone does not establish why a pack was granted.
- I could not confirm whether packs are granted automatically, delivered by email/dashboard banner/Discord/X/WeChat, or need manual activation. No such notification source was located.
- I could not obtain an authenticated live reset-list payload, so the schema beyond the public client's fixture and its runtime field accesses remains unverified.
- I could not confirm the reset-list polling rate, CORS policy for a Manifest V3 service worker, key type eligibility, or whether `Authorization` also accepts a raw key rather than `Bearer`.
- I could not confirm a provider-wide reset feed, changelog, status event, or a reliable way to distinguish it from a scheduled reset solely from quota data.
- I could not confirm that Z.ai API/Coding Plan reset packs apply to Zhipu/BigModel China accounts; use the Z.ai endpoint only for Z.ai accounts until validated separately.

## EXPAND leads - further sources or angles worth checking

- With a consenting test subscriber, capture only request/response metadata (redact Authorization) for the Z.ai dashboard around “usage”, “benefit”, “coupon”, “权益”, “补偿”, and “重置”; compare the reset-list payload before/after a grant and test whether an available pack is consumed by a dashboard click.
- Search official Z.ai release notes, help centre, status page, official Discord announcements, X posts, and Zhipu/BigModel Chinese notices for `customer-package-reset`, `五小时重置`, `周重置`, `重置包`, `补偿`, `权益`, and `兑换` dated 2025-2026.
- Review commits/issues for https://github.com/LogicIncZo/zai-usage and other active quota clients for the endpoint introduction, payload captures, and any POST route; require a real captured response before promoting fixture-only fields to high confidence.
- Probe documented dashboard API routes only without credentials for route existence, then validate authenticated behavior manually with a test account; do not search local credentials or automate redemption.
