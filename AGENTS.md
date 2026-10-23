# Ovll beta — AGENTS

## 프로젝트
- Ovll: 캔버스형 AI 작업 플랫폼. 개인 실험용이 아닌 구조적으로 일관된 고품질 중규모 제품 지향.
- 작업 브랜치: `beta`. `main` 수정·병합·배포는 사용자 명시 승인 전 금지.
- 대상: 웹/PWA. 네이티브·모바일 전용 프로젝트 임의 추가 금지.

## 파일 구조

아래는 `beta` 브랜치의 실제 추적 파일 기준 구조다. 역할 설명은 현재 구현과 구분하며, 파일 추가·삭제 시 현행 트리를 다시 확인한다.

```text
/
├── AGENTS.md
├── package.json                     # Render beta Node ESM 시작·테스트 명령
├── render.yaml                      # beta 전용 Render Web Service Blueprint
├── assets/svg/                     # 현재 .gitkeep만 존재
├── back/js/                        # request/{registry,scheduler}, engine/{promptComposer,dataProvider,engine}, model/gemini, demo.js, httpServer.js, server.js
├── docs/
│   ├── VISION.md
│   ├── developing/
│   │   ├── architecture.md
│   │   ├── context.md
│   │   ├── frontend-data.md
│   │   ├── frontend-global.md
│   │   ├── frontend-runtime-and-hosted-swipes.md
│   │   ├── frontend-workspace.md
│   │   ├── prompt-composition.md
│   │   ├── request-engine.md
│   │   ├── render-test-bridge.md
│   │   └── workshops.md
│   ├── notes/
│   │   ├── frontend-backend-handoff.md
│   │   └── request-state-sync.md
│   └── superpowers/plans/
│       ├── 2026-10-17-beta-hosted-slides.md
│       └── 2026-10-17-beta-runtime-foundation.md
├── front/
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── vercel.json
│   ├── html/                        # 현재 .gitkeep만 존재
│   ├── css/
│   │   ├── base.css
│   │   ├── canvas.css
│   │   ├── mascot.css
│   │   ├── composer.css
│   │   ├── hostedSlides.css
│   │   ├── shell.css
│   │   └── workspace.css
│   └── js/
│       ├── boot.js
│       ├── canvas/                 # controller.js, files.js, geometry.js
│       ├── composer/               # controller.js, draft.js
│       ├── data/localDataStore.js
│       ├── mascot/                # actor.js, canvasScene.js
│       ├── library/controller.js
│       ├── input/inputManager.js
│       ├── settings/theme.js
│       ├── shell/                  # appShell.js, hostedSlides.js,
│       │                           # pageHost.js, viewportMotion.js
│       ├── skill/catalog.js
│       └── workspace/              # chat.js, controller.js, dataAccess.js,
│       │                           # icons.js, model.js, requestInput.js, requestBridge.js
├── prompts/
│   ├── base/                       # hallwayInitial, hallwayReturn, gate, output
│   ├── blocks/                     # contextBlockUpdate, contextDataUpdate,
│   │                               # informationRequest, languageGeneration,
│   │                               # planGeneration
│   ├── common/                     # concepts.md, json.md
│   └── manifest.json
└── tests/
    ├── backend/                    # request, engine, Gemini, Render HTTP/Chat 시험
    └── frontend/                   # canvas, composer, hosted, input, shell,
                                    # theme, viewport, workspace 관련 *.test.mjs
```

