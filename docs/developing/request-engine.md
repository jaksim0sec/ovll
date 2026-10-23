# Beta 독립 요청 엔진 — Action Shell 단계
상태: 2026-10-24 Stage 1. 이전 비IR 11행동 실행 구현은 **폐기**했고 이 문서는 현재 동작을 기록한다.

## 런타임
- `request/registry.js`: 방·요청별 큐/진행/완료·미구현 상태 기록. `handoff` 필드 보존.
- `request/scheduler.js`: FIFO, 같은 방 최근 완료 맥락 인계, 실행 실패 진단, HTTP 상태 스냅샷.
- `engine/promptComposer.js`: manifest 순서 기반 조립; 사용자 정보는 context로 별도 전달.
- `engine/dataProvider.js`: need 조회; 대화 이력·요청 원본·초기 참조. 서버에서 조회용 비어 있는 자산 카탈로그를 넣어 `skillList`는 빈 목록으로 조회 가능.
- `engine/engine.js`: 다중 요청 관리형 `createEngine()` Facade. 개별 `requestRunner.js`가 Gate→Hallway Initial→선택된 첫 Action Shell 또는 직접 응답을 수행. 계획 이후 추가 모델 호출 없음.
- `engine/actionShell.js`: 12개 자격 행동 검증 및 `not_implemented` 접수 객체. **실행 함수 없음**.
- `model/gemini.js` & `model/configuredGemini.js`: Gate/Hallway JSON 생성. Gemini 네이티브 Function Calling 사용하지 않음.
- `back/js/server.js`: Render Web Service, 정적 front + API, room 메모리, 읽기 전용 빈 자산 카탈로그.

## 상태
- 직접 답변: `completed`, Hallway Initial에서 생성한 `languageBlock`.
- 행동 계획: `unsupported_workshop` / `currentLayer=actionShell`, `plan`과 `handoff` 반환. `handoff.status=not_implemented`; 실제 스킬/블럭 생성 없음.
- 잘못된 응답 형태/미등록 행동: `ENGINE_OUTPUT_INVALID`; 실작업 요청을 말로만 완료하려 하면 교정 1회 뒤 `WORK_REQUIRED`; 자료 누락은 `DATA_UNAVAILABLE`.
- 모델이 `terminate` 계획을 생성해도 선행 작업의 적용 기록이 없으면 성공으로 전이하지 않는다.
- 세션 `contextData`는 완료된 직접 답변에서만 갱신. 서버 재시작 시 소실됨. 영속 자산이 없고 사용자 인증·IR·Saved Function 실행도 없음.

## API·프론트
- `POST /api/requests`, `GET /api/requests/:id?roomId=...`; 결과 상태에 `handoff`가 포함될 수 있다.
- `GET /api/rooms/:roomId/assets`는 rev 0/빈 자산만 반환. 확인된 새 작업으로 표시하지 않는다.
- 프론트는 Action Shell 도달과 미구현 상태/선택 행동명을 진행 카드에 표시. 완료 답변으로 위조하지 않는다.
- 기존 테스트 전용 `/answer`, `/retry-output` 라우트는 서버에 남아 있으나 실행기에 resume/retryOutput을 제공하지 않으므로 이 단계에서 진행 불가능.
- 테스트: `npm test` (Node 22). 실제 Gemini 모델 응답·Render 브라우저 검증과는 구분.

## 2026-10-24 다중 요청·호출 관리 현행
- 서버는 `createEngine({composer,modelCaller,dataProvider,sessions,policy})` 한 인스턴스를 HTTP에 공급하고 여러 요청을 관리. `submit/getRequest/getCall/listCalls/cancel/whenIdle` 지원. 각 요청은 별도 RequestRecord와 호출 이력을 가진다.
- Scheduler의 요청 동시 슬롯 기본값 3(`policy.maxActiveRequests`). Call Manager의 Gemini 호출 동시 슬롯 기본값 2(`policy.maxModelCalls`). 단일 프로세스 비동기 중첩이며 CPU 병렬·분산 워커 아님.
- `callRegistry.js`: `callId`는 고유, `route`는 Gate/ Hallway Initial/ Workshop 네임스페이스/ Output으로 검증. `path`는 사람이 읽는 파생 문자열; 호출 결과/프롬프트 원문 저장하지 않음.
- `callManager.js`: 호출용 `focus`를 동적으로 첨부하며 시작·종료 결과를 호출 상태에 반영. `requestRunner`는 JSON 결과 구조와 직접 응답/행동 계획을 검증.
- 결과값이 `unsupported_workshop`이면 `planCursor:0`, `handoff.callId`를 반환. 첫 Action Shell의 호출 상태는 `unsupported`, 실제 `verifiedResults` 없음.
- `registry.js`는 revision/CAS 검사가 가능하고 `scheduler.js`는 `cancel`로 queued/active 요청을 중단한다. 취소 후 늦게 도착한 모델 결과로 요청 완료·세션 저장하지 않음. 사용자의 질문 대기 resume 경로는 Scheduler에 남아 있지만 현행 Action Shell에서는 진입하지 않음.
- `GET /api/requests/:id/calls?roomId=...`: 인증된 테스트 토큰과 지정된 roomId 아래 존재하는 요청의 최근 100개 Call 요약(`callId,path,route,status`만) 반환; 미등록 요청은 404. 사용자별 접근권한 체계는 미구현.
- 아직 없는 것: 작업실 전용 호출/도구 스키마, Gemini 네이티브 Function Calling, 실제 스킬·스킬블럭 변경, operationId, 결과에 따른 다음 plan 단계, Hallway Return/Output 종결, DB/분산 큐/SSE.
