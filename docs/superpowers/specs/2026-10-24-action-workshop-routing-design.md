# Ovll — 행동 기반 작업실 라우팅 및 맥락 전달 설계

> **상태: Superpowers 설계 검토안 (2026-10-24). 실행 구현 승인 전.**
> 대상: `beta`만. `main` 수정·병합·배포 금지.
> 이 문서에 등장하는 `ActionRunner`, `actions.apply` 등의 API는 **제안 계약**이다. 현재 실행되는 코드라고 해석하지 않는다.

## 1. 근거와 변동 사항

### 2026-10-12~16 초기 논의에서 유지할 원칙
1. 대문(Gate)은 `need`만 판단, 복도(Hallway)는 직접 응답 또는 순서 있는 계획 판단, 작업실(Workshop)은 할당된 목표를 수행, 출구(Output)는 검증된 결과로만 종결한다.
2. `requests[roomId][requestId]`에 해당하는 **요청처리객체**는 요청 수명 전체를 보유하고, **호출처리객체**는 매 모델 호출에 필요한 프롬프트·입력·응답·진단을 일시 보유한다. 매 호출 프롬프트 원문을 지속 요청 상태에 무조건 복제하지 않는다.
3. `contextBlock.intent/progress`는 **요청 전체에 하나**, `contextData.overallFlow/currentTopic/details`는 **방 전체에 하나**. `focus`는 서버가 **현재 호출마다 새로 계산**하며 영속 `contextBlock` 필드가 아니다. 작업실별 독립 영속 맥락체를 만들지 않는다.
4. 계층 전환, 계획 위치, 다음 작업실 선택, 실패·대기·종결은 **서버 실행 루프**의 결정이다. 작업실이나 모델이 다음 작업실을 직접 호출하거나 완료를 선언하지 않는다.
5. 모델의 행동 선택/도구 반환과 **실제 적용 성공**은 다르다. 서버 검증된 행동 기록·산출물·버전만 다음 단계의 근거다.
6. 계층 프롬프트는 공통 지침·필요한 조립 블록·동적 컨텍스트로 구성한다. 선택하지 않은 행동의 지침까지 로드하지 않는다.
7. 요청/호출 수명과 프론트 통신·DB 소유권을 구분해, 저장소 교체 때문에 엔진 로직을 다시 설계하지 않는다.

근거: `docs/notes/request-state-sync.md`의 0~3, 10, 13절, `docs/developing/context.md`, 2026-10-23 독립 엔진/Workshop Superpowers 설계 기록.

### 2026-10-23 사용자 결정으로 바뀐 규칙
과거의 `{skillDefine:{objective,need}}`처럼 **작업실만 선택하는 계획** 대신, 복도가 `{'skillDefine.defineDirect':{objective,need}}`처럼 **행동까지 선택하는 계획**을 출력한다. 작업실 분류는 행동의 네임스페이스와 전용 프롬프트/도구 소유자로 유지한다. **행동 인수**는 복도가 작성하지 않는다.

이 차이만 의도적 변경이다. 요청별 맥락체와 방별 맥락데이터, 서버 소유 라우팅·검증·회귀 규칙은 유지한다.

### 현재 beta의 사실
현재 `back/js/engine/engine.js`는 Gate → Hallway Initial → 첫 행동 `actionShell.enter()`에서 멈춘다. `actionShell.js`는 행동 이름과 objective/need를 확인하고 `status:not_implemented`를 돌려준다. 과거 Beta의 `workshop.js`·메모리 행동 실행기는 삭제됐다. `hallwayReturn`/ `output` 프롬프트는 남아 있지만 계획 실행 경로에서는 호출되지 않는다. 이 문서의 다음 구조는 **미래 구현 목표**이고 이번 문서 작성으로 활성화되지 않는다.

## 2. 목표 · 범위 · 제외

