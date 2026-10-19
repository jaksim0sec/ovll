# Ovll beta — 프론트 ↔ 백엔드 연결 인수인계 (2026-10-19)

> **성격:** 백엔드 작업자에게 전달하는 *현황·경계·미결정 사항 노트*. 이 파일은 `docs/notes/`에 위치하며 **새 구현 계약을 확정하지 않는다**. `docs/developing/`의 확정 명세 및 실제 `beta` 코드가 우선한다. 현황은 2026-10-19 `beta` 정적 코드 열람 기준. 실제 브라우저·네트워크 재검증을 이 문서 작성만으로 수행했다고 간주하지 않는다.
>
> **작업 제한:** `beta`만 대상. `main`은 사용 경험·참조 구현 확인용이며 수정·병합·배포 금지. 백엔드가 미구현이므로 API 경로, SSE 이름, JSON 계약, 인증/DB/버전 정책을 추측해서 고정하지 않는다.

## 0. 이 문서를 읽을 백엔드 담당자에게: 먼저 알아야 할 결론

- 프론트를 새 백엔드의 내부 실행 구조에 종속시키지 말 것. 서버는 **요청 실행·검증·자산 원본·버전**을 담당하고, 프론트는 **조작·표현·입력 중 상태·서버 확정값의 투영**을 담당한다.
- `Shell`/`Page Host`/`Hosted Slides`/`Input Manager`는 이미 분리·구현됐다. 전면 개편 대상 아님. 페이지 내부 기능은 `Workspace`와 향후 `Library`가 소유한다.
- **지금은 실제 HTTP/SSE 클라이언트 및 백엔드 엔드포인트가 없다.** `front/js/api/` 폴더와 API 함수 파일 역시 현재 추적 트리에 없다. 아직 정해지지 않은 URL과 이벤트를 붙인 가짜 클라이언트를 만들지 않는다.
- **기본 Skill Catalog는 7개의 로컬 정적 표시 정의**일 뿐 백엔드 Skill 스키마가 아니다. 동적 Skill을 저장·공급할 인터페이스를 정하기 전 서버가 생성한 Skill Block은 현재 모델에서 검증/복원 불가능할 수 있다.
- **후속 구현 완료:** Workspace 읽기 전용 데이터 조회·동적 Skill 표시 공급 슬롯·요청/실행 콜백 주입점은 실제 구현됐다. 서버 need·실행 IR·HTTP/SSE는 여전히 미구현이다.
- **로컬 Canvas Model은 영속 서버 모델이 아니다.** 그래프 조작을 즉시 로컬 확정하고 80회 undo를 유지한다. 서버가 확정한 변경과 수동 편집의 승인 과정을 아직 구분하지 않는다.
- `Chat`은 시작 화면만, `Library`는 데이터가 없는 목업이다. 메시지 스트림과 자산 라이브러리의 도메인 UI/입출력 계약을 앞으로 결정해야 한다.
- **`docs/notes/request-state-sync.md`는 임시 논의**, `docs/developing/architecture.md`·`workrooms.md` 등은 1014 확정된 *논리적 역할*의 명세. 논리 계층을 고정 HTTP/API 필드로 오해하지 않는다.

## 1. 검토한 원본 및 우선순위

1. `AGENTS.md` — 브랜치·경로·명세 우선순위·변경 금지 원칙
2. `docs/developing/architecture.md` — Gate/Corridor/Workroom/Output, Skill/Skill Block/Function, 순환 흐름
3. `docs/developing/context.md` — request 단위 `contextBlock`, session 단위 `contextData`, 호출별 `focus`
4. `docs/developing/workrooms.md` — 작업실 분류·행동 분류, 아직 없는 베이스/Function Calling 계약
5. `docs/developing/prompt-composition.md` — Gate/복도/Output 지침 조립·분기
6. `docs/developing/frontend-global.md`, `frontend-runtime-and-hosted-swipes.md` — Shell/Host/입력/Hosted/라우팅/생명주기
7. `docs/developing/frontend-workspace.md`, `frontend-data.md` — 현재 로컬 Workspace/Canvas/Composer/IndexedDB 계약
8. `docs/notes/request-state-sync.md` — HTTP+SSE·요청 수명·중단/충돌/복구 **미확정 논의**
9. 실제 `front/index.html`, `front/js/boot.js`, `front/js/shell/*`, `front/js/input/inputManager.js`, `front/js/settings/theme.js`, `front/js/workspace/*`, `front/js/composer/*`, `front/js/canvas/*`, `front/js/skill/catalog.js`, `front/js/data/localDataStore.js` 및 `front/css/base.css` 확인

