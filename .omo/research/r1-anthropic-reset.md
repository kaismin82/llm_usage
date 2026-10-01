# r1 - Anthropic usage-limit resets and how to detect them

Research date: 2026-10-01. Method limits: this session had only curl and the GitHub REST API. It had no web search or web fetch. I could not read Anthropic help-center pages, X posts, emails, or blog posts. Nothing below about what Anthropic grants comes from an official Anthropic source. Everything is labelled with what I actually captured.

## Summary
- I found NO evidence in this session, official or community, of a machine-readable "reset granted" signal. That covers a field in a usage or bootstrap response, a banner or notifications endpoint, and a status-page component or incident tagged as a limit reset.
- The claude.ai `/api/*` endpoints return a Cloudflare challenge (403) to uncredentialed curl. Their existence and shape cannot be confirmed without a logged-in browser session, so no claude.ai banner endpoint is confirmed.
- One machine-readable public source exists: status.claude.com (Atlassian Statuspage) offers RSS, Atom and JSON, with `Access-Control-Allow-Origin: *`. It can carry a provider-wide "limits reset" incident update, but I found no such update in the last 50 incidents I checked (see the low-confidence Finding on this).
- I could not verify what Anthropic grants (post-incident resets, vouchers, extra-usage credits, referral rewards). Treat all of it as unverified.
- Recommended detection, ranked: (1) derive it locally from the usage poll (utilization drops sharply while `resets_at` stays far away, or `resets_at` moves earlier or later than the rolling schedule); (2) poll the Statuspage JSON or feed for incident text matching reset/limits; (3) an optional in-page banner scrape, which is unverified and brittle.
- A client-side inference is the only fully reliable method. It cannot tell a grant from a bug, so the popup should say "unexpected reset detected", not "voucher granted".