**목표:** 최초 복도가 생성한 행동별 계획을 서버가 한 단계씩 안전하게 소비하고, 각 행동에 동일 요청의 최신 맥락체와 정확한 현재 `focus` 및 이전 검증 결과를 제공하며, 결과에 따라 다음 행동·복도 회귀·질문 대기·Output으로 제어권을 이동하는 책임 계약을 결정한다.

**범위:** 소유권, 요청/호출 객체, Action Shell과 실행기의 관계, 프롬프트 선택, `need`·결과 전달, 전이표, 실패/중복 방지, 이후 구현 파일 경계, 수용 기준.

**제외:** 지금 바로 행동 기능 구현, 실제 Gemini 도구 선언/인수 스키마 확정, IR/저장 Function 실행, DB 테이블 생성, 새로운 UI/화면, SSE/API 규격 변경, 모델 추가, `main` 변경.

**금지:** 작업실끼리 직접 호출, 작업실별 `contextBlock` 복제, Action Shell 도달을 성공으로 표시, 모델이 작성한 ID/결과를 서버 확정으로 승격, 한 번 적용한 행동을 Output 오류 때문에 재실행, 모든 행동 프롬프트 한 번에 주입.

## 3. 검토한 세 방식

| 방식 | 장점 | 결함 | 판정 |
|---|---|---|---|
| A. 각 Workshop이 다음 Workshop을 직접 호출 | 코드 처음 작성은 쉬움 | cursor·상태·복구/맥락 소유권 분산, 재귀·중복 실행 | 제외 |
| **B. 서버 오케스트레이터 + Stateless Action Runner** | 요청/계획 소유권 단일화, 행동별 지침 로딩, 저장소 교체 용이 | 서버 실행 루프와 결과 계약을 엄격히 설계해야 함 | **채택 제안** |
| C. 행동별 독립 요청/메모리 에이전트 | 큰 복합 작업에는 자율성 | 같은 요청의 맥락·원본 참조 및 결과 정합성 붕괴, 토큰 낭비 | 제외 |

B는 10/16의 요청처리객체·호출처리객체 분리와 10/23 행동 단위 계획을 동시에 만족하는 유일한 작은 변화다.

## 4. 논리 구조

```text
사용자 / 외부 근원지
       │
       ▼
Request Registry (roomId + requestId)
       │  request state / contextBlock / plan / cursor / verified results
       ▼
Engine / Orchestrator ──▶ Gate → resource need 해결
       │
       ├──▶ Hallway Initial ──▶ direct answer → 완료
       │                  └──▶ action plan → validate/save
       ▼
plan[cursor] 선택: skillDefine.defineDirect 등
       │
       ├── resource.resolve(need) + 권한/버전 확인
       ▼
Action Shell (행동명 등록·검증·네임스페이스 매핑)
       │
       ▼
Call Factory → prompt.compose(선택된 행동) + 매번 새로운 focus
       │
       ▼
Action Runner / provider tool-call adapter
       │  행동 인수 후보 (아직 실행 결과 아님)
       ▼
서버 인수/자산/revision 검사
       │
       ▼
operation 준비 체크포인트 → actions.apply → 결과 확정
       │
       ├── 성공 → verifiedResults 보존, cursor++
       │               └── 다음 계획 행동으로 (focus 재구성)
       ├── 중간 발화 → 확정 메시지 기록, 다음 단계
       ├── 질문 → awaiting_input / 같은 requestId에서 재개
       ├── 실패/충돌/예상 밖 결과 → Hallway Return (재계획)
       └── 계획 소진
               ├── terminate 있었음 + 검증 완료 → Output
               └── terminate 없거나 미달성 → Hallway Return
```

중요: 그림의 Action Runner 이하 전부 **향후 구현**이다. 초기 구현은 현재의 Action Shell 경계를 유지한다.

## 5. 영속/일시 상태와 소유권

### 5.1 요청처리객체 (엔진이 소유, 요청당 하나)

