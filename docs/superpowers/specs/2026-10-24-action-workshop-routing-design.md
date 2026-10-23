# Ovll — 다중 요청 엔진과 호출 ID 기반 작업실 라우팅 설계

> **Superpowers / brainstorming 설계 검토안 · 2026-10-24**
> 대상: `beta` 전용. 이 문서는 설계이며 제품 코드·실행 기능이 아니다. 구현 계획은 설계 승인 뒤 별도로 작성한다.
> 이 문서는 2026-10-24의 이전 '행동 기반 작업실 라우팅 및 맥락 전달' 명세를 **같은 경로에서 개정**한다. 기존 합의와 달라진 내용을 별도로 표시한다.

## 1. 요구와 설계 경계

**사용자 요구 (이번에 강조·확정한 방향)**

- 엔진은 호출 하나를 처리하고 끝나는 함수가 아니다. **여러 요청을 등록·대기·동시 실행·중단·재개·조회**하는 상시 요청 관리 시스템이다.
- 각 호출에 **서버가 생성한 고유 callId**를 부여하고, 명시적 라우트로 목적을 나타낸다.
- 예: `adffyhd36yt6.workshop.skillDefine.defineDirect`, `adffGGG36yt6.workshop.skillDefine.revise`. 같은 요청의 다른 행동일 수도 있고 다른 요청에 속할 수도 있다.
- Hallway의 계획 단위는 `skillDefine.defineDirect` 같은 **행동**, 작업실 이름은 분류(네임스페이스)다.
- 엔진과 외부 임시 처리 계층의 소유권을 분리해 Gemini/DB/HTTP 구현 교체가 엔진 판단·수명을 변경하지 않도록 한다.
- 초기 논의의 요청처리객체/호출처리객체, 맥락체/맥락데이터, 서버 소유 상태 전이 원칙은 유지한다.

**설계 범위**: 다중 요청 엔진의 논리 API와 내부 책임, Request/Call/Operation 세 식별자와 상태, 호출 라우팅, 맥락 투영, 자원/동시성 제어, 결과 귀속, 실패·대기·재개·취소, 공급자 인터페이스, 향후 검증 기준.

**비목표**: 지금 작업실 실행·네이티브 Function Calling·DB·SSE를 구현하거나 기존 프론트를 수정하는 것, 모든 행동별 세부 인수 스키마 완성, 무제한 병렬 실행 보장, 현재 Beta의 임시 자산을 복원하는 것.

## 2. 출처와 원칙

- `docs/notes/request-state-sync.md` §1, §2, §3, §10, §13: room/request/transport의 서로 다른 수명, 요청처리객체와 호출처리객체 분리, 요청 맥락체(intent/progress)와 호출별 focus, 서버 소유 실행 상태, 여러 요청 공통 기반.
- `docs/developing/context.md`: 방 전체 `contextData`, 요청 전체 `contextBlock`, 각 모델 호출에서 서버가 계산하는 `focus`.
- `docs/developing/{architecture,workshops,prompt-composition,request-engine}.md`: 10/23 행동 단위 plan, 현재 Action Shell로 중단하는 사실.
- `docs/superpowers/specs/2026-10-23-independent-request-engine-design.md` 및 과거 비IR Workshop 명세는 **역사적 근거**. 폐기한 JSON Workshop 실행기를 다시 도입하라는 뜻이 아니다.
- 10/23 변경: Hallway는 더 이상 작업실만 계획하지 않고 **행동을 명시**한다. 단, 구체 인수/도구 호출은 작업실 행동 처리에서 결정한다.

**중요한 용어**: `Engine`은 등록소·대기열 정책·호출 관리·요청 오케스트레이션을 가진 다중 요청 시스템의 외부 인터페이스다. `runRequest()` 같은 내부 함수가 있어도 그것만을 Engine이라 부르지 않는다.

## 3. 대안 비교