## 경로와 역할
- `back/`: 백엔드. `back/js/`는 서버·API·요청 처리 로직(JS)을 책임에 따라 분리할 위치. **Gate → Hallway Initial → 선택 행동 Action Shell 엔진 + Render 시험 HTTP 서버 구현**. 서버는 `back/js/server.js`에서 `front/`와 `/api/requests`를 함께 제공하며 Chat 폴링으로 진행을 표시한다. SSE·DB·정식 사용자 인증·IR은 아직 없음. 기존 비IR Workshop 실행기·자산 변경기는 폐기. 행동 실행·Function Calling은 미구현.
- `front/`: 웹/PWA 정적 배포 루트. `index.html`은 현재 진입 파일이며 `manifest.webmanifest`, `vercel.json`은 배포·PWA 설정. 필수 루트 파일 외 앱 코드·일반 스타일을 루트에 쌓지 말 것.
- `front/html/`: 별도 HTML 문서·페이지 구조용 위치. **현재 구현 파일 없음**. 실제 화면 구조는 `front/index.html`에도 존재하므로 이전을 임의 강제하지 말 것.
- `front/js/`: 부팅(`boot.js`), 셸·페이지 호스트(`shell/`), 캔버스(`canvas/`), 컴포저(`composer/`), 워크스페이스(`workspace/`), 라이브러리(`library/`), 스킬 목록(`skill/`), 로컬 데이터(`data/`), 입력(`input/`), 테마(`settings/`) 등 프론트 로직. 기능 변경 시 해당 영역의 실제 코드와 경계를 확인.
- `front/css/`: 공통·셸·캔버스·컴포저·워크스페이스·호스팅 슬라이드 스타일. 테마와 레이아웃 수정 전 적용 지점 확인.
- `prompts/`: AI 호출 계층·조립형 지침. `base/`는 기본 지침, `blocks/`는 조립 블록, `common/`은 공통 규약, `manifest.json`은 구성 목록.
- `assets/svg/`: SVG 정적 자산용 위치. **현재 자산 파일 없음**.
- `tests/`: 자동화 검증·회귀 테스트 전용. 검증 파일은 `tests/backend/`와 `tests/frontend/`에 있으며, Render HTTP·Chat 시험은 백엔드 테스트에 포함됨. 제품 코드·임시 실험 파일과 혼재 금지.
- `docs/notes/`: 개발 중 논의·가설·임시 설계·미확정 기록. 확정 명세로 취급 금지.
- `docs/developing/`: **확정된 실제 개발 명세**. 시스템 구조·모듈 경계·데이터 구조·구현 방법·인터페이스/프로토콜·동작 규칙 등 구현에 필요한 결정과 사실 보관. 일반론·소개문·독자용 튜토리얼 아님.
- `docs/superpowers/plans/`: 현재 존재하는 작업 계획 기록 경로. `docs/developing/`의 확정 명세나 `docs/notes/`의 미확정 기록을 대체하지 않으며, 새 문서의 기본 저장소로 자동 선택하지 말 것.
- `docs/VISION.md`: 제품 비전. 개발 명세·임시 노트와 별개. 경로 미확정 시 다른 비전 문서 임의 신설 금지.
- 문서 이관: `notes`에서 내용 확정 → 검증·정리해 `developing`의 적절한 문서에 반영 → 해당 임시 노트 삭제. 중복 원본 방치 금지; 미확정 내용을 확정 명세에 섞지 말 것.

## 구성·명명
- **디렉터리=책임 영역 / 파일명=구체적 역할**. 기존 `front/js/canvas/controller.js`, `front/js/workspace/model.js`처럼 실제 소속과 역할을 드러낼 것. 예시 경로가 실제 존재한다고 가정하지 말 것.
- 신규 기능: 기존 파일·책임·공개 API·의존성·중복 구현 확인 → 기존 구조의 적합한 확장 지점 우선. 실제 책임 경계가 필요할 때만 파일·폴더 추가. 기능별 파일·폴더 자동 양산 금지.
- 기본 `<역할>.js`; 경로 밖에서도 소속 식별이 필요하면 `<소속>.<역할>.js`. 역할 접미사(`engine`, `model`, `renderer`, `controller`, `repository`, `contract` 등)는 해당 책임일 때만 사용.
- 명칭·용어 일관성 유지. `utils.js`, `functions.js`, `misc.js` 등 의미 불명 이름과 `new`, `final`, `v2` 등 임시 상태명 지양. `core`·`shared`를 잡동사니 폴더로 사용 금지.
- 지나친 파일 분할과 거대 단일 파일 둘 다 회피. 구성 변경 시 호출 관계·상태 소유·생명주기 영향 확인.

## 금지·판단
- 사용자 요청 무조건 동의·일괄 수행 금지. 의도·실현 가능성·부작용·범위 검토; 추상적 지시·중요 불확실성·설계 선택은 실행 **전** 확인. 독단 확대 후 사후 보고 금지.
- 타 시스템 내부를 직접 조작하는 임시 결합 금지. 공개 제어 계약·이벤트·상태 소유권·생명주기부터 검토.
- 오류를 분석 없이 예외 처리·변환/호환 계층·방파제 추가로 은폐 금지. 재현·원인·책임 경계 파악 → 구조 개선 가능성 우선 검토.
- 테스트 파일은 `tests/`에 배치. 신규 작성 전 기존 검증 재사용·수정 가능성 확인; 테스트 양산·불필요한 반복 검증 금지. 영향 범위에 맞는 최소 유효 검증, 실패 시 원인 재평가. 미검증 성공 주장 금지.
- 개발 중 `docs` 아무 곳에나 Markdown 추가 금지. `notes` / `developing` / 비전 구분. 내부 문서=우리의 실제 개발 참조 자료: 압축형·정확한 기술 서술, 조건·예외·수치·결정 근거 등 필요한 세부사항 보존. 보고서식 서론·목차·미사여구·가공 사실·과장 금지.

