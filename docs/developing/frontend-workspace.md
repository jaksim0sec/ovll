# Workspace · Composer · Canvas — beta 로컬 구현

범위: main `ed2fcdd`의 컴포저·캔버스 로컬 동작과 외형을 beta 소유권 경계로 재구현. Chat은 시작 화면만 존재한다. 모델 호출·실행·업로드·서버 동기화·저장 함수 생성/실행은 미구현. 기존 main 상태/IR/참조 문자열/전역 객체를 연결하지 않는다.

## 책임과 결합

| 모듈 | 소유 |
|---|---|
| `workspace/controller.js` | 단일 Workspace 조립, 페이지 활성 수명, 로컬 복원/저장, 파일 첨부와 슬라이드 이동의 공개 API 연결 |
| `workspace/model.js` | 스킬블럭·연결 원본, 변경 검증, 되돌리기 기록 |
| `skill/catalog.js` | main에서 추출한 정적 표시용 스킬 목록. 실행 스키마 아님 |
| `workspace/icons.js` | 신뢰된 정적 SVG. 사용자 문자열은 SVG/HTML로 해석하지 않음 |
| `composer/controller.js`, `composer/draft.js` | 편집 DOM·선택·참조 메뉴·첨부·구조화 초안·입력 높이·활성 이벤트 수명 |
| `canvas/controller.js`, `canvas/geometry.js`, `canvas/files.js` | 블럭 표시·입력 필드·포트·연결 곡선·선택·카메라·제스처 의미·도구·로컬 파일 표시 |
| `css/composer.css`, `css/canvas.css`, `css/workspace.css` | 개별 기능 스타일 및 Workspace 배치. workspace.css는 기능 CSS 뒤에 로드 |

Boot가 `createWorkspace({root,data,input})`를 생성한다. Page Host `onEnter`가 Workspace 구성 선언을 Hosted Slides에 전달하고 반환된 제어자와 새 `signal`을 Workspace `activate`에 전달한다. 이탈 시 deactivate, 문서 종료 시 destroy. Composer는 Hosted Slides의 bottom stationary 슬롯에 장착되므로 Chat↔Canvas 전환에 DOM·초안이 유지된다. Canvas 본문 `allowContentSwipe:false`, Chat은 true. Shell 메뉴 열림/문서 숨김에는 Workspace 공개 `closeTransientUI()`로 임시 메뉴·드래그·초기화 확인 상태를 종료한다.

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

`createWorkspaceModel({snapshot?})`: `getSnapshot/getBlocks/getBlock`, `addBlock(skillId,{x,y,values,expanded,file}?)`, `updateBlock(id,patch)`, `deleteBlock`, `connect(from,to)`, `disconnect`, `clear`, `arrange`, `undo/redo/canUndo/canRedo`, `replace`, `subscribe`.

- 반환/이벤트 스냅샷은 복제본. 블럭 ID·스킬 참조와 카메라를 혼동하지 않는다.
- 실제 포트 존재·방향·타입·중복·단일 입력·자기 연결·순환을 검증한다. 기존 연결의 재선택으로 해제하는 UI 정책은 Canvas 책임이다.
- 블럭 삭제는 연결도 함께 삭제한다. 복원 검증 실패 시 기존 그래프를 바꾸지 않는다. replace는 되돌리기 기록을 초기화한다.
- 되돌리기 최대 80회. 블럭 드래그는 표시만 이동하다 포인터 종료에 한 번 반영한다. 파일 생성/교체는 실제 Blob과 메타데이터를 한 번에 반영한다.
- 정리는 DAG 깊이에 따라 가로 열을 배정하고 같은 열의 블럭을 세로 배치한다. 실제 작업 실행 순서를 확정하는 계약이 아니다.

## Composer

`createComposer({model,onSubmit,onHeightChange,onAttach})` → `{element,editor,getDraft,setDraft,focus,closeMenu,activate,deactivate,destroy}`.

