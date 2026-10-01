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

## 구조

```
src/providers/   provider별 어댑터 (claude, chatgpt, zai, poe, litellm, openrouter)
src/core/        SafeFetch(GET allowlist), 스케줄러, reset 권 탐지, 저장소, 탭 브리지
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
