# LLM 사용량 한눈에 보기 Chrome Extension - 개발 설계 보고서

- 작성일: 2026-10-01
- 범위: 설계만 다룸 (구현 코드 없음)
- 근거 원장
  - `.omo/research/r1-*.md`: 1차 조사 11건
  - `.omo/research/r2-*.md`: 2차 교차 검증 6건과 공식 문서 직접 확인 1건
  - `.omo/research/r3-lead-direct-check.md`: 리드가 직접 수행한 무인증 probe와 소스 grep 재확인
- 검증 수준 표기
  - [공식] 공식 문서에서 확인
  - [소스] 공식 클라이언트 또는 여러 오픈소스 구현의 소스 코드로 교차 확인
  - [실측] 이번 세션에서 실제 응답을 캡처
  - [프로브] 인증 없는 curl로 경로 존재, 에러 형태, CORS만 확인
  - [추정] 미검증

---

## 0. 결론 요약

1. **요청 항목 9개(6개 provider와 reset 권 3종)는 모두 기계가 읽을 수 있는 데이터 소스가 있습니다.** 5시간/7일 창의 사용률과 reset 시각, 일/주/월 비용을 모두 표시할 수 있습니다.
2. **reset 권은 세 회사 모두 전용 신호가 있습니다.**
   - Claude: usage 응답의 `cedar_ember` 블록 (`?cedar_ember=1`로 요청할 때만 포함)
   - ChatGPT: `wham/usage` 응답의 `rate_limit_reset_credits.available_count`와 상세 목록 API
   - Z.ai: `customer-package-reset/list` API
   - 세 곳 모두 reset 권을 **소모하는 API(redeem/consume)도 따로 존재**합니다. 확장은 GET만 허용하는 읽기 전용 가드를 코드 수준에서 강제해야 합니다.
3. **인증은 두 계열로 나뉩니다.**
   - 세션형: Claude, ChatGPT. 브라우저에 로그인만 되어 있으면 키가 필요 없습니다.
   - 키형: Z.ai, Poe, OpenRouter, LiteLLM. 사용자가 API 키를 입력합니다.
4. **가장 큰 리스크는 Claude, ChatGPT, Z.ai 사용량 API가 비공개 내부 API라는 점입니다.** 스키마가 바뀌거나, 약관 문제가 있거나, Cloudflare 챌린지를 만날 수 있습니다. 설계에서는 다음으로 흡수합니다.
   - 관대한 스키마 파싱
   - 'API 변경 감지' 상태 표시
   - 열린 탭에 주입해서 가져오는 fallback
   - 보수적인 폴링 간격
5. **요구사항과 다르게 동작하는 부분이 세 가지 있습니다.**
   - ChatGPT 수치는 ChatGPT 구독 플랜에 포함된 **Codex 사용 한도**입니다. 일반 채팅 메시지 한도는 어떤 API로도 노출되지 않습니다.
   - Claude, ChatGPT, Z.ai는 토큰 **개수**가 아니라 **사용률(%)**을 줍니다. Z.ai는 절대값 필드가 오는 경우에만 수량을 추가로 표시할 수 있습니다.
   - Poe 사용 이력 API는 **최근 30일만** 보존합니다. 달력 월 합계를 정확히 내려면 확장이 이력을 로컬에 누적해야 합니다.

---

## 1. Provider별 데이터 소스 상세

### 1.1 Anthropic Claude 구독 (Pro/Max/Team): 5시간, 7일, reset 권

**인증**
- claude.ai 로그인 세션 쿠키(`sessionKey`, HttpOnly)를 씁니다.
- 확장은 `fetch(url, {credentials:'include'})`로 요청만 보냅니다. 쿠키를 읽지 않으므로 `cookies` 권한이 필요 없습니다.
- 운영 중인 확장 claude-monitor v1.14.3(2026-08)이 서비스 워커에서 이 방식으로 동작합니다. [소스]

**호출 1: 조직 탐색**
```
GET https://claude.ai/api/organizations
Accept: application/json
```
- 응답은 배열입니다. `capabilities`에 `"chat"`이 들어 있는 조직을 고르고, 식별자는 `uuid`를 씁니다.
- `rate_limit_tier` 문자열(`max_20x`, `max_5x`, `pro`, `team` 등)로 플랜 라벨을 만듭니다.
- 결과는 24시간 캐시합니다. `/usage`가 404를 주면 다시 탐색합니다. [소스: claude-monitor background.js, CodexBar]

**호출 2: 사용량과 reset 권**
```
GET https://claude.ai/api/organizations/{uuid}/usage?cedar_ember=1
Accept: application/json
```
- 상태가 200/401/429 중 하나가 아니고 Cloudflare 챌린지도 아니면, `cedar_ember` 없이 한 번 재시도합니다. 이 규칙은 CodexBar 2026-09-27 커밋 `68916f98`, `9bcab580`과 같습니다. [소스]
- 인증 없는 요청은 Cloudflare 403(`Cf-Mitigated: challenge`)을 받습니다. [프로브]

| 표시 항목 | 응답 필드 | 형식 |
|---|---|---|
| 5시간 사용률 | `limits[kind=session].percent`, 없으면 `five_hour.utilization` | % (0-100, 초과 사용 시 100 초과 가능) |
| 5시간 reset | `five_hour.resets_at` / `limits[].resets_at` | ISO-8601. `null`이면 창이 아직 시작되지 않음 |
| 7일 전체 | `limits[kind=weekly_all]`, 없으면 `seven_day` | 위와 동일 |
| 모델별 7일 | `limits[kind=weekly_scoped].scope.model.display_name`, `seven_day_opus`, `seven_day_sonnet` | 해당 없는 플랜은 `null` |
| Extra usage | `extra_usage.{is_enabled, used_credits, monthly_limit, currency}` | 금액 단위는 cents |

- `limits` 배열은 2026-07 무렵 추가됐습니다. Settings > Usage 화면이 이 배열을 렌더링합니다. 배열이 있으면 우선 쓰고, 없으면 flat 필드로 fallback합니다. [소스, medium]
- `resets_at`에는 호출마다 소수초 흔들림이 있습니다. 새 창인지 비교할 때는 분 단위로 반올림합니다.

**reset 권 (`cedar_ember`)** [소스: CodexBar ClaudeRateLimitResetCredits.swift, vinzdg/codenotch 문서, lidge-jun/opencodex]
```json
"cedar_ember": {
  "eligible": true,
  "ineligible_reason": null,
  "grants": [{
    "id": "opus55-launch-promax-20260921",
    "resets_left": 1,
    "resets_total": 1,
    "starts_at": "2026-09-22T16:00:00+00:00",
    "ends_at": "2026-10-22T16:00:00+00:00",
    "paused": false,
    "usable_now": true
  }]
}
```
- **사용 가능 개수**는 다음 조건을 모두 만족하는 grant의 `resets_left` 합입니다.
  - `eligible === true`
  - `!paused`
  - `resets_left > 0`
  - `starts_at <= now < ends_at` (`null`이면 해당 경계 없음)