초안은 `{parts,attachments}`. parts는 `{type:'text',text}`, `{type:'skill',id,label}`, `{type:'block',id,label}`. 스킬과 배치 참조를 별도로 보존하고 태그를 문자열 프로토콜로 변환하지 않는다. 초안 복원에는 저장된 HTML을 사용하지 않는다. 첨부는 실제 File/Blob과 이름·MIME·크기·수정시각을 보존한다.

- compact 알약에서 내용 길이·줄바꿈·참조/첨부에 따라 확장하고 짧아지면 축소한다. 입력 폭은 별도 측정 요소로 판단한다.
- `@` 스킬/스킬블럭 검색, `/` 빠른 명령, 도구 메뉴, 방향키·Enter·Escape, 참조 선택/삭제를 제공한다.
- PC Enter는 전송, Shift+Enter는 줄바꿈, coarse 입력의 Enter는 편집으로 남긴다. IME 조합 중 전송/메뉴 선택을 실행하지 않는다. 붙여넣기/텍스트 드롭은 일반 텍스트만 삽입한다.
- 입력 높이·IME·메뉴 위치는 Composer 책임이다. 앱 프레임/브라우저 키보드를 조작하지 않는다. picker는 form의 backdrop 컨텍스트 바깥 형제 DOM이다.
- 편집은 element의 bubbling `input`으로 Workspace에 알린다. setDraft는 복원용이며 변경 이벤트를 발생시키지 않는다.
- `onSubmit`은 명시적 `{accepted:true}`에서만 초안을 비운다. 제출 중 새 편집이 생겼으면 최신 입력을 보존한다. 현재 Workspace 콜백은 accepted:false를 반환하므로 실제 전송·실행 성공을 주장하지 않는다.
- `onAttach(files)`가 `{handled:true}`를 반환하면 외부 소유자가 파일을 처리한 것으로 보고 초안 첨부를 중복 생성하지 않는다. 기본/미처리·실패 시 로컬 첨부로 보존한다. Workspace는 Canvas.addFile로 파일 스킬블럭을 만들고 캔버스로 전환한다.

## Canvas

`createCanvas({model,input,onRun,onNotice,onAttach})` → `{element,activate,deactivate,closeMenu,destroy,getViewport,setViewport,focusBlock,addFile}`.

- 표시/조작: 블럭 추가·확장·요청 입력·이동·삭제, 입력/출력 포트 클릭 또는 드래그 연결, 기존 연결 해제, 연결 선택·삭제, 정리·전체 보기·초기화·undo/redo.
- 새 일반 블럭은 펼쳐서 추가한다. 실제 펼친 크기를 측정해 주변 빈 위치를 찾고 화면 밖이면 카메라를 이동한다. main의 compact 크기·아이콘·색·자연어 입력 스타일을 기준으로 한다.
- 초기화는 두 번째 클릭으로 확정하며 되돌릴 수 있다. 입력 필드는 250ms 뒤 반영하고 change·이탈·메뉴 인계 시 남은 편집을 반영한다.
- 카메라 `{x,y,zoom}`는 그래프 밖의 로컬 UI 상태. 줌 .12–3. 마우스 배경 드래그·휠 커서 중심 줌, 터치 이동·두 손가락 핀치를 처리한다. `canvasviewportchange` detail로 카메라 변경을 알린다.
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

검증 범위: 모델 무결성·복원·undo/redo·파일 교체, 편집/참조/초안 복원·한글 조합 이벤트·줄바꿈/붙여넣기, 포인터 취소·native mouse·CDP native touch·모바일 핀치, 메뉴/슬라이드/Library 왕복, IDB 재진입·실패 표시, 모의 VisualViewport 축소/offsetTop, 모바일 여백·테마·화면 크기, 요청 미발생. Android/iOS 실기기 IME·키보드 애니메이션·Safari/Firefox·PWA 물리 환경은 미검증이다. main과의 픽셀 완전일치를 주장하지 않는다.
