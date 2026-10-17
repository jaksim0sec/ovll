# Ovll beta — 프레임 보간·정지형 요소·화면 레이아웃 보완안

상태: **사용자 요구 명시, 구현 방식 검토용 제안** (2026-10-17). 아직 `docs/developing/` 확정 명세로 편입하지 않음.
근거: `main/front/css/style.css` #app / #app-stage 및 `main/front/js/workspaceUi.js` viewport 처리, `main/front/css/ui.css` topbar/composer, 현 `beta/front/js/shell/appShell.js` / `front/css/shell.css`.

## A. 높이 조정: main 대비 정확한 차이와 보완

- `main`: JavaScript에서 `visualViewport.height/offsetTop` 또는 VirtualKeyboard 오버레이 높이를 읽어 `--app-frame-top`, `--app-frame-height`, `--app-stage-height` 갱신. 증가/감소 방향(`viewport-growing/shrinking`)에 따라 140/120ms easing. `#app`의 top/height와 직계자식 `#app-stage`의 height **둘 다 CSS transition** 보유하며, `prefers-reduced-motion`에서 중지. 회전 후 지연 재측정과 ResizeObserver도 사용. 기존의 화면 튕김 보정 효과는 실기기 관측 없이는 성공 범위를 확정하지 않는다.
- `beta`: `requestAnimationFrame`으로 VisualViewport 값을 Shell CSS 변수에 적지만, **단일 .app-shell 높이**만 제어하며 `#app-stage`와 방향별 시각 보간이 없다. 기술적으로 "개선"이라기보다 매끄러움에 기여한 부분을 제거한 단순화.
- **제안**: Shell이 가시 경계의 사실값(좌표/높이)을 즉시 관측하고, Shell 직계 내부 Stage가 표시 높이를 짧게 보간한다. 프레임 경계 및 포커스된 입력기 가시성은 애니메이션보다 우선한다. 모드별 최적 보간 대상(top/height vs transform/clip)과 부모/자식의 지연 차이는 Android/iOS 실기기 비교 후 결정하며 main의 방향별 120/140ms를 출발점으로 삼는다.
- 1px 수준 측정 잡음, 확대/주소창 변화, PWA/브라우저, 회전/키보드 연속 이벤트, viewport scroll, BFCache, reduced-motion을 확인한다. 억지로 키보드 열림 Boolean을 추정하지 않으며 `VirtualKeyboard.overlaysContent` 강제 활성화는 미포함.
- **사용자에게 확인할 점**: 실제 `main` CSS는 JS 즉시 변수 갱신 + 부모와 자식 모두 짧은 CSS transition이며, 사용자가 말한 “부모는 즉시/직계 자식은 트랜지셔너”는 실제 구현의 효과·설계 의도를 지칭한 것으로 해석한다. 완전히 무애니메이션 부모로 바꾸는 방식은 별도 검증 없이는 확정하지 않는다.

## B. Hosted Page의 스와이프 독립 요소 (추가 요구)

- Hosted Page가 내부 슬라이드/알약 설정 외에 **움직이지 않는 콘텐츠를 선택적으로 선언**한다. 예: Composer, 페이지 공통 FAB, 페이지 전용 보조 컨트롤. 글로벌 pill·Shell 메뉴는 계속 Shell 소유이며, Composer의 텍스트/IME/전송 동작은 Workspace/Composer 소유.
- **제안 계약**: `stationary: [{id:"composer", slot:"bottom", element: composerElement}]` (선택, 기본 빈 배열). `slot`은 `top|bottom|overlay`부터 필요할 때만 확대. 슬라이드 트랙의 `transform`과 다른 DOM 형제 컨테이너에 배치하므로 스와이프 중 이동하지 않는다. 컨테이너는 선언이 없으면 DOM에 생성하지 않거나 비활성화한다.
- 가능한 DOM 계층: `hosted-root > .slide-viewport > .slide-track > [slide elements]`, `hosted-root > .stationary-layer > [stationary elements]`; Shell 소유 `chrome-layer > global pill/menu/veil`은 별도. Stationary는 단순 DOM 장착 슬롯일 뿐 내용/실행 상태를 읽거나 변경하지 않는다.
- **Raw HTML보다 권장**: HTML 문자열 삽입 없이 개별 페이지가 `<template>` 복제나 DOM 생성 함수/컴포넌트 팩토리에서 `HTMLElement`를 만들고 `element`를 전달. 필요하면 `mount({container,signal})` 함수가 반환한 cleanup에 생명주기를 묶되, 초기에 `HTMLElement` 계약 하나만으로 충분하면 새로운 렌더링 추상화를 만들지 않는다. DOM 재부착 중 Composer의 focus/IME/selection이 끊어지지 않도록 마운트 시점과 이동 금지 테스트 필요.
- 글로벌 pill 상단 배경 베일은 정지형 페이지 요소가 아니라 Shell 안정 레이어에 하나만 유지. 페이지 전환 중 각 슬라이드가 독자적으로 베일을 그려 발생하는 경계 이음새 방지.

