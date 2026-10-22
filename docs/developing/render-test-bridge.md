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
4. 대기열 → Gate → Hallway 진행 카드와 최종 응답을 확인한다. 단순 인사는 직접 응답을 예상할 수 있다. Skill·Canvas 실행 요청은 현재 미구현 Workshop으로 남을 수 있다.
5. 실패가 발생하면 Chat 진행 카드의 실패 코드/단계, Render 로그, `/api/health`를 확인한다. 실제 Gemini 출력의 구조/서비스 모델에 따라 실패 가능성이 있으므로 아직 성공을 단정하지 않는다.

## 제한과 책임
- 메모리 상태는 Render 인스턴스 종료·재배포·무료 요금제의 슬립 때 사라진다. 프론트도 서버의 채팅 기록을 영속 저장/재조회하지 않는다. 요청별 `contextData`는 초기 빈 값으로 공급하며 세션 원본 병합은 없다.
- 기본값 `abcd`는 소스에 공개되어 인증/보안 기능을 사실상 제공하지 않는다. 선택 테스트 접근키는 **베타 공개 시험을 위한 임시 공유 비밀**이지 사용자 계정 인증/다중 테넌트 접근 제어가 아니다. 본 구성으로 일반 공개 서비스를 운영하지 않는다.
- 큰 파일은 전송하지 않는다. `prepareRequestInput`은 Skill/Skill Block 직접 참조와 필요한 표시 메타데이터만 보내며 프론트의 Blob은 보내지 않는다. 프론트 메타데이터를 검증된 실행 정의로 주장하지 않는다.
- Canvas 전체 동기화, Workshop 실제 행동, Hallway Return/Output 실호출, 서버 DB, SSE·재연결 리플레이, 자동 인증 복구는 미구현.
- **별도 정적 호스팅(Vercel/GitHub Pages)에 올라간 beta 프론트는 이 실험 API와 같은 origin이 아니므로 동작하지 않는다.** 현 단계는 Render에서 제공하는 beta UI를 통해 시험한다.

## 테스트 명령
```bash
npm test
node --test tests/frontend/*.test.mjs
```
일부 브라우저 중심 프론트 테스트는 Chromium/Playwright 사용 환경이 필요하다. Node의 백엔드 테스트 통과만으로 실제 모바일 브라우저 또는 Render Gemini 실호출 검증을 주장하지 않는다.