- **만료 시각**은 `ends_at`의 최솟값입니다.
- 실제 사례: 2026-09-21~22 Opus 5.5 출시 프로모션으로 Pro/Max 사용자에게 1회권이 지급됐고, 10-22 만료였습니다. 5시간 창과 주간 창을 모두 비웁니다.
- 알려진 `ineligible_reason` 값: `config_off`, `tier`, `seat`, `mobile`, `surface`, `cli_version`, `no_grant`, `tenure`, `other_experiment`, `unavailable`, `unknown`.
- 두 번째 프로그램명 `juniper_tide`가 있다는 흔적이 있습니다(low). 파서는 `cedar_ember`에 고정하지 말고, 응답 최상위에서 `grants[]`를 가진 객체를 모두 탐색합니다.
- **호출 금지**: `POST https://api.anthropic.com/api/organizations/{org}/reset_rate_limits`. grant를 되돌릴 수 없게 소모합니다. [소스: sub2api, opencodex]
- grant `id`는 소모에 쓰는 핸들입니다. 원문을 저장하거나 로그에 남기지 않고 SHA-256 해시만 보관합니다.

**미채택 경로**
- `api.anthropic.com/api/oauth/usage`는 Claude Code OAuth 토큰이 필요합니다. 확장은 이 토큰을 정당하게 얻을 수 없습니다.
- 일부 surface에서는 이 경로가 grant에 대해 `eligible:false`를 준다는 보고도 있습니다.

### 1.2 ChatGPT 구독 (Codex 사용 한도): 7일, reset 권

**인증**
1. `GET https://chatgpt.com/api/auth/session`을 `credentials:'include'`로 호출합니다.
2. 응답에서 `accessToken`(JWT)과 계정 id를 얻습니다. 계정 id는 `session.account.id`, 또는 JWT claim `https://api.openai.com/auth`.`chatgpt_account_id`에 있습니다.
3. 응답이 `{}`이거나 HTML이면 '로그인 필요' 또는 '챌린지'로 판정합니다. [소스: ViuMP/Walder, codex-auth-helper]
- 토큰은 메모리와 `chrome.storage.session`에만 둡니다. 디스크에 저장하지 않습니다.

**사용량**
```
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <accessToken>
ChatGPT-Account-Id: <account id>
Accept: application/json
```
- 인증 없이 호출하면 401이 옵니다. `/wham/usage/credits` 같은 가짜 경로는 404이므로, 401은 이 경로에 대한 실제 인증 요구입니다. [프로브]
- 공식 스키마는 openai/codex `RateLimitStatusPayload`입니다. [소스]

| 필드 | 의미 |
|---|---|
| `plan_type` | free, go, plus, pro, prolite, promax, team, business 등 |
| `rate_limit.{allowed, limit_reached}` | 차단 여부 |
| `rate_limit.primary_window` / `secondary_window` | `{used_percent, limit_window_seconds, reset_after_seconds, reset_at}` |
| `reset_at` | Unix epoch **초** (UTC) |
| `additional_rate_limits[]` | 모델/기능별 버킷 (`limit_name`, `rate_limit`) |
| `credits` | 유료 크레딧 `{has_credits, unlimited, balance(문자열)}` |
| `rate_limit_reset_credits` | `{available_count}` (선택 필드) |

- **7일 창은 슬롯 위치가 아니라 `limit_window_seconds`로 찾습니다.**
  - 604800(7일)이면 주간, 18000(5시간)이면 세션 창입니다.
  - 계정에 따라 7일 창이 `primary_window`에 오고 5시간 창이 없을 수도 있습니다.
  - 요청하신 대로 7일 창을 주로 표시하고, 5시간 창이 있으면 보조로 표시합니다(설정에서 끌 수 있음).

**reset 권** [소스: openai/codex backend-client types.rs, rate_limit_resets.rs]
- 요약값은 usage 응답 안의 `rate_limit_reset_credits.available_count`입니다. 추가 요청 없이 얻습니다.
  - 필드 자체가 없으면 0이 아니라 '미지원'으로 취급합니다.
- 상세 목록은 개수가 늘었을 때만 호출합니다.
  ```
  GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits
  -> {available_count, credits:[{id, reset_type, status, granted_at, expires_at|null, title|null, description|null}]}
  ```
- 도입 시점
  - 요약값: openai/codex 커밋 `bef99f8` (2026-06-15)
  - 상세 목록: 커밋 `58ec528` (2026-07-06)
  - 제3자 README(aaamosh/codex-reset)는 2026-06-12에 Go/Plus/Pro/Business 대상으로 롤아웃됐다고 하고, 30일 만료 예시를 보여 줍니다. [소스, medium]
- **호출 금지**: `POST /backend-api/wham/rate-limit-reset-credits/consume`

**한계**
- `wham/usage`는 Codex 한도만 보여 줍니다. GPT 채팅 메시지 한도나 Deep Research 한도를 주는 검증된 API는 없습니다.

### 1.3 Z.ai (GLM Coding Plan): 5시간, 7일, reset 권

**인증**
- Coding Plan API 키를 `Authorization: Bearer <key>`로 보냅니다. [소스: pi-zai-usage, LogicIncZo/zai-usage, CodexBar zai.js]
- 지역별 호스트
  - Global: `api.z.ai`
  - 중국: `open.bigmodel.cn` (키가 따로 있음)

**쿼터**
```
GET https://api.z.ai/api/monitor/usage/quota/limit
Authorization: Bearer <key>
```
- **에러도 HTTP 200으로 옵니다.** 반드시 `body.success === true`를 확인합니다. [프로브]
  - `code 1001`: 헤더 없음
  - `code 401 "token expired or incorrect"`: 잘못된 키
- `data.level`은 플랜입니다(예: `"PRO"`).
- `data.limits[]`의 각 항목은 `type`과 `unit`의 조합으로 식별합니다. 배열 순서에 의존하지 않습니다.

| type | unit | number | 의미 |
|---|---|---|---|
| `TOKENS_LIMIT` (구 플랜은 `CREDIT_LIMIT`) | 3 | 5 | 5시간 창 |
| `TOKENS_LIMIT` | 6 | 1 | 주간(7일) 창 (플랜에 따라 없을 수 있음) |
| `TIME_LIMIT` | 5 | 1 | 월간 MCP/도구 호출 (`currentValue`, `usage`, `remaining`, `usageDetails[]`) |

- `percentage`는 사용률(%)입니다. `nextResetTime`은 epoch **밀리초**입니다.
- `usage`, `remaining`이 오면 CodexBar처럼 이 값들로 %를 다시 계산합니다. [소스]
- CORS: 요청 Origin을 그대로 반사하고 `Allow-Credentials: true`를 보냅니다. preflight에서 `authorization` 헤더를 허용합니다. [프로브]