| 구조 | 장점 | 문제 | 결론 |
|---|---|---|---|
| 하나의 엔진이 요청 하나씩 처리하고 외부가 모든 큐·호출 상태를 관제 | 외부 재사용 쉬움 | 엔진이 동시성, 재개, 자원 공정성, 상태 수명을 통제 못함 | 거부 |
| 작업실끼리 다음 호출을 직접 생성·호출 | 구현 초기 간단 | 상태/계획 커서/맥락 소유권 파편화 및 중복 실행 | 거부 |
| **다중 요청 Engine + 엔진 내부 Call Manager + 외부 무상태 작업 어댑터** | 요청 상태 단일 진실, 호출별 식별·관제, 공급자/저장소 교체 | 실행 루프·CAS·호출 결과 계약 필요 | **채택할 설계 제안** |

선택지는 사용자 제시 `callId.workshop.group.action` 라우팅과 초기 논의를 동시에 만족한다. **실제 저장소는 외부**여도 어떤 요청을 언제 실행할지 결정하는 **정책·상태 전이 권한은 엔진**에 둔다.

## 4. 구성도

```text
    사용자 Chat / 외부 API / 자동화
                   |
                   v
  +---------------- Ovll Engine ---------------------+
  | Public API: submit/get/cancel/resume/list        |
  |                                                 |
  | Request Manager                                  |
  |  ├─ Request Registry (roomId, requestId)         |
  |  ├─ Queue & Scheduler (동시성·공정성·재개 정책)   |
  |  └─ Coordinator (Gate/Hallway/Action/Output)     |
  |       │                                         |
  |       ├─ Request A ── Call A1 ── Call A2 ...     |
  |       ├─ Request B ── Call B1 ...                |
  |       └─ Request C ── queued / awaiting_input   |
  |                                                 |
  | Call Manager                                    |
  |  ├─ 서버가 callId 발급                       |
  |  ├─ 정형 route에 현재 layer/행동 명시        |
  |  ├─ 호출 상태 기록·승인된 결과 귀속          |
  |  └─ 호출별 focus·prompt·resource 준비         |
  +--------------------|----------------------------+
                       | 명시적 포트
               +-------+---------------------------+
               | 외부 Infrastructure / Adapters    |
               | model: Gemini Function Calling    |
               | stores: 요청/호출/세션/큐         |
               | resources: 자료·자산 조회         |
               | actions: 실제 검증·적용           |
               | transport: HTTP/SSE               |
               +-----------------------------------+
```

현재 Beta의 `back/js/request/scheduler.js`와 `registry.js`는 이미 일부 엔진 소유 책임을 구현하지만 `maxConcurrent=1` 기본 FIFO 및 `engine.run(snapshot)`의 외부 조합으로 노출된다. 이는 **현재 코드 사실**이며 목표 구조와 구별한다. 10/23 Action Shell은 첫 선택 행동에서 `not_implemented`를 반환한다.

### 엔진 논리 API (미구현 제안)

```js
const engine = createEngine({
  requestStore, callStore, queueStore, sessionStore,
  modelPort, resourcePort, actionPort, eventPort,
  policy: { maxActiveRequests: 3, maxModelCalls: 2 }
});

const { requestId } = await engine.submit({ scope, roomId, request });
await engine.getRequest({ scope, roomId, requestId });
await engine.getCall({ scope, callId });
await engine.listCalls({ scope, requestId });
await engine.resume({ scope, requestId, waitingId, answer });
await engine.cancel({ scope, requestId });
```

`scope`는 인증된 실행 범위이다. 클라이언트가 임의로 제출한 `roomId`, `requestId`, `callId`는 인증 수단이 아니다. 위 함수·정책 값은 설계용 예시로, 코드에 아직 존재하지 않는다.

## 5. ID 세 가지를 절대로 합치지 않는다

