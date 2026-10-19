# Workspace · Composer · Canvas — beta 로컬 구현

범위: main `ed2fcdd`의 컴포저·캔버스 로컬 동작과 외형을 beta 소유권 경계로 재구현. Chat은 시작 화면과 외부 공급받은 확정 메시지·요청별 임시 진행 상태의 읽기 전용 표시 기능을 제공한다. 모델 호출·실행·업로드·서버 동기화·저장 함수 생성/실행은 미구현. 기존 main 상태/IR/참조 문자열/전역 객체를 연결하지 않는다.

## 책임과 결합

| 모듈 | 소유 |
|---|---|
| `workspace/controller.js` | 단일 Workspace 조립, 페이지 활성 수명, 로컬 복원/저장, 파일 첨부와 슬라이드 이동의 공개 API 연결 |
| `workspace/model.js` | 스킬블럭·연결 원본, 변경 검증, 되돌리기 기록; 선택적 Skill 조회자 |
| `workspace/dataAccess.js` | 로컬 Workspace·캐시 읽기 전용 조회 (서버 need/IR 아님) |
| `workspace/chat.js` | 확정 대화 표시와 요청별 임시 진행 표시. 저장·통신·서버 메시지 스키마 소유 안 함 |
| `skill/catalog.js` | main에서 추출한 정적 표시용 스킬 목록. 실행 스키마 아님 |
| `workspace/icons.js` | 신뢰된 정적 SVG. 사용자 문자열은 SVG/HTML로 해석하지 않음 |
| `composer/controller.js`, `composer/draft.js` | 편집 DOM·선택·참조 메뉴·첨부·구조화 초안·입력 높이·활성 이벤트 수명 |
| `canvas/controller.js`, `canvas/geometry.js`, `canvas/files.js` | 블럭 표시·입력 필드·포트·연결 곡선·선택·카메라·제스처 의미·도구·로컬 파일 표시 |
| `css/composer.css`, `css/canvas.css`, `css/workspace.css` | 개별 기능 스타일 및 Workspace 배치. workspace.css는 기능 CSS 뒤에 로드 |

Boot가 `createWorkspace({root,data,input})`를 생성한다. 선택적 Skill 공급자와 요청·실행 콜백은 아직 Boot가 전달하지 않으므로 미연결이다. Page Host `onEnter`가 Workspace 구성 선언을 Hosted Slides에 전달하고 반환된 제어자와 새 `signal`을 Workspace `activate`에 전달한다. 이탈 시 deactivate, 문서 종료 시 destroy. Composer는 Hosted Slides의 bottom stationary 슬롯에 장착되므로 Chat↔Canvas 전환에 DOM·초안이 유지된다. Canvas 본문 `allowContentSwipe:false`, Chat은 true. Shell 메뉴 열림/문서 숨김에는 Workspace 공개 `closeTransientUI()`로 임시 메뉴·드래그·초기화 확인 상태를 종료한다.

Shell은 기능 내부 DOM을 조회하지 않는다. Page Host는 최상위 페이지 ID만, Hosted Slides는 내부 슬라이드 상태만 소유한다. Canvas와 Composer는 서로 import하지 않는다. Workspace가 공개 콜백으로 결합하며 window에 앱 API를 게시하지 않는다.

## 로컬 스킬과 스킬블럭

- **스킬**: 재사용 정의. **스킬블럭**: 캔버스 배치 인스턴스. 저장 함수는 별도 자산이며 이 구현에서 생성하지 않는다.
- catalog: `start`, `research`, `organize`, `judge`, `write`, `file`, `createFile`의 이름·설명·색·아이콘·입출력·공개 입력 필드. main의 legacy 인수·실행 지침은 가져오지 않는다. 내부 `start`는 추가/참조 메뉴에서 숨긴다.
- 기본 캔버스는 main처럼 비어 있다. 샘플 블럭·연결을 자동 생성하지 않는다.

```js
{
  version: 1,
  blocks: [{id, skillId, x, y, expanded, values, file?}],
  links: [{id, from: {blockId, portId}, to: {blockId, portId}}]
}
```

이 형식은 **beta 로컬 편집 스냅샷**이다. 서버 계약·실행 IR·Revision 형식으로 확정하지 않는다. 파일은 `{localId,name,type,size,text?,blob?}`. blob은 실제 로컬 Blob/File이고 URL 문자열을 영속 저장하지 않는다.

