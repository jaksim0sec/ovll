# Render beta — 채팅↔독립 엔진 시험 연결

상태: 2026-10-23 beta 구현. 로컬 HTTP 및 모의 응답 통합 시험 완료; 실제 Render 배포와 Gemini 실호출은 별도 확인 필요.

## 역할과 배포
- `back/js/server.js`: Node Web Service 진입점. Gemini 단일 호출기·엔진·메모리 요청 등록소·FIFO 관제를 인스턴스당 하나만 생성한다.
- `back/js/httpServer.js`: 한 origin에서 `front/`의 정적 파일과 요청 HTTP API를 제공한다. `front/` 바깥 파일을 공개하지 않는다.
- `front/js/workspace/requestBridge.js`: `front/js/boot.js`가 `createWorkspace({onSubmitRequest})`에 주입한다. Composer의 구조화 초안을 `prepareRequestInput()`으로 정리하고, 실제 접수 성공 후에만 초안을 비운다. UI는 기존 `setConfirmedChatRecords()`·`setRequestActivities()`를 사용한다.
- Render에서 새 **Web Service**를 생성해 반드시 `beta` 브랜치로 배포한다. 루트 `render.yaml`을 Blueprint로 이용하거나 Build `npm install --ignore-scripts`, Start `npm start`, Health Check `/api/health`로 수동 생성한다. `main`의 기존 서비스/도메인은 수정하지 않는다.
- `package.json`: Node.js 22~24, 추가 npm 의존성 없음. 서버는 Render가 제공하는 `PORT`를 `0.0.0.0`에서 리슨한다.

## Render 환경변수 (main과 정합)
- **서버 시작에 필수인 모델 관련 환경변수: 없음.** 키가 없으면 서버·프론트·`/api/health`는 시작하지만 실제 AI 요청은 `MODEL_AUTH`로 실패한다.
- Gemini API 키: `GEMINI_API_KEY` → `OVLL_POINTER_MODEL_API_KEY` → `OVLL_VNEXT_MODEL_API_KEY` 우선순위. 세 변수 모두 **서버 시작 시 선택**, 실제 Gemini 호출 시 하나는 필요하다.
- Gemini 모델: `OVLL_POINTER_MODEL_ID` → `OVLL_VNEXT_MODEL_ID` → `GEMINI_MODEL` → **기본 `gemini-3.5-flash-lite`**. 전부 생략 가능. `main`과 동일한 우선순위다.
- `OVLL_POINTER_PROVIDER_ID` / `OVLL_VNEXT_PROVIDER_ID`를 명시했다면 `gemini`만 지원한다. **`beta`는 합의대로 Gemini 단일 공급자**이며 `main`의 Groq·호환 공급자는 이번 프로토타입 범위 밖이다.
- `OVLL_TEST_TOKEN`: **선택**. 미설정 시 테스트용 기본값 `abcd`; 설정한 값이 있으면 그 값이 우선한다. beta Composer는 기본 `abcd`를 자동 전송하므로 같은 값이면 접근키 팝업이 뜨지 않는다. 서버에 다른 토큰이 설정된 경우 401 응답 후 직접 입력받는다. `abcd`는 프론트 소스에 노출되는 약한 공유 문자열로 실제 보안을 제공하지 않으며 공개 Render API에서 AI 호출 비용이 발생할 수 있다. 운영 서비스에 사용 금지.
- `PORT`: Render 제공값, 없으면 10000. `render.yaml`은 환경변수를 강제로 요구하지 않는다.

## HTTP 계약
- `GET /api/health`: 공개, `{ok:true,service:'ovll-beta',memoryOnly:true}`.
- `POST /api/requests`: 토큰이 설정된 경우 `Authorization: Bearer <OVLL_TEST_TOKEN>` 필요, JSON `{roomId,request:{parts,attachments},initialResources}`. 입력 크기 128KiB 이하. 접수 시 `202 {roomId,requestId,status:'queued'}`를 반환한다. 요청 처리는 이후 비동기로 계속된다.
- `GET /api/requests/:requestId?roomId=<roomId>`: 토큰이 설정된 경우 동일 인증 헤더. `{roomId,requestId,status,currentLayer,result?,error?,plan?}`를 반환한다. roomId가 다르거나 레코드가 없으면 404.
- 상태: `queued`, `running`(Gate/Hallway), `completed`, `unsupported_workshop`, `failed`. 프론트는 약 900ms 간격으로 상태를 재조회하며 최신 서버 스냅샷을 표시한다. 지금은 SSE가 아닌 **HTTP 폴링**이다.
- Composer 전송 후 사용자는 기존 **채팅** 슬라이드로 이동한다. 사용자 메시지는 HTTP 접수 확인 후 표시되고, AI 메시지는 완료 상태의 검증된 `languageBlock`만 표시한다. 계획 분기/오류는 별도의 상태 카드에 표시하며 성공 메시지를 위조하지 않는다.