주의: `frontend-global.md`, `frontend-runtime-and-hosted-swipes.md` 앞부분에는 초기 임시 픽스처를 설명한 역사적 구절이 남아 있다. **2026-10-18~19 갱신 단락과 현재 실제 소스**를 우선 검토하되, 문서와 코드가 다르면 차이를 명시하고 임의 해석하지 않는다.

## 2. 현재 코드 구조 — 사실

`front/`는 빌드 시스템/프레임워크 없는 정적 ES Modules 웹/PWA 진입 루트이고 `front/index.html` → `front/js/boot.js`로 시작한다. `front/html/`, `back/js/`, `assets/svg/`는 현재 구현 파일이 없다. manifest는 있지만 Service Worker와 서버 실행은 미구현이다.

```text
front/index.html
  └─ front/js/boot.js                       [조립/페이지 URL·History]
       ├─ settings/theme.js                 [system/dark/light; localStorage]
       ├─ shell/appShell.js                  [메뉴·헤더·가시 viewport; DOM 프레임]
       │    └─ shell/viewportMotion.js        [프레임 보간만]
       ├─ shell/pageHost.js                  [최상위 workspace/library의 단일 원본]
       ├─ shell/hostedSlides.js              [페이지 내부 슬라이드/알약/정지 슬롯]
       ├─ input/inputManager.js              [한 입력 소유자; Canvas opt-in 멀티포인터]
       ├─ data/localDataStore.js             [IndexedDB: cache / local]
       ├─ workspace/controller.js            [단일 로컬 방, 컴포넌트 조립/로컬 저장]
       │    ├─ workspace/model.js             [블럭·연결 로컬 상태/검증/undo]
       │    │    └─ skill/catalog.js          [정적 표시용 스킬 목록]
       │    ├─ canvas/controller.js          [블럭 UI/포트/파일/카메라/제스처]
       │    │    ├─ canvas/geometry.js
       │    │    └─ canvas/files.js
       │    └─ composer/controller.js        [편집/참조/첨부/전송 버튼]
       │         └─ composer/draft.js         [구조화 입력 초안]
       └─ Library HTML template              [레이아웃 테스트 목업, 도메인 로직 없음]

미존재: front/js/api/*, backend API/SSE, request stream handling,
        Chat message renderer/store, Library asset provider,
        동적 Skill 공급자, 서버 검증/동기화 어댑터.
```

- `Page Host`만 최상위 `workspace`·`library` 전환 및 페이지 `AbortSignal`을 가진다. `Hosted Slides`는 Workspace 내부 `chat`·`canvas` 선택을 담당하고 Composer를 **bottom stationary**에 유지한다. `Chat`은 본문 스와이프 허용, `Canvas` 본문은 글로벌 스와이프 거부. 메뉴는 Shell 소유.
- `boot.js`가 `?page=workspace&slide=chat|canvas` / `?page=library&slide=library` URL 및 History를 소유하며 현재 페이지/슬라이드 API로 복원한다. URL은 자산 ID나 요청 ID를 뜻하지 않는다.
- `Input Manager`는 포인터 소유권만 중재. 제스처의 의미(핀치/슬라이드/메뉴)는 각 시스템 소유.
- `Workspace`만 Canvas/Composer를 연결하고 로컬 저장을 시작한다. 다른 기능이 Canvas DOM이나 Composer DOM을 직접 수정하는 통합은 금지.
- 제품 소스에는 실제 API 호출이 없다. 입력기 `onSubmit` 및 Canvas `onRun`은 모두 `accepted:false`를 반환하는 **명시적 미연결 처리**를 사용한다. 입력기를 비우거나 실행 완료 상태를 꾸며 내지 않는다.

## 3. 데이터 소유권·준비 상태 (확정 사실 / 임시 / 미확정 구분)