`createWorkspaceModel({snapshot?})`: `getSnapshot/getBlocks/getBlock`, `addBlock(skillId,{x,y,values,expanded,file}?)`, `updateBlock(id,patch)`, `deleteBlock`, `connect(from,to)`, `disconnect`, `toggleConnections(pairs)`, `disconnectPort(endpoint,direction)`, `clear`, `arrange`, `undo/redo/canUndo/canRedo`, `replace`, `subscribe`.

- 반환/이벤트 스냅샷은 복제본. 블럭 ID·스킬 참조와 카메라를 혼동하지 않는다.
- 실제 포트 존재·방향·타입·중복·단일 입력·자기 연결·순환을 검증한다. 기존 연결의 재선택으로 해제하는 UI 정책은 Canvas 책임이다.
- 블럭 삭제는 연결도 함께 삭제한다. 복원 검증 실패 시 기존 그래프를 바꾸지 않는다. replace는 되돌리기 기록을 초기화한다.
- `toggleConnections([{from,to}])`는 기존 쌍은 해제하고 새 쌍은 검증 후 추가한다. 유효하지 않은 쌍은 `{error}`를 반환하고 나머지를 적용한다. 전체 제스처는 한 번의 undo 단위. `disconnectPort`도 해당 방향의 모든 연결을 한 번에 해제한다.
- 되돌리기 최대 80회. 블럭 드래그는 표시만 이동하다 포인터 종료에 한 번 반영한다. 파일 생성/교체는 실제 Blob과 메타데이터를 한 번에 반영한다.
- 정리는 DAG 깊이에 따라 가로 열을 배정하고 같은 열의 블럭을 세로 배치한다. 실제 작업 실행 순서를 확정하는 계약이 아니다.

## Composer

`createComposer({model,onSubmit,onHeightChange,onAttach})` → `{element,editor,getDraft,setDraft,focus,closeMenu,activate,deactivate,destroy}`.

초안은 `{parts,attachments}`. parts는 `{type:'text',text}`, `{type:'skill',id,label}`, `{type:'block',id,label}`. 스킬과 배치 참조를 별도로 보존하고 태그를 문자열 프로토콜로 변환하지 않는다. 초안 복원에는 저장된 HTML을 사용하지 않는다. 첨부는 실제 File/Blob과 이름·MIME·크기·수정시각을 보존한다.

- compact 알약은 편집기 포커스·비어 있지 않은 입력·참조·첨부·열린 메뉴에서 확장한다. 빈 초안에서 포커스와 메뉴가 모두 사라지면 축소한다. 확장 시 파일 추가/스킬 참조/스킬블럭 참조/빠른 명령 4개 도구를 표시한다. 높이와 편집기·도구 이동은 폼 내부 좌표 기준 300ms 보간하며 reduced-motion에서 생략한다. 입력 폭은 별도 측정 요소로 판단한다.
- `+`는 작은 글래스 선택 메뉴를 열며 파일 추가 → 스킬 참조 → 스킬블럭 참조 순서로 표시한다. 파일 추가를 선택했을 때 파일 선택기를 연다. `@` 스킬/스킬블럭 검색, `/` 빠른 명령, 도구 메뉴, 방향키·Enter·Escape, 참조 선택/삭제를 제공한다. main의 저장 함수·사용자 스킬 목록은 beta 데이터 공급 계약이 없어 미연결이다. 정적 기본 스킬과 현재 모델의 스킬블럭만 참조한다.
- 편집기 기본 폰트는 `.93rem`이며 `base.css`의 공통 루트 기준에 따르고, coarse 포인터 환경에서는 모바일 OS 자동 확대를 막도록 최소 16px을 적용한다. 390px에서의 계산 px 값은 기준 폰트 변경에 따라 달라진다. 포커스가 없는 상태의 참조 메뉴 선택에서 Selection/execCommand가 편집기에 포커스를 주는 Chromium 동작은 `inputmode:none`·`virtualkeyboardpolicy:manual`을 먼저 설정하고 작업 후 blur/속성 복원한다. 네이티브 undo 기록을 유지하며 참조 칩의 pointerdown도 기본 편집 포커스를 막는다. 실제 Samsung/iOS 키보드 반응은 미검증이다.
- PC Enter는 전송, Shift+Enter는 줄바꿈, coarse 입력의 Enter는 편집으로 남긴다. IME 조합 중 전송/메뉴 선택을 실행하지 않는다. 붙여넣기/텍스트 드롭은 일반 텍스트만 삽입한다.
- 입력 높이·IME·메뉴 위치는 Composer 책임이다. 앱 프레임/브라우저 키보드를 조작하지 않는다. picker는 form의 backdrop 컨텍스트 바깥 형제 DOM이다.
- 편집은 element의 bubbling `input`으로 Workspace에 알린다. setDraft는 복원용이며 변경 이벤트를 발생시키지 않는다.
- `onSubmit`은 명시적 `{accepted:true}`에서만 초안을 비운다. 제출 중 새 편집이 생겼으면 최신 입력을 보존한다. 현재 Workspace 콜백은 accepted:false를 반환하므로 실제 전송·실행 성공을 주장하지 않는다.
- `onAttach(files)`가 `{handled:true}`를 반환하면 외부 소유자가 파일을 처리한 것으로 보고 초안 첨부를 중복 생성하지 않는다. 기본/미처리·실패 시 로컬 첨부로 보존한다. Workspace는 Canvas.addFile로 파일 스킬블럭을 만들고 캔버스로 전환한다.

