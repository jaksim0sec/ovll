# Ovll beta — 공통 실행환경 · Hosted Page 스와이프 설계

상태: **설계 승인 및 아래 A/B 실험 기반 구현 반영 (2026-10-17)**. 실제 모바일 물리 키보드/플랫폼별 최종 시각 품질 검증 완료와는 별개. 이 문서는 승인된 책임 경계와 의도 및 의도적으로 미확정인 항목을 기록하며, 실제 구현 상태는 `frontend-global.md` 및 `frontend-data.md`와 해당 구현 계획에서 관리한다.
현재 로컬 Workspace가 실험 픽스처를 대체했다. 아래 실험 단계 설명과 현행 기능의 구분/연결은 `frontend-workspace.md`를 따른다.
대상: `beta`의 전역 프론트 기반. `main`은 구현·디자인 참고용이며 수정하지 않는다.

## 1. 세션에서 확정된 의도 및 요구

- 기존 `main`의 프론트 개편 이유: 기능 자체를 버리는 게 아니라 거대한 Workspace·UI 모듈 내부의 **상태·제스처·레이아웃·전역 설정의 소유권 혼재**를 해소하고, 공개 계약으로 결합해 다른 영역 수정 시 회귀를 줄인다.
- 모바일/PC 별도 최상위 관리자 **금지**. 기기별 행동 결정은 해당 기능의 소유자가 한다. 환경의 사실 관측은 중복 계산을 줄일 수 있지만 개별 기능을 대신 제어하지 않는다.
- Shell, Page Host, Input Manager, 캐시의 기존 책임을 유지하고 불필요한 새로운 범용 계층을 만들지 않는다. Boot는 조립자이며 전역 상태 복제 장소가 아니다.
- **작업 A — 기본 기반**: 모바일 키보드 시 화면 높이와 위치 변화, 환경/입력 능력 관측, 테마·모드·PWA 상태, 버전 확인과 재검증/재로드 정책, 캐시 읽기 경계, 현 SPA 페이지 접근. 이미 있는 책임은 재사용한다.
- **작업 B — Hosted Page 글로벌 슬라이드**: 각 최상위 페이지가 내부 수평 슬라이드 수/ID/표시명/DOM, 알약 노출 선택, 현재 슬라이드별 본문 전체 스와이프 허용 여부를 선언한다. 글로벌 시스템이 상단 알약 생성, 클릭·드래그, 전환 진행률/제스처/애니메이션을 맡는다. 알약은 슬라이드 2개 이상이고 표시 허용인 경우만 생성·활성화.
- SideMenu와 Hosted Page 제스처는 별개 책임이며 충돌 금지. Canvas처럼 자체 제스처가 있는 슬라이드에서는 **본문 글로벌 스와이프 거부**, 알약을 통한 전환은 허용. 모바일 터치와 PC 클릭/드래그·키보드 동작 지원.
- 시각 기준은 `main` 결과물: 화면이 옆으로 미끄러지며 다음 화면이 점진적으로 드러남, 진행형 알약 하이라이트·유리/블러 배경, 깊이감/투명도, 가속도 기반 스냅, 모바일/PC 동일한 인지적 동작. 동작 도중/취소 상태, reduced motion, 포커스/ARIA 포함.
- **중요한 사실 구분**: 확인한 `main/front/css/ui.css`는 페이지간 상대 불투명도를 `.92→1`로 보간하고, 글래스 알약에 backdrop-filter를 사용한다. 실제 페이지 자체가 blur()로 해제되는지 여부는 확인한 구간만으로 확정할 수 없으므로 실측 없이 정확 복제를 주장하지 않는다.

## 2. 원본 기술 분석 (main 참고)