| 데이터/기능 | 현 구현·표현 | 장기 원본/책임 방향 | 판단 등급 |
| --- | --- | --- | --- |
| Shell/Host/Slides/입력/테마 | 실제 브라우저 모듈 동작 | 프론트가 각 역할 소유 | **확정 구현** |
| 그래프 블럭·연결 | `workspace/model.js` `{version:1,blocks,links}`; IndexedDB `cache.canvasState` | 서버 자산 원본, 프론트는 조작·캐시·표현 | **로컬 임시 형식** |
| 블럭 배치·확장·입력 `values` | 블럭 인스턴스 속성에 혼재 | 무엇이 공유 영속/로컬 UI인지 추가 분할 결정 필요 | **미확정 경계** |
| 카메라 `{x,y,zoom}` | `local.canvasViewport` | 프론트 UI 상태 | **확정 방향/구현** |
| Skill 정의·포트·필드 | `skill/catalog.js` 정적 7종 | Skill은 서버 측 관리될 재사용 정의 자산 | **현재 Catalog는 임시 표시용** |
| Saved Function | 없음 | Skill과 별개의 저장/참조/실행 자산 | **개념 확정·계약 미정** |
| 구조화 Composer 입력 | `draft.parts`(text/skill/block) + `attachments`(Blob 포함) | UI 편집은 프론트; 서버 요청 직렬화·저장/동기화 미정 | **로컬 초안 형식만 구현** |
| Chat 기록/중간/최종 언어 | Chat 시작 화면만 있음 | 요청·메시지 확정 기록은 서버 원본; 임시 진행 표시는 프론트 | **화면/계약 미구현** |
| Library 자산 | 목업 문서/이미지/프로젝트 예시 | 데이터 소유·공급과 Library UI의 책임 분리 | **목업, 자산 범위도 미정** |
| 로컬 파일 | File/Blob을 파일 블럭/초안에 보유 | 업로드·서버 asset ref·권한/접근은 미정 | **로컬만 구현** |
| `roomInfo`, `chatRecord`, `contextData` | IDB cache 도메인은 존재; 실제 Chat/세션 서버 연동 없음 | 서버 원본의 검증된 캐시 | **저장 공간만 준비됨** |
| `chatScroll`, `mascotPresentation` | IDB local 도메인은 존재; 모든 UI와 실제 연결됐다는 뜻 아님 | 프론트 전용 | **저장 공간만 준비됨** |
| 요청 수명·`contextBlock`/`focus`·진행 | 백엔드 없음 | 서버만 원본, 호출 내부 상태 미공개 | **설계 원칙 확정/구현 없음** |

`localDataStore.js`는 IDB `ovll-beta-data`(v1)를 `serverCache`(cache)와 `localOnly`(local)로 나눈다. `cache`는 `source:"provisional"`(현재 로컬 임시)과 `source:"server"`(**실제 서버가 확정한 뒤에만**), 숫자 revision 조건을 구별하며 동일·더 오래된 revision의 덮어쓰기를 방지한다. 이는 **캐시 항목 수준의 방어**이지 SSE 수신, 공용 자산 충돌 병합, 오프라인 변경 큐가 아니다. 실제 서버 revision 규칙은 미정이다.

## 4. 이미 있는 연결점과 위험 — 실행 전에 알아야 함

### A. Composer → 요청

- 현재 실제 호출: `createComposer({model,onSubmit,onHeightChange,onAttach})`. `onSubmit(draft)`의 `draft`는 `normalizeDraft`로 정규화한 `{parts,attachments}`이며 참조는 `{type:"skill"|"block",id,label}`, 텍스트는 `{type:"text",text}`다. 첨부에 실제 `Blob`이 포함될 수 있다. **DOM HTML·참조 문자열 프로토콜이 아니다.**
- `{accepted:true}`인 경우에만 전송 당시 revision에 따라 초안을 비운다. 편집 중 새 입력을 보존한다. 이 내부 revision은 **프론트 편집 세대**이며 서버/자산 revision이 아니다.
- 실제 HTTP 전송 직렬화, Skill 참조의 시점·버전, 파일 업로드, 요청 ID 수신·중복 제출·에러 분류는 아직 없다. **현재 `onSubmit` 계약을 곧바로 서버 JSON 스키마로 지정하지 않는다.**
- 현재 첨부는 Workspace `onAttach` → `Canvas.addFile`로 연결되어 파일 블럭을 생성하고 캔버스로 이동한다. 이것이 서버 업로드 완료를 의미하지 않는다.

### B. 서버 → Chat

