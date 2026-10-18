# 프론트엔드 글로벌 시스템

범위: `beta`의 App Shell, Page Host, Input Manager, Hosted Slides와 공통 스타일. Workspace에는 **로컬 Composer·Canvas**와 Chat 시작 화면, Library에는 임시 Stacked 페이지가 있다. Workspace 로컬 구현 계약은 `frontend-workspace.md`. AI Chat·서버 API·실행·서비스워커는 미구현이다. 아래 초기 Scaffold/임시 실험 기록은 후반 갱신 절과 현재 Workspace 명세보다 우선하지 않는다.

## 진입·참조

- 정적 배포 루트 `front/`, 진입점 `front/index.html`. HTTP 정적 서버로 실행한다. 예: 저장소 루트에서 `python3 -m http.server 8000 --directory front`, 이후 `http://localhost:8000/` 접속. ES Modules이므로 `file://` 실행 대상이 아니다.
- 프레임워크·빌드·제품 외부 패키지 없음. HTML이 기본/Shell/Hosted Slides CSS와 Composer·Canvas·Workspace CSS, `js/boot.js`를 로드한다. boot는 Shell, Page Host, Input Manager, Hosted Slides, 로컬 데이터 어댑터와 Workspace 조립자를 import한다.
- 외형 참조: `main`의 `front/css/style.css`, `front/css/shellMenu.css`, `front/js/shellMenu.js`, `front/index.html`, `front/css/ui.css`. 흑백 색상, 둥근 선 아이콘·컨트롤, 데스크톱 도킹·모바일 오버레이를 참고했다. 기존 Store·Navigation·전역 객체·히스토리·제스처 구현은 가져오지 않았다.
- 기존 `docs/developing/`의 요청 처리·맥락·작업실 명세는 이번 프론트와 연결하지 않는다. 이번 작업 이전에는 프론트 전용 구현 명세가 없었다.

## 파일·소유권

| 파일 | 소유·책임 |
|---|---|
| `front/index.html` | 앱 루트, 글로벌 메뉴·헤더, 빈 페이지를 복제할 두 template, 로딩 상태 |
| `front/css/base.css` | 색상·간격·반경·모션·안전 영역 토큰, 시스템 폰트·기본 버튼·아이콘, OS 테마 |
| `front/css/shell.css` | 메뉴·헤더·페이지 영역 배치, 글로벌 내비게이션 상태, 빈 페이지 표시 |
| `front/js/boot.js` | 인스턴스 생성·공개 API 연결, 두 빈 페이지 등록, 첫 진입·문서 이탈 정리 |
| `front/js/shell/appShell.js` | 메뉴 열림, 도킹, **가시 뷰포트 높이·상단 위치 관측**, 메뉴 이벤트·포커스·접근성, 활성 페이지의 표시 |
| `front/js/shell/pageHost.js` | 페이지 등록, 현재 페이지의 단일 원본, 활성 DOM의 장착·제거, 진입별 수명 신호 |
| `front/js/input/inputManager.js` | 등록된 입력 소유 주체, 단일 활성 소유권 묶음, 전달·취소·캡처 해제 |
| `front/js/workspace/*`, `front/js/canvas/*`, `front/js/composer/*` | 로컬 기능 조립·모델·편집·렌더링. 상세는 `frontend-workspace.md` |

- boot만 세 시스템을 조립한다. 시스템 간 import는 없고 `window`에 앱 API를 게시하지 않는다.
- App Shell은 메뉴·헤더·내비게이션 및 **앱 프레임의 뷰포트 배치와 페이지 레이아웃 모드 표시**만 조작한다. 페이지 내부 DOM·데이터를 조회하지 않는다. 현재 페이지 ID를 별도 상태로 보관하지 않고 Page Host의 통지를 DOM에 반영한다.
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
- 모든 Shell 이벤트는 인스턴스의 AbortController에 묶는다. OS 테마는 CSS 미디어 쿼리로만 반영하며 정식 테마 선택·저장 UI는 없다. 현재 Workspace의 임시 테스트 UI는 레이아웃/알약/슬라이드 3개 동적 변경 테스트에 사용하며, 테마 영속 설정 기능은 아니다.

### 브라우저 가시 뷰포트/모바일 키보드

