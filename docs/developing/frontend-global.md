# 프론트엔드 글로벌 시스템

범위: `beta`의 App Shell, Page Host, Input Manager와 공통 스타일. Workspace·Library는 제목과 준비 중 문구만 표시하는 빈 페이지다. Chat·Canvas 내부, 실제 라이브러리, 도메인 상태, API, 저장소, 서비스워커는 구현하지 않았다.

## 진입·참조

- 정적 배포 루트 `front/`, 진입점 `front/index.html`. HTTP 정적 서버로 실행한다. 예: 저장소 루트에서 `python3 -m http.server 8000 --directory front`, 이후 `http://localhost:8000/` 접속. ES Modules이므로 `file://` 실행 대상이 아니다.
- 프레임워크·빌드·제품 외부 패키지 없음. HTML이 두 CSS와 `js/boot.js`만 로드하고 boot가 세 제어 모듈을 import한다.
- 외형 참조: `main`의 `front/css/style.css`, `front/css/shellMenu.css`, `front/js/shellMenu.js`, `front/index.html`, `front/css/ui.css`. 흑백 색상, 둥근 선 아이콘·컨트롤, 데스크톱 도킹·모바일 오버레이를 참고했다. 기존 Store·Navigation·전역 객체·히스토리·제스처 구현은 가져오지 않았다.
- 기존 `docs/developing/`의 요청 처리·맥락·작업실 명세는 이번 프론트와 연결하지 않는다. 이번 작업 이전에는 프론트 전용 구현 명세가 없었다.

## 파일·소유권

| 파일 | 소유·책임 |
|---|---|
| `front/index.html` | 앱 루트, 글로벌 메뉴·헤더, 빈 페이지를 복제할 두 template, 로딩 상태 |
| `front/css/base.css` | 색상·간격·반경·모션·안전 영역 토큰, 시스템 폰트·기본 버튼·아이콘, OS 테마 |
| `front/css/shell.css` | 메뉴·헤더·페이지 영역 배치, 글로벌 내비게이션 상태, 빈 페이지 표시 |
| `front/js/boot.js` | 인스턴스 생성·공개 API 연결, 두 빈 페이지 등록, 첫 진입·문서 이탈 정리 |
| `front/js/shell/appShell.js` | 메뉴 열림, 뷰포트에 따른 도킹, 메뉴 이벤트·포커스·접근성, 활성 페이지의 표시 |
| `front/js/shell/pageHost.js` | 페이지 등록, 현재 페이지의 단일 원본, 활성 DOM의 장착·제거, 진입별 수명 신호 |
| `front/js/input/inputManager.js` | 등록된 입력 소유 주체, 단일 활성 포인터 스트림, 전달·취소·캡처 해제 |

- boot만 세 시스템을 조립한다. 시스템 간 import는 없고 `window`에 앱 API를 게시하지 않는다.
- App Shell은 메뉴·헤더·내비게이션 DOM만 조작한다. 페이지 내부 DOM·데이터를 조회하지 않는다. 현재 페이지 ID를 별도 상태로 보관하지 않고 Page Host의 통지를 DOM에 반영한다.
- Page Host만 `#page-host` 안에 페이지 루트를 장착·제거한다. 페이지 안의 내용·이벤트는 페이지 구현의 책임이다.
- Input Manager는 소유권을 결정하고 등록 콜백에 이벤트를 전달한다. 캔버스·텍스트 편집 동작이나 도메인 상태를 갖지 않는다.

## App Shell 공개 API

`createAppShell({ element, onNavigate, onMenuOpen? })`

| API | 동작 |
|---|---|
| `setMenuOpen(boolean, { focus = true }?)` | 메뉴 표시·inert·ARIA·배경을 동기화. 열린 메뉴에 포커스를 옮기고, 메뉴 안의 포커스를 가진 상태로 닫으면 트리거로 복원 |
| `setActivePage(id 또는 null)` | 해당 내비게이션의 `aria-current="page"`, 헤더·문서 제목을 갱신. 전환 요청 자체를 실행하지 않음 |
| `destroy()` | 메뉴 닫기, 모든 이벤트·미디어 쿼리 리스너 해제. 반복 호출 무해 |

