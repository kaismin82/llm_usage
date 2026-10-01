# R2 verification: ChatGPT / Codex

Research date: 2026-10-01. Public source and GitHub verification; no credentials used. The GitHub code-search API rate-limited during this run; direct raw source and commit API requests were available. Dates refer to source commits or third-party README's stated announcement dates, not independent confirmation of OpenAI announcements.

## Verdicts
- VERDICT: CONFIRMED | CLAIM: `GET https://chatgpt.com/backend-api/wham/usage` is the ChatGPT-style usage route and unauthenticated 401 indicates a protected route | EVIDENCE: R1 usage report finding; https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client/rate_limit_resets.rs lines 123-128; R1 curl output `401` | NOTE: 401 probe demonstrates auth gate, not a guaranteed stable public API.
- VERDICT: CONFIRMED | CLAIM: classify Codex windows by `limit_window_seconds`, not primary/secondary slot | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client.rs lines 735-765; R1 usage report cites 2026-04 Plus sample and 2026-06 5h/7d sample | NOTE: OpenAI client maps slots independently; source alone does not guarantee a given plan's window set.
- VERDICT: PARTIAL | CLAIM: Plus and Pro both have a 5-hour and 7-day window | EVIDENCE: R1 usage report (2026-04 Plus sample, 2026-06 codex-reset sample); https://github.com/aaamosh/codex-reset/blob/main/README.md lines 7, 20-21 (source observed 2026-10-01) | NOTE: a Plus example and one unspecified account do not establish the plan-by-plan matrix; Pro's five-hour window is not independently established here.
- VERDICT: CONFIRMED | CLAIM: Codex usage status embeds optional `rate_limit_reset_credits.available_count` and there is a separate detail list | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/types.rs lines 22-42, 55-66 | NOTE: Summary is optional; absence cannot be interpreted as zero.
- VERDICT: CONFIRMED | CLAIM: list/consume routes are `GET /wham/rate-limit-reset-credits` and `POST /wham/rate-limit-reset-credits/consume` under ChatGPT backend-api | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client/rate_limit_resets.rs lines 82-120, 123-153 | NOTE: Codex API style uses `/api/codex/...`; consume is a mutation and should not be used by a display-only extension.
- VERDICT: CONFIRMED | CLAIM: Codex reset credit detail includes `id`, `reset_type`, `status`, `granted_at`, nullable `expires_at`, `title`, `description` | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/types.rs lines 27-42 | NOTE: `expires_at` may be null; field types do not constrain enum values or prove all grants expire.
- VERDICT: REFUTED | CLAIM: Codex CLI itself automatically consumes a reset credit when limits are reached | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client/rate_limit_resets.rs lines 89-120; https://github.com/aaamosh/codex-reset/blob/main/README.md lines 20-30 | NOTE: source separates read from explicit consume request; third-party CLI requires `codex-reset consume` (confirmation by default per README lines 68-70). The reset UI is an explicit redeem action, not an inferred automatic consume.
- VERDICT: REFUTED | CLAIM: saved credits categorically do not expire | EVIDENCE: https://github.com/aaamosh/codex-reset/blob/main/README.md lines 14-16 shows `expires=2026-07-12T01:33:14Z` for a grant dated 2026-06-12; https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/types.rs lines 34-41 | NOTE: observed sample expires after 30 days; backend type permits null, so do not assume a universal lifetime.
- VERDICT: PARTIAL | CLAIM: saved resets rolled out 2026-06-12 to Go/Plus/Pro/Business and referral can grant more | EVIDENCE: https://github.com/aaamosh/codex-reset/blob/main/README.md lines 5-7 (README source observed 2026-10-01); https://github.com/openai/codex/commit/bef99f861b365377caa9c095f20a8adf4eae4647 (2026-06-15) | NOTE: README states these rollout/plan facts and the official source confirms personal reset-credit support, but this run did not fetch the linked announcement or verify eligibility with OpenAI documentation.
- VERDICT: CONFIRMED | CLAIM: Official Codex client sends bearer authorization and optional `ChatGPT-Account-Id`; user-agent defaults to `codex-cli` | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client.rs lines 213-240; https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client/rate_limit_resets.rs lines 74-85 | NOTE: `originator` and `OpenAI-Beta` are not added in these client header-building lines; a supplied user agent can override default.
- VERDICT: CONFIRMED | CLAIM: A browser-session access token is used by a third-party web client for `/backend-api/wham/usage` | EVIDENCE: https://github.com/ViuMP/Walder/blob/main/src/providers/chatgpt-web.ts lines 7-12, 74, 111-126, 340 | NOTE: Explicit direct evidence of bearer use; does not independently prove browser-session token works for every account or environment.
- VERDICT: PARTIAL | CLAIM: Detecting a grant via count increase/new credit ID or provider-wide reset via changed windows enables immediate notification | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/types.rs lines 22-42; https://github.com/aaamosh/codex-reset/blob/main/README.md lines 14-16 | NOTE: Data supports polling and diffing, but no push/instant delivery is evidenced. Provider-wide reset detection by window changes is heuristic.
- VERDICT: UNVERIFIED | CLAIM: `wham/usage` supplies the normal contract for ChatGPT conversation message caps, Deep Research caps, or an authoritative plan-by-plan five-hour policy | EVIDENCE: R1 usage report's "No verified endpoint" / "Unverified" sections; current Codex client source maps Codex rate limits only, https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client/rate_limit_resets.rs lines 69-80 | NOTE: Treat this feature as Codex subscription usage, not all ChatGPT usage.