- **책임**: App Shell이 현재 사용 가능한 브라우저 화면의 높이와 상단 위치를 계산해 **자신의 루트에만** CSS 변수 `--shell-visible-height`, `--shell-visible-top`, `--shell-stage-height`, `--shell-stage-duration`을 설정한다. 외부 App Frame은 즉시 반응하고 직계자식 Stage만 선택적으로 보간한다. `front/css/shell.css`의 `.app-shell` 프레임이 이를 사용하며, 페이지 영역 `#page-host`는 기존 flex 수축 규칙으로 남은 공간을 배정받는다. Page Host의 라이프사이클이나 Input Manager의 포인터 계약을 변경하지 않는다.
- **출처**: 이전 `main/front/js/workspaceUi.js`의 `visualViewport.height/offsetTop`, `requestAnimationFrame` 동기화 방식을 **Shell 책임으로 이전**한 최소 구현. `main/front/js/ovllComposer.js`의 입력기 자체 높이/선택 팝업 재측정은 신규 Composer가 생길 때 해당 UI 구성요소의 책임으로 구현한다.
- `visualViewport.height`의 유효값과 `offsetTop`을 사용한다. `visualViewport` 부재/높이 오류 시 `window.innerHeight` → `documentElement.clientHeight` → 최소 1px 순서의 대체값 사용. `100dvh`는 JS 비활성/갱신 전 CSS 기본값으로 유지한다.
- `window.resize`, `orientationchange`, `pageshow`, `visualViewport.resize/scroll`을 한 `requestAnimationFrame`으로 합쳐 계산하고, `destroy()`에서 리스너·예약 프레임·CSS 변수를 정리한다. BFCache 복귀 시 재측정한다.
- **의도적인 미도입**: `navigator.virtualKeyboard.overlaysContent = true` 설정, 브라우저 키보드 직접 열기·닫기, 사용자 확대 비활성화, 별도 Mobile/Viewport Manager, 페이지 내부 요소 직접 이동, 키보드 높이 추정. 기본 브라우저 키보드 처리(visual viewport 축소)를 유지한다. 브라우저가 이미 오버레이 모드인 특수 환경과 OS별 차이는 후속 실기기 검증 후 결정한다.
- **주의**: 높이 감소가 항상 키보드 열림은 아니다(주소창·회전·확대도 가능). 현재 구현은 '키보드 열림' 불리언을 추론하지 않는다. Shell은 키보드가 아닌 뷰포트 높이 변화를 관측하고, 빠르게 연속되는 변화에는 65ms Stage 추종, 단발 축소 120ms/확대 140ms Stage 보간, 회전/초기화에서는 무보간을 적용한다. 이 값은 실기기에서 조정할 기준값이며 완성된 IME 실기기 검증 결과가 아니다. Chat/Canvas 내부 스크롤, 정식 Composer 포커스·팝업·크기 대응은 아직 미구현.
- **검증**: 현재 변경에 대한 Android/iOS 실기기 및 실제 키보드 애니메이션·PWA 검증은 미수행. 기존 문서의 '확인 범위'는 최초 Shell 구현에 대한 과거 검증이고 이번 변경의 새 검증 결과가 아니다.

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
- boot가 등록하는 최상위 ID는 `workspace`, `library`뿐이다. Workspace의 Hosted Slides가 Chat 본문/글로벌 알약에 한해 Input Manager의 소유권을 등록한다. Canvas 본문은 글로벌 스와이프에 등록하지 않는다. Composer는 네이티브 편집과 구조화 초안 저장을 제공하며 실제 전송은 미연결이다. URL·history·deep link·페이지 저장 상태는 사용하지 않는다.

## Input Manager 공개 API·수명

`createInputManager({ target = window }?)`

| API | 동작 |
|---|---|
| `registerOwner({ element, signal?, multiPointer?, onStart, onMove?, onEnd?, onCancel? })` | 입력 영역과 콜백 등록. `{ unregister, cancel }` 반환. 같은 element 중복 등록 금지 |
| 반환 핸들의 `unregister()` | 영역·abort 리스너 해제. 소유 중인 입력도 `owner-unregistered`로 취소. 반복 호출 무해 |
| 반환 핸들의 `cancel(reason = "owner-cancel")` | 이 주체가 가진 활성 입력만 취소. 등록은 유지 |
| `cancel(reason = "cancel")` | 현재 활성 입력 취소. 등록은 유지 |
| `destroy()` | 활성 입력 취소, 전체 소유 주체·외부 signal 리스너·전역 이벤트 해제. 반복 호출 무해 |

- `pointerdown`의 composed path에서 가장 가까운 등록 영역만 선택한다. 그 주체의 `onStart(event)`가 정확히 `true`를 반환해야 소유권을 얻는다. 거절한 이벤트를 상위 등록 영역에 다시 넘기지 않는다.
- 활성 소유자는 **하나**다. 기본은 포인터 하나이며 추가 pointerdown을 무시한다. `multiPointer:true`에서는 같은 소유자가 시작을 수락한 추가 포인터도 전달한다. 종료는 포인터별, 취소는 소유권 묶음 전체이며 다른 소유자로의 전환은 없다. 핀치 의미는 Canvas가 처리한다.
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

## 로컬 데이터 저장·Workspace 연결