**reset 권 (reset pack)**
```
GET https://api.z.ai/api/biz/customer-package-reset/list?targetType=PERSONAL
Authorization: Bearer <같은 키>
```
```json
{"code":200,"success":true,"data":{
  "customerId":"41002358991004410","targetType":"PERSONAL",
  "lastFiveHourResetTime":"2026-09-11 06:02:16","lastWeekResetTime":null,
  "fiveHourResets":[{"recordId":910002,"expireTime":"2026-11-07 23:59:59","available":true}],
  "weekResets":[]}}
```
- 5시간용과 주간용 inventory가 분리되어 있습니다. `available:true` 레코드 수를 각각 표시합니다.
- 새 권 탐지: 처음 보는 `recordId`가 나타나거나 `available`이 false에서 true로 바뀌면 새 권으로 봅니다.
- 시간 문자열은 UTC+8로 해석합니다(잠정). 원문은 따로 보관합니다.
- `customerId`는 JS 안전 정수 범위를 넘을 수 있으므로 문자열로 다룹니다.
- 근거 수준은 [소스, medium]입니다.
  - 스키마는 LogicIncZo/zai-usage의 데모 fixture(2026-09-09 v0.1.0)에서 왔습니다.
  - Z.ai 공식 저장소 `zai-org/ZCode`에 `coding-plan-reset.ts`가 있어 기능 자체가 실재한다는 방증이 됩니다.
  - 실제 인증 응답은 아직 캡처하지 못했습니다. Phase 0에서 확인해야 합니다.
- redeem API는 발견되지 않았습니다. 어떤 POST도 호출하지 않습니다.

### 1.4 Poe API: 포인트 일간/주간/월간 [공식]

