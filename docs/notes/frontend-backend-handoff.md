# Ovll beta — 프론트·백엔드 연결 인수인계 (2026-10-19)

> **읽는 순서:** 이 문서 → `AGENTS.md` → `docs/developing/frontend-workspace.md`·`frontend-data.md` → `architecture.md`·`context.md`·`workshops.md` → 실제 `beta` 코드.
>
> **2026-10-23 업데이트:** 2026-10-19 당시 프론트 인수인계 기록이다. 이후 `back/js/`에 Gate → Hallway Initial 독립 프로토타입이 구현됨. 문서 내 '백엔드 없음' 설명은 당시 기준이며, 현황은 `docs/developing/request-engine.md`가 우선이다.
>
> **상태:** 실제 구현/미구현/미확정의 구분을 위한 인수인계. 새 백엔드 API/IR 명세가 아니다. `docs/notes/`에 위치하므로 여기의 미확정 항목을 구현 계약으로 자동 승격하지 않는다. **브랜치 `beta`만 수정. `main`은 참조용, 수정·병합·배포 금지.**

## 0. 2분 요약 — 프론트 준비 상태

1. **프론트의 독립된 구조는 동작한다.** `boot → Shell / Page Host / Hosted Slides / Input Manager → Workspace·Library`. Workspace 내부에서 Canvas·Composer·Chat은 각 영역의 입력/표시를 소유한다. Library는 별도 표시 페이지다. 백엔드가 Shell/DOM을 직접 조작하지 않는다.
2. **Canvas는 프론트가 조작한다.** 사용자의 이동·입력·연결은 서버 승인을 기다리지 않는다. 현재 로컬 Model이 편집 원본이고 IndexedDB에는 브라우저 재진입용으로 저장한다. **Canvas 상시 동기화는 이 단계의 요구가 아니다.**
3. **외부 → 프론트 정보 요청:** `workspaceController.getDataAccess().exportCanvasJSON()`으로 호출 시점의 블럭·연결·설정을 JSON **문자열**로 내보낸다. 서버 호출·SSE/HTTP를 이 함수가 수행하지는 않는다.
4. **외부 → 프론트 Canvas 변경:** `workspaceController.getCanvasCommands()`로 기존 모델의 검증된 로컬 `addBlock/updateBlock/deleteBlock/connect/disconnect`를 사용한다. 이는 **작업실 명령 스키마, IR 컴파일러, 실행기가 아니다.**
5. **외부 → Chat·Library 표시:** Workspace의 `setConfirmedChatRecords`·`setRequestActivities`, Library의 `setConfirmedItems`·`setLoading`. 검증된 정보를 **표시만** 하며 가짜 응답/자산을 생성하지 않는다.
6. **프론트 → 요청/실행:** `createWorkspace({...,onSubmitRequest?,onRunBlock?})`라는 선택적 콜백 슬롯이 있다. 현재 `boot.js`는 실제 서버를 전달하지 않아 두 동작은 `accepted:false`다.
7. **없는 것:** 백엔드 서버/DB, 실행 IR, 요청·호출 수명 구현, Gate/Hallway/Workshop/Output 런타임, 권한/HTTP/SSE/업로드, 실제 Chat·Library 데이터 공급, 원격 자산 프로토콜. **프론트 연결 지점 준비 완료 ≠ 서버 통합 완료.**

## 1. 실제 책임·호출 구조

```text
front/index.html → front/js/boot.js
  ├─ shell/appShell.js             글로벌 메뉴·프레임
  ├─ shell/pageHost.js             workspace/library 상위 페이지 수명
  ├─ shell/hostedSlides.js         Chat↔Canvas, Library 단일 slide, Composer 고정 슬롯
  ├─ input/inputManager.js         포인터 소유권 조정 (작업 의미/서버 데이터 모름)
  ├─ settings/theme.js             UI 테마
  ├─ data/localDataStore.js        IndexedDB 임시 캐시/로컬 UI 상태
  ├─ workspace/controller.js       Workspace 컴포넌트 조립·공개 경계
  │   ├─ workspace/model.js        로컬 Canvas graph·검증·undo
  │   ├─ workspace/dataAccess.js   읽기 전용 snapshot / JSON 내보내기
  │   ├─ canvas/controller.js      블럭 UI·필드·제스처·파일 미리보기
  │   ├─ composer/controller.js    입력·구조화 초안·파일 선택
  │   └─ workspace/chat.js         확정 메시지/임시 진행 표시
  └─ library/controller.js         공급받은 자산의 표시·빈 상태

백엔드 (미구현)
  Gate / Hallway / Workshop / Output, 요청/호출 수명,
  서버 검증/저장/IR/need 조회, HTTP/SSE, 인증·파일 업로드.
```