- 실제 메시지 리스트·중간 발화·진행/실행 결과/최종 답변의 구분 모델 없음. Chat은 welcome DOM뿐. 백엔드가 보낼 데이터 구조를 아직 렌더링할 객체가 없다.
- 요청 단계의 잠정 표시와 저장된 확정 메시지를 분리해야 한다. 동일 요청에 여러 발화가 올 수 있으며 `roomId/requestId`와 개별 message ID를 동일시하면 안 된다.
- 모델이 말한 성공과 서버의 자산 변경 성공을 구분. 호출처리객체 전체나 민감한 지침/`focus`를 Chat 기록으로 복제하지 않는다.

### C. 서버 확정 → Canvas

- 현재 모델 공개 함수: `getSnapshot/getBlocks/getBlock`, `addBlock/updateBlock/deleteBlock`, `connect/disconnect/toggleConnections/disconnectPort`, `replace`, `subscribe`, `undo/redo`.
- `replace(snapshot)`는 입력의 Skill 존재·포트·연결 무결성을 검증하고 **undo/redo를 초기화**, `subscribe` 변경 이벤트를 일으킨다. 서버 SSE 이벤트를 여기에 아무 처리 없이 연결하면 현재 provisional 자동 저장과 섞일 수 있다.
- `addBlock/connect`은 로컬 ID를 생성한다. 서버의 확정 ID/수정 리비전·검증 규칙과 지금 동일하다고 가정하지 않는다.
- `workspace/model.js`, `canvas/controller.js` 및 Composer 참조 UI가 정적 `getSkill()`에 의존한다. 서버가 생성한 Skill 정의를 공급/검증하는 경계가 먼저 필요하다.
- 현재 포트는 타입/방향·중복·단일 입력·자기 연결·순환(DAG)을 로컬 검증한다. **서버 최종 Skill/실행 IR의 규칙과 같다는 근거 없음**. 이 제약을 백엔드에 역강제하지 않는다.
- Canvas 렌더러를 서버 이벤트에서 직접 호출/DOM 변조하지 않는다. 검증된 데이터 변경은 모델·공개 입력 경계로 전달해야 한다.

### D. Canvas 수동 조작 → 서버

- 현재 드래그/포트 클릭/정리/초기화/undo 등은 모델을 즉시 바꾸고 로컬 `provisional`로 저장한다. 서버 승인 여부나 출처가 기록되지 않는다.
- 장차 수동 편집의 명령→확정/거절→UI 동기화, 사용자별 접근권한, 자산 revision, 충돌·undo 정의가 필요하다.
- 드래그 중 표시 위치/선택/임시 연결선과 영속 그래프 변경은 서로 다른 상태. 서버는 매 포인터 이동을 자산 변경으로 취급하면 안 된다.

### E. 복구·저장

- 현재 단일 고정 방 `ROOM="beta-local-workspace"`, 그래프 `canvasState`·구조화 초안 `chatDraft`·카메라 `canvasViewport` 저장. Workspace의 모델 구독자가 그래프 변경을 곧바로 `source:"provisional"`로 기록한다.
- 실패한 그래프 복원 결과를 덮어쓰지 않도록 보호하며, 도메인별 저장 실패를 사용자에게 알린다. 저장 쓰기 직렬화를 유지한다.
- 향후 서버 스냅샷 적용 및 캐시의 `source:"server"` 전환은 임의 수행 금지. 서버 버전 확인 없이 캐시를 덮거나, IDB 기반 로컬 작업을 자동 업로드/이관하는 기능을 만들지 않는다.
- SSE 단절은 서버 요청 취소가 아님. 취소는 별도 명령이며 접수와 실제 종료가 다를 수 있다는 방향이 논의되었지만 URL/상태 전이 등은 미정.

## 5. 책임 구조: 현재 → 필요한 경계 (추가 파일명은 제안, 확정 아님)