- 내비게이션 클릭 → `onNavigate(id)` → boot의 `pages.activate(id)`. 전환 결과 → Page Host의 `onChange(id)` → `shell.setActivePage(id)`.
- 닫힘→열림 직전에 `onMenuOpen()` 호출. boot는 `input.cancel("menu-open")`으로 기존 입력을 끝낸다. 메뉴 이벤트는 일반 버튼 클릭이며 별도 입력 제스처를 등록하지 않는다.
- 도킹 조건은 main과 동일: `(min-width: 43.76rem) and (hover: hover) and (pointer: fine), (min-width: 60.01rem)`. 조건에 맞으면 처음에 펼치며 콘텐츠 너비를 줄인다. 그 외에는 처음에 접고, 열 때 배경을 덮는다. 조건이 바뀌면 해당 기본 열림 상태로 재설정한다.
- 모바일 오버레이는 `role="dialog"`, `aria-modal`, 페이지 콘텐츠 `inert`를 사용한다. Tab/Shift+Tab은 메뉴 버튼 안에서 순환한다. 배경·닫기·Escape·페이지 선택으로 닫힌다. 데스크톱도 닫기·Escape로 접을 수 있다.
- 모든 Shell 이벤트는 인스턴스의 AbortController에 묶는다. OS 테마는 CSS 미디어 쿼리로만 반영하며 테마 선택·저장 UI는 없다.

## Page Host 공개 API·수명

`createPageHost({ element, onChange? })`

| API | 동작 |
|---|---|
| `register(id, { element, onEnter?, onLeave? })` | 페이지 루트와 동기 훅 등록. 빈 ID·루트 누락·중복 ID는 오류 |
| `activate(id)` | 등록된 페이지로 전환. 같은 페이지면 무동작. 미등록 ID면 기존 페이지를 보존하고 오류. 중첩 전환 금지 |
| `getActivePage()` | 현재 ID 또는 `null` |
| `destroy()` | 활성 수명 종료·페이지 제거·등록 해제. 반복 호출 무해 |

- 훅 인수는 `{ element, signal }`. 비동기 훅 완료를 기다리는 계약은 없다.
- 전환 순서: 이전 현재 상태 비우기 → 이전 signal abort → 이전 `onLeave` → 이전 루트 제거·`onChange(null)` → 다음 루트 장착 → 새 signal로 `onEnter` → `onChange(id)` → 새 페이지 루트에 포커스.
- 페이지 이벤트는 `addEventListener(..., { signal })`, 입력 소유권은 `registerOwner({ ..., signal })`로 같은 활성 수명에 묶는다. 컴포넌트가 먼저 해제되면 반환된 `unregister()`를 사용한다. 다른 자원의 정리는 `onLeave`가 담당한다.
- 페이지 재진입은 동일한 루트와 새로운 signal을 사용한다. 이전 signal은 다시 활성화하지 않는다. 비활성 페이지 루트는 문서에서 제거한다.
- `onEnter` 실패 시 해당 signal을 abort하고 이탈 훅·DOM 제거를 수행한 뒤 오류를 전파한다. 이전 페이지로 자동 복구하거나 예외를 숨기지 않는다.
- abort·이탈·진입 훅에서 Host가 해제되면 진행 중인 활성화를 중단한다. 해제된 Host에 다음 페이지나 새 수명을 남기지 않는다.
- boot가 등록하는 ID는 `workspace`, `library`뿐이다. 현재 두 페이지는 이벤트·입력 소유권을 등록하지 않는다. URL·history·deep link·페이지 저장 상태는 사용하지 않는다.

## Input Manager 공개 API·수명

`createInputManager({ target = window }?)`

| API | 동작 |
|---|---|
| `registerOwner({ element, signal?, onStart, onMove?, onEnd?, onCancel? })` | 입력 영역과 콜백 등록. `{ unregister, cancel }` 반환. 같은 element 중복 등록 금지 |
| 반환 핸들의 `unregister()` | 영역·abort 리스너 해제. 소유 중인 입력도 `owner-unregistered`로 취소. 반복 호출 무해 |
| 반환 핸들의 `cancel(reason = "owner-cancel")` | 이 주체가 가진 활성 입력만 취소. 등록은 유지 |
| `cancel(reason = "cancel")` | 현재 활성 입력 취소. 등록은 유지 |
| `destroy()` | 활성 입력 취소, 전체 소유 주체·외부 signal 리스너·전역 이벤트 해제. 반복 호출 무해 |