- `boot.js`가 의존성을 연결하고 종료 수명을 소유한다. `window` 글로벌 API, 임의 도메인 간 import, Shell의 서버 로직은 없다.
- `front/js/api/*`는 아직 없고 **임의 URL/이벤트/메시지 포맷으로 빈 클라이언트를 추가하지 않는다**.
- 정적 배포 루트 `front/`, 진입 `front/index.html`. `back/js/`는 여전히 비어 있다. 배포 설정/Service Worker 변경은 이 작업 범위 밖.
- `skill/catalog.js` 7종은 **표시용 로컬 정의**이며 실제 서버 Skill 정의 계약이 아니다. 외부 `skillCatalog:{get(id),list()}`를 Workspace에 주입하는 슬롯은 준비됐다.

## 2. 바로 사용할 수 있는 프론트 공개 인터페이스

### A. 조회·내보내기 (Workspace 소유)

```js
const read = workspaceController.getDataAccess();

const canvasJson = read.exportCanvasJSON();      // JSON string
const canvasView = read.readCanvasSnapshot();    // JS object
const catalog = read.readSkillCatalog();         // 프론트 표시용 Skill
const draft = read.readComposerDraft();          // 미전송 typed 초안
const contextCache = await read.readCached('contextData');
const chatCache = await read.readCached('chatRecord', {limit:50});
```

- `exportCanvasJSON()`는 `readCanvasSnapshot()`을 **매번 호출**하고 직렬화한다. Canvas에 250ms 지연 중인 필드 입력도 먼저 로컬 Model에 반영한다. 별도 스냅샷 원본/동기화 큐가 없다.
- 현재 구조: `{roomId,source:'local-view',format:'beta-local-edit-graph-v1',snapshot:{version:1,blocks:[...],links:[...]}}`. 블럭의 `{id,skillId,x,y,expanded,values,file?}`, 연결의 `{id,from:{blockId,portId},to:{...}}`는 **베타 로컬 그래프 형식**이다. 현재 포트/DAG/필드 검증 역시 프론트의 표시·편집 규칙이다.
- `file`은 `name,type,size,localId?,localBlobAvailable,textPreviewAvailable`만 내보낸다. 실제 `Blob`, 텍스트 미리보기 본문, 영속 업로드 참조, 서버 자산 ID를 포함하지 않는다. 카메라는 화면 UI 상태라 포함하지 않는다.
- `readComposerDraft()`는 `parts`의 `text/skill/block` typed 참조와 첨부 메타데이터를 제공하지만 파일 Blob은 전달하지 않는다. 전송용 서버 요청 body가 아니다.
- `readCached`는 기존 IDB `roomInfo/chatRecord/chatDraft/contextData/canvasState`만 조회. `chatRecord`의 결과는 **키 순서**, 실제 시간순 채팅 기록/API 페이지네이션이 아니다. `contextData`가 기록되지 않았다면 `null`. **없는 데이터를 만들어 반환하지 않는다**.
- 프론트에 실행 IR 원본이 없으므로 이 JSON을 **실행 가능한 IR이라고 명명하지 말 것**. IR 직렬화가 필요해지면 IR의 실제 소유자·형식부터 확정해야 한다.

### B. Canvas 조작 — 별도 서버 명령 문법 없이 기존 Model로 연결

```js
const canvas = workspaceController.getCanvasCommands();
const block = canvas.addBlock('write', {x:10,y:20,expanded:false});
canvas.updateBlock(block.id, {x:30,values:{request:'문장'}});  // 해당 Skill의 필드여야 함
const link = canvas.connect(
  {blockId:block.id,portId:'실제 출력 포트 ID'},
  {blockId:'다른 블럭 ID',portId:'실제 입력 포트 ID'}
);
canvas.disconnect(link.id);
canvas.deleteBlock(block.id);
```

