# Prompt composition — 현재 구현과 다음 연결점
상태: 2026-10-23 Action Shell 재구성.

## 호출별 조립
- Gate: `common/concepts → base/gate → common/json → blocks/informationRequest`.
- Hallway Initial: `common/concepts → base/hallwayInitial → common/json → blocks/languageGeneration → blocks/planGeneration → blocks/contextBlockUpdate → blocks/contextDataUpdate`.
- Hallway Return: `common/concepts → base/hallwayReturn → common/json → blocks/planGeneration → blocks/contextBlockUpdate` (**프롬프트 보존, 실행 경로 연결 전**).
- Output: `common/concepts → base/output → common/json → blocks/languageGeneration → blocks/contextBlockUpdate → blocks/contextDataUpdate` (**프롬프트 보존, 계획 분기에서 호출하지 않음**).

## 변경된 PlanGeneration
- 계획 키는 `skillDefine.defineDirect`처럼 **작업실 분류 + 행동 이름** 형식이다. 작업실 분류 단독을 출력하면 검증 오류.
- `objective`와 `need`만 포함하고 구체적 행동 인수/도구 스키마는 없음. 필요한 행동의 목적과 순서는 복도가 결정한다.
- 직접 응답은 `languageBlock,contextBlock,contextData`; 행동 계획은 `plan,contextBlock`만 반환. 다른 분기의 필드를 혼합할 수 없음.
- 선택하지 않은 행동들의 전문 지침을 일괄 주입하지 않는다. 기존 `base/workshop.md`와 `blocks/workshopActions.md` 및 `manifest.layers.workshop` 제거.

## Action Shell과 미구현
- Action Shell은 현재 **프롬프트를 조립하거나 모델을 호출하지 않는다**. 계획의 첫 행동과 목표·need를 받아 미구현 handoff를 되돌린다.
- 다음 구현 시 선택된 행동에 필요한 베이스·전용 프롬프트·네이티브 Function Calling 도구만 조립하는 구조를 연결할 예정이며, 인수/도구/실행/재계획 계약은 아직 미확정.
- `prompts/manifest.json`이 현재 활성 레이어의 정확한 파일 및 순서를 소유한다. 런타임 컨텍스트는 모델 호출 시 별도로 전달한다.