## 테스트 절차
1. Render의 새로운 `beta` Web Service를 배포한다. AI 요청에는 Gemini API 키가 필요하고 모델명은 선택이다. `OVLL_TEST_TOKEN`을 설정하지 않거나 `abcd`로 지정하면 Composer에서 자동 처리한다. 기존에 다른 값을 설정했다면 `abcd`로 변경하거나 그대로 두고 직접 입력한다.
2. Render 주소의 `/api/health`가 `ok:true`인지 확인한다.
3. **Render 주소로 접속한 beta 프론트**의 채팅에서 요청을 보낸다. 기본 `abcd`는 자동 전송되어 접근키 팝업이 없다. 환경변수의 다른 토큰과 충돌할 때에만 401 응답 이후 그 토큰을 묻는다. Gemini API 키는 브라우저에 입력하지 않는다.
4. 대기열 → Gate → Hallway → 필요시 Workshop·Hallway Return → Output 진행 카드와 결과를 확인한다. 단순 인사는 직접 응답. 실제 Skill/Canvas 변경 요청은 해당 Workshop 결과가 확인돼야 성공이다.
5. 실패가 발생하면 Chat 진행 카드의 실패 코드/단계, Render 로그, `/api/health`를 확인한다. 실제 Gemini 출력의 구조/서비스 모델에 따라 실패 가능성이 있으므로 아직 성공을 단정하지 않는다.

## 제한과 책임
- 메모리 상태는 Render 인스턴스 종료·재배포·무료 요금제의 슬립 때 사라진다. 완료된 채팅 최근 8개는 서버 메모리에서 `GET /api/rooms/:roomId/history`로 재조회할 수 있으나 **영속 저장이 아니다**. 요청별 `contextData`는 초기 빈 값으로 공급하며 세션 원본 병합은 없다.
- 기본값 `abcd`는 소스에 공개되어 인증/보안 기능을 사실상 제공하지 않는다. 선택 테스트 접근키는 **베타 공개 시험을 위한 임시 공유 비밀**이지 사용자 계정 인증/다중 테넌트 접근 제어가 아니다. 본 구성으로 일반 공개 서비스를 운영하지 않는다.
- 큰 파일은 전송하지 않는다. `prepareRequestInput`은 Skill/Skill Block 직접 참조와 필요한 표시 메타데이터만 보내며 프론트의 Blob은 보내지 않는다. 프론트 메타데이터를 검증된 실행 정의로 주장하지 않는다.
- Canvas의 로컬 사용자 편집을 서버 원본에 트랜잭션으로 반영하는 완전 동기화, 서버 DB, IR, SSE·재연결 리플레이, 자동 인증 복구는 미구현. 비IR Workshop 11개 행동과 Hallway Return·Output은 Beta 메모리 기반으로 연결돼 있다.
- **별도 정적 호스팅(Vercel/GitHub Pages)에 올라간 beta 프론트는 이 실험 API와 같은 origin이 아니므로 동작하지 않는다.** 현 단계는 Render에서 제공하는 beta UI를 통해 시험한다.

## 테스트 명령
```bash
npm test
node --test tests/frontend/*.test.mjs
```
일부 브라우저 중심 프론트 테스트는 Chromium/Playwright 사용 환경이 필요하다. Node의 백엔드 테스트 통과만으로 실제 모바일 브라우저 또는 Render Gemini 실호출 검증을 주장하지 않는다.