| ID | 식별 대상 | 발생 시점 | 재시도·재개 의미 |
|---|---|---|---|
| `requestId` | 사용자/외부 요청 하나의 **전체 수명** | 접수 | 질문 답변·계획 재수립에도 유지 |
| `callId` | Gate, Hallway, Workshop, Output 등 **호출 한 번** | 매 호출 생성 | 모델을 다시 호출하면 **새 callId** |
| `operationId` | 실제 자산 변경 등 **부작용 한 건** | 인수/버전 확정 시 실행 전 | 결과 불명 시 **같은 operationId 재조회/재전송**, 새 ID로 재실행 금지 |

Gemini가 반환하는 `functionCallId`/`call_id`는 **공급자 고유 ID**이며 엔진의 `callId` 또는 `operationId`와 동일시하지 않는다.

### 표시·조회용 호출 경로

```text
<callId>.gate
<callId>.hallway.initial
<callId>.workshop.skillDefine.defineDirect
<callId>.workshop.skillDefine.revise
<callId>.workshop.canvasEdit.addBlock
<callId>.hallway.return
<callId>.output
```

**설계 결정 제안**: `callId`는 자체로 유일한 서버 발급 식별자. `<callId>.<route>`는 사람이 보기 쉬운 **파생 디버깅 경로**다. 실제 상태 원본은 구조화한 `{callId,roomId,requestId,route}` 필드로 저장하며 문자열 분해에 시스템 로직을 의존하지 않는다. `route`는 서버 등록부에서만 생성/검증하고 클라이언트/모델이 임의 지정하지 못한다.

`requestId`를 호출 경로의 접두어로 붙이지 않는다. 호출 기록이 별도 소속 `requestId`를 갖고 있기 때문에 `callId`만으로 조회하되 권한 범위와 소속을 검증한다.

## 6. 처리 객체는 3단으로 분리

### 6.1 RequestRecord (요청 전체에서 유지)

```ts
type RequestRecord = {
  roomId: string; requestId: string; scopeRef: string;
  userRequestRef: string; status: RequestStatus; stage: Layer;
  contextBlock: { intent: string; progress: string };
  contextDataRevision: number;
  plan?: PlanStep[]; planCursor?: number; planRevision?: number;
  verifiedResults: ResultRef[];
  activeCallIds: string[]; waiting?: WaitingRef;
  pendingOperation?: OperationRef;
  revision: number;
};
```

요청 객체는 진행·중단·재개·회귀·종결까지 살아 있다. `focus`나 모든 Gemini 원문을 이곳에 누적하지 않는다. 실제 DB에 저장할 땐 ID/참조 형태로 정규화해도 동일 의미여야 한다. `stage`, `cursor`, 완료 판정 등은 엔진 제어자만 갱신한다.

### 6.2 CallRecord (호출 관리자에 남는 가벼운 이력)

```ts
type CallRecord = {
  callId: string; requestId: string; roomId: string;
  route: { layer: Layer; workshop?: string; action?: string };
  path: string; status: 'queued'|'running'|'completed'|'failed'|'cancelled';
  requestRevisionAtStart: number;
  inputRef?: string; outcomeRef?: string;
  startedAt?: number; finishedAt?: number;
  providerTraceRef?: string;
};
```

`CallRecord`는 실행 완료 뒤에도 **상태·소속·순서·진단 참조만** 보존한다. 호출당 한 record, 동일 요청에서 여러 record 허용. 경로는 record의 분리된 ID/라우트로부터 도출 가능해야 한다.

### 6.3 CallFrame (한 호출 동안만 메모리에 존재)

```ts
type CallFrame = {
  callId: string;
  prompt: string; toolDefinitions?: unknown[];
  contextBlockForThisCall: { intent: string; progress: string; focus: string };
  contextDataSnapshot: unknown;
  objective?: string;
  resources: ResourceSnapshot[];
  priorVerifiedResults: ResultRef[];
  modelResponse?: unknown; normalizedResponse?: unknown;
  signal?: AbortSignal;
};
```

`CallFrame`의 프롬프트·도구/공급자 원문·임시 응답은 호출이 끝나면 기본 폐기한다. 사고 서명·연속 응답이 필요하다면 보안·보존 정책이 허용하는 공급자 전용 `providerTraceRef`만 저장 포트를 통해 남긴다. **대기 중에도 프롬프트를 DB에 상시 저장한다고 가정하지 않는다.** 장애 복구 시 같은 프롬프트·자료 버전을 재구성할 수 있는지 별도로 검증한다.