## 작업 기준
- 실제 코드·참조 확인 + **관련 `docs/developing/` 명세 반드시 확인** → 기존 설계·계약에 부합하는 변경 → 필요한 검증.
- `docs/developing/`의 파일명·제목을 먼저 훑어 해당 작업에 필요한 문서를 선택해 읽을 것. 새 확정 명세를 작성할 때도 후속 에이전트가 제목만 보고 관련성을 판단할 수 있게 명명할 것.
- 명세가 비었거나 미완성이면 추측해 채우지 말고 불확실성을 명시. 현재 문서와 구현이 다르면 차이를 보고하고, 근거 없이 어느 쪽도 임의로 정답 처리하지 말 것.

**개발 진행 과정에서의 변화로 AGENTS.md에 수정이 필요하다 판단될 경우, 유저에게 명확히 알릴 것.**

## 2026-10-23: Action Shell 도입 기록 (2026-10-24 현행 사항은 아래)
- **현재 유효 구조:** Gate → Hallway Initial(정확한 행동 이름으로 plan 생성) → Action Shell(첫 행동 껍데기 진입 및 미구현 상태 보고). 계획된 행동은 실행하지 않음.
- Plan key 예: `skillDefine.defineDirect`, `canvasEdit.addBlock`, `skillEdit.editAppearance`, `textGenerate.question`. `terminate`는 제어 표식. 범주 이름만으로 된 `skillDefine`/ `canvasEdit` 계획은 거부.
- `back/js/engine/{engine,actionShell,promptComposer,dataProvider}.js` 사용. 과거 비IR Workshop의 `workshop.js`, `memoryAssets.js`, `checkpoints.js` 및 Workshop 전용 프롬프트·회귀 시험 제거. 실행 방법/도구 스키마는 추후 계약 확정 대상.
- Action Shell은 어떤 Skill/Canvas 상태도 변경하지 않으며 Function Calling을 수행하지 않음. `status:unsupported_workshop`, `currentLayer:actionShell`, `handoff:{action,workshop,objective,need,status:not_implemented}`로 미구현 상태를 공개. **성공·적용 결과가 아님**.
- `back/js/server.js`는 조회 전용 빈 자산 목록을 사용하여 Gate의 `skillList` 조회와 HTTP 자산 조회를 지원하되, 어떤 행동도 적용하지 않음. 이것은 영속 DB나 기존 Beta 자산 복원이 아님.
- Gate/Hallway 직접 대화 분기 및 room 기반 완료 맥락 기록은 유지. Hallway Return, Output, IR 실행, 행동별 지침·네이티브 Function Calling·질문 응답의 실제 실행 연결은 이번 단계 미구현.
- `AGENTS.md`의 이전 2026-10-23 비IR Workshop 연결 기록은 이 현행 구조로 대체됨. `main`은 손대지 않음.
- 자동 검증: `npm test` (Node 22 CI). 실 Gemini·Render 브라우저 시험과 분리해서 보고.

## 2026-10-24: 다중 요청 Engine · Call Manager (Stage 1 기록; 아래 Stage 2가 현행)
- 제품 엔진은 `back/js/engine/engine.js`의 `createEngine()`. 한 요청 전용 Gate/Hallway 처리는 `requestRunner.js`에 분리했으며 `createRequestEngine`은 이전 단위테스트용 얇은 alias임. `server.js`는 `createEngine` 하나를 만들고 HTTP에 같은 인스턴스를 전달.
- `request/scheduler.js`는 요청 FIFO와 최대 동시 요청 수를 관리(엔진 기본 3), `engine/callManager.js`는 별도 Gemini 모델 호출 동시 수를 관리(기본 2). 같은 요청의 Gate → Hallway → 첫 Action Shell은 순차적으로 진행. 여러 요청은 동시에 관리 가능.
- `request/callRegistry.js`에 매 호출마다 고유 `callId`, 구조화 `route`, 파생 `callId.route`와 `queued/running/completed/failed/cancelled/unsupported` 이력을 관리. 각 Call은 `roomId`, `requestId`에 귀속되며 Gemini 호출 데이터·시스템 프롬프트를 CallRecord에 저장하지 않는다.
- Call Manager는 호출마다 `contextBlock.focus`를 **임시 입력에만 추가**. 요청 원본 `contextBlock.intent/progress`와 방별 `contextData`의 수명을 유지.
- `registry.transition(...,{expectedRevision})`으로 요청 revision 충돌을 검출할 수 있음. 같은 방의 확정 대화 맥락은 `memorySessions.commit(expectedRevision)`으로 CAS 확인 후 적용. 취소는 queued → stopped 또는 running → stopping → stopped로 전이; 늦은 모델 응답으로 취소 요청을 완료시키지 않음.
- 계획 첫 행동은 `CallRecord`로 등록 후 `unsupported`으로 끝내며 `handoff.callId`와 `planCursor:0` 반환. 후속 행동, Function Calling, 자산 변경은 여전히 **미구현**.
- `GET /api/requests/:id/calls?roomId=...`가 해당 요청의 최근 호출 기록 최대 100개 중 `callId,path,route,status`만 반환. 테스트용 공용 토큰은 사용자별 인증이 아니므로 프로덕션 격리 보장 불가.
- 모두 프로세스 메모리 기반. 서버 재시작, 분산 워커, 영속 CallRecord/operationId, 실제 취소 가능한 Gemini 작업 수행은 이 단계의 보장 범위가 아님. 실제 Gemini·Render 환경/브라우저 실검증은 CI와 별도.