- `front/js/data/localDataStore.js`는 미래 서버 원본 예정 캐시와 로컬 UI 상태를 별도 영역에 저장한다. Boot가 수명을 소유하고 Workspace 조립자에 주입한다.
- 현재 단일 로컬 Workspace가 그래프·초안·카메라를 저장한다. 기존 임시 uiTest 모듈/CSS는 제거했다. Library는 독립 임시 페이지이며 데이터 연결은 없다.
- 저장 경계는 `frontend-data.md`, 실제 기능·공개 API·서버 미연결 범위는 `frontend-workspace.md`를 따른다.

## 2026-10-17 Hosted Slides 실제 결합 계약

- 확정된 사용자 의도/구현 경계 및 추가 명세: `docs/developing/frontend-runtime-and-hosted-swipes.md` 8절. 기존 초기 Scaffold 설명보다 현행 모듈 계약을 우선한다.
- 신규 `front/js/shell/hostedSlides.js`: `normalizePresentation(...)`, `createHostedSlides({pillHost,stationaryHost,input,onLayout,isBlocked})` 제공. `activateForPage({root,slides,pill,stationary,layout,signal})` 반환값에 `goTo(id)`, `getCurrentSlide()`, `update(patch)`, `cancel(reason)`, `destroy()`가 있다. 한 번에 Hosted Page 그룹 하나만 활성화한다.
- 신규 `front/js/shell/viewportMotion.js`: 실제 뷰포트 측정 책임을 갖지 않고 Shell 내부의 보간 상태(`immediate|tracking|shrinking|growing|stable`)를 결정한다.
- `front/js/boot.js`가 생명주기를 연결한다. Page Host `signal`이 종료되면 Hosted Slides가 알약과 stationary 요소를 해제한다. Page Host만 Workspace/Library의 활성 ID를 보관한다. `main`/배포 설정 변경 없음.
- 검증: Node 3개 계약 테스트, Playwright Chromium 데스크톱/모바일 에뮬레이션에서 모드/알약/3슬라이드/입력기 유지/Library 왕복과 합성 터치/모의 VisualViewport 높이 테스트. 실제 Android/iOS·Safari·키보드 애니메이션·PWA 실기기는 **미검증**.


## 2026-10-18: 브라우저 프레임 보간·Hosted 표시·테마 검수

- `front/js/shell/viewportMotion.js`의 `createViewportMotion`: 브라우저 VisualViewport 실측값을 App Shell이 받아 JS requestAnimationFrame 하나로 외부 프레임과 내부 Stage 보간을 함께 수행한다. 외부 프레임은 마지막 실제 가시 영역으로 잘라 키보드 뒤에 노출되지 않게 하고, 내부 Stage는 65ms 연속 갱신 / 120ms 축소 / 140ms 확대를 출발값으로 사용한다. 회전과 동작 축소 선호에서는 즉시 적용. CSS height 전환을 중첩하지 않으며 실제 모바일 키보드 동작은 실기기 검증 필요.
- Shell은 사이드바 토글 및 최상위 페이지명만 소유한다. 페이지명은 Shell 콘텐츠 영역의 수평 중앙에 배치하며 Hosted Page 알약이 표시되는 경우 숨기고 알약이 없으면 표시한다. Source of truth는 Hosted Slides의 실제 `pill.visible`이며 `onPillVisibilityChange` 콜백을 통해 Shell에 표시 상태를 전달한다. 알약 자체와 Stationary는 Shell 사이드바 버튼의 자식이 아닌 `[data-hosted-presentation]` 영역에서 관리한다.
- `front/js/settings/theme.js`는 `system/dark/light` 사용자 선택을 관리한다. 임시 Chat과 SideMenu는 동일한 설정 소유자에 연결되고, 로컬 저장이 차단되어도 메모리에서 선택을 적용한다. `system`은 기존 OS 색상 선호 CSS가 해석한다.
- 실제 Chat·Canvas·Composer·Library 도메인 기능이 아닌 **임시 시각 검수 픽스처**다. 실제 Android/iOS 키보드 애니메이션과 `main` 대비 픽셀 완전일치 검증은 이 테스트에서 주장하지 않는다.

### 상단 글로벌 토글과 Hosted Pill의 시각 계약 (2026-10-18)