### 6.4 OperationRecord (실제 부작용만 해당)

```ts
type OperationRecord = {
  operationId: string; requestId: string; originatingCallId: string;
  action: string; argsRef: string; expectedRevision: number;
  status: 'prepared'|'applied'|'rejected'|'conflict'|'unknown';
  resultRef?: string;
};
```

호출 성공은 `OperationRecord.status='applied'`와 다르다. `function_call` 응답을 받은 호출이 정상 완료돼도 실제 자산 수정은 아직 없을 수 있다.

## 7. 엔진과 외부 임시 처리계층의 소유권

| 책임 | 엔진 | 외부 포트/어댑터 |
|---|---|---|
| 요청/호출 ID 발급, route 결정 | **정책·결정** | ID 및 상태 물리적 저장 가능 |
| 큐 정책, 공정성, 호출 수 상한 | **소유** | 큐 원자 연산·리스 구현 |
| 요청 상태 전이 및 cursor 증가 | **독점** | CAS/checkpoint 지속화 |
| 요청 contextBlock, 호출별 focus | **소유** | 원본 저장·자료 읽기 |
| 방 contextData의 갱신 시점 | **결정** | revision 확인·트랜잭션 저장 |
| 현재 행동과 허용 도구 선택 | **등록부/계약 결정** | 도구 선언을 Gemini 형식으로 변환 |
| 프롬프트 조립 규칙/행동 지침 선택 | **결정** | 프롬프트 파일 로더/SDK 입력 변환 |
| 네트워크 전송·429·SDK 오류 | 공급자 중립 상태로 처리 | **Gemini/HTTP 어댑터** |
| 모델 function_call 후보 검증 | **의미 검증** | 공급자 응답 파싱·정규화 |
| 실제 스킬·캔버스 반영 | postcondition 및 결과 판정 | **액션 실행/저장 포트**, 자산 제약·권한/revision 검사 |
| 다음 행동/복도 회귀/Output | **엔진 독점** | 어떤 계층도 직접 호출 금지 |
| 상태의 UI 표시·SSE/HTTP | 공개 상태 스냅샷 의미 결정 | **전송 어댑터** |

`scheduler.js`/ `registry.js` 같은 **모듈이 별도로 존재해도 엔진 내부 책임**이다. '엔진 내부'는 코드를 단일 파일에 몰아넣으라는 말이 아니다. 메모리/Redis/Postgres 구현은 포트로 분리하지만 외부 어댑터에 판단 권한을 넘기지 않는다.

호출 어댑터는 `performModelCall(input)`과 같은 모델 중립 실행을 맡고, 호출 생성/검증/계층 전이의 최종 책임은 Call Manager / Coordinator가 갖는다.

## 8. 호출 수명과 요청 수명은 별개

### 8.1 RequestStatus

```text
queued → running ↔ awaiting_input
             ↘ stopping → stopped
             ↘ completed | failed | unsupported_workshop
```

`awaiting_input` 중에는 실행 슬롯을 반납하고 같은 requestId에서 합법적 answer가 왔을 때 큐에 재진입한다. `stopping/stopped`는 미래 확장 상태이며 현재 Beta에는 구현되지 않았다. 이미 적용된 자산을 취소 상태로 소급 삭제하지 않는다.

### 8.2 CallStatus

```text
queued → running → completed | failed | cancelled
```

각 CallRecord는 자신에게만 속하는 결과를 반환한다. **요청 A가 waiting이라고 해서 요청 B의 Call을 중단하지 않는다.** Call의 `completed`는 모델 반환·정규화 완료이고, 전체 요청 `completed`가 아니다. 실패한 호출의 late response, 취소 후 도착한 응답은 서버의 `requestRevisionAtStart`/현재 `activeCallIds` 확인 뒤 폐기한다. 폐기는 자산 적용 내역을 없던 것으로 만드는 것이 아니다.