설계용 JS 타입. 필드명은 이번 **제안**이며 기존 beta 공개 API와 동일하다고 주장하지 않는다.

```js
RequestState = {
  roomId: string,
  requestId: string,
  userRequest: StructuredRequest,
  status: 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'unsupported_workshop',
  currentLayer: 'gate' | 'hallwayInitial' | 'action' | 'hallwayReturn' | 'output',
  contextBlock: { intent: string, progress: string },
  contextDataRevision: number,
  plan: Array<{ [qualifiedAction: string]: { objective: string, need: Need[] } }>,
  planCursor: number,
  verifiedResults: VerifiedActionResult[],
  pendingOperation?: { operationId: string, action: string, args: object, expectedRevision: number },
  waiting?: { waitingId: string, question: string, planCursor: number },
  checkpointRevision: number
}
```

`plan`은 Hallway만 교체, `planCursor`는 서버만 증가/초기화한다. Output 완료 전에 contextData를 성공 확정하지 않는다. 인증 정보·모델 원문 프롬프트·토큰/키를 이 객체의 공개 직렬화에 포함하지 않는다.

### 5.2 호출처리객체 (매 호출 생성·폐기)

```js
CallInput = {
  requestId: string,
  layer: 'gate' | 'hallwayInitial' | 'action' | 'hallwayReturn' | 'output',
  action?: string,
  objective?: string,
  contextBlock: { intent: string, progress: string, focus: string },
  contextData: SessionSnapshot,
  resources: ResourceSnapshot[],
  verifiedResults: VerifiedActionResult[],
  prompt: string,
  toolDefinitions?: ToolDefinition[]
}
```

이 객체는 저장할 영속 맥락체가 아니라 해당 호출의 **읽기 전용 투영**. 모델 결과/진단이 생기면 필요 결과만 별도 실행 기록으로 남긴다.

### 5.3 맥락을 다음 행동에 넘기는 규칙

- `intent`: 최초 요청의 전체 목적. 다음 행동으로 갈 때 그대로 유지.
- `progress`: Hallway Initial/Return 및 Output의 해당 **맥락체 갱신 블록**이 작성. 작업실이 매번 다시 쓰지 않는다.
- `focus`: 서버가 `현재 행동 + objective + 직전 검증 결과 요약 + 다음에 필요한 참조`로 호출 시점에 합성. 저장된 `contextBlock`에 누적하지 않는다.
- `contextData`: 방/세션 소유. 실행 중에는 확인된 revision의 읽기 스냅샷으로 참조하고 Output/직접 응답 최종화에서 충돌을 검증해 갱신.
- `verifiedResults`: 별도 검증된 실행 원본. 결과 ID·revision·출처가 포함되며 매 단계의 자료 조회와 `focus`가 참조. 텍스트로 원본을 `progress`에 복사하지 않는다.
- `need`: 현재 단계의 자료 선택자. 실행기가 요청한 시점에 `resources.resolve`로 다시 확인하며 완전성(`complete/metadata/missing`)과 버전을 보존.

**작업실마다 별도 맥락체를 만드는 게 아니다. 동일 요청 맥락체에 각 호출의 초점만 바뀐다.**

## 6. 작업실을 코드로 구조화하는 계약

작업실 = 스스로 다음 작업실을 부르는 AI 객체가 아니다. **등록된 행동의 네임스페이스, 지침, 도구/검증 계약의 모음**이다.

```js
ActionDescriptor = {
  name: 'skillDefine.defineDirect',
  workshop: 'skillDefine',
  promptParts: string[],         // 선택 행동 지침의 정해진 조립 순서
  toolId: string,                // 공급자 중립 도구 ID (추후 확정)
  validateArgs: (args, snapshot) => ValidationResult,
  postcondition: (outcome, snapshot) => ValidationResult
}
```

