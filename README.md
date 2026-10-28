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
| Claude Platform (API) | 이번달 사용액과 남은 월 한도(UTC 달력 기준, 이월 없음) | Anthropic Admin API 키 |

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
| Claude Platform (API) | 10 | 1 |
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

## 두 번째 Claude 구독 계정 (v0.2.3)

Claude 구독 계정을 두 개 쓰려면 브라우저 프로필을 하나 더 만들어야 합니다(쿠키가 프로필 단위로 분리되므로 한 프로필에서 두 계정의 세션을 동시에 쓸 수 없습니다).

- 두 번째 프로필(또는 다른 브라우저)에 이 확장을 설치하고 두 번째 계정으로 claude.ai에 로그인한 뒤, 옵션의 휴대폰 동기화에서 **계정 라벨**을 다른 값(예: `sub2`)으로 지정합니다. 기본 라벨은 `main`입니다.
- 각 프로필의 확장은 자기 계정의 스냅샷을 릴레이에 라벨별 슬롯으로 올리고, 릴레이 reader(`/api/snapshot`)는 슬롯들을 병합해 돌려줍니다. 라벨이 붙은 계정은 `claude#<라벨>` id와 `Claude · <라벨>` 이름으로 구분됩니다.
- 첫 번째 프로필의 옵션에서 **보조 Claude 계정 표시**를 켜고 릴레이의 읽기 토큰(`credentials.json`의 `readToken`)을 넣으면, 이 확장이 주기적으로 병합 스냅샷을 읽어 사이드 패널에 두 번째 Claude 카드를 함께 표시합니다. 휴대폰 화면도 같은 병합 payload를 받습니다.
- 규칙은 그대로입니다: 세션 쿠키 요청은 각 프로필의 로그인된 claude.ai 탭 안에서만(GET), 보조 계정 읽기는 로컬 릴레이 GET, 읽기 토큰은 브라우저 저장소에만 저장됩니다. 두 프로필이 모두 실행 중이어야 두 계정이 모두 갱신됩니다.
- **설정 가져오기 링크 (v0.2.4, 클릭 없는 구성)**: `scripts/import-settings.ps1`이 릴레이 자격 증명에서 토큰을 읽어 `options.html#import=<base64>` 링크를 만들어 지정한 브라우저로 엽니다. 예시 — 두 번째 계정 프로필: `powershell -File scripts/import-settings.ps1 -Browser "<chrome.exe 경로>" -Profile "Profile 1" -Mode relay -Label sub2`, 기존 프로필: ``-Mode secondary``(readToken 자동 사용). 옵션 페이지는 해시를 1회 읽어 휴대폰 동기화(enabled·계정 라벨·쓰기 토큰)와 보조 계정 표시(enabled·읽기 토큰)만 적용하고, 그 즉시 주소창에서 해시를 지웁니다. 허용된 필드 외에는 무시되고, 결과 메시지에 토큰 값이 노출되지 않습니다. 이 경로는 확장 자체의 옵션 페이지에서만 동작하며 일반 웹페이지는 `web_accessible_resources` 미선언으로 이 페이지를 열 수 없습니다.
- 보안 참고: 가져오기 링크로 토큰이 브라우저 주소창/명령줄에 잠깐 존재합니다(이 PC 안에서만, 전송되지 않음). 해시는 적용 직후 삭제됩니다. 신뢰할 수 없는 환경에서는 스크립트를 실행하지 마세요.
- v0.2.4부터 `http://127.0.0.1/*`(루프백)가 필수 호스트 권한으로 지정되어 보조 계정 읽기가 클릭 없이 동작합니다(임의 도메인 권한은 여전히 선택적). 필수 권한 추가가 이미 설치된 확장을 비활성화할 수 있는지(권한 증가 경고)는 공식 문서에서 "경고를 유발하는 권한 추가 시 수락까지 비활성화"만 확인됐고 루프백 단일 패턴의 경고 유무는 명시되어 있지 않아 확인하지 못했습니다. 재설치 후 확장이 비활성화되어 보이면 확장 페이지에서 한 번 승인하면 됩니다.
- v0.2.5 수정: (1) 보조 계정 카드는 보조 슬롯의 Claude 구독(`claude`) 항목만 사용합니다. 같은 슬롯에 Claude Platform(`claude_platform`) 값이 함께 올라와도 구독 창(5시간·7일·Extra) 대신 월 USD 한도 한 줄이 표시되던 문제를 고쳤습니다. (2) 릴레이는 보조 라벨 슬롯의 `claude_platform`을 병합에서 제외합니다. Claude Platform 사용액은 조직 단위 값이라 두 프로필이 같은 Admin 키를 쓰면 카드가 중복되므로 메인 슬롯의 값만 표시합니다. (3) `import-settings.ps1`에서 `-Profile "Profile 1"`처럼 공백이 있는 프로필 이름이 `--profile-directory=Profile`과 `1`로 쪼개져 엉뚱한 프로필에 창이 뜨던 문제를 고쳤습니다. 인자를 따옴표로 감싸 전달하며, `-NoOpen`은 브라우저를 열지 않고 인자 배열만 출력합니다(토큰이 든 URL은 가립니다).
- v0.2.3은 연결 테스트 버그도 고칩니다: 마지막 시도로부터 60초 안에 눌린 연결 테스트(단일 프로바이더 새로고침)가 쿨다운에 걸려 아무 시도 없이 "시간 초과 (20초)"로 끝나던 문제입니다. 명시적 테스트는 이제 항상 즉시 실행됩니다.

## 휴대폰 동기화 (선택, 기본 꺼짐)