```text
[브라우저 UI]                                  [백엔드: 아직 미구현]
Composer (typed draft)                          HTTP 요청 접수/인증
  │ onSubmit(draft)                                     │
  ▼                                                     ▼
Workspace 공개 콜백 ── (미래의 요청 전송 경계) ──→ 요청별 처리 상태
  │                                                Gate / Corridor
  │                                                Workroom → 검증·실행
  │                                                Output / 종결
  │                                                     │
  ├── Chat 표현  ←─ (미래의 공개 진행·확정 이벤트) ─────┤
  ├── Canvas Model ←─ (검증된 자산 변경/스냅샷) ────────┤
  ├── Library UI ←─ (검증된 자산 목록/메타데이터) ──────┤
  └── localDataStore (최신 승인 캐시 / UI 전용 상태)    └─ DB 원본
       ↑
Canvas 수동 조작 ── (미래의 편집 명령/승인 경계) ───────→ 서버 자산 변경 검증

독립적인 글로벌 프레임:
boot → App Shell / Page Host / Hosted Slides / Input Manager / Theme
(Shell/Host는 AI 응답, 서버 요청 상태, 도메인 변경을 소유하지 않음)
```

**API 함수 파일 / 처리 계층 설계 판단**

| 책임 | 지금 코드의 위치 | 후속 코드 위치/방식에 대한 *제안* | 이번 단계에서 하지 않는 일 |
| --- | --- | --- | --- |
| 네트워크 호출(HTTP/SSE 전송) | **없음** | HTTP/SSE 계약 승인 뒤 `front/js/api/` 아래 **실제 책임별 최소 파일** 검토 | 빈 `api.js`/URL 임의 상수/가짜 성공 함수 추가 |
| 요청 전송·중간 상태·중단 버튼 UI 연결 | `workspace/controller.js`의 `onSubmit`은 미연결 | 실제 상태 수명에 따라 Workspace 또는 전용 요청 표현 모듈(필요성이 확인될 때만 분리) | `boot.js`/Shell에 요청 상태 관리자 얹기 |
| Chat 표시 | 단일 정적 welcome DOM | 메시지 표시/임시 진행 UI는 Chat/Workspace 도메인 소유 | 미확정 이벤트 이름/채팅 DB 행 구조를 UI 계약으로 고정 |
| Canvas 서버 적용 | `workspace/model.js`의 `replace`/변경 API | Catalog 공급·서버 확정 적용과 로컬 편집 의도 분리 계약 뒤 연결 | SSE 수신에서 Canvas DOM 직접 수정, 매 이벤트 `replace` |
| Skill 목록·정의 조회 | `skill/catalog.js` 로컬 상수 | 검증된 Catalog 공급 경계를 우선 확정. 프론트 기본 정적 정의는 *임시 표시* | 이 상수를 실제 서버 스키마로 채택 |
| Library UI/조회 | `front/index.html` 목업 | 자산 종류/권한/목록·상세 계약 이후 Library 도메인으로 분리 검토 | 가짜 데이터로 라이브러리 완료 선언 |
| 캐시/로컬 상태 | `data/localDataStore.js` | 현재 cache/local 구분 유지, 서버 인정 revision만 cache에 기록 | 별도 범용 GlobalStore, 오프라인 동기화 추측 구현 |

**왜 지금 API 함수 파일을 만들지 않는가:** 실제 호출 URL, 인증, SSE 연결 단위/재연결, 응답 스키마와 오류·멱등·중단 계약이 없다. 무언가 구현하면 나중에 폐기하거나 서버 계약을 잘못 선점하는 *쓸모없는 새 계층*이 될 위험이 있다. 현재 `Composer.onSubmit`·`Canvas.onRun`·`WorkspaceModel`·`localDataStore`는 실제 API가 정해지면 연결할 자리로 식별되어 있다. **API 폴더 및 계약을 문서에만 제안하고 빈 생산 코드는 추가하지 않는다.**

## 6. 백엔드 1014와 결합할 때의 경계

**확정된 논리 흐름:** 요청별 제어는 Gate → Corridor Initial → (즉시 응답 | Workroom 행동 및 검증 → 필요시 Corridor Return 반복 → terminate → Output). 이것은 조건/순환 구조이며 LLM 호출 수와 1:1이 아니다. Workroom 선택 분류 `skillDefine`, `skillEdit`, `canvasEdit`, `textGenerate` 및 그 행동 목록은 `docs/developing/workrooms.md` 확인. `execute`를 임의 작업실로 만들지 않는다.

