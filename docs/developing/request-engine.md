# 독립 요청 엔진 — beta 최초 실행 범위
상태: 2026-10-23 구현 사실. 실서버/API/배포가 아니라 Node 프로세스 내부 프로토타입.

## 컴포넌트와 실행
- `back/js/request/registry.js`: `createRequestRegistry({createId?})` → `register({roomId,request,contextData,initialResources?})`, `get(roomId,requestId)`, `transition(roomId,requestId,changes)`. 메모리에 요청별 상태를 기록하고 외부에는 복제된 스냅샷을 반환한다.
- `back/js/request/scheduler.js`: `createRequestScheduler({registry,execute,maxConcurrent=1})` → `enqueue(input)`, `get(roomId,requestId)`, `whenIdle()`. FIFO, 기본 동시 실행 1개. 실패해도 다음 요청을 실행하며 실패 내용은 코드별 안전한 메시지만 기록한다.
- `back/js/engine/promptComposer.js`: `createPromptComposer({promptsRoot?})` → `compose(layer,bindings)`. `prompts/manifest.json` 순서를 기준으로 지침을 읽는다. 사용자 원문과 자료는 프롬프트 문자열에 끼워 넣지 않고 모델 호출의 별도 `context`로 보낸다. 지원 manifest 레이어: gate/hallwayInitial/hallwayReturn/output; 최초 런타임에서 앞의 둘만 실행.
- `back/js/engine/dataProvider.js`: `createMemoryDataProvider({fixtures?})` → `resolveNeed({roomId,requestId,need,availableResources,request,contextData})`. `need`는 기존 originalReq/chatContext/skillDef/canvasSkill/skillList 문법을 사용하며, 이미 있는 완전 자료를 재조회하지 않고 메타데이터만 있는 자료는 정의 완료로 보지 않는다. 부족한 자료를 `missing`으로 되돌린다.
- `back/js/engine/engine.js`: `createRequestEngine({composer,modelCaller,dataProvider})` → `run(requestSnapshot,{onStage?})`. Gate JSON `{need:[...]}` 검증 후 자료 조회, Hallway Initial 직접 응답 `{languageBlock,contextBlock,contextData}`만 `completed`. 계획 분기는 `{plan,contextBlock}`로 검증해 `unsupported_workshop`에 남긴다. **Output 추가 호출 없음.**
- `back/js/model/gemini.js`: `createGeminiCaller({apiKey,model,fetchImpl?})`의 `generate({layer,prompt,context,format:'json',signal?})`가 `{jsonText}` 반환. 모델/인증/REST 형식은 호출기만 알고 엔진은 공급자별 타입을 import하지 않는다. 이 단계에서는 동일한 한 모델로 모든 호출을 실행한다.
- `front/js/workspace/requestInput.js`: `prepareRequestInput({draft,dataAccess})` → `{request,initialResources}`. 직접 첨부한 Skill/Skill Block만 읽으며 Block이면 해당 배치 인스턴스와 참조 Skill 메타데이터를 처음부터 전달한다. 연결된 전체 Canvas는 수집하지 않는다. 프론트의 정적 Skill 카탈로그는 **표시용 메타데이터**이며 실행 지침이 아님. 파일 Blob은 전달하지 않는다. 아직 `boot.js`의 전송 콜백과 연결하지 않았다.

## 요청 상태
`queued → running → completed | unsupported_workshop | failed`.
- Registry는 roomId와 requestId로 조회한다. 대기 중/완료 상태와 등록소 보관 수명은 별개다.
- 각 AI 모델 호출의 응답·프롬프트는 요청 등록소 공개 스냅샷과 분리된다.
- 직접 응답이 완료된 경우에만 서버 확정 결과로 취급한다. 실제 Workshop 행동은 실행하지 않는다.
- contextData는 요청이 시작할 때의 사본이다. 이 프로토타입은 세션 원본을 DB에 병합하거나 다중 요청의 세션 갱신을 확정하지 않는다.

## 검증
```bash
node --test tests/backend/*.test.mjs
GEMINI_API_KEY='...' GEMINI_MODEL='your-supported-gemini-model' node back/js/demo.js
```
자격증명은 서버 환경변수로만 공급하며 프론트로 전달하거나 저장소에 기록하지 않는다. 실제 Gemini 키/모델이 없다면 모델 실호출은 **미검증**이다. `back/js/demo.js`는 하나의 가상 구조화 요청을 등록해 실행하는 CLI이고, 모의 모델 성공을 출력하지 않는다.

## 아직 없는 기능
프론트 전송 API/HTTP/SSE, 서버 인증, DB 영속 저장·재시작 복구·중단, 실물 파일 업로드, 사용자별 요청 접근 제어, Workshop 실행·Function Calling·IR, Hallway Return 실호출, Output 실호출, 서버 확정 Canvas 원본 관리. 프로토타입의 자료 완전성 표기는 인증이나 악의적 입력에 대한 신뢰 검증을 대신하지 않는다.
