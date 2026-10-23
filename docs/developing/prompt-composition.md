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

## 모델 중립 행동 선언 및 공급자 변환 (2026-10-24)
- `engine/actionDescriptors.js`는 `{name,description,inputSchema}`의 **모델 중립 도구 명세**를 보유한다. 고정 입력과 동적 Block values 모두 JSON Schema를 사용하며 엔진 코드에 Gemini의 `parameters`/`parametersJsonSchema` 필드를 넣지 않는다.
- `model/gemini.js`가 `tool.inputSchema`를 `FunctionDeclaration.parametersJsonSchema`로 변환해 REST 전송. 과거 모델 포트 호출 형태는 임시 호환으로 지원하되 신규 엔진 작업실 명세에서는 사용하지 않는다. `ANY`, `allowedFunctionNames:[selectedToolName]`, 선언 1개 규칙 유지.
- Google API 전송 형식과 내부 도메인 유효성 검사는 별개. 응답 도구명·함수 개수 확인 뒤에도 서버의 `validateArgs`와 ActionStore 적용 검증이 필요하다. 실 Gemini REST 요청 성공은 CI fake-provider 시험과 별도.