- **서버 내부:** 요청 처리 객체(방/요청 수명), 호출 처리 객체(개별 모델 호출 수명), 모델 입력 지침·`focus`·실행 로그/취소 신호는 프론트 공개 API가 아니다.
- **프론트 공개 경계:** 필요한 요청·메시지·진행 표시·검증된 자산 변경/상태 스냅샷만 내보낸다. 내부 `planIndex`·`focus` 등 구현 세부를 UI 상태에 무조건 복제하지 않는다.
- **Skill ≠ Skill Block ≠ Saved Function**. 정의 생성, 배치, 실제 실행 완료는 서로 다르고 실제 저장 결과로 확인한다. `textGenerate.basicText/question`은 사용자에게 보여줄 수 있지만 성공 증명이 아니다.
- **서버 원본의 안전:** 같은 방의 복수 요청과 같은 Canvas/`contextData` 자산 충돌을 요청별 ID 하나로 해결할 수 없다. 자산 revision·적용 순서가 따로 필요하다.
- **중단/오류:** SSE 끊김과 서버 실행 종료는 다르다. 중단 접수와 중단 완료, 이미 확정된 변경과 향후 미실행을 구분한다. 실제 요청 취소 URL/상태 값/최종 응답 포맷은 아직 승인되지 않았다.

## 7. 구현 단계와 명시적 중단선

| 단계 | 진행할 수 있는 범위 | 진행 전에 필요한 근거/승인 | 하지 말아야 할 것 |
| --- | --- | --- | --- |
| **현재: 코드·명세 실태 확인** | 책임·호출 지점 분석, 본 노트 작성, 기존 UI/로컬 편집 유지 | 이미 있는 문서·코드만 사용 | API/SSE/백엔드 실행했다고 주장 |
| **프론트 독립 UI 단계** | 별도로 승인된 Chat/Library 화면 구조·빈 상태·접근성·Canvas UX 검증 및 로컬 입력 보존 | 사용자 UX 범위·자산 목록/정보 표현 합의 | 목업을 실제 DB 데이터로 둔갑, 불필요한 신규 상태 관리자 |
| **Skill/Canvas 계약 단계** | *승인된* Skill 공급·식별자·포트·그래프 변경/승인·undo·revision 경계에 맞춘 모델 개선 | 아래 결정 Q1~Q4 | 기존 정적 Catalog/로컬 `version:1`을 백엔드 표준으로 강제 |
| **HTTP/SSE 연결 단계** | 확정된 전송 계약별 실제 함수 구현, 요청별 진행·최종 조회/복구 | Q5~Q8 및 백엔드 실행·검증 구현 | 엔드포인트·페이로드·SSE 이벤트 발명 |
| **배포/완료 검증 단계** | 브라우저 회귀, 서버 통합·재접속/충돌·실기기 검증 | 앞 단계 실제 연결·테스트 환경 | 서버 없는 상태에서 E2E 성공/완성 선언 |

완성으로 혼동하면 안 되는 현 상태: **로컬 Canvas/Composer UI는 동작할 수 있지만 실제 Skill 정의/실행·AI Chat·Library 자료 공급·SSE·서버 DB/권한·Service Worker는 완성되지 않았다.**

## 8. 백엔드 담당자에게 먼저 확인할 결정 — *미확정, 임의 선택 금지*

- **Q1 Skill 정의 계약**: 서버가 공급할 최소 표시/입출력/편집/실행 메타데이터는 무엇인가? Skill 버전·삭제·동적 업데이트 시 이미 배치된 Skill Block은 어떻게 유지하나?
- **Q2 Canvas 원본**: 방과 캔버스 1:1인가, 여러 방에서 공유 가능한 자산인가? 블럭/링크 ID 누가 발급하나? 어느 필드(배치·`expanded`·`values`·파일 참조)가 서버 영속이고 어느 필드가 로컬 전용인가?
- **Q3 편집 확정**: 수동 조작을 낙관적으로 UI에 먼저 반영할지, 서버 확인 후 반영할지, 조작별 구분할지? 변경 명령·충돌·거절·undo/redo 경계는?
- **Q4 Library 범위**: Skill, Saved Function, 생성/첨부 파일, 프로젝트 중 무엇을 보여주나? 목록·검색·이동·참조·권한·삭제 계약은?
- **Q5 요청/Chat**: 입력의 typed draft·첨부 처리, 서버 request ID 발급 시점, 채팅 record 단위(요청 묶음/개별 메시지), 중간 언어·질문·진행·최종 상태의 UI 공개 구분은?
- **Q6 전송**: HTTP 메서드/URL, 인증, SSE 방별 또는 요청별 구독, 이벤트 ID/버전/재연결, 중복 이벤트·오류·중단·최종 스냅샷 규칙은?
- **Q7 자산 동기화**: 요청 revision과 Canvas·Skill·contextData 자산 revision 구분, 동시 수정/재접속 시 충돌·복구/멀티탭 처리?
- **Q8 로컬 이관**: 기존 `provisional` IndexedDB 그래프/파일/초안을 서버 연결 뒤 이관할지 보관할지 초기화할지, 오프라인 수정은 허용할지?