- `front/js/workspaceUi.js`: `pageGesture`는 Chat 본문에서 좌→우가 아닌 **Chat에서 왼쪽 드래그 → Canvas**를 트리거; 터치 초기 감지 8px, 수직 우선 거부, 편집기·버튼·수평 스크롤러에서 거부. Canvas 본문에서는 제스처 시작 안 함.
- `pillGesture`: Pointer 시작/이동/끝 추적, 이동 5px, 속도 필터, 0.34px/ms 기준·중간값으로 대상 결정, 클릭으로 직접 슬라이드 선택. 슬라이드와 알약은 동일한 진행률을 공유.
- `snapTo`: 280ms + 이동 거리×55ms, 4차 ease-out 보간 후 도착. 진행 중 사용자가 새 제스처를 시작하면 기존 스냅 중단.
- `front/css/ui.css`: 알약 기본 폭 9.375rem(2개 기준), 높이는 공통 control size, 둥근 유리 배경·backdrop blur, 선택 배경이 CSS 진행률을 따라 이동. 페이지 translateX, 상대 opacity, 인접 페이지 visibility 관리. 상단 fading topbar 별도.
- `front/js/shellMenu.js`: SideMenu가 열린 상황에서 패널 왼쪽 드래그로 닫기; 초기 방향 판정 6px, 세로 우선 거부, 너비 22% 또는 왼쪽 속도 기준. 즉 기존의 Sidebar 동작은 Hosted Page와 다른 제스처이며 별도 책임이어야 함.
- `main/workspaceUi.js`의 VisualViewport/VirtualKeyboard/회전 처리와 `ovllComposer.js`의 팝업·입력기 재측정은 **다른 책임**. beta는 이미 Shell이 `visualViewport.height/offsetTop`를 읽지만 모의 검사만 했고 실기기 성능·오버레이 키보드·포커스는 미검증.

## 3. 접근법 비교 및 선택안

1. **채택 제안: 기존 Shell + 작고 독립된 Hosted Slides 제어자.** `Page Host`가 유지하는 최상위 `workspace/library` ID는 변경하지 않고, 활성 페이지가 구성한 내부 슬라이드 세트만 Hosted Slides 제어자에 수명-연결해 제공. Shell 내 알약 DOM을 공통 제어자 소유로 한다. 장점: 명확한 단일 소유권, 메인과 독립적 구현, 페이지 N개 확장, Canvas 제스처 거부, 테스트 가능. 비용: 전환 상태·DOM·제스처를 처리하는 하나의 역할 기반 모듈 필요.
2. `Page Host` 자체에 내부 슬라이드/제스처/알약 포함. 파일 수 감소하지만 최상위 페이지 장착 책임과 시각 내비게이션 책임이 섞임. **비권장**.
3. `GlobalManager`/MobileManager에 제스처·캐시·테마·페이지·PWA를 중앙 집중. 결합도 재증가와 중복 상태 소유. **기각**.

선택안은 제스처 제어를 별도 앱 계층으로 승격한다는 뜻이 아니다. 기존 Shell·Page Host 아래에서 특정 **Hosted Slides 표시·전환 책임만** 소유하는 형제 모듈 하나를 허용하는 설계다. 환경·저장·업데이트 로직은 이 모듈에 들어가지 않는다.

## 4. 책임·상태 계약 (승인된 방향)

| 구성 | 소유 | 소유하지 않는 것 |
|---|---|---|
| Boot | 초기화 순서, 의존성 전달, 종료 정리 | 테마 원본, 활성 페이지 복제, API 요청 로직 |
| App Shell | 공통 메뉴, 헤더, 브라우저 가시 프레임의 높이/상단 위치 | Canvas/Composer 내부 레이아웃·편집 |
| Page Host | 최상위 `workspace/library` 정체성과 활성화 수명 | 각 페이지의 내부 슬라이드 선택 상태 |
| Hosted Slides | 활성 Hosted Page의 내부 슬라이드 ID, 진행률, 전환 애니메이션, 글로벌 알약·스와이프 | 최상위 페이지 ID, Canvas 내부 확대·축소, SideMenu 열림 상태 |
| Input Manager | 포인터 제어권 경쟁·취소·해제 | 실제 스와이프 의미·전환 정책 |
| 개별 Hosted Page | 슬라이드 선언, 내부 스크롤/제스처 거절 조건, 콘텐츠 수명 | 글로벌 알약 구현, 다른 Hosted Page의 전환 |
| Composer | Enter 정책·IME·자체 높이·메뉴 포지션 | 앱 프레임/OS 키보드 자체 조작 |
| 로컬 데이터 어댑터 | 서버 예정 캐시/로컬 전용 상태 분리 | 임의 서버 API/충돌 정책 |
| 실행환경/설정 | 관측 가능한 기기 능력·테마 선택, 앱 업데이트 상태 | 타 컴포넌트의 동작 직접 조작 |