- `pointerdown`의 composed path에서 가장 가까운 등록 영역만 선택한다. 그 주체의 `onStart(event)`가 정확히 `true`를 반환해야 소유권을 얻는다. 거절한 이벤트를 상위 등록 영역에 다시 넘기지 않는다.
- 활성 스트림은 **하나**이며 `pointerId`가 일치하는 move/up/cancel만 전달한다. 소유 중인 추가 pointerdown은 무시한다. 멀티터치·핀치·소유권 전환은 구현하지 않았다.
- 실제 브라우저 입력은 최초 이벤트 target에 pointer capture를 설정한다. 원래 버튼을 캡처하므로 등록된 컨트롤의 기본 클릭 대상도 보존한다. 합성 이벤트에는 브라우저의 활성 포인터가 없어 capture를 설정하지 않는다.
- `onMove(event)` → `onEnd(event)` 또는 `onCancel({ reason, event })`. 수동·수명 취소의 event는 `null`이다. 종료 시 활성 소유권을 먼저 비운 뒤 캡처를 해제하므로 lostpointercapture에 의한 이중 취소를 방지한다.
- 취소 사유: `pointercancel`, `lostpointercapture`, `window-blur`, `document-hidden`, `owner-unregistered`, `manager-destroyed`, 호출자가 전달한 사유. boot가 추가로 전달하는 사유는 `menu-open`, `page-hidden`이다.
- signal이 이미 abort된 등록은 즉시 해제한다. 페이지의 signal abort는 등록 자체를 해제하므로 이전 페이지가 후속 입력을 다시 받지 않는다.
- Manager는 preventDefault·stopPropagation·전역 touch-action·선택 금지를 적용하지 않는다. 등록하지 않거나 시작을 거절한 영역은 기본 브라우저 입력을 사용한다. 수락 이후의 동작·기본 동작 제어는 콜백 소유 주체의 책임이다.
- Manager 전역 리스너도 인스턴스 AbortController에 묶는다. 해제 후 등록은 오류다. 콜백 오류는 숨기지 않는다.

## 부팅·종료

1. input 생성 → Page Host 생성 → App Shell 생성·콜백 연결.
2. 두 HTML template의 루트를 복제해 Host에 등록 → 앱 표시 → Workspace 활성화 → 로딩 표시 숨김.
3. 초기화 실패 시 생성된 인스턴스를 해제하고 앱 대신 실패 문구 표시·콘솔 오류 기록.
4. `pagehide.persisted === true`이면 활성 입력만 취소한다. BFCache에서 돌아올 인스턴스는 보존한다.
5. 일반 pagehide는 boot 리스너 해제 → Host 종료 → Shell 종료 → Input Manager 종료. 등록한 앱 객체·전역 리스너를 남기지 않는다.

## 확인 범위

- Chromium 153 headless 실제 실행. 1280×800 데스크톱, 터치 환경 390×844·320×568·844×390에서 진입, 두 페이지 왕복, 메뉴·Escape·모바일 배경 닫기, 활성 표시와 수평 넘침 확인.
- 다크·라이트 스타일, 모바일 메뉴 inert·포커스 순환, URL·히스토리 불변 확인. 브라우저 네이티브 마우스의 capture→영역 밖 이동→up에서 종료·클릭 보존 확인.
- 입력 소유 충돌·거절·취소·signal abort·해제, 페이지 전환 후 이벤트·입력 제거, 재진입 새 수명, 진입 실패 정리, 훅 안의 Host 종료를 확인.
- 콘솔 오류·모듈 로드 실패를 수집해 확인. 검증용 패키지·스크립트·전역 객체는 제품 소스에 추가하지 않는다.
- 실제 Android/iOS·Safari·Firefox, 물리 기기의 노치·브라우저 툴바, BFCache 왕복은 미검증. 안전 영역은 env 토큰, 높이는 100dvh와 100% fallback으로 대응한다. 배포 설정·서비스워커를 변경하거나 별도 배포하지 않는다.