## Canvas

`createCanvas({model,input,onRun,onNotice,onAttach})` → `{element,activate,deactivate,closeMenu,destroy,getViewport,setViewport,focusBlock,addFile}`.

- 표시/조작: 블럭 추가·확장·요청 입력·이동·삭제, 입력/출력 포트 클릭 또는 드래그 연결, 기존 연결 해제, 연결 선택·삭제, 정리·전체 보기·초기화·undo/redo.
- 새 일반 블럭은 펼쳐서 추가한다. 실제 펼친 크기를 측정해 주변 빈 위치를 찾는다. **일반/파일 삽입은 카메라 위치·줌을 변경하지 않는다.** 빈 위치가 화면 밖이어도 자동 재정렬하지 않으며 전체 보기/정리/명시적 focusBlock으로 이동한다. main의 compact 크기·아이콘·색·자연어 입력 스타일을 기준으로 한다.
- **단일 표면 소유권**: `.canvas-block`은 외곽선/배치, `::before`는 유일한 배경(`--ui-glass`)·질감·블러를 소유한다. `.canvas-block-body`와 `.canvas-field`의 일반 상태에는 독립 배경을 두지 않아 텍스트 입력부도 같은 유리 표면을 사용한다. 포커스 테두리는 약하게 표시한다. `::before`의 z-index 1이 포트(z-index 0)의 안쪽 절반을 가리고 헤더/본문(z-index 2)보다 뒤에 놓이는 계약을 유지한다.
- 접기·펼치기는 같은 블럭/편집 DOM에서 body 높이를 380ms `cubic-bezier(.16,1,.3,1)`로 보간한다. 불투명도/내용 이동은 별도 240ms로 보간하며 빠른 반전은 현재 표시 상태에서 이어간다. 포트와 곡선은 ResizeObserver로 현재 높이를 추종하고 좌표에는 테두리와 소수 단위 레이아웃 값을 사용한다. 포트 원은 .75rem·1px 테두리이며 포트 z-index 0 → 블럭 표면 ::before 1 → 본문/헤더 2 순으로 내부 반쪽을 덮는다. 표면은 pointer-events:none이므로 기존 포트 입력 영역은 유지한다. 라벨은 블럭 바깥 absolute·.625rem 한 줄이며 선택/호버에만 표시한다. 헤더 드래그 중에는 임시로 접었다가 해제/취소 시 펼치며 그래프 확장 상태와 undo 기록을 추가하지 않는다. reduced-motion은 즉시 반영한다.
- 출력 포트 드래그 중 다른 출력에 200ms 머물면 소스로 수집한다. 수집한 각 출력의 미리보기 곡선·시작점을 표시하고 입력에 놓을 때 한 묶음으로 토글한다. 입력에서 시작한 역방향 드래그는 단일 연결. 히트 범위는 포트 중심에서 월드 좌표 각 축 ±20px이다. 짧은 탭(<320ms)을 동일 포트에 340ms 안에 두 번 하면 해당 입/출력의 연결을 140ms fade 후 일괄 해제한다. 이탈·취소 시 수집 타이머·미리보기·미확정 fade를 정리한다. 클릭-클릭 연결과 연결 선택/삭제도 유지한다.
- 신규 블럭은 240ms 불투명도·340ms 이동/크기 등장 효과를 적용한다. 스킬 선택창은 180ms 불투명도·220ms 이동/크기를 보간하며 닫는 즉시 inert, 종료 시 hidden으로 전환한다. 정리 RAF는 기존 블럭 위치·카메라·연결선만 갱신하고 입력창 측정과 전체 렌더는 반복하지 않는다. 모든 효과는 이탈/destroy 시 취소하고 reduced-motion에서는 생략한다.
- 초기화는 두 번째 클릭으로 확정하며 되돌릴 수 있다. 입력 필드는 250ms 뒤 반영하고 change·이탈·메뉴 인계 시 남은 편집을 반영한다.
- 카메라 `{x,y,zoom}`는 그래프 밖의 로컬 UI 상태. 줌 .12–3. 마우스 배경 드래그·휠 커서 중심 줌(`exp(-deltaY*.0015)`), 터치 이동·두 손가락 핀치를 처리한다. 이동 판정은 7px 초과. 팬 해제 후 속도 평활(.68/.32)·최대 1.6px/ms·감쇠 `.86^(dt/16.67)`의 관성을 적용한다. 새 입력·메뉴·이탈·blur·hidden에서 중단하고 reduced-motion에서는 생략한다. 정리는 블럭 좌표와 카메라를 520ms의 정규화된 임계 감쇠 곡선으로 함께 보간한다. `canvasviewportchange` detail로 카메라 변경을 알린다.
- 텍스트/컨트롤은 Canvas 포인터 시작을 거절해 네이티브 편집을 유지한다. 포인터 취소·두 번째 손가락 개입·페이지 이탈 시 미확정 블럭 이동을 되돌린다.
- `InputManager.registerOwner({multiPointer:true,...})`는 같은 Canvas 소유자의 추가 포인터만 수락한다. 기본 소유자는 한 포인터 그대로다. 다른 소유자는 제어권을 탈취하지 못하며, 취소는 묶음 전체를 정리한다. Manager는 핀치 의미를 해석하지 않는다.
- `addFile(File)`은 로컬 파일 스킬블럭을 생성한다. 텍스트 미리보기는 파일의 앞 64KiB만 읽고 화면에는 최대 900자를 표시한다. 이미지/텍스트 미리보기와 로컬 내려받기는 실제 Blob으로 제공한다. Blob URL은 표시 수명에만 존재하고 교체·삭제·destroy 시 해제한다.
- 기존 파일 교체의 `onAttach(File,{blockId,metadata})`는 추가된 파일 정보를 반환할 수 있다. await 후 아직 유효한 파일 선택/블럭인지 확인하고 단일 모델 변경으로 반영한다. 현재 Workspace는 blob을 포함한 메타데이터를 반환한다.
- `onRun(blockId)`는 미래 실행 어댑터 연결점. 현재는 미연결 메시지만 표시하며 실행 결과·완료 상태를 만들지 않는다.