- 호출자가 기존 프론트 Model의 **실제 Skill·포트·필드 ID**를 준다는 전제의 사용 예시다. `getCanvasCommands()`는 `addBlock(skillId,options)`, `updateBlock(id,patch)`, `deleteBlock(id)`, `connect(from,to)`, `disconnect(linkId)`만 노출한다. 필드 입력의 지연 버퍼를 먼저 반영하고 기존 Model 메서드를 호출한다.
- 유효하지 않은 Skill·연결 등은 Model의 기존 오류가 발생한다. UI는 Model 구독을 통해 반영한다. 연결되거나 삭제됐다는 모델 변경 사실과 **서버 실행/파일 업로드 성공**은 별개다.
- Workshop `canvasEdit`의 의미·행동과 대응할 수 있지만, **모델/서버가 전송할 action-plan JSON이나 외부 호출 권한 규칙을 정한 것이 아니다**. 이를 그대로 신뢰할 수 없는 외부 요청/모델 출력에 노출하지 말고 실제 서버 통신 계층에서 필요한 검증을 구현해야 한다. 원격 동시 수정/AI 편집 충돌·undo 정책은 여전히 미확정이다.

### C. 요청 접수, Chat, Library

| 공개 함수/슬롯 | 프론트 책임 | 없는 것 |
| --- | --- | --- |
| `onSubmitRequest(draft)` | Composer typed 초안을 전달하는 선택적 콜백; **명시적 `{accepted:true}` 때만** 당시 입력 제거 | HTTP, 업로드, 요청 ID/중복·권한 |
| `onRunBlock(blockId)` | Canvas 블럭 실행 버튼의 선택적 콜백 | 작업실/스케줄러/실제 실행 |
| `workspace.setConfirmedChatRecords(records)` | `[{id,role:'user'\|'assistant',text,requestId?}]` 표시 | 실제 Chat 조회·저장·순서/권한 확인 |
| `workspace.setRequestActivities(items)` | `[{requestId,label,detail?}]` 임시 진행 표시 | 서버 단계의 정확한 로그/중단 상태 |
| `library.setConfirmedItems(items)` | `[{id,title,kind?,detail?}]` 표시, 빈 상태 구분 | 파일/함수/Skill 자산 분류·조회·권한 |
| `library.setLoading(boolean)` | 표시 중 로딩 상태 | 실제 로드 수행 |

- Chat의 **확정 기록과 요청 진행 표시가 분리**되며, 임시 활동을 채팅 기록으로 자동 승격하지 않는다. 내용은 `textContent`로 표시해 외부 HTML을 실행하지 않는다.
- Library는 허위 문서·이미지·프로젝트 예시 카드를 삭제했으며, 공급 전과 확인된 빈 목록을 구별한다. `library` 컨트롤러는 `boot.js`가 소유한다.
- 위 메서드의 타입은 **현재 프론트 표시용 입력**이지 백엔드 API JSON/DB 테이블의 최종 스키마가 아니다.

## 3. 요청·작업실·맥락/IR — 백엔드 작업자가 반드시 분리할 것

`docs/developing/architecture.md`, `context.md`, `workshops.md`의 현재 확정된 **논리적 의미**:

- 서버 요청 흐름: Gate → Hallway Initial → (즉시 응답 또는 Workshop 실행·검증 → 필요 시 Hallway Return → terminate → Output). 순환/조건부이며 매 계층마다 LLM 1회 호출을 강제하지 않음.
- `need`: `[[datasetName,...parameters],...]` 형태의 계획 필요자료 표현. **서버가 이미 가진 방/요청/자산·IR·대화·맥락 정보는 서버 내부에서 조회**한다. 항상 자동 공급되는 자료의 중복 조회를 강제하지 않는다.
- **프론트에서만 존재하는 최신 Canvas 편집 상태가 필요할 때:** 연결이 있는 브라우저에 데이터를 요청하도록 *향후 실제 통신 계층*을 설계하고, 그 접점에서 `exportCanvasJSON()`을 호출한다. 브라우저가 꺼져 있으면 최신 로컬 편집 결과는 그 시점에 제공 불가. 서버가 이미 받은 기존 스냅샷은 별도로 사용할 수 있다. 이를 이유로 상시 Canvas 동기화를 임의 도입하지 않는다.
- `contextBlock`: 해당 요청의 `intent/progress` 및 매 호출마다 서버가 제공하는 `focus`. 프론트가 별도 생성·갱신하지 않는다.
- `contextData`: 방/세션 전반의 지속 맥락. 서버 실행 원본과 프론트의 기존 캐시 영역은 다르며 `readCached('contextData')`는 있는 캐시만 제공.
- `chatRecord`: 메시지/요청 기록 원본 구조·조회/페이지네이션은 미정. 프론트의 표시용 `setConfirmedChatRecords` 타입을 DB 스키마로 복제하지 않는다.
- **IR**: 현재 beta에는 백엔드 실행 IR의 생성기·원본·검증 기록이 없다. `{version:1,blocks,links}`는 편집용 그래프. 옛 `main`의 `GraphPatch/ModelTurn` 형식을 새 표준으로 복제하지 않는다.
- Skill 정의 ≠ Canvas Skill Block ≠ IR에서 만든 Saved Function. Workshop `skillDefine/skillEdit/canvasEdit/textGenerate`와 `terminate` 의미 보존. `execute` 독립 작업실은 임의로 추가하지 않는다.
- 모델의 완료 발화 ≠ 서버 검증 완료. 상태·참조·검증·실행 및 실제 성공 여부는 백엔드가 결정한다.

## 4. 로컬 보존·전송 정책

- 현재 하나의 임시 로컬 방 `beta-local-workspace`. `workspace/model.js`의 편집 그래프, `composer/draft.js`의 typed 초안, `canvasViewport` 로컬 카메라가 존재한다.
- `localDataStore.js`: IndexedDB `serverCache`(provisional 및 장차 검증된 server 캐시)와 `localOnly`(UI 전용) 분리. **현재 서버 API·SSE·DB/오프라인 수정 큐 없음**. `source:'server'`는 실서버 확인 데이터에만 사용.
- Workspace 저장 큐는 도메인별 실패를 표시하고 후속 작업을 계속한다. `written:false`를 성공으로 취급하지 않는다. 그래프 복원 실패 시 저장된 내용을 자동 덮어쓰지 않는다.
- ***서버 승인/상시 동기화 정책은 Canvas JSON 조회의 선행조건 아님.*** 영속 서버 저장, 다중 기기/사용자 공동 편집, AI가 수정한 내용의 충돌 처리가 실제로 필요해질 때 별도 계약으로 결정한다.
- 로컬 데이터 이관/삭제/업로드는 절대 임의 시행하지 않는다.

## 5. 실제 완료·검증과 남은 계약

**이번 프론트 연결 준비 완료:**
- 독립 Shell/Host/Slides/Input Manager + 현재 로컬 Canvas/Composer/Chat/Library 페이지
- 정적 기본 Skill 및 선택적 Skill 표시 공급 슬롯(`{get,list}`), 모델 검증·undo
- 외부 입력 콜백(`onSubmitRequest/onRunBlock`), 한 번에 읽는 `exportCanvasJSON` 및 읽기 전용 데이터 접근
- 외부 Canvas 조작 함수 5종, Chat 기록/요청 진행 분리 표시, Library 자료/빈 상태 표시
- 로컬 영속 저장 가드, 가짜 서버 실행 방지. 코드·테스트·문서 변경은 `beta`에만 반영

**백엔드 설계/구현 전이라 의도적으로 미완료:**
- 요청별 인스턴스/호출 수명, Gate/Hallway/Workshop/Output 동작과 검증, IR/실행/Stored Function, `need` 실제 데이터 제공 목록
- HTTP/SSE 계약·인증·서버 재접속/중단·파일 업로드, 요청/메시지/자산 ID·Revision
- Chat·Library 실제 서버 데이터 취득, 기록 정렬·페이지네이션, 사용자/AI 원격 Canvas 변경 권한/충돌
- 브라우저 전체 Playwright 실행, 서버 연동 E2E 및 모바일 Safari/Android IME 실기기 검증

**다음 담당자의 실행 순서:** `AGENTS.md` 확인 → 이 문서의 실코드 API 위치 확인 → *서버가 소유하는 데이터와 프론트에 질의할 데이터 구별* → IR 및 need 조회/권한 계약 확정 → 실제 통신/실행 계층 구현 → Workspace 공개 인터페이스로 연결 → 실서버·실기기 검증. **비어 있는 api.js·동기화 매니저·가짜 서버 응답으로 구현 완료를 주장하지 않는다.**