## New facts
- CLAIM: Reset-credit summary was introduced in openai/codex commit `bef99f861b365377caa9c095f20a8adf4eae4647`, dated 2026-06-15; PR #28143 | EVIDENCE: https://github.com/openai/codex/commit/bef99f861b365377caa9c095f20a8adf4eae4647 (commit message: "feat(app-server): expose rate-limit reset credits") | SOURCE DATE: 2026-06 | CONFIDENCE: high
- CLAIM: Detail rows were added to app-server rate-limit reads in commit `58ec5283156c3fce6421d38684afef0a656129d4`, dated 2026-07-06; PR #30395 | EVIDENCE: `gh api repos/openai/codex/commits?path=codex-rs/backend-client/src/client/rate_limit_resets.rs` output: `58ec528... 2026-07-06T19:54:06Z [app-server] Include reset-credit details (#30395)`; https://github.com/openai/codex/commit/58ec5283156c3fce6421d38684afef0a656129d4 | SOURCE DATE: 2026-07 | CONFIDENCE: high
- CLAIM: Current official client chooses reset-credit/usage endpoint by path style and shares the same headers for read/list/consume; Luna Reserve capability header is opt-in only for capable clients | EVIDENCE: https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client/rate_limit_resets.rs lines 69-85; https://raw.githubusercontent.com/openai/codex/main/codex-rs/backend-client/src/client.rs lines 221-240 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Current codex-reset README describes grants for Go, Plus, Pro, Business and an example 30-day expiration, while advertising a referral program through June 24, 2026 | EVIDENCE: https://github.com/aaamosh/codex-reset/blob/main/README.md lines 5-16 | SOURCE DATE: 2026-06 | CONFIDENCE: medium
- CLAIM: ViuMP/Walder explicitly describes `wham/usage` as reporting the Codex allowance, obtaining `accessToken` from session JSON and sending it as Bearer | EVIDENCE: https://github.com/ViuMP/Walder/blob/main/src/providers/chatgpt-web.ts lines 7-12, 111-126, 340 | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: CodexBar file path/header/notification details could not be confirmed during this run; guessed source paths returned no content, so no positive claim is made | EVIDENCE: attempted `curl.exe -Ls` for `https://raw.githubusercontent.com/steipete/CodexBar/main/Sources/CodexBar/CodexProvider.swift` and `/Sources/CodexBar/Providers/CodexProvider.swift` produced no matching output | SOURCE DATE: 2026-10 | CONFIDENCE: high

## Corrected spec

**Method and URLs**

- Read usage: `GET https://chatgpt.com/backend-api/wham/usage`.
- Read grant details only when useful: `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`.
- Do not redeem: `POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume` is a state-changing endpoint.
- No query parameters or body are used by the official GET call.

**Headers**

- `Authorization: Bearer <session accessToken>`.
- `ChatGPT-Account-Id: <account id>` when known (official client treats it as optional).
- `User-Agent` is `codex-cli` by default in Codex Rust client; browser client behavior is its own. Do not claim required headers `OpenAI-Beta` or `originator`: neither appears in this backend client's headers builder.
- Use `Accept: application/json` as a client preference, not an evidenced required header. In browser fetch, session retrieval requires the site's browser session/cookies; third-party Walder explicitly uses accessToken as bearer.

**Response contract** (wire fields taken from Rust deserialization models; values illustrative, not a captured live response)

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
  "rate_limit_reset_credits": {"available_count": 1}
}
```

`used_percent` is consumed percentage; `limit_window_seconds` is duration; `reset_at` is Unix epoch seconds (UTC). Find the weekly window by duration 604800 seconds, regardless of slot; may be absent. Do not assert every account or plan has both windows. `rate_limit_reset_credits` is optional; count is banked grant count, not paid usage balance.

Detail list response (shape from type model, not captured live):
```json
{"available_count":1,"credits":[{"id":"...","reset_type":"...","status":"available","granted_at":"...","expires_at":null,"title":null,"description":null}]}
```

Poll and compare count/credit IDs to notify of newly observed grant; this is detection latency bounded by poll interval, not immediate server push. `expires_at` is nullable; display when supplied. Provider-wide resets may be inferred from changed usage windows but have no confirmed dedicated event field. Preserve unknown fields and handle optional/null data.

## Still unverified
- OpenAI Help Center and official announcement pages were not fetched; the 2026-06-12 rollout date and eligibility are third-party README claims, albeit consistent with the official June source addition.
- No plan-by-plan matrix was verified for Go, Free, Plus, Pro, Business, or other plans. Plus 5h+7d is seen in a third-party sample; current Codex source has no entitlement policy table establishing all plans.
- No authenticated live response was captured; response examples above are illustrative. Availability and exact enum values for reset credits remain unknown; the type says `expires_at` may be null.
- CodexBar provider filenames, request headers, and grant-notification behavior were not verified; GitHub code search failed with API rate limiting and attempted guessed raw paths yielded no usable lines.
- No TUI/app-server end-user copy or automatic consume trigger was confirmed. Official source exposes an explicit consume API; codex-reset README explicitly requires the `consume` command. This is not evidence for every Codex desktop/editor UI behavior.
- Browser session endpoint access/CORS/Cloudflare behavior in an MV3 extension and whether `originator`/`OpenAI-Beta` may be sent by other clients remain unverified.
