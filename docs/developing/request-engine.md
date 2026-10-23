# Beta 관리형 요청 엔진과 네이티브 행동 호출

상태: 2026-10-24 Stage 2: 정의 저장·블럭 배치 **2행동** 실행 지원.

## 구성·인터페이스
- `back/js/runtime.js:createBetaRuntime()`는 `createEngine`, `createMemoryActionStore`, `createMemorySessions`, `createMemoryDataProvider({assets})`, `createRequestHttpServer`를 조립. `server.js`에서 생성/구동.
- `engine.js:createEngine`: `submit/getRequest/getCall/listCalls/cancel/whenIdle`, HTTP 레거시 호환 `enqueue/get/resume/retryOutput`. 실제 여러 요청 관리, 한 요청만 실행하는 추상화를 엔진 전체와 혼동 금지.
- `requestRunner.js:createRequestRunner`: Gate/Hallway 직접 응답 또는 action plan. 지원 행동 순차 호출, Output. `actionStore` 미주입 시 Stage 1의 inert Action Shell 유지.
- `callManager.js`: `invoke`(JSON)·`invokeFunction`(한 selected tool), 별도 `callId`, route/path, 제한된 공급자 슬롯, 호출별 임시 focus, AbortSignal. 모델 응답은 적용 결과가 아니다.
- `model/gemini.js`: 기존 JSON `generate` 외 `generateFunction`(REST `generateContent`, `ANY`, 허용 함수명 한 개, `functionCall` 1개 검증). 공급자 응답은 인수 **제안**.
- `actionDescriptors.js`: 두 도구 선언/검증, `memoryActionStore.js`: 서버 실제 적용·room별 revision·opId 중복 방지. 이전 `workshop.js`/임시 JSON router는 복구하지 않음.
- `scheduler.js`의 `onCheckpoint`는 적용 전 `pendingOperation`, 적용 후 `verifiedResults`·`planCursor`를 Registry에 기록. 예외/Output 오류 시 적용된 결과와 room 자산은 남는다.

## 계약
- Hallway JSON 직접 응답 `languageBlock,contextBlock,contextData` → 요청 `completed`. 별도 Output 없음.
- Hallway 계획 `plan,contextBlock`. 각 plan 요소 `{'skillDefine.defineDirect':{objective,need}}`처럼 단일 행동 이름. `skillDefine` 같은 분류만 선택 불가.
- 실행 지원: `skillDefine.defineDirect`는 유효한 설명/지침/필드/포트/아이콘을 갖춘 **독립 Skill 정의 저장**. `canvasEdit.addBlock`은 기존 확인된 Skill ID를 사용해 별도 Block 배치. Skill의 지침은 **실행하지 않음**.
- `verifiedResults`의 `outcome.status='applied'`만 실제 성공. `requestId`/각 모델 `callId`/실제 변경 `operationId` 구분. `terminate` 도달 후 Output가 검증된 작업만 언급하고 room `contextData`를 CAS 확정.
- 나머지 10개 이름은 Action Shell에서 `unsupported_workshop`, 현재까지의 부분 `verifiedResults` 보존, 다음 단계 자동 실행 금지. Hallway Return/임의 재계획 없음.
- 중복 `operationId` + 같은 인수는 기존 결과 재현, 변경 인수 재사용은 거절. `expectedRevision`이 구식이면 `conflict` 반환, 덮어쓰기 금지. 서버 재시작 후 operation 복원은 **불가능** (메모리).
- 사용자가 취소하면 새 행동을 시작하지 않도록 AbortSignal 검사. 이미 적용된 서버 자산을 취소할 수 없으므로 존재한 변경을 없던 것으로 보고하지 않는다.

## HTTP·UI
- `POST /api/requests`, `GET /api/requests/:id?roomId=...`는 상태·`verifiedResults`·`planCursor`·확인된 답변 노출. `GET /api/requests/:id/calls?roomId=...`는 최근 최대 100개의 호출 ID·route·status **요약만**.
- `GET /api/rooms/:roomId/assets`는 서버 최신 Skill/Block/Link·revision, `/history`는 완료 대화·확인된 적용 결과. `front/js/workspace/requestBridge.js`는 성공 뒤 asset 재조회, `applyServerAssets`는 로컬 편집이 갈라졌으면 덮어쓰지 않음.
- `OVLL_TEST_TOKEN`이 미설정(기본 `abcd`) 또는 16자 미만이면 **실제 작업실 변경 비활성화**. 16자 이상 `abcd`가 아닌 토큰을 명시 설정한 Beta 시험 환경에서만 허용. 이 공용 토큰으로 다중 사용자 권한이 해결된 것은 아님.
- Render의 실 Gemini 연결, 브라우저 Playwright, PWA/모바일 실동작은 Node fake-model CI 성공과 별도 확인.

## 2026-10-24 실행 예산 및 Output 재시도 보강
- 초기 Hallway 계획은 `terminate`를 제외한 행동 최대 **24개**. 이를 넘는 계획은 어떤 Workshop 호출이나 자산 변경 전에 `ENGINE_BUDGET_EXCEEDED`로 종료한다.
- `callManager`가 요청별 모델 호출 수를 별도로 집계한다. 기본 40회(`policy.maxModelCallsPerRequest`), 요청 A의 호출 소진이 요청 B의 예산을 깎지 않는다. `maxModelCalls`는 동시 슬롯 제한이므로 별도 정책. 호출 실패도 예산 소모로 계산. 미지원 Action Shell 진입은 모델 호출이 아니다.
- `requestRunner.retryOutput(snapshot)`: `terminate`를 포함하는 검증된 계획에서 Output만 실패한 요청은 **같은 requestId**로 새 Output `callId`를 발급하고 Output 호출만 재수행. 기존 Skill/Block `operationId`는 재적용하지 않는다.
- `scheduler.retryOutput`은 실제 Runner 메서드에 연결. `POST /api/requests/:id/retry-output`은 Output 실패 요청에서만 허용. 성공 시 실패 오류 표시는 지우고, 방 history에 남았던 같은 요청의 임시 실패 기록은 완료 기록으로 대체한다.
- 여전히 미구현: 일반 Hallway Return, 다른 10개 행동, 영속/분산 재개, 사용자별 정식 인증, 실제 Gemini·브라우저 검증. 위 항목은 단일 프로세스 Node fake-model 통합 테스트로 확인됨.