`HostedSlides.activateForPage({ root, slides, showPill, signal })` 제안:
- `slides`: 명시적 순서의 `{ id, label, element, allowContentSwipe? }` 배열. `id` 유일. 0개/1개에서는 알약 및 수평 제스처 없음.
- 기본 `allowContentSwipe: false` (Canvas 등에 안전한 opt-in). Chat 슬라이드만 true 선언. 콘텐츠의 `input/textarea/button/a/select/contenteditable` 및 가로 스크롤 하위 요소에서는 거절.
- 이 플래그는 **현재 슬라이드에서 본문 스와이프를 시작할 수 있는지**만 결정한다. 도착 슬라이드가 false여도 전환은 허용한다. 본문 마우스 드래그는 현재 구현에서 거부하고 터치/펜만 처리한다. 알약은 마우스/터치 모두 허용한다.
- Hosted Slides는 true인 슬라이드 루트에 `allows-content-swipe` 클래스로 `touch-action:pan-y`를 부여한다. 브라우저는 touch-action을 가장 가까운 스크롤 컨테이너까지만 결합하므로 `overflow:auto` 루트에는 viewport의 pan-y만으로 부족하다. 중첩된 별도 스크롤 컨테이너가 본문 스와이프를 허용하려면 해당 콘텐츠도 pan-y를 선언해야 한다. 수직 스크롤은 네이티브 처리하고 Canvas의 none/자체 입력 정책은 유지한다.
- `signal`이 종료되면 제스처 취소, DOM 표시/가시성/ARIA 해제, 알약 삭제. 페이지 재활성화 때는 새로운 signal과 현재 슬라이드 관리 정책에 따라 재구성.
- `goTo(id)`, `getCurrentSlide()` 등 공개 제어 계약. 임의 전역 상태 변수로 두지 않음.
- 활성 Hosted Page가 바뀌어도 `Page Host` 자신의 `getActivePage()`가 최상위 ID의 유일한 원본. 글로벌 알약은 현재 활성한 페이지의 구성으로만 렌더링.
- Pill 마우스/터치 드래그와 페이지 본문 스와이프는 같은 진행률 엔진을 사용하되 **서로 독립 입력 소유자**. SideMenu가 열리면 페이지 입력은 취소·억제된다.

## 5. 공통 실행환경: 과잉 분리 금지

