## Summary
- MV3 can make cross-origin requests only after matching host permission, but that does not make an extension request a first-party site request or defeat cookie/privacy or bot-protection controls.
- The safe design is API-key-based APIs first; treat Claude/ChatGPT/Z.ai consumer-plan meters and reset grants as unverified UI/session integrations, refreshed only while the relevant site tab is open.
- Alarms are best-effort (minimum 30 seconds), not an instant-notification channel; a service worker can die after 30 seconds idle, so persist state before returning.
- Keep API keys local, prefer session-only storage for ephemeral tokens, and use WebCrypto only with a user-provided passphrase/key-management story; client-side encryption alone does not protect a decryptable extension secret.
- Request a user-entered LiteLLM origin at runtime with optional host permissions. Do not request broad site access or spoof Origin/Referer preemptively.
- Store viability requires one clearly disclosed purpose (displaying the user's usage), minimal on-device use of session-derived data, an accurate privacy policy, no remotely hosted executable code, and a graceful unsupported-provider state.

## Findings
- CLAIM: A service worker/extension page with a matching host permission may fetch cross-origin resources without the target server opting into CORS; content-script requests remain cross-origin and must satisfy CORS. | EVIDENCE: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests | SOURCE DATE: 2012-09 | CONFIDENCE: high
- CLAIM: `credentials: 'include'` only asks Fetch to include eligible cookies; it does not turn `chrome-extension://<id>` into the target's first-party site, so SameSite and third-party-cookie policy still decide whether a site's cookies are eligible. | EVIDENCE: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: SameSite `Lax`/`Strict` cookies must not be assumed available to an extension-origin subresource fetch; `SameSite=None; Secure` cookies can still be withheld by the user's third-party-cookie setting, and a `Partitioned` (CHIPS) cookie is keyed by its top-level site rather than universally reusable. | EVIDENCE: https://developer.chrome.com/docs/privacy-sandbox/cookies/chips | SOURCE DATE: 2024-07 | CONFIDENCE: high
- CLAIM: A site can independently reject automated or extension-origin traffic with Cloudflare/bot checks even when host permission and cookies exist; MV3 host permission bypasses CORS, not server authentication or anti-bot policy. | EVIDENCE: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests | SOURCE DATE: 2012-09 | CONFIDENCE: high
- CLAIM: `chrome.scripting.executeScript` can inject into an eligible existing tab; `world: 'MAIN'` runs in the page's JavaScript world and `ISOLATED` is the extension's isolated world, so MAIN has page-context compatibility but exposes injected logic to page interference. | EVIDENCE: https://developer.chrome.com/docs/extensions/reference/api/scripting | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: An offscreen document is a hidden extension document for DOM-dependent work, has only `chrome.runtime` extension API access, and is not a first-party Claude/ChatGPT/Z.ai page; it is therefore not a bot-protection or cookie-context fallback. | EVIDENCE: https://developer.chrome.com/docs/extensions/reference/api/offscreen | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: Chrome terminates an extension service worker after 30 seconds of inactivity (events/API calls reset the timer); long work and global variables are not durable state. | EVIDENCE: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle | SOURCE DATE: 2023-05 | CONFIDENCE: high
- CLAIM: Repeating alarms cannot run more often than every 30 seconds (`periodInMinutes` below 0.5 is not honored) and may be delayed arbitrarily, so polling cannot guarantee immediate reset-grant detection. | EVIDENCE: https://developer.chrome.com/docs/extensions/reference/api/alarms | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: `chrome.storage.local` persists on disk and is exposed to content scripts by default; `chrome.storage.session` is in-memory, cleared on restart, and is not exposed to content scripts by default. | EVIDENCE: https://developer.chrome.com/docs/extensions/reference/api/storage | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: Chrome recommends `storage.session` rather than `storage.local` for sensitive data, and recommends Web Crypto rather than relying on storage as cryptographic protection. | EVIDENCE: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: `optional_host_permissions` lets an extension request an origin at runtime with `chrome.permissions.request`; a user-supplied LiteLLM URL should be normalized to its origin and requested only after the user action that explains why it is needed. | EVIDENCE: https://developer.chrome.com/docs/extensions/reference/api/permissions | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: Action badges are short text on the toolbar action; notification creation requires the `notifications` permission; Side Panel is a persistent extension UI surface alongside the page. No Chrome documentation found that establishes a fixed popup width/height limit, so popup UI must fit normal viewport constraints rather than depend on a claimed numeric cap. | EVIDENCE: https://developer.chrome.com/docs/extensions/reference/api/action | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: Store policy requires a detailed single purpose, an accurate up-to-date privacy policy when handling user data, and collection/use/transmission only as necessary for that disclosed purpose; this applies to automatically gathered/scraped data and derived data. | EVIDENCE: https://developer.chrome.com/docs/webstore/program-policies/limited-use | SOURCE DATE: 2022-11 | CONFIDENCE: high
- CLAIM: Store policy prohibits remotely hosted code (including remotely loaded JavaScript/Wasm or evaluation of remote strings); provider endpoint configuration may be data but executable behavior must ship in the reviewed extension package. | EVIDENCE: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: `declarativeNetRequest` can modify request headers under its rule model, but changing Origin/Referer to impersonate a site is not a prerequisite for ordinary host-permitted fetch and is a fragile, policy-risky workaround; use it only if a documented provider integration requires it and Chrome permits the exact rule/header. | EVIDENCE: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest | SOURCE DATE: unknown | CONFIDENCE: medium
- CLAIM: LiteLLM documents `GET /global/spend/report?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` with `Authorization: Bearer <key>` and separately documents spend-route permissions; capability and response shape vary by proxy version/configuration. | EVIDENCE: https://docs.litellm.ai/docs/proxy/cost_tracking | SOURCE DATE: unknown | CONFIDENCE: high
- CLAIM: OpenRouter's public API endpoint exists at `/api/v1/credits`; unauthenticated probing is not sufficient to establish the authenticated response schema or historical day/week/month spend capability. | EVIDENCE: curl -sI https://api.openrouter.ai/api/v1/credits captured no HTTP response headers on 2026-09-30 from this network | SOURCE DATE: 2026-09 | CONFIDENCE: low

## Spec

### Recommended acquisition method
Use an MV3 service-worker fetch for documented API-key integrations and persist only a normalized snapshot plus `fetchedAt` in `storage.local`; keep the credential in `storage.session` by default. Trigger refresh from popup open, explicit Refresh, and a repeating 0.5-minute alarm as a best-effort stale-data check. A notification/badge may say "changed" only after a successful comparison; it cannot promise immediate provider-wide reset detection.

For Claude/ChatGPT/Z.ai consumer subscriptions, do **not** invent an API URL, cookie name, or header. If a current, public, provider-approved endpoint is later found, request only that site's host permission. If direct worker fetch is challenged, inject into a user-open, logged-in provider tab only after a user action: MAIN world can call the same page APIs but is vulnerable to page scripts; ISOLATED/content scripts can inspect rendered DOM but have no page-JS privileges and are brittle. Pass a minimal result via `runtime.sendMessage`. Do not use an offscreen document to impersonate the site. Detect a reset voucher/pass/provider reset only as a changed, provider-supplied field or UI message during a successful fetch; present its observed timestamp and label, never infer it from a usage decrease.

### LiteLLM (documented, proxy-specific)
Method: `GET`.

URL: `<user-approved-origin>/global/spend/report?start_date=2026-10-01&end_date=2026-10-01` (repeat with local calendar week/month boundaries; proxy docs do not establish a universal timezone, so send ISO dates and label the configured proxy/report timezone as unknown unless the proxy returns one).

Auth/headers: `Authorization: Bearer <LiteLLM key with get_spend_routes permission>`; no Origin/Referer spoofing. Request the exact `<scheme>://<host>/*` via `optional_host_permissions` after the user enters it.

Illustrative normalized snapshot (not asserted as the raw LiteLLM response):
```json
{
  "provider": "litellm",
  "period": "day",
  "start": "2026-10-01",
  "end": "2026-10-01",
  "timezone": "unknown",
  "spendUsd": 1.2345,
  "fetchedAt": "2026-10-01T12:00:00Z",
  "source": "global/spend/report"
}
```
`provider` identifies the adapter; `period` is the UI grouping; `start`/`end` are requested calendar dates; `timezone` is deliberately unknown until configured/returned; `spendUsd` is USD; `fetchedAt` is UTC RFC3339; `source` is the endpoint path. Do not claim a reset time for spend reports: LiteLLM budget reset fields are configuration-dependent.

### OpenRouter, Poe API, and vendor APIs
OpenRouter: use only a currently documented authenticated endpoint and API key supplied by the user. The public probe above did not yield a usable schema; do not ship the sample below as a parser. Poe public documentation was login-gated from this research environment; no verified usage endpoint or points schema was obtained. Anthropic's public API docs describe API use, not the Claude Pro/Max consumer meter; OpenAI public API endpoints are not evidence for ChatGPT/Codex subscription meters; Z.ai public API docs are not evidence for GLM Coding Plan consumer meters. Keep all five adapters disabled/"not connected" until a provider-approved, reproducible contract is captured.

A future raw-response parser must retain every provider field verbatim in an adapter-specific schema, then normalize: `window` (`5h`, `7d`, `day`, `week`, `month`), `used` (provider unit), `limit` (same unit), `remaining` (same unit), `resetAt` (RFC3339 instant or `null`), `grant` (object or `null`), and `observedAt` (UTC RFC3339). A realistic **normalized** response example is:
```json
{
  "provider": "example",
  "windows": [{"window":"7d","used":42,"limit":100,"remaining":58,"unit":"percent-of-plan","resetAt":"2026-10-08T00:00:00Z"}],
  "grant": {"kind":"voucher","label":"Extra usage","amount":10,"unit":"percent-of-plan","effectiveAt":"2026-10-01T12:00:00Z"},
  "observedAt":"2026-10-01T12:00:00Z"
}
```
Every numeric field uses `unit`; all `*At` values are UTC ISO-8601; `grant` is `null` when none is provider-supplied. `example` makes clear this is a target internal schema, not a claimed vendor response.

## Unverified / open questions
- No public, reproducible 2026 endpoint/schema was confirmed for Claude Pro/Max 5-hour/7-day usage, ChatGPT/Codex 7-day usage, Z.ai GLM Coding Plan usage, or their occasional reset grants. These must not be represented as supported without fresh provider authorization/evidence.
- The exact current behavior of each provider's cookies under user third-party-cookie settings, CHIPS partition keys, and Cloudflare challenges requires a logged-in test account and provider permission; it was not probed.
- No public Poe API points day/week/month endpoint or response was confirmed because the available docs redirected to login.
- OpenRouter authenticated credits/spend history and response fields were not confirmed from this network. A no-credential HEAD request did not produce a captured HTTP response, so it proves nothing beyond an inconclusive transport result.
- No fixed Chrome popup pixel-size maximum was confirmed. Design a compact popup and provide Side Panel for expanded history.
- Whether modifying Origin/Referer is technically allowed for the exact target request and compliant with that provider's terms must be verified per documented endpoint; do not use it to bypass anti-bot controls.
- Store approval of reading consumer-site session data/undocumented endpoints is not guaranteed by Limited Use compliance. Obtain provider approval or use official APIs where available.

## EXPAND leads
- Re-check Chrome's storage-and-cookies page and Chromium cookie SameSite/CHIPS tests against the shipping Chrome version used for launch.
- Obtain written provider approval and a public API/partner document for each consumer subscription meter and reset-grant event before adding the adapter.
- Capture authenticated, redacted OpenRouter and Poe official API responses in a test account, including date/timezone and aggregation semantics.
- Test LiteLLM against representative proxy versions with a least-privilege key and document exact report response schema/timezone.
- Review the current Chrome Web Store Program Policies and MV3 requirements immediately before submission; policy pages and review interpretation change.
