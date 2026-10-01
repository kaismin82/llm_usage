# LLM Usage Glance

여러 LLM provider의 사용량과 남은 금액을 Chrome 확장 팝업 한 화면에서 보여 줍니다.

| Provider | 표시 내용 | 인증 |
|---|---|---|
| Claude (구독) | 5시간 / 7일 / 모델별 주간 사용률과 reset 시각, reset 권 | claude.ai 로그인 세션 |
| ChatGPT (구독) | 7일(+5시간) Codex 사용 한도와 reset 시각, reset 권 | chatgpt.com 로그인 세션 |
| Z.ai | 5시간 / 7일 / MCP 월간 사용률과 reset 시각, reset 권 | API 키 |
| Poe | 일 / 주 / 월 사용 포인트, 남은 포인트 | API 키 |
| LiteLLM | 일 / 주 / 월 비용(UTC), 남은 예산 | 가상키 또는 관리키 |
| OpenRouter | 일 / 주 / 월 비용(UTC), 남은 크레딧 | API 키 또는 관리키 |

- 팝업은 Chrome 팝업 높이 제한(600px) 안에 모든 항목이 한 번에 보이도록 만들었습니다.
- 읽기 전용입니다. GET 요청만 보내며 reset 권을 소모하는 API는 코드가 호출하지 못하게 막혀 있습니다(`src/core/allowlist.ts`, `tests/allowlist.test.ts`).
- 외부 서버로 데이터를 보내지 않습니다. 설정과 마지막 조회 결과는 `chrome.storage`에만 저장합니다.

## 시작하기

```
npm install
npm run build
```

1. `chrome://extensions`에서 개발자 모드를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다**로 `dist/` 폴더를 선택합니다.
3. 팝업의 설정 버튼으로 옵션 페이지를 열고 provider별 토글을 켠 뒤 접근 권한을 허용하고 **연결 테스트**를 누릅니다.
4. Claude와 ChatGPT는 같은 Chrome 프로필에서 해당 사이트에 로그인해 두어야 합니다.

## 개발

| 명령 | 설명 |
|---|---|
| `npm run dev` | Chrome 확장 없이 일반 탭에서 팝업/옵션 UI를 샘플 데이터로 미리보기 (`/dev/index.html`) |
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
src/core/        SafeFetch(GET allowlist), 스케줄러, reset 권 탐지, 저장소, 탭 브리지
src/custom/      custom 설정, 필드 매핑, GET 조회, 별도 저장소와 실행 큐
src/background/  서비스 워커 진입점
src/popup/       팝업 UI
src/options/     옵션 UI
dev/             확장 없이 UI를 보는 미리보기 하네스
scripts/         실제 API 확인용 CLI
tests/           단위 테스트
```

설계 근거와 조사 기록은 [`.omo/research/final-design-report.md`](.omo/research/final-design-report.md)에 있습니다.

## 알려진 한계

- Claude, ChatGPT, Z.ai의 사용량 API는 공식 문서가 없는 내부 API입니다. 약관상 자동화 접근으로 해석될 수 있고, 응답 구조가 바뀌면 `API 변경 감지` 상태로 표시됩니다.
- Z.ai, Poe, OpenRouter, LiteLLM은 실제 서버로 확인했습니다. Claude와 ChatGPT의 세션 방식은 실계정 응답으로 아직 확인하지 못했습니다.
- ChatGPT 수치는 구독에 포함된 Codex 사용 한도이며 일반 채팅 메시지 한도는 제공되지 않습니다.
- API 키는 `chrome.storage.local`에 암호화 없이 저장됩니다. 패스프레이즈 암호화 코드(`src/core/secrets.ts`)는 있으나 옵션 화면에는 연결하지 않았습니다.
- Poe 사용 이력은 30일만 보존되므로 월간 합계는 설치 이후 누적분 기준입니다.