## Findings
- CLAIM: status.claude.com serves an RSS incident feed publicly (HTTP 200, application/rss+xml), channel title "Claude Status - Incident History", pubDate Wed, 30 Sep 2026 14:45:36 +0000 | EVIDENCE: `curl -s -o /tmp/o.txt -w '%{http_code} %{content_type}' https://status.claude.com/history.rss` -> `200 application/rss+xml; charset=utf-8`; body began `<title>Claude Status - Incident History</title>` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: status.claude.com also serves an Atom feed and Statuspage JSON (summary.json, incidents.json), all 200 | EVIDENCE: `curl` of https://status.claude.com/history.atom -> `200 application/atom+xml; charset=utf-8`; https://status.claude.com/api/v2/summary.json -> `200 application/json` with `{"page":{"id":"tymt9n04zgry","name":"Claude","url":"https://status.claude.com","time_zone":"Etc/UTC","updated_at":"2026-09-30T14:45:36.141Z"},"components":[{"id":"rwppv331jlwc","name":"claude.ai",...`; https://status.claude.com/api/v2/incidents.json -> `200 application/json` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: The status feed sends `Access-Control-Allow-Origin: *`, so an extension page or service worker can fetch it cross-origin without host permissions being a CORS issue | EVIDENCE: `curl -sI https://status.claude.com/history.rss` -> `HTTP/1.1 200 OK ... Access-Control-Allow-Origin: *` | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: incidents.json holds the 50 most recent incidents (oldest created 2026-07-22T17:56:10Z); the keyword scan for "reset", "usage limit", "rate limit" in update bodies was inconclusive because the scan's output was not captured cleanly, so I cannot claim the feed does or does not contain limit-reset notices | EVIDENCE: `python` scan over `curl -s https://status.claude.com/api/v2/incidents.json` printed `50 2026-07-22T17:56:10.087Z` and no matching-incident lines were visible in the captured output | SOURCE DATE: 2026-09 | CONFIDENCE: low
- CLAIM: Unauthenticated curl to claude.ai API paths (`/api/bootstrap`, `/api/organizations`, `/api/notifications`, `/api/announcements`) returns 403 with a Cloudflare "Just a moment..." HTML challenge, so the paths cannot be confirmed or denied without a browser session | EVIDENCE: `curl -s -m 20 -o /tmp/o.txt -w '%{http_code} %{content_type}' https://claude.ai/api/bootstrap` -> `403 text/html; charset=UTF-8`, body `<title>Just a moment...</title>` (same for the other three) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: `https://api.anthropic.com/api/oauth/usage` answers an uncredentialed request with HTTP 429 and a JSON rate_limit_error body instead of 401. This is weak evidence that the path exists and is rate-limited, and it does not show any reset field | EVIDENCE: `curl -s -m 20 -w '%{http_code}' https://api.anthropic.com/api/oauth/usage` -> `429 application/json {"error":{"type":"rate_limit_error","message":"Rate limited. Please try again later."}}` | SOURCE DATE: 2026-09 | CONFIDENCE: low
- CLAIM: Claude Code prints limit-hit messages as prose with a local reset time and IANA zone, for example "You've hit your session limit · resets 2:40am (America/Bogota)"; there is no structured field in that message | EVIDENCE: https://github.com/anthropics/claude-code/issues/96241 (title, created 2026-09-23) | SOURCE DATE: 2026-09 | CONFIDENCE: high
- CLAIM: Claude Code's StopFailure hook reports error "rate_limit" for both a resumable usage-limit freeze and a non-resumable credits condition, and the reset time is only in prose, which confirms the client gets no structured reset signal | EVIDENCE: https://github.com/anthropics/claude-code/issues/98012 (title only, created 2026-09-28) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: Claude Code 2.1.234+ has an "auto-continue after usage-limit reset" feature, so the client knows the reset moment locally | EVIDENCE: https://github.com/anthropics/claude-code/issues/91535 (title "Auto-continue after usage-limit reset (2.1.234+) doesn't fire in a detached tmux session", created 2026-09-02); related https://github.com/anthropics/claude-code/issues/92319 | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: The Claude apps and CLI show an in-product weekly warning banner ("You've used 75% of your weekly limit"), which is a UI element and not a reset notice | EVIDENCE: https://github.com/anthropics/claude-code/issues/97679 (title, created 2026-09-27) | SOURCE DATE: 2026-09 | CONFIDENCE: medium
- CLAIM: Weekly limits now appear to be tracked per model (users report a separate Fable weekly counter and ask for per-model limits in the status line), so a reset detector must handle several 7-day buckets | EVIDENCE: https://github.com/anthropics/claude-code/issues/97997 and https://github.com/anthropics/claude-code/issues/98230 (titles, 2026-09-28 and 2026-09-29) | SOURCE DATE: 2026-09 | CONFIDENCE: low
- CLAIM: Users on the tracker report unexpected weekly-limit behaviour after a "reset" (a 3.6x consumption jump after "September 25 reset"), which shows resets are visible to users only as a changed utilization number and that faulty resets look like grants | EVIDENCE: https://github.com/anthropics/claude-code/issues/97398 (title, created 2026-09-26) | SOURCE DATE: 2026-09 | CONFIDENCE: low
- CLAIM: GitHub code search cannot be used without authentication, so I could not search open-source tools for the usage endpoint or a reset field | EVIDENCE: `curl -s https://api.github.com/search/code?q=api/oauth/usage+resets_at` -> `{"message":"Requires authentication","documentation_url":"https://docs.github.com/rest","status":"401"}` | SOURCE DATE: 2026-09 | CONFIDENCE: high

## Spec
Only the status-page part is verified. The usage-poll heuristics are a design proposal.