### 8.3 한 모델 호출에 한 작업실 행동

초기 안전 기본값: 계획 `skillDefine.defineDirect`는 **해당 행동 호출 1개**에 연결한다. 호출에 공급자 도구를 하나만 노출하고, 정확히 그 도구의 유효한 반환만 후보로 접수한다. 모델이 지원하지 않는 행동을 생성하면 실행하지 않고 실패/복도 회귀 대상으로 둔다. Gemini의 한 응답에 여러 function call이 오더라도 현재 plan의 다른 행동을 임의 실행하지 않는다. 하나의 행동 내부에서 다회 모델 호출·복수 도구 호출이 필요한 정책은 **추후 별도 결정**한다.

Call Manager는 성공 확인 뒤 Cursor를 진행시킨다. 다음 행동용 **새 callId**와 **새 focus**를 생성한다.

## 9. 다중 요청 동시성 모델

엔진은 **여러 RequestRecord를 동시에 관리하며**, 정책이 허용하는 범위에서 복수 CallRecord를 동시에 실행한다. 단일 JS 이벤트 루프에서도 비동기 Gemini/DB 요청은 중첩 수행 가능하나, CPU-bound 실행과 DB 원자성 보장은 별도 실행기/저장소 책임이다.

- 요청 큐와 모델 호출 큐를 **개념적으로 분리**한다. `maxActiveRequests`는 활성 요청 수, `maxModelCalls`는 실제 공급자 호출 동시성을 제한. 값은 초기 예시 3/2이며 측정·예산 이후 조정한다.
- FIFO를 기본 출발점으로 하되 질문 대기·모델 레이트리밋·긴 작업이 독점하지 않도록 요청별/방별 공정성 정책 확장 가능. 구체 우선순위는 미확정.
- 요청 A, B, C의 Call은 허용 범위에서 병렬. **같은 요청의 순차 plan**은 의존성상 cursor 단위 실행: Action1의 verifiedResults를 기록하기 전 Action2를 시작하지 않는다. 향후 DAG 병렬 계획은 별도 명세.
- 같은 방의 복수 요청을 무조건 전역 직렬화하지 않는다(**제안 기본값**). 독립된 읽기/별도 자산 작업을 병렬화할 수 있으나 세션 contextData commit과 동일 자산 적용은 예상 revision 기반 CAS·권한 검증. 충돌 시 요청을 보존한 채 재평가.
- `awaiting_input`, 레이트리밋 백오프, 전송 끊김은 해당 요청/호출만 조정. 미사용 모델 슬롯은 즉시 풀에 반납. 실행 대기 중 레이트리밋 재시도는 무한 반복 불허.
- 분산 프로세스 확장 시 외부 queueStore는 원자적 claim/lease 제공, 엔진은 ownerToken·lease 만료·checkpoint revision으로 **중복 워커가 같은 호출을 확정하지 않게** 검증. 이것은 향후 계약으로 Beta가 현재 보장하지 않는다.

## 10. 맥락 전달과 다음 행동으로 이동

**맥락체는 요청당 하나다.** 작업실/호출마다 맥락체를 복제·누적하지 않는다.

| 값 | 누가 갱신 | 다음 호출에서 활용 |
|---|---|---|
| `contextBlock.intent` | Hallway/Output의 맥락 갱신 | 전체 요청 목적 보존 |
| `contextBlock.progress` | Hallway/Output의 맥락 갱신 | 전체 진행 요약. Call이 임의 재작성 불가 |
| `focus` | **Call Factory(엔진)** | 그 호출의 행동·objective·이전 확정 결과에서 새로 계산 |
| `contextData` | 방 세션 최종화 포트 (엔진 결정) | 해당 실행 시점의 최신 확인된 revision |
| `verifiedResults` | 액션 검증·적용 결과 기록 | 다음 Call에서 실존 ID/산출물/버전 참조 |
| `need` 해결 결과 | Resource Provider | 필요한 최신 원본만 해당 CallFrame에 제공 |