- **환경 감지**: 기기 이름/UA를 곧바로 동작 정책으로 삼지 않고 포인터, hover, 뷰포트, 색상 선호, reduced motion, standalone 표시 상태 등 필요한 사실을 공급. 실제 정책은 Composer/Canvas/Shell이 결정. 사용 주체가 한 곳이면 별도 Environment 모듈을 선행 생성하지 않는다.
- **모바일 화면 높이·위치**: 현재 `App Shell`의 `visualViewport.height/offsetTop` + CSS 프레임(이미 beta 반영)을 유지하되 실제 Android 키보드, iOS/화면 회전/주소창/화면 확대/standalone에서 검증하고 필요한 경우에만 수정. `VirtualKeyboard.overlaysContent` 강제 활성화는 보류.
- **테마 설정**: OS 선호와 사용자가 명시한 system/dark/light를 별도 사용자 설정 소유자가 관리. 임시 `uiTest` 테마는 테스트용이므로 영구 원본으로 승격하지 않는다. 가능한 작은 범위에서 현재 코드의 설정 책임을 추출한다.
- **캐시 로더**: 기존 `localDataStore`의 도메인 경계를 그대로 이용. 실제 서버 API 없이는 임의로 데이터 요청을 생성하지 않으며, 차후 `load(cache-first → 검증된 fetch → revision 검증 후 갱신)` 계약으로 결합. 임의의 전역 request 상태 없음.
- **버전/PWA**: 빌드 버전과 서버 최신 버전 계약이 아직 없으므로 '업데이트 가능'을 추측하지 않는다. 현재 manifest/standalone 등 관측 상태와 미래 업데이트 전략을 분리한다. 서비스워커 파일·백엔드 버전 API를 지어내지 않음. 새로고침과 API 재시도는 별개의 소유권.
- **현재 SPA 페이지**: 기존 `Page Host.getActivePage()`를 조회/알림으로 제공하되 환경 계층에서 중복 보관하지 않음.

## 6. 시각·상호작용 요구 및 실패·예외

- 각 슬라이드는 뷰포트 너비 기준으로 옆에 놓이고 진행 중 translateX·opacity로 보간. 페이지 간 글래스/블러 인상은 참조와 비교해 조정하지만 캔버스 전체에 지속적인 무거운 filter blur를 적용하지 않는 것이 기본.
- 전환 중에는 양쪽 페이지가 렌더되고 스냅 후 비활성 슬라이드는 `aria-hidden`, `inert`, pointer 차단. 알약에는 키보드 탐색 가능한 button 및 선택 상태를 부여.
- 드래그 도중 pointercancel, 탭 전환, 메뉴 열림, 페이지 이탈, 가시 뷰포트 크기 변경 모두 무조건 안전하게 롤백/종료. reduced motion에서 스냅 애니메이션 생략.
- 모바일 화면 전체 제스처는 수직 스크롤/선택/IME에 우선권을 양보. Canvas의 `allowContentSwipe=false` 선언을 바깥에서 덮어쓰지 않는다.
- 메뉴: 모바일 오버레이가 열려 있으면 Hosted Page 제스처 없음. 열린 메뉴 패널의 좌측 스와이프로 닫는 별도 제스처는 App Shell 책임으로 유지하며 global slide 전환으로 전달하지 않는다.
- 개발 중 임시 Chat/Canvas 목업은 실제 제품이 아님을 계속 표시한다. 구조 제어자가 목업 DOM을 생성하거나 제품 로직을 모방하지 않는다.

## 7. 검증 기준 / 미확정 사항

반드시 확인: (1) 1/2/3 슬라이드, pill 허용/비허용 (2) 클릭·드래그·터치·키보드 (3) Chat swipe → Canvas, Canvas 본문 swipe 무반응, Canvas 알약 → Chat (4) SideMenu 열림/닫힘과 손실 없이 경쟁 취소 (5) 모바일 키보드 높이·상단 위치와 composer mock 위치 (6) 페이지 왕복·destroy·BFCache (7) reduced motion·테마·실패 캐시 (8) PC·모바일 전환 visual 대조 (9) main 수정 및 배포 설정 변경 없음.

현재 beta는 **실제 Canvas/Chat/Composer가 아니라 임시 픽스처**이므로 본문 제스처 억제·전역 슬라이드 구성 계약과 목업 화면 효과는 검증할 수 있지만 실제 Canvas 멀티터치·IME 등은 최종 구성요소와 함께 추가 검증해야 한다.

**후속 판단이 필요한 항목**: 초기 슬라이드 기억 범위(활성 기간/SPA 역사/로컬 지속성), Safari 터치 캡처 정책, 시각적 blur 강도·성능, 앱 버전 신뢰 가능한 원본 및 PWA 서비스워커 구축 시기. 미정 사항을 코드에서 사실처럼 확정하지 않는다.


