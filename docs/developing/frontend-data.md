# 프론트 로컬 데이터 저장 기반 (beta)

상태: 로컬 어댑터와 단일 임시 Workspace의 그래프·구조화 초안·카메라 연결 구현. 서버 API, SSE, 오프라인 수정 동기화, 실제 Library 데이터 연결은 미구현. 데이터의 소유권 구분은 `docs/notes/request-state-sync.md` 4절에서 가져오되 미확정 부분은 계약으로 확정하지 않는다.

## 저장 영역

`front/js/data/localDataStore.js`의 `createLocalDataStore()`는 브라우저 IndexedDB `ovll-beta-data`(v1)에 두 저장 영역을 제공한다.

| 영역/API | kind | 관리할 의미 |
|---|---|---|
| `cache` → `serverCache` | `roomInfo` | roomId, 방 이름, 고정 여부 |
| `cache` | `chatRecord` | roomId 아래 개별 채팅/요청 기록. ID는 호출자 제공. 시간 정렬 정책 없음 |
| `cache` | `chatDraft` | 방 입력 초안 |
| `cache` | `contextData` | 방/세션 전체 맥락데이터. 개별 요청의 contextBlock과 다름 |
| `cache` | `canvasState` | 방에 연결된 지속 캔버스 상태(스킬블록/연결/배치 등). 향후 캔버스 소유 모델 미정 |
| `local` → `localOnly` | `chatScroll` | 스크롤 위치 |
| `local` | `canvasViewport` | 캔버스 화면/줌/스크롤 |
| `local` | `mascotPresentation` | 인터랙티브 오블의 일시적 표시·위치 |

캐시는 **현재 로컬에 저장해도 미래 서버/DB가 원본**이다. UI 전용 상태는 서버 자산으로 승격되지 않는다. 실행 중 SSE 조각, 미검증 모델 주장, 호출처리객체, 인증정보, focus 및 작업실 내부 프롬프트를 캐시에 넣지 않는다. 확정된 개별 요청의 최종 맥락체는 향후 `chatRecord`의 적절한 확정 기록에 속한다. 세부 기록 구조는 미정이므로 강제 스키마 없음.

## 공개 계약 (현재 로컬 전용)

```js
const data = createLocalDataStore();
await data.cache.write("roomInfo", roomId, "state", { name, pinned }, { source: "provisional" });
const room = await data.cache.read("roomInfo", roomId, "state");
await data.cache.write("chatRecord", roomId, messageId, message);
const recordsByKey = await data.cache.list("chatRecord", roomId, { limit: 50 });
await data.local.write("canvasViewport", roomId, { x: 0, y: 0, zoom: 1 });
const viewport = await data.local.read("canvasViewport", roomId);
data.destroy();
```

- `cache.read` 반환: `{kind, roomId, itemId, value, source, revision, cachedAt}` 또는 `null`. `cache.list`도 동일한 엔트리 배열. `cache.remove`는 해당 로컬 복제 항목을 지움. `local.read`는 값 또는 `null`; `local.write/remove`는 영속 로컬 기록.
- 캐시 `source`: `provisional`(서버 없는 임시 저장), `server`(나중에 서버에서 **확정**받은 스냅샷만). `revision`은 비교 가능한 안전한 비음수 정수일 때만. 서버 기록이 이미 있는 항목에 provisional 변경을 쓰지 않으며, 더 오래됐거나 같은 서버 revision 및 확인 불가능한 서버 revision으로의 덮어쓰기도 막음.
- `cache.list`는 인덱스 키 순서이며 **시간순 페이지네이션 API가 아님**. 방 목록을 조회하려면 `list("roomInfo", null, { limit })`처럼 조회할 수 있지만, 대규모 페이지네이션/서버 커서 규칙을 대신하지 않음.
- 호출자는 `roomId`·개별 채팅 ID 등 정합성 있는 식별자를 제공한다. 어댑터는 도메인 기록의 필드·정렬·충돌 병합 방식을 자동 생성하지 않는다.
- 실패/QuotaExceeded/IDB 비지원은 예외로 전달하며 성공했다고 표시하지 않는다. `destroy()`는 열린 DB 핸들을 닫는다. 캐시 메서드는 비동기이고 대용량 데이터는 복제 비용이 발생할 수 있다.

