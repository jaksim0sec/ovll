# 프론트 로컬 데이터 저장 기반 (beta)

상태: 로컬 어댑터 기반만 구현. 서버 API, SSE, 오프라인 수정 동기화, 실제 Workspace/Library 데이터 연결은 미구현. 데이터의 소유권 구분은 `docs/notes/request-state-sync.md` 4절에서 가져오되 미확정 부분은 계약으로 확정하지 않는다.

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
- `front/js/boot.js`는 데이터 어댑터 수명만 생성·종료. 빈 Workspace/Library는 아직 데이터 연동 없음.

## 임시 UI 검사

`?ui-test=1`을 주소 뒤에 붙이면 **TEMPORARY** 테스트 패널이 표시된다. 테마(기기/다크/라이트), 페이지 영역 높이, 입력기 **목업** 높이 및 키보드 입력만 검사할 수 있다. 실제 Composer 구현 또는 저장/전송과는 무관하다. `front/js/dev/uiTest.js`, `front/css/uiTest.css`, boot 조건부 import를 함께 삭제하면 완전히 제거된다. 일반 URL에서는 import되지 않고 DOM/CSS에 추가되지 않는다.
