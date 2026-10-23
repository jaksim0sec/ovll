# 작업실 분류 및 행동 껍데기 계약
상태: 2026-10-23, 구 Beta 비IR Workshop 실행기 **폐기**. 신규 작업실 구현 완료가 아님.

## 개념
작업실 그룹은 행동을 분류하는 네임스페이스로 남는다. `planGeneration`은 작업실만 지정하는 대신 **정확한 행동 이름**을 계획한다. 선택된 행동의 목표·need만 Action Shell로 전달된다.

| 그룹 | 계획 가능한 행동 |
|---|---|
| skillDefine | defineDirect, defineFromIR, revise |
| skillEdit | editAppearance, delete |
| canvasEdit | addBlock, editBlock, deleteBlock, addLink, removeLink |
| textGenerate | basicText, question |

`terminate`는 계획 종료 제어 표식이며 실행 가능한 행동이 아니다. `defineFromIR`도 계획 표기만 인정하며 IR·Saved Function 생성 코드는 없다.

## 현재 구현 범위
- `back/js/engine/actionShell.js`: 정적 행동 목록과 `accepts`, `enter` 검증. `enter`는 `{action,workshop,objective,need,status:'not_implemented'}`만 반환.
- `back/js/engine/engine.js`: Gate need 조회→Hallway Initial 행동별 계획→첫 단계의 자료 확인→Action Shell에 진입. 초기 Hallway 직접 발화는 그대로 완료할 수 있음.
- **미구현**: 개별 행동 프롬프트, 실행 인수 구성, Gemini 네이티브 Function Calling, 행동 효과 적용·수정·저장, 재계획, 작업 완료 판정, 질문 답변 연계.
- 서버는 행동 성공을 주장하지 않는다. 상태 `unsupported_workshop`은 API 호환 상태명이며 의미는 'Action Shell 도달·실행 미구현'이다.
- 이전 `workshop.js`의 JSON 선택→검증→메모리 `apply` 루프와 임시 자산·체크포인트는 삭제됐다.

## 2026-10-24 호출 ID를 가진 첫 Action Shell
- `requestRunner.js`에서 Hallway plan의 첫 `skillDefine.defineDirect`를 선택하면 `callManager.enterAction`이 `callRegistry.register({route:{layer:'workshop',workshop:'skillDefine',action:'defineDirect'}})`로 별도 `callId`를 부여한다.
- Call은 `unsupported` 상태로 끝나며 요청은 `unsupported_workshop` 상태. `handoff.callId`와 `planCursor:0`을 공개하고 실제 Skill/Canvas 변경은 없다. 두 번째 행동은 실행되지 않는다.
- 기존 문서의 `back/js/engine/engine.js`가 직접 작업실에 진입한다는 표현은 개념적 흐름이다. 실제 호출은 `engine.js` Facade → `requestRunner.js` → `callManager.js` → `actionShell.js` 순서이다.