## 저장과 미구현 경계

기존 IndexedDB 어댑터를 사용한다. roomId는 임시 단일 방 `beta-local-workspace`, itemId는 `state`.

| 데이터 | 저장 |
|---|---|
| 그래프 | cache.canvasState, source:provisional |
| 구조화 초안 | cache.chatDraft, source:provisional |
| 카메라 | local.canvasViewport |

저장 쓰기는 순서를 보존한다. 도메인별 실패를 추적해 다른 UI 저장 성공으로 그래프/초안 저장 실패를 숨기지 않는다. 복원에 실패한 기존 그래프는 자동 덮어쓰지 않는다. 실패는 화면에 알리며 성공으로 표시하지 않는다. 로컬 임시 데이터가 미래 서버 원본 계약을 대신하지 않는다.

서버 연결점은 Workspace의 요청/실행 콜백과 스냅샷/카탈로그 공급 지점이다. room/account 선택, 권한, Revision/충돌, 서버 파일 참조, SSE, 실제 실행·Function 계약은 별도 명세 확정 후 구현한다. main 캐시를 자동 이관하지 않는다.

## 검증

`node --test tests/frontend/*.test.mjs` 실행에 Playwright 개발 환경과 Chromium이 필요하다. 별도 실행 파일은 `CHROMIUM_PATH`로 지정한다. 제품에는 패키지/빌드 도구를 추가하지 않는다.

