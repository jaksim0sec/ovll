# Beta 요청 처리 아키텍처 — 행동별 계획과 Action Shell
상태: 2026-10-24 Stage 1. **실제 행동 실행 없음**. 기존 비IR Workshop 엔진은 폐기.

## 모델과 계층
- Skill은 재사용 가능한 작업 정의. Skill Block(스킬블럭)은 Canvas에 배치한 해당 Skill 인스턴스. 저장 Function과 구분한다.
- Gate: 사용자 요청, 기존 방 맥락, 제공 자료를 보고 필요한 `need`만 요청한다.
- Hallway Initial: 직접 대답할지 행동 계획을 만들지 판단한다. **계획의 선택 단위는 작업실 범주가 아니라 구체적인 행동**이다.
- Action Shell: 선택한 첫 행동과 목표·데이터 요청을 검증하고 **진입 기록만 만든다**. 행동 전용 프롬프트 생성·모델 호출·Function Calling·데이터 변경은 없음.
- Hallway Return / Output: 향후 행동 실행이 가능해졌을 때 연결할 계층. 현재 계획 분기로는 도달하지 않는다. 즉시 답변은 Hallway Initial에서 종료한다.

## 계획 계약
```json
{"plan":[
  {"skillDefine.defineDirect":{"objective":"식물 조사 Skill 정의","need":[]}},
  {"canvasEdit.addBlock":{"objective":"Skill Block 배치","need":[]}},
  {"terminate":{"objective":"실제 결과 보고","need":[]}}
],"contextBlock":{"intent":"식물 조사 스킬블럭 만들기","progress":"계획"}}
```
- 각 계획 항목: 정확한 행동 키 1개, `objective` 문자열, `need` 배열. 인수는 계획에서 생성하지 않는다.
- 행동 범주: `skillDefine`(defineDirect, defineFromIR, revise), `skillEdit`(editAppearance, delete), `canvasEdit`(addBlock, editBlock, deleteBlock, addLink, removeLink), `textGenerate`(basicText, question). 총 12개 선택 가능. 모두 **껍데기만** 존재한다.
- `terminate`는 실제 행동이 아니며 마지막 단계에서만 사용. 현재 단계에서는 선행 행동 실행 없이 `terminate`만 하는 계획을 성공 처리하지 않는다.
- `planGeneration`에 행동 목록을 제공하며 Action Shell은 첫 선택 행동의 네임스페이스와 목표를 받는다. 이후 행동은 실행되지 않는다.

## 부작용·상태 및 보존
- 서버는 `unsupported_workshop` 상태와 `currentLayer:'actionShell'`을 반환한다. `handoff`의 `status:'not_implemented'`는 라우팅 기록일 뿐 성공 아님.
- Workshop 실행기·메모리 자산 변경·체크포인트 경로는 제거. 서버 자산 API는 **읽기 전용 빈 목록**으로 대체하며 재시작 후 과거 임시 자산의 복원은 불가능하다. 새로운 자산을 만들지 않는다.
- 방별 메모리 세션의 성공한 직접 대화 맥락과 실패 기록, 다중 요청 FIFO 스케줄러(기본 활성 요청 3, 모델 호출 2), HTTP 폴링은 유지. 정식 인증·DB 영속화·파일 업로드·IR/함수 실행 없음.
- 요청 원문, 계획, 확인된 실제 결과를 구분한다. 향후 행동별 프롬프트와 함수 호출을 구현하기 전까지 결과를 임의 확정하지 않는다.

## 실제 실행/호출 소유권 (Stage 1)
- `createEngine()`이 요청 접수·상태 조회·취소·호출 목록과 스케줄러를 통합하는 서버 측 Facade. 엔진 전체를 한 요청의 `run(snapshot)`과 동일시하지 않는다.
- `requestRunner.js`는 개별 요청의 Gate/Hallway 처리기, `callManager.js`는 모든 요청의 호출 기록·임시 focus·모델 호출 수 제한을 관리, `callRegistry.js`는 고유 호출 ID/경로·결과 상태를 메모리에 저장.
- `callId.workshop.skillDefine.defineDirect`는 표시용 파생 경로. 실제 호출 소속은 `{roomId,requestId,callId,route}`의 구조화 데이터로 검사한다. `operationId`는 추후 실제 부작용에서 별개로 관리할 식별자이며 현재 없음.
- 전역 작업 큐와 요청 수명은 Engine 소유, Gemini 전송은 모델 어댑터, 스킬/캔버스 적용은 추후 액션 포트 소유. 요청 상태·호출 상태·자산 적용 결과를 혼동하지 않는다.