현재 `actionShell.js`의 정적 `actionCatalog`, `actionNames`, `accepts()`, `enter()`를 등록부의 출발점으로 재사용하되, **지금은 `enter()`가 미구현 접수 객체만 반환하는 상태를 유지**한다. 추후 `ActionRunner`에 선택된 descriptor와 컨텍스트를 전달한다.

`planGeneration`이 허용받는 것은 행동명·목표·need. 모델은 `defineDirect`의 구체 Skill JSON, `addBlock`의 실존 Skill ID 같은 인수를 **그 행동 호출에서만** 만든다. 서버는 모델이 다른 행동으로 도구 호출을 바꾸면 해당 invocation을 거절한다. 변경 필요 시 Hallway Return으로 되돌린다.

### 지침 선택

```text
shared concepts + action/workshop base (해당 그룹)
              + selected action instruction ONLY
              + JSON/tool contract
              + dynamic CallInput (objective, need 결과, focus, 검증 결과)
              → provider adapter
```

현재 `prompts/manifest.json`은 Gate/Hallway/Output 조립만 가짐. 행동 베이스, 전용 파일 경로와 Gemini 도구 선언은 다음 단계에서 확정하고 추가한다. 선택되지 않은 행동 프롬프트의 일괄 로딩 금지. 실제 Function Calling은 이 시점의 구현 사실이 아니다.

## 7. 서버의 이동/종결 판단

| 시작 상태 / 사건 | 서버 행동 | 다음 위치 |
|---|---|---|
| Gate need 확인 | 자료 조회 후 Hallway 실행 | Hallway Initial |
| Hallway 직접 답변 검증 | 방 맥락 revision 확인·확정 | completed (Output 중복 없음) |
| Hallway 행동 계획 | 키·objective·need·순서 검증, 계획 저장 | 첫 Action |
| Action 성공·postcondition 확인 | 원자적 적용·verifiedResults 저장 후 cursor 증가 | 다음 Action / 계획 끝 |
| Action 실패·revision conflict | 적용 여부/오류 기록, 임의 재실행 금지 | Hallway Return |
| Action 질문 `textGenerate.question` | waitingId 발급 및 기록, 실행 슬롯 반납 | awaiting_input |
| 동일 요청의 적법한 질문 답변 | waiting 상태·revision 확인 후 재개 | 다음 계획 단계 또는 재판단 |
| 계획 소진, terminate 없음 | 전체 목적과 검증 결과 재검토 | Hallway Return |
| terminate 존재 + 실증된 완료 | Output에서 언어·요청 맥락·방 맥락 갱신 | completed |
| terminate 존재, 실행 미완료 | 가짜 성공 차단, 남은 요구 제공 | Hallway Return / failed |
| Output 문장 생성 실패 | 이미 적용한 작업 유지, Output 재시도만 허용 | failed(output) |

행동 실행기나 모델은 `nextWorkshop()`, `setCurrentLayer()`, `commitContextData()`처럼 오케스트레이터를 직접 조작할 권한을 갖지 않는다. 단지 **검증 가능한 결과**를 반환한다.

## 8. 실제 예: 식물 조사 스킬블럭

Hallway 계획:
```json
{"plan":[
 {"skillDefine.defineDirect":{"objective":"식물을 조사하는 재사용 스킬 정의","need":[]}},
 {"canvasEdit.addBlock":{"objective":"그 스킬을 캔버스에 스킬블럭으로 배치","need":[]}},
 {"terminate":{"objective":"확인된 결과 안내","need":[]}}
],"contextBlock":{"intent":"식물 조사 스킬블럭 생성","progress":"작업 계획 확정"}}
```

