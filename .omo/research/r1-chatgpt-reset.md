# r1 - ChatGPT / Codex usage-limit resets: existence and detection

Method note: this run had only curl and GitHub raw-file access. There was no web-search tool, so no news, X/Twitter, forum or help-center pages were read. Every finding below comes from the current openai/codex source (main branch, fetched 2026-09-30/10-01) or from curl probes made the same day. Announcement history is listed under "Unverified".

## Summary
- Yes, a per-user reset mechanism exists in the backend. The Codex client (openai/codex main) has "rate limit reset credits": a list endpoint, a consume endpoint, and an `available_count` summary embedded in the usage response.
- The strongest machine-readable signal is `rate_limit_reset_credits.available_count` in `GET /backend-api/wham/usage`. It is already part of the usage call the extension makes, so it costs no extra request. Its detail list, `GET /backend-api/wham/rate-limit-reset-credits`, carries `id`, `granted_at`, `expires_at`, `title` and `description` for each grant.
- Detecting a grant means polling and diffing: when `available_count` rises or a new credit `id` appears, a grant happened. There is no push feed. For a provider-wide reset, the same poll sees `used_percent` drop and `reset_at` jump forward.
- Secondary signals are `GET /wham/workspace-messages` (headline/announcement messages, workspace admin oriented), `rate_limit_upsell` (opaque banner payload), and the `credits` block (paid balance that bypasses limits). The status.openai.com RSS feed is public but covers incidents only.
- Consuming a credit is a separate POST. The extension should display only and never consume.
- Not verified: how or when OpenAI grants these credits, any official announcement, and the live response shape. Probes without credentials only confirmed the endpoints exist (401).

## Findings
- CLAIM: Backend-client type `RateLimitResetCreditsSummary { available_count: i64 }` is an optional field `rate_limit_reset_credits` on the usage-status response | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/types.rs (lines ~22-63, struct RateLimitStatusWithResetCredits) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Reset-credit detail objects have fields id, reset_type, status, granted_at, expires_at (nullable), title (nullable), description (nullable), wrapped as `{credits:[...], available_count}` | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/types.rs (RateLimitResetCreditsDetails / RateLimitResetCreditDetails, lines ~27-41) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The list endpoint is GET `{base}/wham/rate-limit-reset-credits` (ChatGPT path style) or `/api/codex/rate-limit-reset-credits` (Codex path style) | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client/rate_limit_resets.rs (lines ~82-86, 131-137) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The consume endpoint is POST `{base}/wham/rate-limit-reset-credits/consume`; the response code is one of reset, nothing_to_reset, no_credit, already_redeemed, with `windows_reset` count | EVIDENCE: rate_limit_resets.rs lines ~89-121, 142-151; types.rs lines ~105-120 (same repo path as above) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The usage endpoint is GET `{base}/wham/usage` with base `https://chatgpt.com/backend-api`; the client sends the same `headers()` (bearer auth) for all these calls | EVIDENCE: rate_limit_resets.rs lines ~74, 124-127; client.rs line ~209 ("Normalize common ChatGPT hostnames to include /backend-api") | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Unauthenticated probes confirm the endpoints exist: wham/usage returns 401, wham/workspace-messages returns 401, wham/rate-limit-reset-credits returns 401 (not 404) | EVIDENCE: `curl -s -o /dev/null -w '%{http_code}' https://chatgpt.com/backend-api/wham/usage` -> 401; same for /wham/workspace-messages -> 401 and /wham/rate-limit-reset-credits -> 401 (2026-09-30) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: A made-up path under the same prefix (`/wham/usage/credits`) returns 404, so the 401s are route-specific, not a blanket auth wall | EVIDENCE: `curl -s -o /dev/null -w '%{http_code}' https://chatgpt.com/backend-api/wham/usage/credits` -> 404 (2026-09-30) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: `curl -sI` on wham/usage returned 405 (allow: GET, server cloudflare) and set `__cf_bm` cookies; no CORS headers were observed in that HEAD response | EVIDENCE: `curl -sI https://chatgpt.com/backend-api/wham/usage` -> "HTTP/1.1 405 Method Not Allowed ... allow: GET ... Server: cloudflare" (2026-09-30) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: The usage payload also has `plan_type`, `rate_limit`, `credits`, `spend_control`, `additional_rate_limits`, `rate_limit_reached_type` | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs (lines ~14-55) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The `credits` block (paid credits that can bypass the included limit) has `has_credits: bool`, `unlimited: bool`, `balance: string|null`, `approx_local_messages`, `approx_cloud_messages` | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/codex-backend-openapi-models/src/models/credit_status_details.rs (lines ~13-35) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `rate_limit_reached_type.type` has variants including workspace_owner_credits_depleted and workspace_member_credits_depleted | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client.rs (lines ~696-700) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: An opaque `rate_limit_upsell` value is preserved as a "backend-owned banner contract" (shape unknown) | EVIDENCE: types.rs lines ~52, 64-66 comment "Preserve the backend-owned banner contract" (same repo path as above) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: A announcements endpoint exists: GET `{base}/wham/workspace-messages` returning `{messages:[{message_id, message_type: headline|announcement|unknown, message_body, created_at, archived_at}]}` | EVIDENCE: client.rs lines ~565-575, 727-731; types.rs lines ~78-103, 122-128 (same repo) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Each rate-limit window snapshot is mapped with a `resets_at` epoch and `reset_after_seconds` (window mechanics are owned by another node) | EVIDENCE: client.rs lines ~748-773, 874 (https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client.rs) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: status.openai.com publishes public RSS feeds (feed.rss and history.rss return 200) whose recent items are incidents (errors, Codex issues), not limit-reset notices | EVIDENCE: `curl -s -o /dev/null -w '%{http_code}' https://status.openai.com/feed.rss` -> 200; items seen: "Issues with Codex" (Fri, 25 Sep 2026), "Elevated errors across ChatGPT, Codex, and the API..." (Tue, 29 Sep 2026) | SOURCE DATE: 2026-09 | CONFIDENCE: high

