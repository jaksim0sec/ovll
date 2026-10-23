# Beta 요청 처리 아키텍처 · Stage 2

상태: 2026-10-24. 구 Beta JSON Workshop 실행기는 폐기 유지. 정확히 **2개 행동만 실행**하고 나머지는 Action Shell에서 미지원 종료한다.

## 수명·제어권
- `createEngine()`: 다중 요청 접수·큐·취소·상태. `scheduler`의 기본 동시 요청 3, `callManager`의 기본 Gemini 모델 호출 2. 여러 요청의 상태와 호출 ID 독립.
- `requestRunner.run()`: Gate need 조회 → Hallway Initial의 직접 답변 또는 행동별 plan → 승인된 행동 순서대로 실행 → `terminate`이면 Output. 행동 간 전이는 서버가 결정하며 Workshop은 다른 Workshop을 호출하지 않는다.
- `callManager`: 호출마다 `callId`와 `callId.workshop.group.action`의 표시 경로, 일시적 `contextBlock.focus`; 모델 호출 어댑터에 정확히 선택한 작업실 함수 하나만 전달. `contextBlock.intent/progress`는 요청 수명, `contextData`는 room 수명.
- `actionDescriptors.js`: `skillDefine.defineDirect`, `canvasEdit.addBlock` 전용 선언·인수 검증. 그 밖에 plan에 이름을 쓸 수 있어도 실제 실행 불가.
- `memoryActionStore`: room별 서버 Skill과 Block, revision, operationId 멱등성. 모델 함수 호출/제안과 실제 `applied`를 구분한다.

## 실제 실행 흐름
```text
Gate → Hallway Initial
           ├─ 직접 언어 답변 → completed
           └─ plan: defineDirect → addBlock → terminate
                      │                  │
               Gemini 단일 함수 제안  Gemini 단일 함수 제안
                      ↓                  ↓
               인수 검증·op 준비    이전 단계의 실제 skillId 사용
                      ↓                  ↓
               서버 Skill 저장     서버 Skill Block 저장
                      └── verifiedResults / cursor ──→ Output → completed
```
- `terminate`는 엔진 제어 표식, Gemini 도구가 아니다. 정의 저장과 리서치 실행은 다르며 Output에서 실제 실행 여부를 구분한다.
- 적용 이전에 `pendingOperation`을 요청에 기록, 적용 이후에 `verifiedResults`와 `planCursor`를 기록. Output 실패 시 적용 결과는 보존, 뒤 행동이 미구현이면 앞서 적용한 결과만 보존하며 전체 성공을 주장하지 않는다.
- `actionStore`가 제공되지 않으면 예전 Action Shell 미지원 동작을 유지한다. Beta 런타임은 테스트용 토큰이 **16자 이상이며 `abcd`가 아닐 때에만** 이 포트를 엔진에 주입한다. 이 길이 검사는 정식 사용자 인증/토큰 엔트로피 검증이 아니다.

## 외부 원본·검증 한계
- `back/js/runtime.js`에서 한 서버 자산 저장소를 `dataProvider`, Engine, HTTP 조회에 공유. `GET /api/rooms/:roomId/assets`는 같은 저장소의 확정 Skill/Block/Link와 revision을 반환.
- 프론트 `workspace.applyServerAssets`는 검증된 스냅샷을 수용하되 **로컬의 별도 변경이 있으면 덮어쓰지 않는다**. 로컬 편집을 자동 서버 원본으로 등록/실행하지 않는다.
- 모든 저장소·요청·호출 이력은 단일 프로세스 메모리. 서버 재시작 후 복구, DB·다중 워커, 사용자별 인증, Gemini Interactions API, 실제 Skill의 외부 조사·실행, IR, 기타 행동, Hallway Return 재계획·질문은 미구현.
- Node CI의 fake Gemini 테스트는 성공했지만 실제 Gemini API·Render 브라우저·Android 실기기 검증을 대신하지 않는다.

## 모델/클라이언트 소유권 경계 (2026-10-24 검증)
- `actionDescriptors.js`는 Gemini 필드 이름을 모르고 `tool.inputSchema`를 작성한다. `model/gemini.js`만 이를 `FunctionDeclaration.parametersJsonSchema`로 옮긴다. 모델 호출 결과는 서버가 검증/적용하기 전까지 후보일 뿐.
- 프론트 로컬 그래프와 서버 임시 자산은 아직 서로 다른 상태 원본이다. 확인된 결과와 실제 화면 반영을 구분한다. 병합 정책을 **미확정**으로 남기고 사용자의 로컬 편집을 덮어쓰지 않는다.