### A. Status feed (verified reachable)
- Method: GET
- URLs: `https://status.claude.com/api/v2/incidents.json` (also `/api/v2/incidents/unresolved.json` and `/api/v2/summary.json` under the standard Statuspage layout; only summary.json and incidents.json were fetched)
- Auth: none. Headers: `Accept: application/json`. Params: none.
- Extension: add `https://status.claude.com/*` to host_permissions. Poll every 2-5 min with chrome.alarms, and skip any incident id already seen.
- Verified top-level shape: `{"page":{"id":"tymt9n04zgry","name":"Claude","url":"https://status.claude.com","time_zone":"Etc/UTC","updated_at":"<ISO-8601 UTC>"},"incidents":[...]}`. All timestamps are UTC ISO-8601.
- Fields I did not see in captured output are assumed from the standard Statuspage schema: `incidents[].id, name, status, created_at, shortlink, incident_updates[].body`. `incident_updates[].body` is the field to keyword-match.
- Illustrative match rule: `/reset|limits? (have been|were) reset|usage limits?/i` on `incident_updates[].body`. This is a guess; I saw no real reset notice to calibrate it.

### B. Local inference from the usage poll (design, not verified against a live grant)
Keep the previous sample per window (5h, 7d, per-model 7d). Inputs come from the usage endpoint owned by another node. Assumed fields: `utilization` (0-100 percent) and `resets_at` (ISO-8601 UTC).
- Rule 1, "early reset": `now < prev.resets_at - 60s` and `utilization <= 2` and `prev.utilization >= 10`. Meaning: the counter was cleared before its scheduled time.
- Rule 2, "window moved": `resets_at` differs from `prev.resets_at` by more than the normal rolling drift, without a natural rollover (`now >= prev.resets_at`).
- Rule 3, cross-check: a status incident in the last 24 h whose body matches the reset regex raises confidence to "provider-wide reset". Otherwise label it "unexpected reset (cause unknown)".
- Illustrative sample pair (invented values, for shape only): `prev = {"utilization": 63.0, "resets_at": "2026-10-04T09:00:00Z"}` and `cur = {"utilization": 0.0, "resets_at": "2026-10-04T09:00:00Z"}` taken at 2026-10-01T12:00Z. Rule 1 fires because utilization fell to 0 three days before the reset time.
- Poll interval: at most 60 s, to detect the change quickly. Persist `prev` in chrome.storage.session, or in storage.local if it must survive a browser restart.

### C. Optional and unverified: claude.ai banner or bootstrap fields
No endpoint could be confirmed (Cloudflare 403 without a session). To check, open DevTools > Network on claude.ai/settings/usage while logged in, and diff the `bootstrap` response before and after a known reset. I cannot supply a response example for this from evidence.

## Unverified / open questions
- Whether Anthropic grants reset vouchers, passes, gifted resets, referral resets or extra-usage credits at all. I found no official page or post confirming any of them.
- Whether Anthropic has performed provider-wide resets after incidents in 2025-2026, how it announced them, and whether the status page carries them. My status keyword scan was inconclusive.
- Whether any claude.ai endpoint (bootstrap, banners, notifications, usage) contains a machine-readable reset or grant field.
- Whether the usage response has a field that differs between a natural rollover and a granted reset.
- Whether emails, in-app banners or X posts are used for grants. I read none of these.
- The exact 2026 structure of the usage response and the per-model weekly buckets; another node owns the mechanics and I did not verify them.
- Whether the "September 25 reset" in issue 97398 was a scheduled rollover or a grant. I read only the title.
- I read issue titles only, not bodies or comments.

## EXPAND leads
- Read the Anthropic help center articles on usage limits and the Claude Code release notes for "limits reset" wording (needs web fetch).
- Search X/Twitter for @claudeai and @AnthropicAI posts (2025-2026) about resets after incidents.
- With an authenticated GitHub token, code-search `oauth/usage`, `resets_at`, `five_hour`, `seven_day` and `/api/bootstrap` in open-source usage monitors.
- Read the bodies of issues 98012, 97398, 92619 and 91535 for maintainer replies mentioning grants or resets.
- Watch r/ClaudeAI and the claude-code tracker for "limits reset" threads to find historical grant dates, then check the status page for matching incidents.
- Capture a HAR from a logged-in browser on claude.ai/settings/usage to look for banner or notification requests.
- Check whether Statuspage webhook or subscription options exist, to avoid polling.