검증 범위: 모델 무결성·복원·undo/redo·파일 교체, 편집/참조/초안 복원·한글 조합 이벤트·줄바꿈/붙여넣기, 포인터 취소·native mouse·CDP native touch·모바일 핀치·관성/취소·다중 출력 수집/일괄 해제·삽입 시 카메라 불변·펼침 DOM/높이 보간·정리 보간, 메뉴/슬라이드/Library 왕복, IDB 재진입·실패 표시, 모의 VisualViewport 축소/offsetTop, 모바일 여백·테마·화면 크기, 요청 미발생. Android/iOS 실기기 IME·키보드 애니메이션·Safari/Firefox·PWA 물리 환경은 미검증이다. main과의 픽셀 완전일치를 주장하지 않는다.

## 2026-10-19 실제 추가 구현 — 로컬 데이터 조회와 연결 슬롯

- `createWorkspace({root,data,input,skillCatalog?,onSubmitRequest?,onRunBlock?})`: `skillCatalog={get(id),list()}`는 **로컬 프론트 표시/검증용 정의 공급 슬롯**이다. 기본은 `skill/catalog.js` 정적 7종. 서버 Skill 스키마나 자산 revision 계약이 아니다.
- `createWorkspaceModel({snapshot?,resolveSkill?})`와 `createCanvas({...,resolveSkill?,listSkills?})`, `createComposer({...,resolveSkill?,listSkills?})`로 동일한 공급자를 전달한다. `workspace.refreshSkillCatalog()`는 기존 모델 무결성을 확인한 후 Canvas 팔레트/블럭·열린 Composer 참조 목록을 갱신한다. **실제 서버 동적 Skill 공급·삭제/버전 조정·동기화 미구현**.
- `onSubmitRequest(draft)` 및 `onRunBlock(blockId)`는 기존 UI 콜백의 선택적 주입점이다. 현재 Boot는 전달하지 않으므로 기본 `{accepted:false}`로 입력을 지키고 실행 완료를 가장하지 않는다. 초안/블럭 ID를 서버용 새로운 요청 본문으로 변환하지 않는다. 요청 **접수**와 작업 **완료**는 다르다.
- `workspace.getDataAccess()`는 소유 상태를 만들지 않는 읽기 전용 검사 객체다.
  - `readCanvasSnapshot()` → `{roomId,source:'local-view',format:'beta-local-edit-graph-v1',snapshot:{version,blocks,links}}`. 250ms 지연 입력을 먼저 반영한다. 파일의 Blob·텍스트 본문 대신 메타데이터와 localBlobAvailable/textPreviewAvailable만 담는다. **서버 실행 IR/최종 스냅샷/asset revision 아님**.
  - `readSkillCatalog()` → `{source:'local-presentation-catalog',definitions:[...]}`.
  - `readComposerDraft()` → `{roomId,source:'local-unsent-draft',parts,attachments}`. 참조는 typed parts, 첨부는 로컬 File/Blob 없이 메타데이터·보유 여부만.
  - `readCached(kind,{limit?})` → 기존 `roomInfo/chatRecord/chatDraft/contextData/canvasState` 캐시. `chatRecord`는 IDB **키 순서**(시간순 아님), `contextData`가 없으면 null. 요청별 `contextBlock`은 임의 클라이언트 상태로 생성하지 않는다.
- **Gate/Workroom need 조회는 서버가 권한/버전을 확인한 원본 Canvas/Skill/IR/채팅/맥락 자산에서 해결한다.** 로컬 검사 API는 네트워크 전송도 need datasetName 해석도 하지 않으며 서버 원본이 아니다.
- IDB 캐시가 `{written:false}`를 반환하면 Workspace는 기존 저장을 성공 처리하지 않고 사용자에게 실패를 알린다. 서버가 소유한 캐시를 provisional 변경으로 덮었다고 주장하지 않는다.
- 백엔드 실행·HTTP/SSE·실제 Chat·Library·Server IR/Revision·업로드·동시성·오프라인 동기화는 **아직 없음**.


## 2026-10-19 추가 — Chat·Library 읽기 전용 표시 계약

