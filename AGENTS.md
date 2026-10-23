# Ovll beta — AGENTS

## 프로젝트
- Ovll: 캔버스형 AI 작업 플랫폼. 개인 실험용이 아닌 구조적으로 일관된 고품질 중규모 제품 지향.
- 작업 브랜치: `beta`. `main` 수정·병합·배포는 사용자 명시 승인 전 금지.
- 대상: 웹/PWA. 네이티브·모바일 전용 프로젝트 임의 추가 금지.

## 파일 구조 (현재 주요 실행 파일)
- 백엔드: `back/js/engine/{engine,requestRunner,callManager,actionDescriptors,actionShell,dataProvider,promptComposer}.js`, `back/js/request/{registry,callRegistry,scheduler,memorySessions}.js`, `back/js/model/{gemini,configuredGemini}.js`, `back/js/assets/memoryActionStore.js`, `back/js/{runtime,server,httpServer}.js`.
- 프론트: `front/js/workspace/{controller,model,requestBridge,dataAccess}.js`, `front/js/skill/catalog.js`, 그 밖의 `front/js/{canvas,composer,library,shell,input,data,mascot,settings}` 기능별 디렉터리.
- 프롬프트: `prompts/manifest.json`, `prompts/{base,blocks,common}`. 실행 계층은 Gate/Hallway/Output 및 **지원하는 행동 두 개의 전용 Workshop 프롬프트**.
- 문서: `docs/developing/`은 실제 동작, `docs/notes/`는 미결 논의, `docs/superpowers/{specs,plans}/`는 시기별 설계·계획, `docs/VISION.md`는 제품 비전.
- 검증: `tests/backend/`는 Node 통합/계약, `tests/frontend/`는 UI/로컬 그래프. 파일을 수정하기 전에 현재 트리를 확인한다.

## 경로와 역할
- `back/`: 관리형 다중 요청 Engine, Call Manager, 요청별 Runner, 행동 검증, 임시 자산 저장소 및 Render 테스트 HTTP 서버. `skillDefine.defineDirect`·`canvasEdit.addBlock`만 실제 실행한다. 지원하지 않는 행동은 명시적으로 중단. SSE·DB·정식 사용자 인증·IR·일반 Hallway Return은 아직 없음. 과거 비IR Workshop 실행기는 폐기 상태 유지.
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

## 현재 실행 계약 (2026-10-24, beta)

**이 절이 현행 상태의 단일 기준이다.** 과거 Action Shell/Stage 1과 작업실 설계의 시기별 기록은 `docs/superpowers/{specs,plans}/`에 둔다. 이전 문서의 "현재" 표현이 이 절을 덮어쓰지 않는다.

- **엔진:** `createEngine`이 다중 요청·FIFO 큐·상태·취소·호출 기록을 관리, `requestRunner`는 요청 하나의 Gate → Hallway Initial → 행동 → terminate/Output을 순차 처리한다. Gate/Hallway 직접 답변은 그대로 작동.
- **호출:** 각 Gate/Hallway/Workshop/Output 모델 호출에 서로 다른 `callId`와 구조화 `route`; `contextBlock.focus`는 호출마다 임시 투영, `intent/progress`는 요청 수명, `contextData`는 room 수명. `requestId`, `callId`, `operationId` 혼동 금지.
- **행동:** `skillDefine.defineDirect`는 Skill 정의를 서버 메모리에 저장, `canvasEdit.addBlock`은 확인된 Skill ID로 Block 배치. `terminate`는 엔진 제어 마커. 나머지 행동 10종, IR/Skill 자체 실행/일반 Hallway Return/질문 재개는 미구현.
- **중립 계약:** `engine/actionDescriptors.js`의 도구는 공급자 중립 `inputSchema`(JSON Schema). `model/gemini.js`가 Gemini의 `parametersJsonSchema`로 변환한다. 모델의 함수 호출 제안은 실제 `assets.apply` 성공이 아니다.
- **실제 적용:** 서버의 `memoryActionStore`만 임시 beta 자산·revision·멱등 operation 결과를 저장한다. 적용 전 `pendingOperation`, 적용 후 `verifiedResults/planCursor`를 기록한다. Output 실패 시 실제 변경은 그대로 남고 Output만 재시도 가능하다.
- **프론트:** 성공 또는 부분 적용 뒤 서버 자산을 재조회한다. 로컬에서 따로 편집한 캔버스는 자동 덮어쓰기 금지, 충돌 경고. 자산이 저장됐어도 기존 로컬 그래프에 바로 표시되지 않을 수 있으므로 둘을 동일한 성공 기준으로 간주하지 않는다.
- **현행 시험 값:** 요청 동시 슬롯 3, 모델 동시 호출 2, 행동 예산 24, 모델 호출 예산 40. 설정 가능한 초기 제한으로서 제품 불변 규칙으로 승격하지 않는다. `OVLL_TEST_TOKEN` 기본 `abcd` 또는 16자 미만은 행동 저장 비활성화. **토큰 길이는 신뢰할 수 있는 인증·사용자 격리 기준이 아니다.** 서버 상태는 재시작 시 휘발.
- **검증:** Node fake-provider CI와 실제 Gemini API, Render 배포, Playwright/모바일 시험은 별도 근거다. 작업 중 테스트 통과를 서비스 동작 확인으로 표현하지 않는다. `main`은 변경 금지.

## 변경 전 반드시 구분할 사항
- **사용자에게 합의된 원칙:** 엔진 독립성, 요청과 호출의 분리, 행동 단위 계획, 검증된 결과만 실제 성공, 원본 맥락 수명, 로컬 사용자 편집 보존.
- **현재 코드에만 존재하는 선택:** 메모리 자산, 숫자로 된 큐/호출 상한, 공용 테스트 토큰과 16자 실행 게이트, 첫 두 행동만 실제 지원. **코드에 존재한다는 사실이 사용자의 영구 정책 승인을 뜻하지 않는다.**
- **미확정 제품 정책:** 프론트 로컬/서버 캔버스의 최종 원본 및 병합 기준, 실서비스 인증·room 권한, 일반 Hallway Return/질문 대기의 단계 계약, 다음 행동 우선순위. 별도 설계 승인 전 임의 확정·대규모 구현하지 않는다. 논의 기록: `docs/notes/2026-10-24-engine-recovery-boundaries.md`.
- 기존 범위의 재현 가능한 버그는 테스트 RED → 수정 GREEN → 전체 회귀로 고친다. **새 동작이나 정책은 Superpowers 설계 승인 → 계획 승인 → 코드 변경** 순서를 지킨다. `@Superpowers ㅇㅋ`를 아직 설명하지 않은 범위의 포괄적 승인으로 해석하지 않는다.