## Spec
Detection (primary), reusing the extension's existing ChatGPT session. The auth mechanics (Bearer access token obtained from the chatgpt.com session, `ChatGPT-Account-Id` header for team accounts) are owned by another node; this report did not verify them.

1. Method: GET. URL: `https://chatgpt.com/backend-api/wham/usage`. No request params found in source. Read `rate_limit_reset_credits.available_count`.
2. When the count is > 0, or differs from the stored value: GET `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` for the detail list.
3. Optional: GET `https://chatgpt.com/backend-api/wham/workspace-messages` for announcements.
4. Do NOT call POST `.../rate-limit-reset-credits/consume`. That spends the user's credit.

Reconstructed response for `/wham/rate-limit-reset-credits` (field names from source; values invented; timestamps presumably ISO-8601 UTC strings, since the source types are `String`):
```json
{
  "available_count": 1,
  "credits": [
    {
      "id": "rlrc_abc123",            // unique grant id; new id == new grant
      "reset_type": "all",            // string; allowed values unknown
      "status": "available",          // string; values other than this are unknown (consumed/expired likely)
      "granted_at": "2026-09-30T12:00:00Z",
      "expires_at": "2026-10-14T12:00:00Z",   // nullable
      "title": "Usage limits reset",          // nullable, display text
      "description": "We reset your Codex limits." // nullable
    }
  ]
}
```
Relevant part of `/wham/usage` (window fields are owned elsewhere; shown only for the reset-related keys; values invented):
```json
{
  "plan_type": "plus",
  "rate_limit": { "...": "window data, see other node" },
  "credits": { "has_credits": false, "unlimited": false, "balance": "0", "approx_local_messages": [], "approx_cloud_messages": [] },
  "rate_limit_reset_credits": { "available_count": 1 },
  "rate_limit_reached_type": null,
  "rate_limit_upsell": null
}
```
`balance` is a string of unknown unit (probably credits). `rate_limit_upsell` shape is unknown.

Detection methods, ranked by reliability:
1. Poll `/wham/usage`; `rate_limit_reset_credits.available_count` increase means a new per-user reset was granted. Confirm with the list endpoint (new `id`, `granted_at`). Most reliable, machine-readable, same call as usage.
2. Provider-wide reset (no credit issued): in the same poll, the primary window's `used_percent` falls sharply while `reset_at` moves forward earlier than the stored one. Heuristic, inferred, not an explicit flag.
3. Poll `/wham/workspace-messages` and alert on a new `message_id`. Explicit, but its content is workspace-admin messaging; unclear whether OpenAI posts global reset notices there.
4. Watch `rate_limit_upsell` and `credits.has_credits` changes. Weak; semantics unknown.
5. Poll status.openai.com RSS for "reset" keywords. Public, no auth, low precision.
6. Off-platform (X posts from the Codex team, email, in-app banner): no API access; manual only.

## Unverified / open questions
- Whether and when OpenAI actually grants these credits (promotions, compensation after incidents, provider-wide resets) in 2025-2026. No announcement, help-center article, changelog or X post was read because no web-search tool was available.
- The live JSON of `/wham/usage` and `/wham/rate-limit-reset-credits` with credentials. Field names come from client source types, not from captured responses.
- Allowed values of `reset_type` and `status`, the credit lifetime, and whether credits exist for Free/Plus/Pro/Business alike.
- Whether `rate_limit_reset_credits` appears for every account or only those in a rollout; the field is `Option`, so absence is possible.
- Whether a browser extension running on chatgpt.com can call these routes cross-origin. No CORS headers were seen on an unauthenticated HEAD response; the extension would probably need host permissions and a bearer token, and this was not tested.
- Whether Codex CLI prints a message when a reset occurs. Not checked in the CLI/TUI source.
- Whether the Codex CLI `/api/codex/*` path style is reachable with the same token from the web session.
- Anthropic and Z.ai resets are outside this report.

## EXPAND leads
- Search the openai/codex repo for `reset_credit`, `rate_limit_reset`, `available_count` in `codex-rs/tui` and `codex-rs/app-server` to find the user-facing message text and when it shows.
- Read the openai/codex commits and PRs that introduced `rate_limit_reset_credits` (git log on `backend-client/src/client/rate_limit_resets.rs`) for the date and rollout notes.
- Codex changelog (developers.openai.com/codex/changelog) and OpenAI Help Center pages on Codex usage limits and credits.
- X/Twitter accounts of the Codex team and OpenAI for provider-wide reset announcements; reddit r/codex and r/ChatGPTPro for user reports of the reset field.
- Third-party usage trackers on GitHub that call `wham/usage` (search code for `wham/usage`; needs a logged-in GitHub API) to see whether they already read `rate_limit_reset_credits`.
- Capture one real response from the user's own logged-in browser DevTools (Network tab) to confirm shapes; the user can do this, this run could not.
