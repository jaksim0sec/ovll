# 프롬프트 조립 계약 · Stage 2

## 활성 호출별 manifest 조립
- Gate: `common/concepts → base/gate → common/json → blocks/informationRequest`
- Hallway Initial: `common/concepts → base/hallwayInitial → common/json → blocks/languageGeneration → blocks/planGeneration → blocks/contextBlockUpdate → blocks/contextDataUpdate`
- Hallway Return: 프롬프트 파일만 존재. **실행 복귀 미구현**
- Output: `common/concepts → base/output → common/json → blocks/languageGeneration → blocks/contextBlockUpdate → blocks/contextDataUpdate`; 실제 검증된 행동 결과를 모두 포함한 `terminate` 계획 후 호출.
- `workshop.skillDefine.defineDirect`: `common/concepts → base/skillDefine → blocks/defineDirect`
- `workshop.canvasEdit.addBlock`: `common/concepts → base/canvasEdit → blocks/addBlock`

## 의미/범위
- Hallway `planGeneration`은 정확한 행동 선택 및 `objective`, `need`만 출력. 툴 인수는 다음 Workshop 함수 제안에서 만들며 Hallway가 자산 ID를 꾸며낼 수 없음.
- `getActionDescriptor`는 선택된 행동 **한 개의** Gemini FunctionDeclaration만 제공. Gate/Hallway/Output은 이전처럼 JSON 텍스트 반환을 사용. Action은 응답 functionCall을 서버 인수 검증에 전달.
- 작업실별 공통·전용 프롬프트 파일만 조립, 다른 행동의 instruction을 한꺼번에 넣지 않음. `CallManager`는 요청의 맥락체를 복사해 이번 호출에만 `focus`를 추가, 원본에 누적 저장 안 함.
- 지원 행동: `skillDefine.defineDirect`, `canvasEdit.addBlock`; 10개 미지원 행동은 Action Shell로 종료. 한 저장 Skill과 배치된 Block은 별개이며 Skill 저장을 실제 사용자 조사의 완료라고 서술하지 말 것.
- 기존 폐기 `base/workshop.md`, `blocks/workshopActions.md`, 단일 JSON 행동 실행 프롬프트는 다시 만들지 않는다.

## Gemini REST 도구 스키마 확인 (2026-10-24)
- 고정 필드인 `define_direct`는 `FunctionDeclaration.parameters`(OpenAPI Schema)를 사용. 동적 필드별 문자열 값이 들어가는 `add_block.values`는 `parametersJsonSchema`(JSON Schema의 `additionalProperties:{type:'string'}`)를 사용한다. Google API에서 둘은 상호 배타적인 필드이며 어댑터는 둘 중 하나만 전송한다.
- `toolConfig.functionCallingConfig={mode:'ANY',allowedFunctionNames:[selectedToolName]}`와 함수 선언 1개로 제한. REST fake-transport 검증을 통과했으나 실 Gemini 연결 성공의 증거는 아니다.