예시. 하나의 requestId `req-A`의 순차 호출:

```text
Call g1.gate
   → need=[] 확인
Call h1.hallway.initial
   → plan=[skillDefine.defineDirect, canvasEdit.addBlock, terminate]
   → contextBlock.intent='식물 조사 스킬블럭 만들기'
Call adffyhd36yt6.workshop.skillDefine.defineDirect
   → 새 focus='식물 조사 Skill 정의'
   → tool 인수 제안 → 검사 → operation op-1 적용 확인
   → verifiedResults에 skillId='skill-123' 저장, cursor 0→1
Call adffGGG36yt6.workshop.canvasEdit.addBlock
   → 새 focus='앞에서 확정된 skill-123 배치'
   → tool 인수 제안 → 검사 → operation op-2 적용 확인
   → verifiedResults에 blockId='block-7' 저장, cursor 1→2
Call o1.output
   → 실제 생성/배치 결과만 언급, 맥락데이터 충돌 검사 후 완료
```

동시에 `req-B`는 별도의 `z912.hallway.initial` 또는 `y277.workshop.skillEdit.revise` 호출로 진행할 수 있다. 각각 requestId·맥락체·결과·예산은 서로 공유되지 않는다.

**다음 작업실을 호출하는 주체는 작업실이 아니라 엔진 Coordinator**다. `CallResult`를 받은 뒤 검증·상태 기록·커서 전진/복도 회귀를 판정하고, 필요할 때 Call Manager에 새 호출 생성을 요청한다.

## 11. Gemini Function Calling 접점

```ts
type ModelCallInput = {
  callId: string; route: CallRoute;
  systemPrompt: string; context: unknown;
  allowedTools?: ToolSpec[]; mode: 'json' | 'function_call';
  abortSignal?: AbortSignal; providerContinuationRef?: string;
};
type ModelCallOutcome =
  | { kind: 'json'; value: unknown; providerTraceRef?: string }
  | { kind: 'function_proposal'; tool: string; args: unknown; providerCallId?: string; providerTraceRef?: string }
  | { kind: 'error'; category: 'auth'|'rate_limit'|'network'|'invalid_response'|'cancelled'; retryable: boolean };
```

이 타입은 **공급자 중립 설계안**. 실제 Gemini Interactions API/generateContent/SDK는 modelPort 안에서 변환한다. Gemini 자체가 도구를 실행하는 것이 아니므로 모델 도구 반환은 `function_proposal`일 뿐이다. **서버 검증→OperationRecord 준비→ActionPort 적용→적용 결과 확정** 단계가 완료되기 전 성공으로 표시하지 않는다.

선택된 행동의 전용 프롬프트·도구만 조립한다. `route.workshop`과 `route.action`이 허용 등록부와 맞지 않거나 모델이 다른 도구를 호출하면 실패, 임의 다른 행동 실행 금지. 공급자별 응답 연결 토큰/ID·사고 서명·API 세션 ID는 **Model Adapter의 포맷**이며 엔진에는 재개에 필요한 opaque 참조만 전달한다.

Function Calling을 위한 정확한 모델/SDK API 이름, 복수 function call 허용 정책, provider state 저장 여부는 **후속 작업실 명세의 미확정 항목**. Interactions API 지원을 현재 beta 기능으로 선언하지 않는다.

## 12. 실패·대기·취소·복구 규칙