## 남은 경계

- 로그인/계정 도입 전 반드시 사용자별 캐시 격리·로그아웃 정리 정책 확정. 현재 브라우저 origin 수준의 beta 실험 DB이며 계정 단위 격리가 아님.
- 서버 DB 도입 시 조회·권한·캐시 업데이트 책임을 별도로 연결한다. 원격 스냅샷 revision 정책과 변경 확정 프로토콜을 정한 후 `source: "server"`를 사용한다.
- 읽음/수정중 초안, 미동기화 오프라인 편집, 동시 요청 충돌, 데이터 삭제/무효화 정책, 메시지 커서/정렬은 미정. 이 어댑터가 결정하지 않는다.
- `front/js/boot.js`는 데이터 어댑터 수명을 생성·종료하고 Workspace 조립자에 주입한다. 로컬 Workspace 연결은 `frontend-workspace.md`. Library는 아직 데이터 연동 없음.

## Workspace 로컬 연결

기존 임시 uiTest 화면/모듈/CSS는 제거했다. `workspace/controller.js`가 `beta-local-workspace`의 canvasState/chatDraft와 local.canvasViewport를 읽고 저장한다. 스킬블럭·연결, typed 초안 참조, 실제 로컬 Blob/File을 재진입 시 복원한다. itemId는 state, cache source는 provisional. 서버 스키마/Revision으로 확정하지 않는다.

저장 쓰기 순서를 보존하고 영역별 오류를 따로 추적한다. 그래프 복원 실패 시 원본을 자동 덮어쓰지 않는다. 실제 공개 형식·수명·파일 표시/서버 미연결 경계는 `frontend-workspace.md`를 따른다.

## 2026-10-19 읽기 전용 데이터 공급 구현

Workspace `getDataAccess()`는 현재 모델·Composer·기존 IDB 캐시를 읽으며 새 저장 원본이 아니다. `readCanvasSnapshot`, `readSkillCatalog`, `readComposerDraft`, `readCached(kind,{limit?})`를 제공한다. 파일/첨부 본문·Blob, 서버 원본 revision, 실행 IR을 캐시/네트워크 데이터로 가장하지 않는다. `readCached('chatRecord')`는 키 순서이고 실제 시간순 채팅 기록 API가 아니다. `contextBlock`은 요청별 백엔드 상태이므로 프론트에서 임의 생성하지 않는다.

기존 캐시의 `written:false` 반환은 Workspace가 저장 실패로 알린다. **서버 확정 캐시를 provisional 저장이 덮지 않았다는 사실**을 숨기지 않는다.

- 요청 시 JSON 내보내기는 `workspace.getDataAccess().exportCanvasJSON()`에서 기존 `readCanvasSnapshot()`의 결과를 직렬화하는 방식이다. 이 조회 자체는 IndexedDB 서버 캐시 조회나 원격 동기화가 아니며, 별도의 실행 IR/서버 상태 원본을 만들지 않는다. `workspace.getCanvasCommands()`는 별도 로컬 그래프 변경 공개 경계로, 서버 저장/업로드/검증 완료가 아니다.


## 저장소 초기화 예외 처리 보강 (2026-10-19)

- IndexedDB 업그레이드가 다른 탭에 막히면 호출에 오류를 반환한다. **이미 오류를 보고한 기존 열기 요청이 나중에 `onsuccess`를 받아도 DB를 즉시 닫고 연결 원본으로 다시 등록하지 않는다.** 실패한 연결과 새로운 재시도 연결이 섞이지 않는다.
- 앱 최종 종료는 Canvas가 유예 중 입력을 모델에 기록한 다음 `Workspace.flush()` 저장 큐를 기다린 뒤 `data.destroy()`로 DB를 닫는다. 종료 과정에서 한 모듈 정리에 예외가 나도 DB 종료를 생략하지 않는다.
- 개별 Workspace마다 독립 `roomId` 키로 cache/local 데이터에 접근한다. 이것은 한 브라우저의 **로컬 작업 공간 분리**일 뿐, 서버 사용자 인증이나 공동 편집/원격 동기화 계약을 의미하지 않는다.
- `tests/frontend/local-data-store.test.mjs`는 막힌 업그레이드의 늦은 성공/종료 후 지연 성공이 연결을 남기지 않는지 검사한다.