- `front/js/workspace/chat.js`: `createChat({onOpenCanvas?})`를 Workspace가 소유하고 Hosted Slides의 Chat 슬라이드로 전달한다. `setConfirmedRecords([{id,role:'user'|'assistant',text,requestId?}])`와 `setRequestActivities([{requestId,label,detail?}])`를 별도로 받아 표시한다. 서로 다른 요청의 진행 상태는 requestId로 식별한다. **임시 활동을 확정 채팅 기록으로 자동 저장하거나 AI 실행 완료로 판단하지 않는다.**
- Workspace 공개 API: `setConfirmedChatRecords(records)`, `setRequestActivities(activities)`. 표시 전용 스키마이며 **서버 API, DB 채팅 행, 요청처리객체, SSE 이벤트 계약 아님**. 외부에서 검증·정렬한 정보만 넣어야 한다. 현재 Boot에는 공급자가 없으므로 환영 화면만 보이며 가짜 대화 기록은 생성하지 않는다.
- `front/js/library/controller.js`: `createLibraryPage()` → `{element,setConfirmedItems(items),setLoading(flag),destroy()}`. 현재 Boot는 이를 `Page Host`의 library 페이지와 `Hosted Slides`의 단일 stacked 슬라이드로 배치한다. `setConfirmedItems([{id,title,kind?,detail?}])`는 **표시용 투영**일 뿐 원본 자산 종류·검색·권한·삭제·선택 API가 아니다. 자료 공급 전에는 '연결되지 않았습니다'를 표시하고, **목업 예시 카드 3개를 삭제**했다. 공급자가 검증한 빈 목록은 연결 없는 상태와 구분한다.
- 화면 문자열은 DOM `textContent`로만 반영해 사용자 제공 HTML을 해석하지 않는다. 중복 ID, 누락된 최소 표시 필드, 미지원 역할은 표시 전 거부한다. Composer와 Canvas UI 내부를 직접 조작하지 않는다.
- 데이터 소유권: Chat의 확정 기록과 Library 자산 원본은 장차 **백엔드**가 관리하고, 프론트는 받아서 표시만 한다. 요청 진행 표시·로컬 선택은 임시 UI다. 현재 `chatRecord` IDB 조회를 자동 Chat 렌더링하지 않는다(정렬/레코드 형식 미정).
- 기존 `Workspace.save`는 `data.cache.write()`가 `{written:false}`를 반환하거나 예외가 나면 알린 뒤 **후속 저장 큐를 계속 실행**한다. 캐시 거부로 이후 초안·그래프 저장까지 영구 정지하지 않는다.
- 서버 수명/HTTP/SSE·Chat 기록 정규화·Library 자산 공급·미전송 편집과 server-owned 리비전 충돌 정책은 **여전히 미확정/미구현**이다.


## 2026-10-19 요청 시 Canvas JSON 내보내기 — 독립 프론트 경계

- Canvas 사용자의 이동·연결·필드 편집은 `workspace/model.js` 로컬 원본을 즉시 변경한다. 이 작업에 서버의 상시 동기화나 개별 조작 승인을 요구하지 않는다. 기존 IndexedDB 임시 저장은 브라우저 재진입 목적이며 서버 동기화가 아니다.
- 외부 공개 함수는 `workspaceController.getDataAccess().exportCanvasJSON()`. `workspace/dataAccess.js`의 기존 `readCanvasSnapshot()`을 호출하고 `JSON.stringify`해 **문자열 하나**를 반환한다. 새로운 네트워크 클라이언트·IR 변환기·중복 상태 소유자는 없다.
- 호출 시 Canvas 필드의 250ms 유예 입력을 먼저 Model에 반영한다. 반환 JSON 객체는 `{roomId,source:'local-view',format:'beta-local-edit-graph-v1',snapshot:{version,blocks,links}}`. 블럭 ID/Skill 참조/설정·좌표·입력값/연결 포함, Blob/미리보기 본문 대신 파일 메타데이터/보유 여부만 포함. 화면 전용 카메라는 제외한다.
- 이 JSON은 **현재 beta의 로컬 편집 그래프**이지 실행기 IR, 서버가 확정한 자산, 업로드 파일 데이터 또는 Revision이 아니다. 실제 서버의 `need`·IR 해석·검증·사용자 권한·실행은 별도 계약으로 다룬다.
- 추후 서버가 최신 캔버스를 요청하면 연결된 프론트의 독립된 통신 어댑터가 이 함수를 호출해 제공할 수 있다. 전송 프로토콜/연결 수명은 미구현이다. 브라우저가 끊긴 상태에서 최신 로컬 데이터를 즉시 가져올 수는 없으며, 이 경우 서버가 이미 확보한 요청별 자료를 활용해야 한다.
- **이번 범위에서 제외:** 조작별 서버 동기화, 서버 승인/거부로 인한 로컬 롤백, Canvas DOM 직접 추출, 가짜 `need` 라우터·HTTP/SSE 엔드포인트.