1. **호출 생성 전에** 요청 소속/현재 plan 및 자원 접근권 검사. CallRecord 생성 시 server-generated callId와 유효 route를 원자 기록.
2. Call 시작/종료 결과는 요청/호출 revision과 activeCallId를 확인해 반영. 같은 호출에 두 개의 늦은 응답이 와도 한 번만 확정.
3. 자산 변경은 operationId·action·args·expectedRevision을 실행 전에 저장. `actionPort.apply`는 중복 operationId에 동일 효과를 보장하고 `getOperation` 조회 가능해야 한다.
4. Function Calling 성공·CallStatus completed·OperationStatus applied·RequestStatus completed는 **서로 다른 사실**.
5. Action 실패/비정상 응답·자산 충돌은 엔진이 검증 결과와 원 요청 intent를 보존하여 Hallway Return으로 이동. 일부 적용된 결과를 다시 실행하지 않는다.
6. `textGenerate.question`을 채택한 요청은 waitingId를 기록하고 `awaiting_input`으로 전이, 실행 슬롯 반환. 답변은 room/request/waitingId 권한 검사 후 같은 요청을 재개. 중복 답변 무효.
7. 취소는 해당 요청을 `stopping`으로 표시하고 더 이상 새 Call을 생성하지 않는다. 실행 중 modelPort에는 가능하면 abort signal 전파. 이미 적용한 operation은 기록·반영하고, 늦게 온 모델 후보는 stale 처리한다.
8. 모델/DB 오류·서버 재시작 시 레코드/체크포인트/operation 조회를 통해 결과를 재구성한다. 재구성이 불가능하면 `unknown/failed`을 명시. 모델이 성공이라고 말했어도 엔진이 누락된 자산을 창작해서 메우지 않는다.
9. Output 단계에서 언어 생성 실패 시 이미 적용된 operation 재실행 없이 Output만 재시도. 최종 `contextData` 저장은 session revision 검증.
10. 모든 내부 상태를 프론트에 그대로 공개하지 않는다. 공개 스냅샷에는 requestId, callId와 안전한 route/status, 사용자용 단계·확정 결과 참조만 표시. 시스템 프롬프트/기밀·공급자 사고 정보는 제외.

## 13. 코드 책임 경계와 점진적 전환 (현재 코드 미수정)

| 기존 파일 또는 제안 영역 | 목표 역할 |
|---|---|
| `back/js/engine/engine.js` | 요청 단일 실행 함수만이 아닌 **다중 요청 엔진 facade / coordinator** 소유; 하위 처리기는 파일 분할 가능 |
| `back/js/request/scheduler.js` | 엔진 내부 스케줄링 정책, 실행 슬롯·공정성·대기·재개; 서버에서 직접 모든 상태를 조작하지 않음 |
| `back/js/request/registry.js` | 엔진 내부 요청 상태/버전 관리, 다중 요청 독립성 |
| `back/js/engine/actionShell.js` | 현재 행동 등록/라우트 검사, 향후 선택 descriptor 반환. 다음 작업실 직접 호출 금지 |
| **추후 Call Manager** | callId 발급, CallRecord 상태·route, CallFrame 생성/종료·결과 귀속 |
| `back/js/engine/promptComposer.js` | 선택된 layer/행동 지침만 조립, 호출별 focus 포함 |
| `back/js/engine/dataProvider.js` | 호출 필요 자료, 출처·완전성·버전 |
| `back/js/model/gemini.js` | Gemini 프로토콜/Function Calling 정규화, 엔진 제어권 없음 |
| **외부 stores / actionPort** | 실제 상태·큐·자산 지속화 및 원자 연산. 실행 의미의 정책 결정은 엔진에 없음이 아니라 **엔진에 있음** |
| `back/js/httpServer.js`, `front/js/workspace/requestBridge.js` | 요청 접수/조회·스트림 및 프론트 투영. 큐·계층 상태 권한 없음 |

구체 신규 파일 수·경로는 설계 승인 후 **Superpowers 구현 계획**에서 기존 분해 수준을 확인해 결정. 지금은 빈 디렉터리, DB, SDK 의존성, 실행 기능을 추가하지 않는다. `docs/developing`은 실구현이 바뀐 다음 동기화한다.

## 14. 수용 기준 (후속 구현의 테스트 계약)