1. 엔진: `cursor=0` ⇒ `skillDefine.defineDirect`. 최초 contextBlock + focus(`스킬 정의`) + 사용자 원요청 + 필요한 자료를 제공.
2. 해당 Action 전용 프롬프트/도구에서 Skill 정의 후보 생성. 입력 포트/필드 판단은 전용 도구 계약 책임. 검증된 Skill 자산 저장이 이루어져야만 `applied`.
3. 확정된 `skillId`·revision·산출물 참조를 `verifiedResults`에 보존. `cursor=1`.
4. 엔진: `canvasEdit.addBlock` 호출용 **새 focus**를 만든다. contextBlock의 `intent/progress` 원본은 유지. 이전 검증 결과에서 정확한 `skillId`를 조회해 두 번째 Action에 제공한다. Hallway에서 미리 가짜 ID를 만들 필요 없음.
5. Canvas Block 적용이 실제 확인되면 `cursor=2`; `terminate`를 검사. 스킬 정의만 됐다면 종결 금지.
6. Output은 검증된 생성/배치와 아직 미실행인 실제 식물 조사 기능을 구분해 응답하고 세션 맥락을 갱신한다.

**현재 beta에서는 1번의 Action Shell 진입까지만 동작하고 2~6은 미구현**이다.

## 9. 안전성·복구

- **계획/실행 구별:** 모델의 계획/도구 후보/언어 주장과 자산의 `applied`는 구별. 응답 카드도 실제 확인된 적용 내역만 표시.
- **준비→적용:** `operationId`, 행동, 구체 인수, 대상 revision을 적용 전 체크포인트에 기록하고 `actions.apply` 후 결과 확정. 중단 후 복구는 같은 ID의 `getOperation`을 먼저 확인.
- **멱등성:** 같은 operationId+동일 인수는 동일 결과를 반환, 같은 ID+다른 인수는 거절. 네트워크 재시도로 Skill Block 중복 생성 금지.
- **CAS/버전:** 같은 room의 자산/세션 변경에서 `expectedRevision`을 검증. 충돌 시 임의 overwrite 금지.
- **부분 성공:** 정의만 생성되고 배치가 실패한 경우 정의는 남으며 재계획은 기존 ID를 재사용. 무조건 처음부터 반복하지 않음.
- **질문:** `awaiting_input` 상태와 답변 대상 ID를 유지하고 사용자 답변으로 원문 요청을 덮어쓰지 않는다.
- **호출 상한:** 서버 정책으로 모델 호출·행동·복도회귀 횟수 제한. 기존 Beta 실험에서 사용한 40 / 24 / 5는 참고 예산이며 새 기준 확정은 후속 과제.
- **명칭/아이콘 검증:** 행동 도구가 반환하는 외형 값은 실제 프론트에서 표시 가능한 카탈로그/정확한 ID를 서버가 검증해야 한다. 저장됐다며 기본 아이콘으로 바뀌는 상태를 성공으로 처리하지 않음.
- **외부 포트:** `model.generate`, `resources.resolve`, `actions.apply/getOperation`, `checkpoints.load/save`, `sessions.load/commit`, `events.publish`의 의미를 DB/Gemini/HTTP 세부로부터 격리. 실제 도구 선언이나 DB 구현은 미확정.

## 10. 이후 구현 시 코드 책임 경계 (지금 만들지 않음)

| 기존/후속 파일 | 소유해야 하는 책임 |
|---|---|
| `back/js/engine/engine.js` | 계층 전이, 계획 커서, 결과에 따른 다음 행동/복도회귀/Output 판단 |
| `back/js/engine/actionShell.js` | 행동 이름 등록/descriptor 선택/입력 라우팅; 실제 적용 소유 금지 |
| `back/js/engine/actionRunner.js` *(추후)* | 선택한 행동의 도구 호출과 후보 인수 수신. 서버 검증 전 성공 주장 금지 |
| `back/js/engine/promptComposer.js` | 해당 행동 전용 조립, 미선택 행동 제외 |
| `back/js/engine/dataProvider.js` | 단계별 need와 검증 결과를 바탕으로 자료 조회 |
| `back/js/request/registry.js` + `scheduler.js` | 요청 상태 원본/FIFO·대기·재개·취소·요청 단위 진행 |
| 외부 `actions/checkpoints/sessions` 포트 *(추후)* | 자산 적용·멱등성 / 요청 체크포인트 / 방 맥락 영속화 |
| `back/js/model/gemini.js` | 모델 중립 호출을 Gemini JSON/도구 요청·응답으로 적응 |
| `front/js/workspace/requestBridge.js` | 서버 확정 상태의 화면 투영, 실행 성공 추측 금지 |