## 8. 실제 구현 계약 — 가시 뷰포트·고정 슬롯·페이지 모드 (2026-10-17)

### 8.1 Frame/Stage 높이

- `#app`은 브라우저에서 현재 보이는 가시 영역의 상단(`visualViewport.offsetTop`)과 높이(`visualViewport.height`)를 **즉시** 적용한다. `visualViewport`가 없거나 값이 유효하지 않으면 `innerHeight → documentElement.clientHeight → 1px` 순으로 대체한다. 키보드 열림 불리언은 추론하지 않는다.
- 외부 프레임의 직계 자식 `#app-stage`는 같은 목표 높이 `--shell-stage-height`를 가지되 CSS `height` 전환을 조건부 적용한다. 수신 시점 간격이 95ms 미만인 연속 변화에는 65ms 추종, 단발 축소에는 120ms, 단발 확대에는 140ms, 초기/회전에는 0ms를 적용한다. 1.25px 미만 크기 흔들림은 재애니메이션하지 않는다. 현 실제 소스는 `front/js/shell/appShell.js`, `viewportMotion.js`, `front/css/shell.css`.
- 글로벌 알약·임시 Composer는 `#app-stage` 밖에서, Frame 안의 독립 overlay에 마운트한다. 브라우저 높이가 바뀔 때 지연 Stage 때문에 입력기가 화면 밖에 남지 않도록 한다. Shell은 Composer 내부 DOM이나 실제 편집 동작을 해석하지 않는다.
- `VirtualKeyboard.overlaysContent` opt-in은 하지 않는다. 새로운 가시 viewport 처리 방식을 브라우저가 사용하면 실기기에서 검증해야 한다. `prefers-reduced-motion`에서는 Stage 전환 생략. 실제 폰에서 부드러움을 확인한 것은 **아님**.

### 8.2 페이지 구성 선언과 장착 수명

- `createHostedSlides({pillHost,stationaryHost,input,onLayout,isBlocked})`가 한 활성 Hosted Page에 한하여 `activateForPage({root, layout, pill, slides, stationary, signal})`를 제공한다. `layout`은 `immersive`(기본) 또는 `stacked`, `pill.visible`은 사용자 표시 요청, `slides`는 `{id,label,element,allowContentSwipe}`, `stationary`는 `{id,element,slot,reserveSpace}` 배열이다. 정지형 요소의 slot은 `top|bottom|overlay`, 공간 예약 기본값은 false.
- `layout:immersive`는 Stage 전체에 slide viewport를 펼치고 글로벌 chrome/Composer가 투명 베일로 겹친다. `stacked`는 `--shell-chrome-height` 아래부터 Page Host 콘텐츠를 시작하며 Shell 헤더 DOM과 베일은 재생성하지 않는다.
- `stationary` 요소는 슬라이드 track 바깥 `[data-hosted-stationary]` 아래에서 렌더링한다. 내부 요소 생성·상태는 Page 담당이며 Hosted Slides는 `HTMLElement`를 장착만 한다. 동일 ID/element의 레이아웃 변경에 재장착하지 않는다. 현재 임시 Composer는 bottom 슬롯에 한번 장착되며 Chat/Canvas 전환 중 DOM/입력값이 유지된다.
- `showPill` 호환 인수 또는 `pill.visible` 요청과 슬라이드 개수 `>=2`일 때만 알약이 나타난다. 요청 여부는 실제 표시 여부와 분리해 유지하여 1개→2개로 동적 증가할 때 원래 표시 요청을 복원한다.
- `goTo(id)` 전환, `getCurrentSlide()` 조회, `update(patch)` 부분 갱신, `cancel(reason)` 제스처·애니메이션 취소, `destroy()` 정리를 제공한다. 업데이트의 `slides`, `stationary` 목록은 부분 항목 수정이 아니라 **전체 교체**다. 동일한 stationary element는 다시 장착하지 않는다.
- `Page Host`는 최상위 `workspace/library`만 소유하고, Hosted Slides는 페이지 내부 슬라이드 ID와 진행률만 소유한다. 메뉴 열림은 Shell만 소유하고, Input Manager는 제스처 소유권만 중재한다.