**Q1~Q3 결정 전에는 Canvas를 서버 확정 자산 모델로 교체하지 않는다. Q4 전에는 Library 데이터를 지어내지 않는다. Q5~Q7 전에는 API/SSE와 Chat 결과를 연결하지 않는다. Q8 전에는 기존 로컬 내용을 자동 삭제/업로드하지 않는다.**

## 9. 변경·검증·다음 에이전트 행동 규칙

1. 먼저 `AGENTS.md`와 해당 `docs/developing/` 원본을 읽고 **현재 beta 코드를 다시 확인**한다.
2. 본 노트의 **사실**(파일/현 호출)과 **제안**(새 API 위치/순서), **미확정**(서버 계약)을 구분한다. 이 문서를 최종 구현 명세로 인용하지 않는다.
3. 백엔드 쪽 제어 로직과 프론트 UI 상태를 직접 결합하지 않는다. 모든 도메인 수정은 공개 계약·검증 결과·생명주기와 함께 설계한다.
4. 중요 계약이 사용자에게 확정되면 `docs/developing/`의 적절한 **기존 명세에 통합**, 일시 논의는 정리/삭제한다. 확정된 규칙을 notes에만 남겨 두지 않는다.
5. **최소 회귀:** Canvas 블럭/포트 무결성·undo, Composer 참조·IME·초안/첨부, Hosted Slides·메뉴·InputManager, 페이지 전환·데이터 복원·테마. Node/Playwright 기존 `tests/frontend/*.test.mjs`를 필요한 범위에서 재사용한다. 실제 Android/iOS 키보드·Safari/Firefox/PWA는 과거 문서에서 미검증임을 유지한다.
6. `main` 수정/병합/배포, `back/js/` 가짜 구현, 서비스워커·임시 REST URL, 새 범용 GlobalStore·변환기·호환 계층 자동 생성은 금지. 차후 실제 요구와 계약을 먼저 확인한다.

**최초 인수인계 작성 당시:** 문서 검토만 수행. 후속 beta 구현 완료 목록은 아래 10절을 참고.

## 10. 최종 구현 인수인계 — 2026-10-19

### 실제 완료한 프론트 준비 사항

| 코드 경로 | 실제 구현 | 범위 제한 |
| --- | --- | --- |
| `front/js/workspace/dataAccess.js` | `readCanvasSnapshot()`, `readSkillCatalog()`, `readComposerDraft()`, `readCached(kind,{limit?})` | **읽기 전용 로컬 상태·캐시**. 백엔드 need 조회 또는 실행 IR 생성 아님 |
| `front/js/workspace/controller.js` | `getDataAccess()`, `refreshSkillCatalog()`, 선택적 `skillCatalog:{get,list}`, `onSubmitRequest(draft)`, `onRunBlock(blockId)` | Boot는 아직 공급자·콜백을 넘기지 않으므로 요청/실행 미연결 |
| `front/js/workspace/model.js` | 주입된 `resolveSkill`을 사용해 기존 graph 무결성 검사, `validateCurrent()` | 로컬 v1 그래프와 로컬 ID/undo 유지; 서버 원본/Revision 아님 |
| `front/js/canvas/controller.js` | 주입 Skill로 포트/블럭/팔레트 표시, `flushPendingEdits()`·`refreshCatalog()` | 서버 확정된 변경의 적용/충돌 처리 없음 |
| `front/js/composer/controller.js` | 주입 Skill로 참조 메뉴 갱신 | 서버 요청 직렬화/첨부 업로드 없음 |
| `data/localDataStore.js` (기존) | 기존 캐시 source/revision 가드 유지; Workspace가 `written:false`를 저장 실패로 인식 | 네트워크 동기화·DB 원본/오프라인 큐 없음 |
| `tests/frontend/workspace-data-access.test.mjs` | 파일 Blob 비노출·지연 Canvas 입력 반영·캐시 출처 및 모델 Skill 공급자 검증용 3개 단위 테스트 | 별도 JS 실행 환경 3개 통과; 전체 Chromium·실제 서버/실기기 테스트 미실행 |

