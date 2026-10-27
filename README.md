# LLM Usage Glance

여러 LLM provider의 사용량과 남은 금액을 Chrome 확장의 사이드 패널(브라우저 옆에 도킹) 한 화면에서 보여 줍니다.

| Provider | 표시 내용 | 인증 |
|---|---|---|
| Claude (구독) | 5시간 / 7일 / 모델별 주간 사용률, 월간 추가 사용액 / 월 지출 한도, reset 권 | claude.ai 로그인 세션 (로그인된 claude.ai 탭 필요) |
| ChatGPT (구독) | 7일(+5시간) 사용 한도, 월간 추가 크레딧 사용량과 현재 잔액, reset 권 | chatgpt.com 로그인 세션 (로그인된 chatgpt.com 탭 필요) |
| Z.ai | 5시간 / 7일 / MCP 월간 사용률과 reset 시각, reset 권 | API 키 |
| Poe | 일 / 주 / 월 사용 포인트, 남은 포인트 | API 키 |
| LiteLLM | 일 / 주 / 월 비용(UTC), 남은 예산 | 가상키 또는 관리키 |
| OpenRouter | 일 / 주 / 월 비용(UTC), 남은 크레딧 | API 키 또는 관리키 |

- 확장 아이콘을 누르면 Chrome 사이드 패널이 열립니다(기본은 브라우저 오른쪽). 폭은 패널 폭에 맞춰 가변(최소 320px)이고 높이는 창 높이를 따릅니다. 패널의 좌/우 위치는 Chrome 설정을 따르며 확장이 강제할 수 없습니다.
- 읽기 전용입니다. GET 요청만 보내며 reset 권을 소모하는 API는 코드가 호출하지 못하게 막혀 있습니다(`src/core/allowlist.ts`, `tests/allowlist.test.ts`).
- 외부 서버로 데이터를 보내지 않습니다. 설정과 마지막 조회 결과는 `chrome.storage`에만 저장합니다. 선택 기능인 휴대폰 동기화를 직접 켠 경우에만 저장된 사용량을 로컬 릴레이(`127.0.0.1`)로 보냅니다.

## 구독 추가 크레딧

Claude와 ChatGPT 카드 아래의 **Extra** 행에서 관측 월과 추가 사용량을 확인합니다.
기존 브라우저 로그인 세션으로 읽기 전용 조회하며 별도 API 키는 필요하지 않습니다.

- **Claude:** `extra_usage`가 제공하는 월간 사용액과 월 지출 한도를 USD로 표시합니다.
  월 지출 한도는 충전된 선불 크레딧 잔액과 다릅니다. 비활성 상태, 0 한도,
  한도 미제공을 구분하며, 제공되지 않은 잔액을 추정하지 않습니다.
- **ChatGPT 개인 구독:** 현재 월 1일부터 조회일까지의 UTC 날짜에 해당하는
  `credit-usage-events`를 제품 구분 없이 합산하고, `usage.credits.balance`의 현재 잔액을
  별도로 표시합니다. 단위 `cr`은 크레딧이며 USD나 리셋권이 아닙니다.
  사용량에 잔액을 더해 가상의 월 한도를 만들지 않습니다. 음수 조정과 음수 잔액은 그대로 표시합니다.
- ChatGPT 이력 API는 날짜 필터·페이지네이션·보존 범위를 제공하지 않으므로
  월간 값은 **서버가 반환한 사용 이력 기준**입니다. Business/Enterprise/Edu 계정에는
  개인 크레딧 이력 API를 사용하지 않으며 월간 추가 사용량이 미제공으로 표시될 수 있습니다.
- 조회 실패나 미지원 응답은 0으로 표시하지 않습니다. 월간 이력만 실패하면 현재 잔액은
  유지하고 사용량은 조회 불가로 표시합니다. 전체 조회 실패 시에는 마지막 성공 데이터의
  관측 월과 오류 상태를 함께 표시합니다.

