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
- `back/`: 백엔드. `back/js/`는 서버·API·실행 로직(JS)을 책임에 따라 분리할 위치. **Gate → Hallway Initial → 비IR Workshop → Hallway Return / Output 엔진 + Render 시험 HTTP 서버 구현**. 서버는 `back/js/server.js`에서 `front/`와 `/api/requests`를 함께 제공하며 Chat 폴링으로 진행을 표시한다. SSE·DB·정식 사용자 인증·IR은 아직 없음. Workshop은 비IR 11행동만 실행하며 메모리 어댑터를 사용.
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

## 백엔드 독립 프로토타입 (2026-10-23)
- 구현 명세: `docs/developing/request-engine.md`; 구현 계획: `docs/superpowers/plans/2026-10-23-independent-request-engine.md`.
- 단위검사: `node --test tests/backend/*.test.mjs`; CLI도 Render와 동일한 Gemini 환경변수 우선순위를 사용하며, 기본 모델을 지정하므로 `GEMINI_MODEL`은 선택. AI 호출에는 지원되는 API 키가 필요하다. 실행: `node back/js/demo.js`. 키·모델을 저장소에 기록하지 말 것.
- `front/js/workspace/requestInput.js`는 직접 참조 Skill/Skill Block의 자료를 추출하는 독립 준비 함수; 현재 `boot.js`는 `requestBridge.js`의 HTTP 요청 전송·상태 폴링에 연결되어 있음. SSE는 미구현.
- 시험용 FIFO에서 **같은 roomId의 직전 완료 맥락데이터 + 최근 8개 완료 기록**을 서버 메모리로 이어 전달한다. `DATA_UNAVAILABLE`은 부족한 데이터명을 노출하고, 프론트 실패 상태는 해당 요청 식별자/문장에 귀속된다. 모델 평가용 부분 구현이며 DB 영속 저장은 없다.

## Render 단일 웹서비스 시험 (2026-10-23)
- `beta` 전용 `package.json`/`render.yaml`. `npm start`로 `back/js/server.js` 실행, `GET /api/health`로 준비 상태 확인.
- `main` Gemini 경로 설정을 공유: `GEMINI_API_KEY` 또는 `OVLL_POINTER_MODEL_API_KEY` / `OVLL_VNEXT_MODEL_API_KEY`는 실제 AI 호출에만 필요. 모델명은 `OVLL_POINTER_MODEL_ID` → `OVLL_VNEXT_MODEL_ID` → `GEMINI_MODEL` → `gemini-3.5-flash-lite`. `OVLL_TEST_TOKEN`은 선택이고 없으면 기본 테스트값 `abcd`로 동작하며 프론트가 자동 전송. 이 값은 소스에 공개되어 인증을 제공하지 않으므로 운영에 부적합. `beta`의 공급자는 Gemini로 고정.
- `front/js/workspace/requestBridge.js`는 `boot.js`가 기존 Composer 콜백·Chat 표시 제어자로 연결. 접수/진행/완료를 서버 HTTP에서만 판정하며 Render의 동일 origin에서 테스트.
- 구현/제한: `docs/developing/render-test-bridge.md`. 실 Render 배포·Gemini 호출·브라우저 실기기 검증은 별도 확인 필요.

## 비IR Workshop 구현 연결 (2026-10-23)
- 설계: `docs/superpowers/specs/2026-10-23-non-ir-workshop-engine-design.md`; 구현 계획: `docs/superpowers/plans/2026-10-23-non-ir-workshop-engine.md`.
- `back/js/engine/{memoryAssets,checkpoints,workshop,engine}.js`에 버전 자산·체크포인트·행동 결정·실행 루프. `back/js/request/{registry,scheduler}.js`에 `awaiting_input`·resume·output-only retry.
- 외부 HTTP와 UI는 본문 조회·대기 입력·최종 응답 재시도를 통해 서버 확정 결과를 표시. 원본이 다른 로컬 캔버스를 무조건 덮어쓰지 않는다. `main`은 변경하지 않는다.
- 구현된 것은 **서버 메모리 기반 Beta 실험**이다. 실 Gemini, Render, 브라우저 및 완전한 Node 백엔드 전체 테스트는 별도 검증 필요. DB 영속성·사용자별 인증·IR 실행 없음.