### 다음 에이전트가 읽을 수 있는 실제 프론트 데이터

```js
const source = workspaceController.getDataAccess();
const currentCanvas = source.readCanvasSnapshot();          // local-view / beta-local-edit-graph-v1
const skillDefinitions = source.readSkillCatalog();         // local-presentation-catalog
const unsentDraft = source.readComposerDraft();             // local-unsent-draft
const contextCache = await source.readCached('contextData'); // 없으면 null
const chatCache = await source.readCached('chatRecord', {limit:50}); // 시간순이 아닌 키 순서
```

- Canvas의 미확정 입력 필드는 조회 전에 Model로 반영하지만, **검증된 서버 실행 IR은 반환하지 않는다**. 로컬 그래프 포트/DAG 제약과 `expanded`/`values`/file 형식은 beta 로컬 UI 계약이다.
- Composer의 typed 초안 `{parts,attachments}`과 `onSubmitRequest(draft)`는 아직 HTTP body가 아니다. 서버 업로드를 완료하지 않은 Blob을 파일 참조로 둔갑시키지 않는다. `onRunBlock(blockId)`의 ID 역시 지금은 로컬 ID다.
- `readCached('contextData')`는 기존 IDB에 캐시된 내용만. **contextBlock(intent/progress)과 호출별 focus는 백엔드 관리**, contextData와 chatRecord 원본도 서버 관리 예정. 이 필드에 없는 값이나 임시 AI 메시지를 만들어 호출 데이터에 채우지 않는다.
- **need**: Gate/Workroom은 사용자가 브라우저를 닫아도 계속 실행될 수 있으므로, 서버가 검증한 방/자산 원본(채팅, 맥락, 캔버스, Skill, IR)을 서버 내부 데이터 조회 기능으로 공급해야 한다. 프론트 상태 조회는 *미전송 사용자 편집 사항을 명시적으로 서버에 제출해야 할 때* 활용할 수 있는 보조 수단으로만 사용한다.
- **IR**: beta 프론트에는 실행 IR 원본/생성기/서버 검증 기록이 존재하지 않는다. `{version:1,blocks,links}`를 그대로 실행 IR 또는 기존 main의 GraphPatch/ModelTurn으로 정하지 않는다. 새 IR의 저장·컴파일·검증·revision/참조 계약은 백엔드가 구현하기 전 협의해야 한다.

### 아직 구현하지 않은 것 (완료 오인 금지)

- 백엔드 Gate/Corridor/Workroom/Output, 독립 요청/호출 수명, 검증된 `need` 데이터셋 레지스트리, 저장 Function, 실행 IR과 DB 원본.
- HTTP/SSE API 파일·URL·이벤트 스키마, 요청 ID 발급/중단/재연결, 확정 변경 이벤트·자산 revision·다중 요청 충돌 해결.
- Chat 기록·중간 발화·최종 발화·요청 진행 렌더러/시간순 페이지네이션, 실제 Library 자료 관리/검색·Skill 공급/파일 업로드.
- `provisional` 로컬 캐시 이관, 사용자 Canvas 수동 편집의 서버 승인/undo 정책, Android/iOS·전체 브라우저 회귀 검증.

### 백엔드 담당자에게 넘기는 결정 순서

1. `AGENTS.md` + `docs/developing` + 이 문서 + 실제 소스를 다시 확인.
2. Skill/Skill Block/Saved Function/Canvas/IR의 서버 원본·조회 권한·공개 데이터 형식과 자산 버전 확정.
3. Gate/Workroom `need`의 dataset 목록/파라미터/권한/조회 일관성 확정 (브라우저 직접 호출 불가 원칙).
4. 요청의 typed 입력/첨부·대화 기록·중간/최종 발화·HTTP/SSE·재접속/취소/충돌 계약 확정.
5. **그때 필요한 실제 API 함수 파일만 추가**하고 `onSubmitRequest/onRunBlock` 및 Workspace 공개 데이터 접근 기능을 적절히 연결. 가짜 API, 범용 전역 상태 관리자, main 레거시 변환기 도입 금지.
6. 서버-프론트 종단간 요청, 파일 참조, 그래프 검증/실행, 동시 요청/중단/재접속, 모바일 실기기 검증 후에만 완성 주장.
