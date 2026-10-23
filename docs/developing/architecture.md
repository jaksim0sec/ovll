# Beta 요청 처리 아키텍처 — 행동별 계획과 Action Shell
상태: 2026-10-23 현행. **실제 행동 실행 없음**. 기존 비IR Workshop 엔진은 폐기.

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
- 방별 메모리 세션의 성공한 직접 대화 맥락과 실패 기록, FIFO 스케줄러, HTTP 폴링은 유지. 정식 인증·DB 영속화·파일 업로드·IR/함수 실행 없음.
- 요청 원문, 계획, 확인된 실제 결과를 구분한다. 향후 행동별 프롬프트와 함수 호출을 구현하기 전까지 결과를 임의 확정하지 않는다.