- 공식 문서: https://creator.poe.com/docs/resources/usage-api
- 인증: `Authorization: Bearer <Poe API key>` (키는 https://poe.com/api/keys 에서 발급)

**잔액**
```
GET https://api.poe.com/usage/current_balance
-> {"current_point_balance": 1500}
```
- 플랜 포인트와 add-on 포인트를 합친 값입니다.

**이력**
```
GET https://api.poe.com/usage/points_history?limit=100&starting_after=<query_id>
-> {has_more, length, data:[{bot_name, creation_time, query_id, cost_usd, cost_points,
     cost_breakdown_in_points, usage_type, chat_name?, canvas_tab_name?, api_key_name?}]}
```
- `creation_time`은 Unix **마이크로초**입니다.
- `usage_type`은 `Chat`, `API`, `Canvas App` 중 하나입니다.
- `limit`은 최대 100, 기본 20입니다. 결과는 최신순이고, 보존 기간은 **30일**입니다. 날짜 필터 파라미터는 없습니다.

**집계 설계**
- 증분 수집: 마지막으로 저장한 `query_id` 또는 `creation_time`에 닿을 때까지 페이지를 넘깁니다.
- 로컬 원장: IndexedDB에 `query_id`를 기본 키로 누적합니다.
- 합산: 사용자 타임존의 달력 경계(일, ISO 주, 월)로 `cost_points`를 합칩니다.
- 데이터가 모자란 경우: 설치 이후 누적분이 월 시작 시점까지 닿지 않으면 월 합계에 '부분 데이터' 표시를 붙입니다.
- 설정 `usage_type` 필터: 기본은 전체이고, API와 Chat을 분리해서 보여 줍니다.
- CORS: preflight가 `*`이고 Authorization 헤더를 허용합니다. [프로브]
- 구독 포인트 갱신일은 API로 제공되지 않습니다.

### 1.5 LiteLLM Proxy: 비용 일간/주간/월간 [소스: BerriAI/litellm main 2026-09-30]

**공통**
- 사용자가 base URL을 입력하면 해당 origin에 대해 `chrome.permissions.request`를 호출합니다(사용자 제스처 필요).
- 인증: `Authorization: Bearer sk-...` 또는 `x-litellm-api-key`. 운영자가 헤더 이름을 바꿀 수 있으므로 설정에 노출합니다.
- CORS 기본값은 origins `*`, credentials false입니다. Bearer 헤더를 쓰는 fetch는 문제가 없습니다.

**A. 가상키만 가진 사용자 (기본 모드)**
1. `GET /key/info`를 파라미터 없이 호출하면 호출한 키 자신의 정보가 나옵니다.
   - `info.spend`: 현재 예산 창의 지출
   - `max_budget`, `budget_duration`
   - `budget_reset_at`: 예산 창이 끝나는 시각. 7d는 월요일, 30d/1mo는 1일로 스냅됩니다.
   - `user_id`, `key_alias`, `status`
2. `GET /user/daily/activity/aggregated?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&user_id=<own>&include_current_utc_day=true`
   - 응답: `results[].date`(UTC 일 버킷), `metrics.spend`, `breakdown.models/providers/api_keys`
   - 최근 31일을 한 번에 받고, 일/주/월 합계는 클라이언트에서 계산합니다.
   - 구버전 fallback은 `GET /user/daily/activity`(`page_size`는 최대 1000)입니다. 이때 `metadata.total_spend`는 해당 페이지만의 합계이므로 페이지 전체를 더해야 합니다.
3. `user_id`가 없는 서비스 계정 키는 403을 받습니다. 이 경우 두 가지 중 하나로 처리합니다.
   - `GET /spend/logs?api_key=...&start_date&end_date` (deprecated이고 10,000행 제한이 있음)
   - 또는 `/key/info`의 예산 창 지출만 표시

**B. 관리자 (master 또는 proxy_admin 키)**
- `/user/daily/activity/aggregated`에서 `user_id`를 생략하면 전체 사용자 합계가 나옵니다.
- `/global/spend/report?group_by=api_key|team|customer`는 그룹별 보고서입니다.

**주의 사항**
- 하루 경계는 **UTC 버킷 고정**입니다. 주/월도 UTC 일을 합산하므로 UI에 'UTC'를 표기합니다.
- DB가 없는 프록시는 500을 줍니다. 404는 버전 차이로 보고 위의 fallback 체인으로 내려갑니다.

### 1.6 OpenRouter: 비용 일간/주간/월간 [공식]

**키 단위 (일반 키)**
```
GET https://openrouter.ai/api/v1/key
Authorization: Bearer <key>
```
- `data` 필드
  - 사용량: `usage`(전체 기간), `usage_daily`(현재 **UTC 일**), `usage_weekly`(현재 **UTC 주, 월요일 시작**), `usage_monthly`(현재 **UTC 월**)
  - BYOK: `byok_usage*`
  - 한도: `limit`, `limit_remaining`, `limit_reset`
  - 기타: `is_free_tier`, `free_model_daily_requests`
- 단위는 USD 크레딧입니다. 서버가 기간 합계를 직접 주므로 추가 집계가 필요 없습니다.
- 출처: https://openrouter.ai/docs/api-reference/limits

**계정 전체 (관리키 모드, 선택)**
- `GET https://openrouter.ai/api/v1/keys?include_disabled=true&offset=N`
  - 키마다 `usage_daily/weekly/monthly`가 들어 있습니다. 모두 더하면 오늘분까지 포함한 계정 합계가 됩니다.
  - `workspace_id` 필터가 있습니다.
  - 출처: https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys.md
- `GET /api/v1/activity`
  - 최근 30일 중 완료된 UTC 일만, 모델별로 제공합니다(오늘 제외).
  - 이력 차트에만 씁니다.

**주의 사항**
- 모니터링 전용 키를 새로 만들면 그 키의 사용량만 보입니다. 실제로 쓰는 키를 입력하거나 관리키 모드를 써야 합니다.
- CORS preflight는 `*`이고 Authorization을 허용합니다. [프로브]

---

## 2. 요약 매트릭스

| Provider | 인증 | 표시 창 | reset 시각 소스 | reset 권 신호 | 근거 수준 |
|---|---|---|---|---|---|
| Claude | claude.ai 세션 쿠키 | 5시간, 7일, 모델별 7일 | `resets_at` (ISO) | `usage?cedar_ember=1`의 `cedar_ember.grants[]` | [소스] 다수 교차 |
| ChatGPT | chatgpt.com 세션에서 받은 accessToken | 7일 (5시간은 보조) | `reset_at` (epoch 초) | `rate_limit_reset_credits.available_count`와 목록 API | [소스] 공식 클라이언트 |
| Z.ai | API 키 (Bearer) | 5시간, 7일, MCP 월간 | `nextResetTime` (epoch ms) | `customer-package-reset/list` | 쿼터: [소스], 권: [소스, medium] |
| Poe | API 키 | 일/주/월 (로컬 계산) | 해당 없음 | 해당 없음 | [공식] |
| LiteLLM | 가상키 또는 관리키 | 일/주/월 (UTC 일 합산) | 예산 `budget_reset_at` | 해당 없음 | [소스] |
| OpenRouter | API 키 또는 관리키 | 일/주/월 (서버 제공, UTC) | 해당 없음 (`limit_reset`은 정책명) | 해당 없음 | [공식] |

---

## 3. 아키텍처

```
+-------------------+  +------------------+  +---------------------------+
| Popup (한눈 보기) |  | Options (설정)   |  | Side Panel (이력, 2단계)  |
+---------+---------+  +--------+---------+  +-------------+-------------+
          |  chrome.runtime 메시지 / storage.onChanged 구독  |
+---------v---------------------------------------------------v---------+
| Service Worker                                                         |
|  Scheduler (chrome.alarms: 1분 tick + reset 시각 one-shot 알람)       |
|    -> ProviderRegistry -> Adapter x6 (claude, chatgpt, zai, poe,      |
|                                         litellm, openrouter)          |
|         -> SafeFetch (GET 전용 allowlist, 15초 타임아웃, 백오프,      |
|                       민감 헤더 로그 제거)                             |
|         -> TabBridge (Cloudflare 챌린지 시 열린 claude.ai/chatgpt.com |
|                       탭에 scripting.executeScript로 같은 origin fetch)|
|    -> Normalizer (스키마 관대 파싱, 알 수 없는 필드 보존)              |
|    -> SnapshotStore (storage.local, 마지막 정상값 캐시)               |
|    -> ResetDetector (reset 권 inventory diff, 조기 리셋 휴리스틱)     |
|    -> Presenter (action badge, notifications)                         |
|  PoeLedger / History (IndexedDB)                                      |
+------------------------------------------------------------------------+
```

### 3.1 manifest 설계 (MV3)
```json
{
  "manifest_version": 3,
  "name": "LLM Usage Glance",
  "permissions": ["storage", "alarms", "scripting"],
  "optional_permissions": ["notifications"],
  "optional_host_permissions": [
    "https://claude.ai/*", "https://chatgpt.com/*",
    "https://api.z.ai/*", "https://open.bigmodel.cn/*",
    "https://api.poe.com/*", "https://openrouter.ai/*",
    "https://*/*", "http://*/*"
  ],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html" },
  "options_ui": { "page": "options.html", "open_in_tab": true }
}
```
- **모든 호스트 권한을 optional로 둡니다.** 사용자가 옵션 화면에서 provider를 켤 때 그 origin만 요청합니다. 설치 시 경고가 최소화되고 스토어 심사에도 유리합니다.
- `https://*/*`와 `http://*/*`는 LiteLLM처럼 사용자가 입력한 origin을 **정확히 그 origin만** 런타임에 요청하기 위한 선언입니다. `http://localhost:4000` 같은 경우를 포함합니다.
- `scripting`은 Cloudflare fallback(TabBridge)에만 씁니다. 상시 content script는 등록하지 않습니다.
- `cookies`, `tabs`, `webRequest` 권한은 쓰지 않습니다. 호스트 권한만으로 해당 origin 탭의 URL 조회와 쿠키 포함 fetch가 가능합니다.

### 3.2 실행 컨텍스트와 인증 흐름
- **기본 경로**: 서비스 워커에서 `fetch`합니다.
  - 호스트 권한이 있으면 CORS 제약이 없습니다. [공식: Chrome network-requests 문서]
  - claude.ai와 chatgpt.com은 `credentials:'include'`로 세션 쿠키를 보냅니다.
  - 쿠키가 실제로 실린다는 근거는 운영 중인 MV3 확장 두 개입니다. [소스]
    - claude-monitor v1.14.3: 권한 storage/alarms만 사용, 서비스 워커에서 5분마다 `/usage` 호출
    - codex-auth-helper: 서비스 워커에서 `chatgpt.com/api/auth/session` 호출
  - **다만 Chrome 공식 문서에는 확장 fetch의 SameSite 쿠키 처리를 보장하는 문장이 없습니다.** Chromium `cookie_util.h`에는 "extension initiator에 SameSite 무시를 강제하지 않는다"는 주석이 있습니다.
    - 따라서 실제로는 동작하지만 공식 보장은 없습니다. 서드파티 쿠키 정책이 바뀌면 깨질 수 있어 TabBridge fallback이 필수입니다.
- **Cloudflare 챌린지 판정**: 403이면서 `cf-mitigated: challenge` 헤더가 있거나, 본문이 HTML `Just a moment...`인 경우입니다.
- **fallback (TabBridge)**
  1. `chrome.tabs.query({url:'https://claude.ai/*'})`로 열린 탭을 찾습니다.
  2. `chrome.scripting.executeScript({target:{tabId}, world:'ISOLATED', func, args:[path]})`로 그 탭에서 같은 origin fetch를 실행합니다.
  3. 결과 JSON만 돌려받습니다.
  - MAIN world는 페이지 스크립트의 간섭에 노출되므로 쓰지 않습니다.
  - 열린 탭이 없으면 '챌린지 해제 필요' 상태와 [claude.ai 열기] 버튼을 보여 줍니다. 탭 로드가 끝나는 `tabs.onUpdated` complete 이벤트에서 다시 폴링합니다.
- **offscreen document는 쓰지 않습니다.** 확장 origin이라 사이트의 1st-party 컨텍스트가 아니어서 우회 수단이 되지 않습니다. [공식]
- **Origin/Referer 헤더 위조(declarativeNetRequest)는 쓰지 않습니다.** 정책 위험이 있고 필요하지도 않습니다.

### 3.3 스케줄러와 갱신 전략
- `chrome.alarms` 반복 알람 `tick`을 1분 간격으로 둡니다. Chrome은 최소 30초를 보장하지만 지연될 수 있습니다. [공식]
- provider마다 `nextDueAt`을 `storage.local`에 저장하고, tick에서 기한이 된 provider만 실행합니다.

| 대상 | 기본 주기 | 비고 |
|---|---|---|
| Claude usage (reset 권 포함) | 3분 | 같은 호출로 reset 권도 갱신 |
| ChatGPT usage (reset 권 개수 포함) | 3분 | 개수가 바뀔 때만 상세 목록 호출 |
| Z.ai quota | 3분 | |
| Z.ai reset pack 목록 | 5분 | |
| OpenRouter | 10분 | |
| Poe 증분 이력 | 10분 | |
| LiteLLM | 10분 | |

- 사용자는 provider별로 1-60분 사이에서 조정할 수 있습니다. 1분 미만은 허용하지 않습니다. 오픈소스 도구들의 하한도 60초입니다.
- **팝업을 열면** 캐시를 즉시 렌더링하고, 30초 이상 지난 provider는 바로 갱신합니다(stale-while-revalidate).
- **reset 직후 반영**: 각 창의 `resetsAt + 15초`에 one-shot 알람(`reset:<provider>:<window>`)을 걸어 해당 provider를 갱신합니다.
- **서비스 워커 수명 대응**: 30초 동안 이벤트가 없거나, fetch 응답이 30초 넘게 오지 않으면 워커가 종료됩니다. [공식]
  - 전역 변수는 믿지 않습니다.
  - 각 adapter 결과는 끝나는 대로 즉시 저장합니다(`Promise.allSettled`, `AbortSignal.timeout(15000)`).
- **예의**: 선택 권한 `idle`을 켜면 잠금 상태나 유휴 상태에서 폴링 주기를 3배로 늘립니다(선택 기능).

### 3.4 SafeFetch: 읽기 전용 가드 (필수)
- 메서드는 **GET만** 허용합니다.
- URL은 provider별 allowlist 정규식에 맞아야 합니다.
- `/consume`, `/reset_rate_limits`, `/redeem`, `/use` 패턴은 명시적으로 차단합니다.
- 이 규칙을 유닛 테스트로 고정합니다. reset 권을 실수로 소모하는 사고를 구조적으로 막기 위해서입니다.
- Authorization, Cookie, 토큰, grant id는 로그와 에러 메시지에서 제거합니다.

### 3.5 저장소 설계

| 데이터 | 위치 | 비고 |
|---|---|---|
| 설정 (비밀 아님) | `storage.local` | |
| API 키 (Z.ai, Poe, OpenRouter, LiteLLM) | `storage.local` (기본). 선택으로 패스프레이즈 잠금 적용 | 패스프레이즈 잠금: PBKDF2로 키를 유도해 WebCrypto AES-GCM으로 암호화. 잠금을 해제하면 `storage.session`에 복호화된 값을 보관 |
| ChatGPT accessToken | 메모리와 `storage.session` (TRUSTED_CONTEXTS) | 디스크 저장 금지. 401이면 다시 조회 |
| 마지막 정상 스냅샷 | `storage.local` | 팝업 즉시 표시용 |
| reset 권 식별자 | `storage.local`에 SHA-256 해시만 | 원문 id는 소모 핸들 |
| Poe 이력 원장 | IndexedDB (`query_id` 기본 키, `creation_time` 인덱스), 13개월 보존 | |
| 일별 이력 (차트용) | IndexedDB | LiteLLM, OpenRouter, 구독 스냅샷 |

- 용량: `storage.local`과 `storage.session`은 각각 10MB입니다. `local`은 `unlimitedStorage` 권한으로 늘릴 수 있습니다. 큰 이력은 IndexedDB에 둡니다. [공식]
- Chrome은 민감한 데이터에 `storage.session`을 권장합니다. [공식] 다만 API 키를 session에만 두면 브라우저를 재시작할 때마다 다시 입력해야 합니다.
- 그래서 기본은 `local` 평문(프로필 디렉터리 보호에 의존)으로 두고, 보안을 원하는 사용자는 패스프레이즈 잠금을 쓰게 합니다. 이 트레이드오프를 옵션 화면에 명시합니다.
- 상시 content script가 없으므로 `storage.local`이 content script에 노출되는 경로가 없습니다. TabBridge로 주입하는 함수도 storage에 접근하지 않습니다.

---

## 4. 데이터 모델 (정규화 스키마, TypeScript)

```ts
type ProviderId = 'claude' | 'chatgpt' | 'zai' | 'poe' | 'litellm' | 'openrouter';

type WindowKind =
  | 'session_5h' | 'weekly_7d' | 'weekly_model'   // 구독형
  | 'monthly_tool'                                 // Z.ai MCP
  | 'day' | 'week' | 'month'                       // 비용형
  | 'budget';                                      // LiteLLM 예산 창

interface UsageWindow {
  kind: WindowKind;
  label: string;              // "5시간", "주간 · Opus", "이번주"
  usedPercent?: number;       // 0-100 (초과 가능)
  usedAmount?: number;        // USD, points, calls
  limitAmount?: number;
  unit: 'percent' | 'usd' | 'points' | 'calls' | 'tokens';
  resetsAt?: string | null;   // ISO-8601 UTC. null = 창 미시작
  windowSeconds?: number;
  periodTz?: 'UTC' | 'local' | 'Asia/Shanghai';  // 기간 경계 기준
  partial?: boolean;          // Poe 월간처럼 데이터가 모자란 경우
}

interface ResetGrant {
  provider: 'claude' | 'chatgpt' | 'zai';
  idHash: string;             // SHA-256(provider + raw id)
  scope: 'session_5h' | 'weekly_7d' | 'all' | 'unknown';
  remaining: number;          // Claude resets_left, ChatGPT 1, Z.ai 1
  startsAt?: string | null;
  expiresAt?: string | null;
  title?: string | null;      // ChatGPT title, Claude label
  status: 'available' | 'paused' | 'not_yet' | 'used' | 'expired' | 'unknown';
}

type SnapshotStatus =
  | 'ok' | 'stale' | 'auth_required' | 'challenge' | 'rate_limited'
  | 'schema_changed' | 'permission_missing' | 'not_configured' | 'unsupported' | 'error';

interface ProviderSnapshot {
  provider: ProviderId;
  status: SnapshotStatus;
  plan?: string;              // "Max 20x", "plus", "PRO"
  account?: string;           // 조직명이나 키 라벨 (마스킹)
  windows: UsageWindow[];
  grants: ResetGrant[];
  grantSupport: 'supported' | 'not_eligible' | 'unsupported' | 'n/a';
  balance?: { amount: number; unit: 'usd' | 'points' };
  fetchedAt: string;          // 마지막 성공 시각
  attemptedAt: string;
  error?: { code: string; message: string; retryAt?: string };
}

interface ResetEvent {
  type: 'GRANT_ADDED' | 'GRANT_USED' | 'GRANT_EXPIRING' | 'GRANT_EXPIRED' | 'WINDOW_RESET_EARLY';
  provider: ProviderId;
  scope?: string;
  at: string;
  detail?: string;
}
```

- adapter 인터페이스: `fetchSnapshot(ctx): Promise<ProviderSnapshot>`. `ctx`에는 설정, 비밀값 접근자, SafeFetch, TabBridge, 이전 스냅샷이 들어갑니다.
- 파싱은 valibot/zod의 `passthrough` 계열로 합니다. 필수 필드가 없으면 `schema_changed` 상태로 두고 마지막 정상값을 흐리게 계속 표시합니다.

---

## 5. reset 권 탐지 설계

**provider별 신호**

| Provider | inventory 소스 | 개수 계산 | 스코프 | 만료 |
|---|---|---|---|---|
| Claude | `usage?cedar_ember=1`의 `cedar_ember.grants[]` | 조건을 만족하는 grant의 `resets_left` 합 | 5시간과 주간 모두 | `ends_at` |
| ChatGPT | `wham/usage`의 `rate_limit_reset_credits.available_count`, 개수가 바뀌면 목록 API | `available_count` | `reset_type` (값은 미확정) | `expires_at` |
| Z.ai | `customer-package-reset/list` | `fiveHourResets`와 `weekResets`에서 `available:true`인 레코드 수 | 5시간과 주간을 분리 | `expireTime` (UTC+8) |

**상태 머신**
- 비교 기준: 이전 inventory(`idHash`, remaining)와 현재 inventory
- 이벤트 조건
  - `GRANT_ADDED`: 새 해시가 등장하거나 remaining이 증가
  - `GRANT_USED`: remaining이 감소하면서 해당 창의 사용률이 크게 떨어짐. 사용자가 공식 UI에서 사용한 경우입니다.
  - `GRANT_EXPIRING`: 만료 48시간 전
  - `GRANT_EXPIRED`: 만료 시각이 지남
  - `WINDOW_RESET_EARLY` (휴리스틱): 다음 조건을 모두 만족할 때
    - `now < prev.resetsAt - 5분`
    - `usedPercent`가 20%p 이상 급락
    - 같은 시점에 `GRANT_USED`가 없음
    - 표시 문구는 "조기 리셋 감지(원인 미상)"입니다. provider 전체 리셋일 수도, 버그일 수도 있으므로 grant로 단정하지 않습니다.
- **첫 실행 동작**: 이미 가진 권은 '보유 중'으로만 표시하고 '새로 받음' 알림은 보내지 않습니다. 알림 폭주를 막기 위해서입니다.

**'바로 표시'의 의미**
- 어느 provider도 push를 제공하지 않습니다.
- 지연은 폴링 주기(기본 3분)와 팝업을 여는 즉시 갱신으로 결정됩니다.
- 새 권이 생기면 다음이 즉시 일어납니다.
  - 팝업 상단 배너
  - 해당 카드의 칩
  - 배지 (예: 보라색 `R1`)
  - 선택 권한 `notifications`를 켠 경우 OS 알림

**보조 신호 (3단계, 정밀도 낮음)**
- `status.claude.com/api/v2/incidents.json` (CORS `*`) [프로브]
- `status.openai.com` RSS
- 위 두 곳에서 "reset" 또는 "limits" 키워드를 매칭해 'provider 공지' 칩을 표시합니다.

---

## 6. UI/UX 설계

### 6.1 팝업 (폭 약 380px, 스크롤 없이 한 화면 목표)
```
+------------------------------------------------------------+
| LLM Usage                        14:02 갱신  [새로고침] [설정]|
+------------------------------------------------------------+
| [리셋권] 사용 가능 2개: Claude 1 (10/22 만료) · Z.ai 5h 1   |
+-- 구독 -----------------------------------------------------+
| Claude  Max 20x                                   [리셋권 1]|
|   5시간  ########....  68%   2시간 13분 뒤 (16:15)          |
|   7일    ###.........  31%   10/06(월) 09:00                |
|   > 모델별 주간: Opus 12% · Fable 40%                       |
| ChatGPT  Plus (Codex)                                       |
|   7일    #####.......  52%   10/04(토) 21:10                |
|   5시간  #...........  10%   (보조)                         |
| Z.ai  GLM Coding Pro                              [5h권 1]  |
|   5시간  ######......  47%   1시간 05분 뒤                  |
|   7일    ##..........  18%   10/05(일) 11:00                |
|   MCP 월간 38/100                                           |
+-- API 비용 ------------------- 오늘 ·  이번주 ·  이번달 ----+
| OpenRouter (UTC)                $1.23 ·  $4.56 ·  $12.34    |
| LiteLLM    (UTC)                $0.80 ·  $3.10 ·   $9.90    |
| Poe        (pt)                 1.2k  ·  8.4k  ·  31k*      |
|                                   잔액 120k pt  *부분 데이터|
+------------------------------------------------------------+
```

**상태 표현**
- 정상
- 오래됨: 회색, "N분 전"
- 로그인 필요: [claude.ai 열기] 버튼
- 키 오류
- Cloudflare 확인 필요
- API 변경 감지: 마지막 값을 흐리게 표시하고 "업데이트 필요" 안내
- 미설정: [설정하기] 버튼

**색상 규칙**
- 70% 미만: 기본색
- 70-89%: 주황
- 90% 이상: 빨강
- 100%: '한도 도달'

**reset 시각**
- 상대시간(24시간 이내일 때)과 로컬 절대시각을 함께 표시합니다.
- 툴팁에는 원래 기준 시간대(UTC, UTC+8)와 원문 값을 보여 줍니다.

**기간 기준 표기**
- OpenRouter와 LiteLLM은 서버 기준인 UTC로 고정하고 라벨로 표시합니다.
- Poe는 사용자 타임존(기본 Asia/Seoul)과 주 시작 요일(기본 월요일) 설정을 따릅니다.

### 6.2 툴바 배지
- 기본 표시값: 구독 5시간 창 사용률 중 최댓값(예: `68`)과 임계값에 맞는 색
- 사용 가능한 reset 권이 있으면 배지를 `R1`, `R2`처럼 보라색으로 바꿀 수 있습니다(설정).
- 오류가 있으면 `!`를 표시합니다.

### 6.3 옵션 페이지
1. **Provider 카드**: 켜기/끄기(이때 호스트 권한 요청), 연결 테스트 버튼, 상태 표시
   - Claude: 조직 선택(여러 개일 때)
   - ChatGPT: 워크스페이스 계정 선택, 5시간 창 보조 표시 여부
   - Z.ai: 지역(Global/China), API 키
   - Poe: API 키, `usage_type` 필터(전체, API만, Chat만)
   - OpenRouter: 모드(키 단위/관리키 계정 전체), 키 입력
   - LiteLLM: base URL, 키, 헤더 이름, 모드(사용자/관리자)
2. **갱신 주기**: provider별 설정
3. **알림**: 새 reset 권, 만료 임박, 사용률 80%/95% 도달, 조기 리셋 감지
4. **표시**: 타임존, 주 시작 요일, 배지 모드, 언어(ko/en)
5. **보안**: 패스프레이즈 잠금, 모든 데이터 삭제
6. **진단**: 마지막 응답의 마스킹된 스키마 보기. API 변경 제보에 씁니다.

### 6.4 사이드 패널 (2단계)
- 30일 추이 차트
  - 구독 사용률 곡선
  - OpenRouter/LiteLLM 일별 비용과 모델별 분해
  - Poe 봇별 포인트
- reset 권 이벤트 타임라인

---

## 7. 오류 처리와 복원 전략

| 상황 | 판정 기준 | 동작 |
|---|---|---|
| 로그인 필요 | Claude 401. ChatGPT session이 `{}`이거나 `accessToken` 없음 | 폴링을 멈추고 '로그인 필요' 표시. 해당 사이트 탭 로드 이벤트에서 재개 |
| Cloudflare 챌린지 | 403과 `cf-mitigated` 헤더, 또는 HTML 본문 | TabBridge 시도. 실패하면 '사이트 열기' 안내 |
| 토큰 만료 | ChatGPT 401 | session을 한 번 다시 조회하고 재시도 |
| 키 오류 | Z.ai `success:false` 401/1001, Poe `invalid_api_key`, OpenRouter/LiteLLM 401 | '키 확인' 표시, 폴링 중지 |
| 권한 부족 | LiteLLM 403 (서비스 계정 등), OpenRouter 403 (관리키 필요) | fallback 체인으로 내려가고, 끝까지 실패하면 안내 |
| 레이트 리밋 | 429 | `Retry-After`를 따르고, 없으면 지수 백오프(최대 60분) |
| 서버/네트워크 오류 | 5xx, 타임아웃 | 지수 백오프(최대 30분), 마지막 값 유지 |
| 스키마 변경 | 필수 필드 검증 실패 | `schema_changed`로 표시하고 마지막 정상값을 흐리게 유지. 진단 화면에 마스킹 스키마 표시 |
| 엔드포인트 부재 | LiteLLM 404, Claude `cedar_ember` 거부 | 구버전 경로로 fallback하거나 reset 권 없이 사용량만 표시 |
| 권한 미부여 | `chrome.permissions.contains`가 false | '권한 허용' 버튼 표시 |

---

## 8. 보안, 개인정보, 스토어 정책

- **원격 코드 없음**: MV3는 원격 코드를 금지합니다. 모든 로직은 패키지에 포함합니다. [공식]
- **텔레메트리 없음**: 데이터는 각 provider와의 통신에만 쓰이고 제3자 서버로 보내지 않습니다.
- **최소 권한**: provider를 켤 때만 해당 origin을 요청합니다. `cookies` 권한 없이 쿠키 원문을 전혀 읽지 않습니다.
- **읽기 전용 가드(3.4)**: redeem/consume 호출이 구조적으로 불가능하도록 막습니다.
- **키 관리**
  - 입력 필드는 마스킹합니다.
  - '연결 테스트' 버튼을 제공합니다.
  - 가능하면 권한이 좁은 키를 쓰도록 안내합니다. 예: OpenRouter는 실사용 키를 쓰고, 관리키는 권한이 크다는 경고를 보여 줍니다.
- **Chrome Web Store**
  - 단일 목적 문구: "사용자 본인의 LLM 구독 한도와 API 비용을 한곳에 표시"
  - 개인정보처리방침: 수집하지 않음, 로컬 저장만 함
  - Limited Use 준수
  - 호스트 권한별 사용 사유 기재
  - 유사한 확장(claude-monitor 등)이 이미 배포되어 있지만 심사 통과를 보장하지는 않습니다. 반려되면 팀 내부 배포(unpacked/자체 호스팅 CRX 정책)를 대안으로 씁니다.
- **약관 리스크**: Claude, ChatGPT, Z.ai 사용량 API는 비공개 내부 API입니다. 본인 데이터를 낮은 빈도로 읽기만 하더라도 약관상 자동화 접근으로 해석될 여지가 있습니다. README와 옵션 화면에 고지합니다.

---

## 9. 기술 스택과 프로젝트 구조

**스택 (권장)**
- WXT: MV3 빌드, HMR, manifest 생성
- TypeScript (strict)
- Preact: 팝업 번들을 작게 유지
- valibot: 경량 스키마 검증
- idb: IndexedDB 래퍼
- vitest: 유닛 테스트
- Playwright: 확장 로드 E2E와 네트워크 모킹

**디렉터리**
```
src/
  entrypoints/
    background.ts          # 스케줄러와 메시지 라우팅
    popup/                 # 한눈 보기 UI
    options/               # 설정
    sidepanel/             # 2단계
  providers/
    types.ts               # 4장의 정규화 모델
    claude.ts  chatgpt.ts  zai.ts  poe.ts  litellm.ts  openrouter.ts
    schemas/               # provider별 valibot 스키마 (passthrough)
  core/
    safe-fetch.ts          # GET allowlist, 타임아웃, 마스킹
    tab-bridge.ts          # Cloudflare fallback
    scheduler.ts           # alarms, nextDueAt, reset one-shot
    backoff.ts
    periods.ts             # 일/주/월 경계 (타임존, 주 시작 요일)
    reset-detector.ts      # inventory diff 상태 머신
    storage.ts  secrets.ts # local/session, 패스프레이즈 잠금
    poe-ledger.ts          # IndexedDB 증분 원장
  fixtures/                # Phase 0에서 캡처한 마스킹 응답
tests/
```

---

## 10. 테스트와 검증 계획

- **adapter별 fixture 테스트**: Phase 0에서 캡처해 마스킹한 실제 응답을 씁니다. 아래 경계 사례를 포함합니다.
  - `null` 창, 주간 창 없음, 100% 초과
  - `limits` 배열 없음(flat 필드 fallback)
  - `cedar_ember`가 `null`이거나 `eligible:false`
  - ChatGPT에서 7일 창이 `primary_window`에 오는 경우
  - Z.ai `success:false`
  - Cloudflare HTML 응답
  - session `{}`
- **기간 계산 테스트**
  - UTC와 로컬 경계, 주 시작 요일, 월말
  - Poe 마이크로초 변환
  - DST가 있는 타임존
- **reset 탐지 테스트**
  - 추가, 사용, 만료, 첫 실행 무알림
  - 조기 리셋 휴리스틱의 오탐 방지: 예정된 롤오버와 구분
- **SafeFetch 테스트**: POST 차단, 금지 경로 차단, 헤더 마스킹
- **E2E**: Playwright로 unpacked 확장을 로드하고 route 모킹으로 팝업 렌더링을 검증합니다. 데스크톱 폭과 좁은 폭을 모두 확인합니다.
- **수동 QA**
  - 실제 계정 6종 연결
  - Cloudflare fallback 강제 시나리오
  - 권한 거부와 재허용
  - 브라우저 재시작 후 복원

---

## 11. 단계별 로드맵 (1인 기준 약 2-3주)

| 단계 | 기간 | 산출물 |
|---|---|---|
| Phase 0 스파이크 | 1일 | 실제 응답 캡처와 fixture화. 서비스 워커 쿠키 동작과 Cloudflare 동작 확인. 미검증 항목(14장) 해소 |
| Phase 1 MVP | 3-4일 | 골격(WXT, SafeFetch, 스케줄러, 저장소). Claude/ChatGPT/Z.ai의 창, reset 시각, reset 권 표시. 팝업 |
| Phase 2 | 3-4일 | OpenRouter(키/관리키), Poe(원장), LiteLLM(fallback 체인). 옵션 페이지. 키 저장과 잠금 |
| Phase 3 | 2-3일 | 알림, 배지, reset 직후 갱신, 조기 리셋 휴리스틱, 상태 피드 |
| Phase 4 | 2-3일 | 사이드 패널 이력, i18n, 스토어 제출 자료(개인정보처리방침, 권한 사유, 스크린샷) |

---

## 12. 리스크 목록

| 리스크 | 영향 | 가능성 | 대응 |
|---|---|---|---|
| 비공개 API 스키마 변경 (Claude `limits`/`cedar_ember` 등) | 표시 중단 | 높음 (2026-07, 2026-09에도 변경됨) | 관대 파싱, `schema_changed` 상태, fixture 회귀 테스트, 빠른 패치 배포 |
| Cloudflare가 서비스 워커 요청을 차단 | Claude/ChatGPT 불가 | 중간 | TabBridge fallback, 사이트 열기 안내 |
| Chrome 쿠키 정책 변경 (확장 fetch에 쿠키 미첨부) | Claude/ChatGPT 불가 | 낮음-중간 (공식 보장 없음) | TabBridge로 같은 origin fetch. 옵션 화면 진단에 표시 |
| reset 권 오소모 | 사용자 손실 | 낮음 (설계로 차단) | SafeFetch GET 전용 allowlist와 테스트 |
| 약관 또는 스토어 반려 | 배포 불가 | 중간 | 최소 권한, 고지, 내부 배포 대안 |
| Z.ai reset pack 스키마가 fixture 기반 | 오표시 | 중간 | Phase 0에서 실측, 파싱 실패 시 권 표시 숨김 |
| Poe 30일 보존 | 월간 불완전 | 확정 | 로컬 원장과 '부분 데이터' 표시 |
| LiteLLM 버전과 권한 차이 | 일부 사용자 불가 | 중간 | fallback 체인, 진단 화면 |
| API 키 평문 저장 | 로컬 유출 시 노출 | 낮음 | 패스프레이즈 잠금 옵션, 권한 좁은 키 안내 |

---

## 13. 사용자 결정 필요 사항 (기본값 제안, 어느 것도 착수를 막지 않음)

1. **ChatGPT 5시간 창**: 요청은 7일만입니다. 기본값은 "5시간 창이 있으면 보조로 표시"입니다.
2. **Poe 집계 범위**: 기본값은 "전체(Chat+API), 분리 표시"입니다. API만 보고 싶으면 필터로 바꿉니다.
3. **OpenRouter 범위**: 기본값은 "입력한 키 단위"이고, 관리키를 넣으면 계정 전체로 전환합니다.
4. **LiteLLM 모드**: 기본값은 "가상키 사용자"입니다.
5. **기간 기준**: 기본값은 Poe에만 로컬(Asia/Seoul), 월요일 시작을 적용하는 것입니다. OpenRouter/LiteLLM은 서버가 UTC로 고정합니다.
6. **배포 방식**: Chrome Web Store 공개와 내부 배포 중 하나를 고릅니다.

---

## 14. 구현 전 확인할 미검증 항목 (Phase 0 체크리스트)

- Claude
  - 실제 응답의 `resets_at` 형식
  - `limits[].group/severity/is_active` 값
  - `cedar_ember` grant의 추가 wire 키(`label`, `clears` 등)
- ChatGPT
  - 플랜별 창 구성(Pro/Business의 5시간 창 존재 여부)
  - `reset_type`/`status` 값
  - 멀티 워크스페이스에서의 `ChatGPT-Account-Id` 동작
- Z.ai
  - reset pack 목록의 실제 인증 응답, 시간대, `available` 의미
  - 같은 키로 인증되는지
  - 주간 창 적용 플랜
- Poe: `cost_points` 부호, 잔액 구성(플랜/add-on 분리 불가 여부)
- OpenRouter: `/credits`에 필요한 키 종류
- LiteLLM: 배포 버전별 `/user/daily/activity/aggregated`와 `include_current_utc_day` 지원 여부
- MV3: 서비스 워커 fetch에 claude.ai/chatgpt.com 쿠키가 실리는지(사용자의 서드파티 쿠키 설정 포함), Cloudflare 동작

---

## 부록: 주요 근거 출처

**공식 문서**
- Poe Usage API: https://creator.poe.com/docs/resources/usage-api, https://creator.poe.com/api-reference/getPointsHistory
- OpenRouter Limits (`/api/v1/key`): https://openrouter.ai/docs/api-reference/limits
- OpenRouter List API keys: https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys.md
- OpenRouter Activity: https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity-grouped-by-endpoint.md
- Chrome: network-requests, storage, alarms, service worker lifecycle, scripting, offscreen, permissions, Web Store 정책 (developer.chrome.com)

**공식 클라이언트 소스**
- openai/codex `codex-rs/backend-client` (`types.rs`, `client.rs`, `client/rate_limit_resets.rs`), 커밋 `bef99f8`, `58ec528`
- BerriAI/litellm `proxy/management_endpoints/*`, `proxy/spend_tracking/*` (main, 2026-09-30)
- zai-org/ZCode `packages/shared/src/coding-plan-reset.ts`

**오픈소스 선행 사례**
- steipete/CodexBar (Claude web, `cedar_ember`, Codex, z.ai, Poe, LiteLLM, OpenRouter)
- claude-monitor/claude-monitor-browser-extension (MV3, v1.14.3)
- vinzdg/codenotch (claude-resets 문서)
- lidge-jun/opencodex (anthropic-reset-grants.ts)
- Wei-Shaw/sub2api (redeem 경로 확인용)
- LogicIncZo/zai-usage (reset pack)
- danielgap/pi-zai-usage
- ViuMP/Walder (chatgpt-web)
- aaamosh/codex-reset
- rgstephens/poeusage
- btuckerc/usage-bar