ChatGPT 응답 계약은 [공식 Codex 클라이언트](https://github.com/openai/codex/blob/160b2b1ef62114eeb41e41e5e3be0000d944b713/codex-rs/backend-client/src/client/analytics.rs)와
[크레딧 이벤트 모델](https://github.com/openai/codex/blob/160b2b1ef62114eeb41e41e5e3be0000d944b713/codex-rs/codex-backend-openapi-models/src/models/analytics.rs)을 기준으로 합니다.

## 시작하기

```
npm install
npm run build
```

1. `chrome://extensions`에서 개발자 모드를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다**로 `dist/` 폴더를 선택합니다.
3. 확장 아이콘을 눌러 열리는 사이드 패널의 설정 버튼으로 옵션 페이지를 열고 provider별 토글을 켠 뒤 접근 권한을 허용하고 **연결 테스트**를 누릅니다.
4. Claude와 ChatGPT는 같은 브라우저 프로필에서 해당 사이트에 로그인해 두고, 조회하려면 그 사이트 탭(claude.ai, chatgpt.com)이 하나 이상 열려 있어야 합니다. 탭이 없으면 요청을 보내지 않고 "로그인된 탭이 필요합니다"로 표시합니다.

## 수집 주기

기본 주기와 최소 주기(분)입니다. 옵션에서 바꿀 수 있고, 저장된 값은 최소 주기 아래로 내려가지 않습니다.

| Provider | 기본 | 최소 |
|---|---|---|
| Claude | 10 | 5 |
| ChatGPT | 10 | 5 |
| Z.ai | 3 | 1 |
| Poe | 10 | 1 |
| LiteLLM | 15 | 10 |
| OpenRouter | 10 | 1 |
| Custom provider | 10 | 1 (최대 60) |

- 서비스 워커는 30초마다 tick을 돌며 주기가 된 provider만 조회합니다. 사용자가 자리를 비웠거나 화면이 잠겨도 수집은 계속됩니다(휴대폰 동기화가 이에 의존합니다). 유휴 상태 게이트는 reset 시각 알람에만 남아 있습니다.
- 마지막 성공 관측 시각 기준으로도 주기를 지키므로, 저장된 다음 실행 시각이 낡았더라도 설정 주기보다 자주 조회하지 않습니다.
- provider는 순차로 조회하고, 스케줄 상태는 조회한 provider 항목만 병합 저장해 동시 실행이 다른 provider의 상태를 덮어쓰지 않습니다.
- 실패 시 재시도: 오류는 설정 주기와 백오프(1분부터 두 배, 최대 30분) 중 긴 쪽, 속도 제한은 `Retry-After`와 백오프(최대 1시간) 중 더 늦은 시각, Cloudflare 챌린지는 1시간부터 두 배씩 최대 6시간 뒤에 다시 시도합니다.

## 로그인 세션 보호 (v0.2.0)

Claude/ChatGPT 웹 접속이 막히거나 로그인이 풀리는 문제를 줄이기 위한 변경입니다. 원인은 서비스 워커가 사용자의 실제 로그인 쿠키를 실어 두 사이트의 비공식 내부 API를 반복 호출한 것으로 보고 수정했으며, 실제 계정에서의 재현과 해소 확인은 하지 못했습니다.

- `claude.ai`, `chatgpt.com`으로 가는 쿠키 포함(`credentials: 'include'`) 요청은 해당 사이트의 로그인된 탭 안에서만 보냅니다. 서비스 워커 직접 요청으로 폴백하지 않으며, 그 외 모든 요청은 쿠키 없이 보냅니다.
- 챌린지(Cloudflare)가 오면 자동 호출을 1시간 이상 멈추는 서킷 브레이커가 동작합니다. 페이지 로드 시 재시도는 로그인 필요(`auth_required`) 상태에서만, 5분 간격으로 한 번 시도합니다.
- Claude/ChatGPT 기본 주기를 10분으로, 최소 주기를 5분으로 올렸습니다. 이전 버전에서 1분 등 더 짧게 저장해 둔 값은 5분으로 올려 적용됩니다.

## 사이드 패널

- `sidePanel` 권한을 사용하며 아이콘 클릭이 곧 패널 열기입니다(`openPanelOnActionClick`). 이전의 팝업(`default_popup`)은 없습니다.
- 대시보드는 팝업과 같은 화면을 재사용합니다. 패널 위치(좌/우)는 Chrome 설정에서 정해집니다.

## 휴대폰 동기화 (선택, 기본 꺼짐)

PC 확장이 저장된 사용량을 로컬 릴레이로 보내면, 릴레이가 이를 휴대폰에서 볼 수 있게 합니다.

```
PC 확장 -> 로컬 릴레이 127.0.0.1:8770 (POST /api/ingest) -> Tailscale -> iPhone (8771)
```

- 릴레이 서버(`src/phone-server/`, 실행 `scripts/phone-relay.ts`)와 폰 웹 화면(`phone/web/`)도 이 저장소에 있습니다. 릴레이는 `npm run phone`으로 실행하며, `127.0.0.1:8770`(확장 -> 릴레이, 쓰기)과 `127.0.0.1:8771`(폰 화면과 읽기 API)에서만 듣습니다. 읽기 API 앞의 Tailscale 구간(예: Tailscale Serve가 8771만 전달)은 이 저장소가 설정하지 않으며 코드로 검증하지 못했습니다.
- 토큰은 처음 실행할 때 `%LOCALAPPDATA%/LLMUsagePhone/credentials.json`(`LLM_PHONE_STATE_DIR`로 변경 가능)에 서로 다른 `readToken`, `writeToken`으로 생성됩니다. 마지막 수신본은 같은 폴더의 `snapshot.json`입니다. 환경변수 `LLM_PHONE_INGEST_PORT`, `LLM_PHONE_READER_PORT`로 포트를, `LLM_PHONE_HOSTS`(쉼표 구분)로 허용할 읽기 호스트 이름을 지정합니다.
- 옵션 페이지의 **휴대폰 동기화** 섹션에서 켭니다. 릴레이의 **쓰기 토큰**(프로바이더 API 키가 아님)을 입력하고 저장하면 `http://127.0.0.1/*` 접근 권한을 요청합니다. 켜기, 토큰, 권한 중 하나라도 없으면 전송하지 않고 상태를 기록합니다.
- 전송은 저장된 사용량 스냅샷만 사용하며 조회를 새로 일으키지 않습니다. 1분 주기 알람(heartbeat)과 설정·스냅샷이 바뀔 때 보냅니다. 요청은 5초 제한, 쿠키 없음, 리다이렉트 불허이며 응답 본문은 읽지 않습니다.
- payload에는 provider별 상태, 사용 창, reset 권, 잔액, 추가 크레딧이 들어가고 API 키·토큰은 들어가지 않습니다. 활성화된 provider만 포함합니다.
- 쓰기 토큰은 `chrome.storage.local`에 암호화 없이 저장됩니다. 토큰은 비밀로 다루고, 릴레이는 `127.0.0.1`에만 바인딩된 상태로 쓰세요. 설정은 브라우저 프로필별로 저장되므로, 확장을 다른 프로필·브라우저에 새로 설치하면 처음부터 다시 설정해야 합니다.
- 켜진 상태에서 provider 설정이 비어 있으면 빈 목록이 전송되어 휴대폰의 기존 표시를 덮어쓸 수 있습니다.
- 연결 문제 확인: 옵션의 휴대폰 동기화 섹션에 마지막 결과가 표시됩니다. `HTTP 401`은 릴레이가 쓰기 토큰을 거부한 것입니다(읽기 토큰을 넣었거나 값이 다른 경우). 릴레이의 `credentials.json`에는 서로 다른 `readToken`과 `writeToken`이 있고, 확장에는 `writeToken`을 넣어야 합니다. `연결 실패 또는 시간 초과`는 릴레이가 `127.0.0.1:8770`에서 실행 중인지 확인하세요.
- Claude/ChatGPT는 해당 사이트의 로그인된 탭이 없으면 "로그인 필요" 상태로 전송되어 휴대폰에도 그렇게 표시됩니다(위 로그인 세션 보호 참고).
- 휴대폰 화면(`phone/web/`)은 v0.2.1부터 한 화면에 들어오도록 압축했습니다. 상단 한 줄(상태 점, 가장 오래된 수집 기준 "N분 전 갱신", 새로고침), 리셋권 한 줄, 구독 카드(막대 한 줄씩), API 비용 표 하나로 구성되며 390x844에서 콘텐츠 높이가 약 650px입니다. PC 전송·릴레이 수신 시각, 연결 해제, 리셋권 상세, 안내 문구는 하단 "상태 · 안내"에 접혀 있습니다. 읽기 키는 이 화면에서 직접 입력하며 탭 세션에만 보관됩니다.

## 개발

| 명령 | 설명 |
|---|---|
| `npm run dev` | Chrome 확장 없이 일반 탭에서 팝업/옵션 UI를 샘플 데이터로 미리보기 (`/dev/index.html`) |
| `npm run phone` | 휴대폰 릴레이 서버 실행 (`scripts/phone-relay.ts`) |
| `npm run probe -- <provider>` | 환경변수의 API 키로 실제 API를 호출해 어댑터 결과를 출력 (`--help` 참고) |
| `npm run typecheck` | 타입 검사 |
| `npm test` | 단위 테스트 |
| `npm run build` | `dist/` 생성 |

`npm run probe`가 읽는 환경변수: `ZAI_API_KEY`, `POE_API_KEY`, `OPENROUTER_API_KEY`, `LITELLM_BASE_URL`, `LITELLM_API_KEY` (선택: `ZAI_REGION`, `OPENROUTER_MODE`, `LITELLM_MODE`).

## Custom provider 추가

1. 확장 설정의 **Custom providers → 프로바이더 추가**를 누릅니다.
2. 이름과 **사용량 JSON URL (GET)**을 입력하고 인증 없음, Bearer API 키, API 키 헤더 또는 브라우저 로그인 세션 중 하나를 선택합니다.
3. 응답의 사용량·한도·사용률·잔액 경로를 입력합니다. 여러 사용량 창을 추가할 수 있고, 잔액만 조회할 때는 기본 사용량 창을 삭제합니다.
4. **저장 및 조회**를 누르고 해당 호스트 접근 권한을 허용하면 즉시 조회하여 팝업에 표시합니다. 이후 지정한 1~60분 주기로 갱신합니다.

예를 들어 응답이 `{"data":{"used":250,"limit":1000,"balance":12.5}}`이면 사용량 경로는 `data.used`, 한도 경로는 `data.limit`, 잔액 경로는 `data.balance`입니다. 배열은 `data.windows[0].used`처럼 지정합니다. 사용률은 0~100 값이며, 사용량과 한도만 지정해도 계산됩니다. 리셋 시각은 ISO 문자열, Unix 초 또는 밀리초를 선택할 수 있습니다.

추가 헤더가 필요하면 JSON 객체로 입력합니다. 설정과 조회 결과는 기존 6개 provider와 별도 저장되며, 기존 설정 저장 버튼과 별개로 저장·편집·비활성화·삭제할 수 있습니다. 조회 실패 시 마지막 성공 값과 오류 상태를 함께 표시합니다.

Custom provider도 GET만 사용하고 리셋권 소모 경로 및 Anthropic inference API 호스트는 차단합니다. 리다이렉트는 허용하지 않으므로 최종 사용량 URL을 입력해야 합니다. 채팅/completions URL만으로 사용량을 알아낼 수는 없으며, provider가 JSON 사용량 조회 API를 제공해야 합니다. `npm run probe`는 기존 provider 전용이고, custom provider는 확장 설정의 연결 테스트를 사용합니다.

## 구조

```
src/providers/   provider별 어댑터 (claude, chatgpt, zai, poe, litellm, openrouter)
src/core/        SafeFetch(GET allowlist), 스케줄러, reset 권 탐지, 저장소, 탭 브리지(로그인된 탭에서만 세션 요청)
src/custom/      custom 설정, 필드 매핑, GET 조회, 별도 저장소와 실행 큐
src/background/  서비스 워커 진입점
src/phone-relay/ 휴대폰 동기화: 확장 쪽(설정 저장, payload 생성, 로컬 릴레이 전송)
src/phone-server/ 로컬 릴레이 서버(ingest 검증, 읽기 API, 정적 서빙)
phone/web/       휴대폰 웹 화면(바닐라 HTML/JS/CSS, 릴레이가 그대로 서빙)
src/popup/       사이드 패널로 열리는 대시보드 UI(디렉터리 이름은 이전 팝업에서 유래)
src/options/     옵션 UI
dev/             확장 없이 UI를 보는 미리보기 하네스
scripts/         실제 API 확인용 CLI
tests/           단위 테스트
```

설계 근거와 조사 기록은 [`.omo/research/final-design-report.md`](.omo/research/final-design-report.md)에 있습니다.

## 알려진 한계

- Claude, ChatGPT, Z.ai의 사용량 API는 공식 문서가 없는 내부 API입니다. 약관상 자동화 접근으로 해석될 수 있고, 응답 구조가 바뀌면 `API 변경 감지` 상태로 표시됩니다.
- Z.ai, Poe, OpenRouter, LiteLLM은 실제 서버로 확인했습니다. Claude 추가 사용량은 실계정 응답으로
  확인했습니다. ChatGPT 크레딧 계약은 공식 Codex 소스와 실계정 사용량 화면으로 확인했으며,
  새 어댑터의 인증된 실서버 요청은 아직 별도로 검증하지 못했습니다.
- ChatGPT 수치는 구독에 포함된 Codex 사용 한도이며 일반 채팅 메시지 한도는 제공되지 않습니다.
- API 키는 `chrome.storage.local`에 암호화 없이 저장됩니다. 패스프레이즈 암호화 코드(`src/core/secrets.ts`)는 있으나 옵션 화면에는 연결하지 않았습니다.
- Poe 사용 이력은 30일만 보존되므로 월간 합계는 설치 이후 누적분 기준입니다.
- Claude/ChatGPT는 해당 사이트의 로그인된 탭이 열려 있을 때만 갱신됩니다. 탭이 없으면 마지막 값이 유지되고 로그인 필요 상태로 표시됩니다.
- 사이드 패널 위치(좌/우)는 확장이 정할 수 없고 Chrome 설정을 따릅니다.
- 검증 범위: 타입체크, 단위 테스트 413개(릴레이 서버 경계 테스트 14개 포함), 빌드는 통과했습니다. 사이드 패널은 임시 프로필 Chrome 156과 Aside에서 직접 열어 확인했으나 v0.2.0 빌드였고, v0.2.1은 Aside에서 다시 로드해 로드와 릴레이 전송 유지까지만 확인했습니다. 확장 -> 릴레이 전송(HTTP 200, 수신 시각이 1분 간격으로 전진)과 릴레이가 서빙하는 폰 화면의 390/375/360/430px 폭 렌더링은 헤드리스 Chrome으로 확인했습니다. 실제 iPhone에서 Tailscale을 거친 확인, 그리고 로그인 세션 보호가 실제 Claude/ChatGPT 계정에서 접속 불능을 해소하는지는 확인하지 못했습니다.
- 같은 사이트에 접속하는 다른 확장(예: 사용량 추적류)도 같은 계정에 요청을 보낼 수 있어, 접속 문제가 계속되면 함께 점검해야 합니다.