## 6. 프론트 인프라 안정성 보강 — 최종 구현 사실 (2026-10-19)

- **방 범위:** `createWorkspace({root,data,input,roomId?})`의 기본 `roomId='beta-local-workspace'`. Workspace 인스턴스별 Model/초안/카메라/IDB 키가 격리된다. `getRoomId()` 조회 제공. Boot는 아직 하나의 로컬 방만 사용; 사용자 방 선택·서버 ID/권한 정책은 정해지지 않았다.
- **상태/서비스 주입:** 주입 `skillCatalog:{get(id),list()}`는 둘 다 필요하며 객체 메서드의 `this`를 유지한다. 요청/블럭 실행은 기존 `onSubmitRequest(draft)`/`onRunBlock(blockId)`를 선택적 주입한다. 실행/통신은 기본값에서 여전히 연결되지 않는다.
- **생명주기:** 종료된 Workspace가 외부 명령·조회·Chat setter를 계속 받아 임시 상태를 바꾸는 문제를 막았다. 이전에 획득한 CanvasCommands/DataAccess도 종료 후 거부된다. 캐시 조회가 비동기 완료돼도 종료 후 결과는 반환하지 않는다.
- **초기화·종료:** `boot.js`의 부분 생성 실패 시 각 소유자를 계속 정리한다. 실제 pagehide에서는 종료 중 Canvas의 마지막 입력 flush → 비동기 저장 완료 → IndexedDB 닫기 순서를 지킨다. BFCache 보존 진입은 앱을 파괴하지 않는다.
- **저장소:** 실패한 IndexedDB 업그레이드가 늦게 성공한 경우 DB를 즉시 닫아 재시도 중인 연결을 덮지 않는다. 기존 서버확정/provisional 가드와 데이터 도메인 분리는 유지.
- **검증:** Workspace/DataAccess/채팅·Library 투영, 막힌 IndexedDB 단위검사 총 **9개**를 분리 JS 실행 환경에서 검증했고, 모의 Workspace 다중 방/종료·모의 Boot 초기화 실패/정리 순서도 확인했다. 기존 `tests/frontend/workspace-browser.test.mjs`에 roomId 격리와 stale handle 검증을 추가했으나 **실제 Chromium 종단 테스트는 미실행**.
- **상태 구분:** 이 보강으로 **기본 프론트 소유권/초기화·종료/로컬 방/외부 연결 기반**을 완성한 것이지, 서버 HTTP/SSE/실행 IR/need 조회/실제 Chat·Library 데이터/파일 업로드, PWA 서비스워커, 모바일 실기기 안정성을 완성한 것은 아니다. 그런 미확정 기능을 의도적으로 임의 구현하지 않는다.

- **데이터 보존 보강(추가):** 기존 IDB 행이 존재하면서 Canvas 값이 누락됐거나 그래프가 검증에 실패하면 기본 그래프를 덮어쓰지 않는다. Composer 초안은 저장 구조의 최소 무결성을 검사하고 미지원 typed parts가 있으면 정규화 과정에서 버리지 않고 원본을 보호한다. 화면에 오류를 알리고 해당 도메인의 후속 자동 저장을 제한한다. 브라우저 회귀 테스트에 손상된 두 도메인 동시 복원 사례 추가(실제 브라우저 실행은 별도).

## 2026-10-23 독립 엔진 갱신

`back/js/request/` 메모리 요청 등록·대기열, `back/js/engine/` 독립 판단 엔진·자료 공급·프롬프트 조립, `back/js/model/gemini.js` 공급자 전용 호출기, `back/js/demo.js` 단일 요청 진입점이 추가되었다. `front/js/workspace/requestInput.js`는 구조화된 Skill/Skill Block 직접 참조를 요청 시작 시 읽는 별도 함수다. 이 변경은 **실제 프론트↔서버 연결을 뜻하지 않는다**. `boot.js`는 연결되지 않았고, HTTP/SSE/DB/Workshop·IR은 여전히 미구현이다. 세부 계약과 테스트: `docs/developing/request-engine.md`.