1. 한 Engine 인스턴스에 **요청 A/B/C 동시 접수**, RequestRecord 각각 독립 등록·조회. maxActiveRequests>1에서 A와 B의 async Call이 실제로 중첩 실행되는 테스트.
2. 요청 A의 `defineDirect`, `addBlock`는 **서로 다른 callId**를 갖지만 **동일 requestId**를 참조. 중간 verified skillId가 정확히 다음 CallFrame에 존재.
3. Request B의 Hallway 또는 Workshop Call은 요청 A와 격리. B 실패가 A의 실행 슬롯/맥락체/결과를 오염시키지 않음.
4. `callId.workshop.skillDefine.defineDirect` 경로와 구조화 route가 항상 정합. 위조 경로·권한 밖 callId 조회는 거절.
5. Call을 재시도해 **새 callId**가 나와도 이미 `applied`된 operation은 동일 operationId 재조회로 한번만 적용.
6. 동일 요청의 cursor는 검증된 결과 뒤에만 전진. cursor CAS 실패/late model response는 무변경.
7. 호출 focus는 매번 새로 생성되고 RequestRecord의 맥락체에는 남지 않음. Hallway/Output만 intent/progress 갱신.
8. question이 awaiting_input으로 바뀌면 실행 슬롯 반환, 후속 요청 실행 가능. 중복·늦은 답변은 동일 요청을 재실행하지 않음.
9. 두 요청이 동일 방 자산/세션을 쓰면 revision conflict로 무음 덮어쓰기 차단; 다른 자산에 대한 합법적인 동시 작업은 허용.
10. 모델 어댑터가 Function Calling 아닌 JSON/오류를 반환하면 결과를 구분하고 자산 변경 성공으로 위장하지 않음.
11. Output 재시도 시 Skill 생성/배치 operation은 재실행되지 않음.
12. 기존 Gate/Hallway 직접 답변과 Action Shell 미구현 상태는 설계 초기 마이그레이션 과정에서도 정직하게 유지됨.
13. 서버 재시작·분산 claim 실패·cancel 중 늦은 응답·scope 변조 입력은 안전하게 종결/보류되고 위조 완료가 없음.
14. `main` 미변경, Node 테스트와 실제 Gemini·Render·모바일 실검증 분리.

## 15. 아직 승인되지 않은 선택

**확정된 요구:** 호출별 고유 ID+route, 여러 요청을 관리하는 엔진, 요청/호출/부작용의 별도 수명, 작업실 행동 계획, 작업실이 직접 다음 호출을 소유하지 않음.

**제안한 기본값(사용자 승인 전):**
- 엔진이 `Call Manager`를 내부 소유, 외부에는 물리 저장·모델 통신·작업 수행만 위임.
- 같은 요청의 플랜은 순차 실행, 서로 다른 요청은 허용되는 범위에서 병렬 실행.
- 같은 방의 여러 요청도 안전 조건(revision/CAS/권한)이 충족되면 동시 실행.
- 경로 문자열은 표시/디버깅용, 상태 원본은 구조화 CallRecord.
- `CallRecord`는 경량 영속 메타데이터, `CallFrame`은 일시 생성 객체.

**추후 별도 설계:** Action별 Function Calling 스키마·다회 도구 호출, 임시/DB 저장 토폴로지 및 분산 Queue claim/lease, 방별 공정성·동시성 예산, SSE/취소 API, IR/Saved Function 실행의 정확한 행동 계약. 이 항목을 문서만으로 구현 완료 또는 사용자 합의로 승격시키지 않는다.

## 16. Superpowers 절차

1. 이 **설계 검토안**에서 위 '제안한 기본값'을 검토·승인한다.
2. 승인 뒤 `superpowers:writing-plans`로 **정확한 기존 파일/함수·테스트**를 지정한 구현 계획을 별도 작성한다.
3. 구현 계획을 승인받은 후에만 코드·프롬프트·테스트 변경. 단계적 범위: (a) Engine facade·다중 요청 상태 (b) CallRecord/ID·route (c) CallFrame/컨텍스트 투영 (d) 동시성/회복 (e) 행동 Function Calling/검증.
4. 실구현과 확인 결과에 맞추어 `docs/developing` 및 `AGENTS.md`를 갱신한다.
