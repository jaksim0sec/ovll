# 요청 처리 아키텍처

상태: 1014 설계 기준. `beta`에서는 Gate → Hallway Initial 직접 응답 **독립 프로토타입만 구현**; Workshop/Hallway Return/Output 실호출은 미구현. 실제 Gemini API 호출 미검증. 기존 `main`은 참조 구현; 구형 내부 데이터 구조·변환 계층 복제 금지.

## 개념·경계
- `Skill`: 목적·입출력·지침을 지닌 재사용 작업 정의. 캔버스 밖에서도 존재.
- `Skill Block` = `Skill Node`: 캔버스에 배치된 Skill 참조 인스턴스(배치·설정·연결 보유). Skill 자체와 구별.
- IR에서 추출한 저장 Function은 Skill과 별도 자산. 자산 생성, 배치, 실행, 참조는 서로 다른 사실.
- `Gate`: 요청 진입, 필요한 추가 자료 식별.
- `Hallway Initial/Return`: 요청 전체 목표에 따른 판단·작업실 계획·재계획.
- `Workshop`: 할당된 `objective` 안에서 행동 선택·실행; 행동별 프롬프트/Function Calling 지향.
- `Output`: 검증된 사실 종합·최종 발화·종결 시점 맥락 확정. 신규 실행 금지.
- **논리 계층 ≠ 매번 독립 LLM 호출.** 호출 수·블록 수를 동일시하지 말 것. 서버가 입력/출력 계약·호출 경계·실행 결과를 책임짐.

## 호출 조립
`prompts/common/concepts.md` + 계층별 고정·얕은 `prompts/base/*` + 필요한 `prompts/blocks/*` + 서버 제공 맥락/계약.
- 공통 블록 5종: `planGeneration`, `informationRequest`, `contextBlockUpdate`, `contextDataUpdate`, `languageGeneration`.
- 별도의 "복도 판단" 또는 "맥락체 활용" 공통 블록 없음. 판단은 복도 베이스 책임; 맥락체는 서버가 입력에 주입.
- 활성화하지 않은 블록의 필드는 모델이 생성/갱신하지 않음. 블록이 작성하는 필드만 정의하고 JSON 조립·검증·서버 적용은 별도 책임.
- 실제 조립 순서 및 분기별 출력: `prompt-composition.md`. 지침 원문·버전: `prompts/` 및 `prompts/manifest.json`.

## 계획
- 복도 `plan` = 순서 있는 **작업실 단위** 단계. 각 단계 `{ workshopName: { objective, need } }`.
- `objective`: 사용자 언어, UI 노출 가능, 결과 중심. 행동 이름·함수 인수·수행 방법을 미리 결정하지 않음.
- `need`: 공통 정보 요청 문법 `[[datasetName, ...parameters], ...]`; 자동 제공 자료 재요청 금지.
- 작업실은 `objective` 범위에서 구체적 행동·기존 자산 재사용 여부를 스스로 판단. 구체 행동 책임은 `workshops.md`.
- 연속된 확정 가능 작업은 하나의 미니 계획으로 묶음; 다음 판단이 실행 결과에 의존하면 그 지점까지만 계획.
- `terminate`: 명시적 완전종결 항목(행동 없는 작업실 아님). 맨 마지막 단계로 계획되면 Output으로 종결.
- 계획이 `terminate` 없이 소진되면 **Hallway Return**. 전제 변경·실패 시에도 필요하면 회귀.
- 작업실마다 복도 호출을 강제하지 않음. 실패 예상 분기를 계획에 억지로 추가하지 않음. 재시도는 새로운 근거가 있을 때만.
- 사용자의 요청 전체가 종결 기준; 미니 계획의 완료 ≠ 전체 목표 완료.

## 요청 흐름
`요청 진입 → Gate(need 조회) → Hallway Initial → (직접 응답·종결 | plan → Workshop* → Hallway Return 또는 terminate → Output)`.
- 순환·조건 분기 구조. 모든 계층이 반드시 직렬로 한 번씩 호출되는 구조 아님.
- 검증된 스킬/스킬블록 변경·실행 결과만 완료 및 사용자 메시지의 근거가 됨.
- 기존 IR·실행기·닫힌 댐/열린 댐 스케줄러의 **기능 의미** 보존 목표. 옛 `GraphPatch/ModelTurn` 매핑을 신규 계약으로 강제하지 않음.
- `execute`: 독립 작업실로 임의 신설 금지. 실제 실행과 종결(언어·맥락체·맥락데이터 갱신)의 세부 연결은 미확정.

## 소유권
- `contextBlock`: 개별 요청의 `intent`·`progress`(모델의 해당 블록 활성 호출만 수정) + 매 호출 서버 제공 `focus`.
- `contextData`: 방/세션 전체의 지속 대화 맥락. 상세: `context.md`.
- 서버: 현재 계층·계획 위치·결과 검증·참조/ID·Revision·실행·저장·최종화 책임. 모델의 주장만으로 성공/상태 변경 금지.
- 요청 상태·세션·전송/DB 경계의 후속 설계: `docs/notes/request-state-sync.md`.
- Workshop 베이스 원문, Function Calling 선언·인수, IR 실행 검증, 호출 묶음 기준·실패 전이 등은 아직 확정되지 않음; 문서/지침 부재를 임의 구현 계약으로 대체하지 말 것.