## 2026-10-24 현재: Native Function Calling Stage 2
- 활성 **작업실 2행동만** `skillDefine.defineDirect`(완전 Skill 정의 저장), `canvasEdit.addBlock`(실제 Skill ID를 참조하는 Block 배치)으로 지원. 다른 10행동, IR/질문/일반 재계획은 미구현. 구 JSON `workshop.js` 복원 금지.
- `back/js/model/gemini.js:generateFunction`은 `generateContent`의 `ANY` 도구 호출을 정확히 선택된 함수 하나로 제한하고 함수명/개수/args 구조를 검증한다. 반환 값은 **모델 제안**일 뿐 적용 성공 아님.
- `engine/actionDescriptors.js`는 2행동 도구 정의·인수 검증. `assets/memoryActionStore.js`는 room별 Skill/Block 실자산, 원자적 expectedRevision, operationId 멱등성 및 실제 applied 아티팩트를 제공한다. 서버가 ID를 발급한다.
- `requestRunner.js`: Hallway 행동 plan에 따라 두 행동을 호출, **적용 전 pendingOperation 체크포인트**, **적용 후 verifiedResults/planCursor 갱신**. `terminate` 후 `output` 호출. Output 실패 시 앞서 적용된 자산·기록 보존. 해당 Skill의 지침(실제 조사)은 여기서 실행하지 않는다.
- `back/js/runtime.js`는 하나의 Store를 Engine, DataProvider, HTTP API에 공유. **기본 `OVLL_TEST_TOKEN=abcd` 또는 16자 미만이면 실행 포트 미주입** (이전 inert Action Shell 유지). 비공개 16자 이상 테스트 토큰만 변경 활성화. 공용 테스트 토큰은 정식 auth/테넌트 격리 수단 아님.
- `front/js/workspace/requestBridge.js`는 완료 뒤 확정 자산을 다시 가져오며 `workspace/controller.js:applyServerAssets`는 로컬 provisional 그래프가 변경되었으면 덮어쓰지 않는다. 실제 DB 동기화/브라우저 실검증은 미구현 또는 미검증.
- 활성 조립형 프롬프트: `prompts/manifest.json`에 `workshop.skillDefine.defineDirect`, `workshop.canvasEdit.addBlock` 추가. 다른 행동 프롬프트를 전체 주입하지 않는다.
- CI fake provider 테스트 성공과 **실제 Gemini/Render/Playwright 성공은 구분**해서 보고. 프로세스 메모리 저장은 재시작 시 전부 휘발. `main`은 변경 금지.

- Gemini 도구 스키마: `define_direct`는 `parameters`, 동적 Block `values`를 받는 `add_block`은 API가 지원하는 `parametersJsonSchema`로 선언. 상호 배타적으로 한 가지만 보낸다. 자세한 계약은 `docs/developing/prompt-composition.md`.

## 2026-10-24 Stage 2 안전 보강
- `requestRunner`는 행동 계획을 실행하기 전에 **최대 24개** 제한을 적용. `CallManager`는 요청별 모델 호출 기본 **40회** 상한(`policy.maxModelCallsPerRequest`)을 Gate/Hallway/Workshop/Output에 공통 적용. 이는 모델 호출 동시성 상한(`policy.maxModelCalls`, 기본 2)과 별도.
- 실패한 Output은 같은 요청 ID로 Output 모델 호출만 재시도한다. `verifiedResults`와 적용된 operation은 재사용하며 Skill·Block 변경을 반복하지 않는다. 성공한 재시도는 해당 요청의 실패 이력 1건을 완료 기록으로 대체하고 stale 오류 표시를 제거한다.
- 이 단계의 TDD 회귀: 과도한 Hallway 계획/호출 예산 소진 방어, Output 첫 실패 후 재시도, 실제 적용 결과 보존 및 중복 자산 생성 방지. 기존 메모리/데모 한계와 그 외 행동 미구현 상태 유지.