파일은 책임상 필요할 때만 추가한다. 행동 하나마다 새 클래스·디렉터리를 일괄 생성하지 않는다. `AGENTS.md` 및 `docs/developing`은 구현이 확정된 다음 실제 코드와 함께 갱신한다.

## 11. 검증 시나리오와 완료 기준 (후속 구현의 수용 조건)

1. Greeting: Gate → Hallway 직접 답변 → completed. Action/Output 호출 없음.
2. 두 행동: `defineDirect → addBlock`에서 정확한 Skill ID가 다음 Action에 전달되고 contextBlock의 intent는 보존됨.
3. Focus 교체: 연속된 두 Action에 서로 다른 focus. 저장 요청 상태에 focus 누적 없음.
4. Plan cursor: 성공한 행동마다 정확히 1번 증가; 다른 모델 반환이 임의 계층/커서를 지정할 수 없음.
5. 미구현 행동·잘못된 Action/tool ID: 서버 무변경, 명시적 unsupported/error.
6. 실행 실패 후 재계획: 검증된 이전 행동은 중복 실행하지 않고 Hallway Return이 원래 intent와 부분 성공을 받음.
7. `question`: 대기→중복 답변 거부→같은 requestId로 재개.
8. 실패 후 Output 재시도: 이미 적용한 행동을 재실행하지 않음.
9. 동시에 다른 방 두 요청: plan/contextBlock/contextData/결과와 ID가 섞이지 않음. 같은 방 session revision 충돌은 무음 덮어쓰기 금지.
10. 잘못된 icon/port/field/자산 ID: 실제 자산 검증 전 성공 없음.
11. Provider 교체/메모리↔DB 포트 교체에도 엔진의 계획·전이 의미 동일.
12. `main` 무변경, 기존 Beta 직접 응답 및 HTTP 회귀, 별도 실제 Gemini/Render 검증.

## 12. 설계 확정이 필요한 잔여 사항

- Action Runner가 공급자에 노출할 **정확한 네이티브 Function Calling 도구/인수 스키마** 및 호출당 도구 횟수.
- 초기 행동 호출에서 도구 불가능 상황을 Hallway Return으로 자동 회귀할 때의 상세 오류 계약.
- 한 행동이 다단계 실행을 필요로 하는 경우의 **행동 내부 다회 호출** 허용 기준과 실행 예산.
- 모든 행동에 동일하게 적용되는 완료 판정 정책과 요청 수준 충족 조건을 어떻게 구조화할지.
- IR 유래 `skillDefine.defineFromIR`와 저장 Function의 별도 자산/실행 계약.
- DB 세부 구조, 방 동시성 병합 정책, SSE/재연결 및 중단 API.

위 항목은 기존 설계의 미확정 영역이다. **문서만으로 임의 확정해서 구현하지 않는다.**

## 13. Superpowers 다음 단계

1. **이 설계안 검토/승인**. 초기에 논의한 불변 조건과 10/23 변경한 행동별 계획의 접합이 맞는지 확인.
2. 승인 뒤에만 `superpowers:writing-plans`로 `docs/superpowers/plans/2026-10-24-action-workshop-routing.md` 구현 계획 작성.
3. 계획은 테스트 가능한 단위로 분리: 요청/호출 상태 계약 → 행동 등록/프롬프트 조립 → 한 행동 결과 확인 → 커서/복도회귀 → 질문/Output/복구. 구현 범위는 별도 승인.