## 기존 main 주소에서 beta를 띄웠을 때의 서비스워커 전환
- 기존 main의 `front/js/boot.js`는 `/api/version`을 호출하고 `/sw.js`를 등록한다. beta 엔진은 `/api/version`을 구현하지 않고 실험 API에 `OVLL_TEST_TOKEN` 검사를 적용하므로 옛 스크립트가 실행되면 401이 나며, 옛 `ui.js`/`ovllPresence.js`/`app.js`는 beta의 HTML에 없는 DOM 요소를 찾으려다 실패한다.
- main `front/sw.js`의 `ovll-shell-*` CacheStorage가 같은 origin에 남은 경우 beta HTML/JS와 옛 파일이 섞일 수 있다. `beta/front/sw.js`는 **전환용 1회성 서비스워커**: 설치→즉시 활성화→오래된 `ovll-shell-*` 캐시만 삭제→자신을 등록 해제→동일 origin의 열려 있는 창을 새로고침한다. beta 자체는 서비스워커를 등록하지 않는다. 별도 Render beta 서비스/URL 사용을 우선 권장한다.
- 확인 기준: beta `front/index.html`은 `./js/boot.js`를 ES module로 로드한다. 버전 API 체크 및 옛 Astra UI는 포함하지 않는다. 실제 Render에서 서비스워커 갱신 결과는 별도로 확인해야 한다.

## 2026-10-23 요청별 진단 개선
- 프론트 진행 카드에는 해당 요청의 사용자 문장(100자 이내)과 requestId 앞부분을 함께 표시한다. 다른 요청이 성공해도 이전 실패 카드는 해당 ID로 남으므로 혼동하지 않아야 한다.
- `DATA_UNAVAILABLE`은 확인된 `error.missing`의 dataset/key를 보여준다. 인식·공급에 실패한 데이터는 가짜 성공 응답으로 변경하지 않는다.

## 2026-10-23 맥락 연결 실험
- 같은 roomId에서 완료된 요청의 `contextData`는 메모리에 보존되며, 다음 요청이 큐에서 실행될 때 전달된다. 최신 완료 요청 8개만 `chatContext`/과거 `originalReq`의 재료로 사용한다. 실패 요청과 Workshop 미지원 상태는 세션 맥락을 바꾸지 않는다.
- 스킬/블록 설명만 요청하면 제공된 표시용 메타데이터로 직접 응답하도록 Gate/Hallway 프롬프트를 보강했다. 하지만 실제 실행용 정의나 존재하지 않는 데이터를 요구하면 `DATA_UNAVAILABLE`을 유지한다.
- 재현 권장: ① `내 프로젝트 이름은 A이고 목적은 B야. 기억해.` ② `아까 프로젝트 이름과 목적은?` (같은 방 연속 요청). 스킬 시험은 캔버스 블록 첨부 후 `설정값을 설명만 해줘. 실행하지 마.`; 모델 판정과 실제 Gemini 모델 출력에 따라 실패할 수 있다.

## 2026-10-23 Workshop HTTP 시험
- 메모리 상태 조회 `GET /api/rooms/:roomId/assets`, 동일 요청의 대기 응답 `POST /api/requests/:requestId/answer`, Output 실패 시 행동 재실행 없는 재시도 `POST /api/requests/:requestId/retry-output`을 추가했다.
- UI는 요청별 `waiting.id` 질문 폼과 최종 응답 재시도 버튼을 지원한다. Canvas는 서버 확정 자산을 반영하되 기존 로컬과 충돌하면 덮어쓰지 않는다. Beta 공유 테스트 토큰은 정식 인증이 아니다.
- 현재 실제 Render 재배포, Gemini 호출 및 브라우저 렌더링은 검증되지 않았고 API의 메모리 상태는 재시작하면 지워질 수 있다.

- 2026-10-23 신뢰성 검증: GitHub Actions Node 22 `npm test` 55/55 통과. 독립 실제 Gemini 모델 통화 및 브라우저·Render 환경에서의 전체 E2E 동작은 별도 확인 필요.
- 동일 방에서 서버 확정 Skill 정의는 `GET /api/rooms/:roomId/assets`로 직접 재조회 가능하다. 채팅의 '서버에서 확인된 작업' 카드에는 적용 결과가 있는 행동만 표시하고, 실제 생성된 Skill은 채팅 자산 목록과 라이브러리에 노출한다. 서버 상태와 다른 로컬 캔버스는 자동으로 덮어쓰지 않는다.
