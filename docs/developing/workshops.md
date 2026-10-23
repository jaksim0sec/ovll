# Workshop 행동 계약 · 네이티브 Function Calling (Stage 2)

기존 beta JSON Workshop 실행기는 폐기 유지. `actionShell.js`의 12개 이름은 계획 가능한 카탈로그일 뿐, 전부 구현됐다는 뜻이 아니다.

| 작업실 그룹 | 계획 가능 | **실제 실행 지원** |
|---|---|---|
| skillDefine | defineDirect, defineFromIR, revise | **defineDirect** |
| skillEdit | editAppearance, delete | 없음 |
| canvasEdit | addBlock, editBlock, deleteBlock, addLink, removeLink | **addBlock** |
| textGenerate | basicText, question | 없음 |

`terminate`는 엔진 제어 마커, Function Calling 대상 아님.

## 행동별 계약
- `back/js/engine/actionDescriptors.js`: `getActionDescriptor(qualifiedName)`이 지원 2행동의 `promptLayer`, 단 하나의 도구 선언, 인수 검증기를 제공. 미지원 이름은 `null`.
- `skillDefine.defineDirect` → `define_direct`: `name/description/instruction/icon/color/inputs/outputs/fields`를 검증 후 독립 Skill 저장, 서버가 ID 발급. Icon은 현재 렌더러에 존재하는 지원 이름만. 재사용 지침을 저장할 뿐 웹검색/실제 조사 실행 아님.
- `canvasEdit.addBlock` → `add_block`: `skillId/x/y/expanded/values`, **같은 room에 실제 존재하는 Skill**과 필드 제약 검증 후 별도 Block ID 발급. 직전 검증 결과의 실제 skillId를 다음 함수 인수로 전달.
- 도구가 반환한 함수명·인수는 모델 제안. `ActionStore.apply`의 applied 결과만 실제 자산 변경. `operationId`/expected revision으로 멱등성·동시 수정 충돌 방어.
- `callManager.invokeFunction`은 `callId.workshop.group.action`의 새 호출 이력을 남김. 모델은 다음 Workshop을 직접 호출하지 않으며 `requestRunner`가 검증 후 cursor를 넘긴다.
- 지원하지 않는 행동에 도달하면 `enterAction`을 통해 `unsupported_workshop` 표시하며 부분 성공 기록은 보존. `Hallway Return`, IR, Saved Function, textGenerate.question, 기타 10행동 구현하지 않음.

## 실행 모드·자산
- `createBetaRuntime`의 `testToken` 길이 16 이상이면서 `abcd`가 아닐 때만 `actionStore`를 엔진에 주입한다. 기본 `abcd` 환경은 기존 inert Action Shell. **공용 토큰은 정식 인증·권한 분리 수단이 아니다.**
- 실 자산은 `back/js/assets/memoryActionStore.js`에 room별 보관, 재시작 시 휘발. 브라우저의 로컬 provisional Canvas는 별도이며 서버 원본으로 자동 등록하지 않음.
- 서버가 확인한 자산을 프론트로 투영하다 로컬 변경과 충돌하면 사용자의 로컬 편집을 보존한다. 별도의 병합·사용자 승인 UI는 없음.