### 8.3 제스처·시각 효과

- Chat에서는 `allowContentSwipe:true`이므로 모바일/터치 가로 제스처로 옆 슬라이드를 열 수 있다. Canvas는 `false`라서 전체 본문 제스처를 글로벌이 가져가지 않는다. 알약 클릭·드래그·키보드 화살표/Home/End는 독립적으로 동작한다.
- 본문 8px, 알약 5px 정도의 움직임을 확인한 뒤 드래그로 판단한다. 세로 스크롤, interactive control, `data-swipe-block`, 내부 수평 scroll 영역은 글로벌 스와이프에서 제외한다. 마우스 본문 전체 스와이프는 하지 않고 PC에서는 알약 클릭·드래그로 전환한다.
- 화면 이동 및 알약 하이라이트는 **동일한 실수형 progress**를 사용한다. 슬라이드 폭만큼 x 변위, 근접 페이지 opacity 0.92–1, 280ms + 이동 정도×55ms ease-out quartic 스냅을 적용한다. 큰 영역의 전면 blur 대신 고정된 연속 베일/작은 알약 유리 blur를 사용한다.
- 오버레이 메뉴가 열리면 hosted 제스처를 취소하고, 메뉴 패널 왼쪽 드래그는 Shell 자신이 처리한다. Page Host 이탈/abort/resize 상황에서는 진행 중 조작을 취소·정리한다. Input Manager의 한 포인터 스트림이라는 제한은 여전히 유지한다.
- Library 역시 `layout:stacked`, 내부 단일 슬라이드/알약 미노출을 Hosted Slides 구성 객체로 선언한다. 현재 구현은 도메인 기능 없는 임시 Chat/Canvas/Composer/Library 및 선택적인 세 번째 실험 슬라이드만 테스트한다. 제품용 Composer IME 정책/Canvas pinch·drag는 아직 구현하지 않는다.

### 8.4 테스트 / 남은 한계

- 현지 Node `node --test tests/frontend/hosted-contracts.test.mjs` 및 로컬 Playwright Chromium 데스크톱(1280×800), 모바일 에뮬레이션(390×844) 실험: Chat→Canvas 터치, Canvas 본문 제스처 거부, 알약 이동, 2↔3 슬라이드, immersive↔stacked, Composer 입력 유지, Library 왕복, 가상 VisualViewport 높이/offsetTop 변경.
- 실제 Android/iOS Safari 환경, 실제 소프트키보드 animation/overscroll/PWA, 물리 모바일 터치·멀티터치와 main 비교 스크린샷 **미검증**. 임시 실험 화면이 제품 UI 구현을 의미하지 않는다.


### 2026-10-18 검수 조정

- `Shell`의 메뉴 토글과 Hosted 알약은 **각기 다른 표현 소유권**이다. 메뉴 버튼은 Shell 안에 남지만, 알약과 고정 컨트롤은 `[data-hosted-presentation]` 아래에서 별도 배치한다.
- 글로벌 상단 페이지명은 현재 페이지에 알약이 없을 때만 중앙에 표시한다. `HostedSlides`의 `onPillVisibilityChange` 콜백으로 이를 반영하며, 슬라이드·알약 상태의 단일 원본을 Shell에 중복 생성하지 않는다.
- `VisualViewport` 높이·오프셋에 대한 `createViewportMotion` JS 보간(프레임 안전영역 제한, 내부 Stage 재지향)은 현재 `beta`의 시험 구현이다. 화면 보간의 물리 키보드·모바일 브라우저별 품질은 별도 실기기 검수가 필요하다.
- `ThemeSettings`의 `system/dark/light`는 SideMenu와 임시 Chat에서 같은 값을 관측·수정할 수 있다.