- Shell의 사이드바 토글과 Hosted Slides의 알약은 **별도 책임/DOM 소유자**이다. 두 컨트롤이 맞닿는 상단 UI에서 높이 `--shell-top-control-height: 2.75rem`와 상단 위치 `--shell-top-control-top: calc(var(--safe-top) + .6875rem)`만 동일하게 사용한다. 해당 변수는 `.app-shell`이 제공한다. 모바일에서도 알약 높이를 독립적으로 2.6rem으로 축소하지 않는다.
- 두 컨트롤의 유리 표면은 `--ui-glass`, `--ui-glass-strong`, `--ui-glass-sheen`, `--ui-glass-shadow`를 사용한다. main의 반투명 알약 팔레트(다크 rgba(28,29,32,.70), 라이트 rgba(255,255,255,.72))와 blur(.85rem)을 기본으로 하되, 평면 배경에서도 질감이 보이도록 약한 방향성 하이라이트와 inset 경계광을 더한다. 테마 system/dark/light에 따라 토큰을 전환한다.
- **검수:** 브라우저에서 390px·428px·820px·1280px, 다크·라이트를 확인하고, 컨트롤 y/height 오차 1px 미만, 알약 클릭 전환, SPA 페이지 제목 대체 표시, 테마 전환, 모바일 메뉴 오버레이를 점검한다. 물리 모바일 장치별 투명도/성능은 별도 검수다.


### Hosted Slides 좌측 경계와 글로벌 SideMenu 제스처

- 가장 왼쪽 내부 슬라이드(index 0)가 `allowContentSwipe:true`를 선언한 경우에만 본문 오른쪽 드래그를 **왼쪽 경계를 넘는 메뉴 열기 의도**로 해석한다. 본문 스와이프에서 `dx >= max(52px, viewportWidth × 22%)`이거나, `dx >= 24px` 이면서 `speed > .34px/ms`일 때 커밋한다.
- `onSwipePastStart({slideId})`는 Hosted Slides의 선택적 출력 계약이고, Boot가 기존 `shell.setMenuOpen(true)`에 연결한다. Hosted Slides는 SideMenu의 DOM/기능을 직접 수정하지 않는다. 메뉴가 이미 열려 있으면 재오픈하지 않는다.
- 알약 드래그, 첫 슬라이드 외 다른 슬라이드의 스와이프, `allowContentSwipe:false`(Canvas), 세로 스크롤·편집기/버튼 및 취소된 제스처는 메뉴를 열지 않는다. 역방향 Chat→Canvas 전환도 유지한다.

### 얇은 글로벌 베일과 반투명 글라스

- Immersive 상단 헤더 베일은 기존 95~100%에 가까운 불투명 그라데이션 대신 `--color-bg` 26%→12%→0%의 얇은 그라데이션과 3px backdrop blur, 점차 사라지는 마스크를 사용한다. Stacked 헤더는 콘텐츠 공간을 점유하므로 일반 불투명 표면으로 유지한다.
- Composer의 하단 베일 역시 24%→10%→0% 그라데이션과 3px blur로 낮추고, 베일이 슬라이드에 따라 잘리지 않도록 정지형 요소에 유지한다.
- 알약과 토글 표면은 별도 소유권 및 공동 높이/상단 위치 기준을 유지한다. 다크 유리 alpha .38(선택 영역 .58), 라이트 .48(선택 영역 .65)이며 내부 inset 반사광을 사용하지 않는다. `backdrop-filter`는 약한 0.5rem 블러. 균일한 배경에서는 블러 차이가 작을 수 있으므로 시각 품질은 실제 콘텐츠 배경에서 추가 검수한다.


## 2026-10-18 로컬 Workspace 연결

- 기존 임시 uiTest 모듈/CSS는 제거했다. 현재 컴포저·캔버스는 로컬 편집 기능이며 서버 실행은 연결되지 않았다. 기본 캔버스는 비어 있다.
- Input Manager의 `multiPointer:true` opt-in은 같은 소유자에 한해 복수 포인터를 전달한다. 기본 한 포인터 계약과 시스템 간 소유권은 유지한다.
- Boot는 비동기 로컬 복원 뒤 페이지를 등록한다. Workspace가 Page Host signal을 Composer/Canvas에 전달하고 Hosted Slides의 stationary 슬롯을 사용한다.
- 단일 임시 방의 그래프·초안을 기존 IDB 캐시에, 카메라를 local 저장 영역에 기록한다. 실패·복원 불가 시 성공/임의 덮어쓰기를 하지 않는다.
- 공개 API·실제 로컬 형식·향후 서버 연결 경계·검증 한계는 `frontend-workspace.md`를 따른다.

### 2026-10-19 메뉴 전환 조정

- SideMenu와 콘텐츠 left, Hosted 알약/고정 슬롯 offset은 380ms `cubic-bezier(.16,1,.3,1)`로 함께 이동한다. backdrop·트리거는 240ms로 표시 전환하며 hidden 즉시 변경 대신 CSS visibility 수명으로 닫힘 효과를 유지한다.
- 열림 상태의 단일 원본·aria/inert·입력 허용은 즉시 변경한다. 닫는 backdrop은 fade 중에도 입력을 가로채지 않는다. pointercancel은 메뉴를 닫지 않고 드래그를 원위치로 돌린다. reduced-motion은 모두 즉시 전환한다. Hosted 본문/pill 스냅 속도와 가시 viewport 보간 정책은 변경하지 않았다.