## C. 화면 구성 모드 (추가 요구)

- **제안 계약**: Hosted Page의 `layout: "immersive" | "stacked"` (예: Workspace immersive, Library stacked). 페이지 단위이며 개별 슬라이드 단위로 즉시 바꾸지 않는다. 이유: 드래그 진행 중 상단 유효 높이가 점프하거나 베일이 잘리는 문제 방지.
- `immersive`: Hosted Page의 슬라이드 뷰포트가 가시 Stage 전체를 채운다. Shell의 header/pill 및 페이지의 stationary Composer가 그 위에 떠 있으며 각각 투명한 연속 베일(상/하 gradient)을 제공. 뷰포트/드래그 시 이 베일을 움직이지 않는다.
- `stacked`: Shell header/pill은 동일한 글로벌 계층을 유지하지만 Hosted Page 시작 영역을 헤더의 **실제 점유 높이 아래**로 inset/padding하여 리스트/라이브러리 콘텐츠가 아래에서 시작한다. Shell에서 측정/제공하는 한 개의 `--shell-chrome-top` 등 레이아웃 변수를 재사용하고 페이지별 margin 하드코딩이나 JS 생성 placeholder는 기본적으로 사용하지 않는다.
- CSS grid/absolute overlay + 모드별 `#page-host`의 inset 또는 padding으로 구현 가능. header는 Shell 레이어에 **한 번만 마운트**하며, 모드 변경 시 베일 자체를 DOM에서 제거/재생성하지 않고 투명도/색만 조정한다. `backdrop-filter`가 성능이나 중첩 컨텍스트 문제를 일으키면 상단/하단에 동일한 gradient 레이어로 대체 가능.
- 최상위 SPA 페이지 전환 시 `Page Host`는 여전히 페이지 ID의 원본이고 Boot는 페이지별 선언을 전달하며 Shell이 모드를 적용. `HostSlides`가 Shell 헤더 DOM을 직접 조작하지 않는다.
- `stationary` 유무와 `layout`의 모든 조합 지원: no pill + stacked Library, pill + immersive Workspace, stationary-only immersive, standalone single-slide.
- 검증: 1/2/N slides, Android 키보드, screen rotation, sidebar dock/overlay, reduced-motion, 베일 연결·키보드 포커스, nested swipe blocks, SPA 페이지 복귀 후 원래 모드.

## D. 대안 비교 및 권장

1. **권장: Shell 고정 chrome/veil + Hosted Slides의 별도 stationary DOM 슬롯 + 페이지별 layout CSS 계약.** 알약 진행률과 페이지 콘텐츠 생명주기를 섞지 않고, 별도 Global/Mobile Manager 불필요.
2. 슬라이드별 fixed 요소를 각각 복제하고 translate 취소: DOM·포커스 중복과 베일 경계 문제 위험. 비권장.
3. JS에서 각 페이지마다 높이 placeholder 동적 삽입: 추후 반응형/회전·브라우저 툴바 갱신 경쟁, 상태 원본 중복 위험. CSS inset/grid 계산으로 충분한 경우 비권장.

**승인 후 반영 위치**: `docs/developing/frontend-runtime-and-hosted-swipes.md`에 계약 합의 내용 이관, 런타임 계획 Task 1의 “현재 높이 매핑만 검증” 문구 수정, Hosted Slides 계획 Task 2와 Task 4의 stationary/layout API·DOM·시각 테스트 수정. 현재 기존 계획은 이 보완 요구를 다 반영하지 못하여 수정 전 실행 금지.

참고: 기존 런타임 계획의 Task 4는 서버 버전 API와 로컬 **정적 파일 캐시 버전** 비교/재요청이라는 별도 사용자 정정 요구를 아직 반영하지 못했다. 업데이트 상태 관측만으로 해당 요구 완료를 주장할 수 없다.