PC 확장이 저장된 사용량을 로컬 릴레이로 보내면, 릴레이가 이를 휴대폰에서 볼 수 있게 합니다.

```
PC 확장 -> 로컬 릴레이 127.0.0.1:8770 (POST /api/ingest) -> Tailscale -> iPhone (8771)
```

- 릴레이 서버(`src/phone-server/`, 실행 `scripts/phone-relay.ts`)와 폰 웹 화면(`phone/web/`)도 이 저장소에 있습니다. 릴레이는 `npm run phone`으로 실행하며, `127.0.0.1:8770`(확장 -> 릴레이, 쓰기)과 `127.0.0.1:8771`(폰 화면과 읽기 API)에서만 듣습니다. 읽기 API 앞의 Tailscale 구간(예: Tailscale Serve가 8771만 전달)은 이 저장소가 설정하지 않으며 코드로 검증하지 못했습니다.
- 폰에서 접속: Tailscale Serve가 `https://<pc이름>.<tailnet>.ts.net`으로 8771 리더를 전달합니다. 릴레이는 기본적으로 로컬 호스트만 허용하므로, Serve 경유 접속에는 환경변수 `LLM_PHONE_HOSTS`에 해당 호스트 이름을 넣어야 합니다(예: `minholee-home.tail2f2c00.ts.net`).
- 부팅 시 자동 실행: `scripts/phone-relay-task.ps1` 래퍼가 호스트 허용 변수를 설정하고 릴레이를 실행합니다. Windows 예약 작업 등록 예: 작업 스케줄러에서 "로그온 시" 트리거로 `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <repo>\scripts\phone-relay-task.ps1` 실행(실행 시간 제한 없음, 이미 실행 중이면 새 인스턴스 시작 안 함).
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
| `npm run probe -- claude_platform` | `ANTHROPIC_ADMIN_KEY` 환경변수로 실제 cost report를 조회 |
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

## Claude Platform (API) 사용량

Claude Platform(Anthropic API) 조직의 월간 사용액을 구독 계정과 별개로 표시합니다(v0.2.2).

- 데이터 출처는 Anthropic **Usage & Cost Admin API**의 `GET /v1/organizations/cost_report`입니다(공식 문서 기준, GET-only). 확장의 allowlist는 `api.anthropic.com`에서 이 경로만 허용하고 추론 API(`/v1/messages` 등)와 나머지 경로는 계속 차단합니다.
- 인증은 세 종류 중 하나입니다: (1) **Admin API 키**(`sk-ant-admin01-...`) — Claude Console의 Settings → Admin keys에서 조직 admin이 발급(최초 1회 표시), (2) **워크스페이스에 묶이지 않은 개인(조직) API 키**(`sk-ant-api...`) — Console → Settings → API Keys의 조직 스코프 키, (3) org:admin OAuth 토큰. **워크스페이스에 묶인 API 키는 사용량 조회 권한이 없어 401로 거부됩니다.** 조직 없는 개인 계정은 Admin API 계열을 아예 쓸 수 없습니다(공식 문서 명시).
- 왜 일반 API 키만으로 안 되는 경우가 있나요: 사용량·지출 데이터는 `/v1/organizations/` 네임스페이스(Admin 계열)에만 있고, 키 스코프에 따라 접근이 갈립니다. 추론 API 응답의 `anthropic-ratelimit-*` 헤더는 요청/토큰 한도만 담고 지출(USD)은 없으며, `count_tokens` 같은 무료 호출도 POST라 이 확장의 GET-only 정책과 맞지 않아 사용하지 않습니다.
- 사용량은 UTC 달력 기준 이번달(1일 00:00 UTC ~) 합계이고 5분 정도 지연 후 반영됩니다. 월 한도는 설정값(기본 $200)이며 매월 1일(UTC)에 초기화되고 이월되지 않습니다. 0으로 두면 한도 없이 사용량만 표시합니다.
- **claude.ai 구독 계정의 Extra usage와는 다른 값이며 합산되지 않습니다.** 구독 사용률은 Claude 카드에, API 사용액은 이 항목에 각각 표시됩니다.
- 한계: 비용 엔드포인트는 Priority Tier 비용을 포함하지 않습니다(공식 문서 명시). 휴대폰 동기화 payload에도 이 항목이 포함되며 API 키는 전송되지 않습니다.
- 사이드 패널 위치(좌/우)는 확장이 정할 수 없고 Chrome 설정을 따릅니다.
- 검증 범위: 타입체크, 단위 테스트 438개, 빌드는 통과했습니다. 사이드 패널은 임시 프로필 Chrome 156과 Aside에서 직접 열어 확인했으나 v0.2.0 빌드였고, v0.2.1은 Aside에서 다시 로드해 로드와 릴레이 전송 유지까지만 확인했습니다. Claude Platform 사용량 조회는 공식 문서 기준으로 구현했고 모의 응답 테스트만 통과했으며 실제 Admin 키로 실서버 조회한 적은 없습니다. 확장 -> 릴레이 전송(HTTP 200, 수신 시각이 1분 간격으로 전진)과 릴레이가 서빙하는 폰 화면의 390/375/360/430px 폭 렌더링은 헤드리스 Chrome으로 확인했습니다. 실제 iPhone에서 Tailscale을 거친 확인, 그리고 로그인 세션 보호가 실제 Claude/ChatGPT 계정에서 접속 불능을 해소하는지는 확인하지 못했습니다.
- 같은 사이트에 접속하는 다른 확장(예: 사용량 추적류)도 같은 계정에 요청을 보낼 수 있어, 접속 문제가 계속되면 함께 점검해야 합니다.
