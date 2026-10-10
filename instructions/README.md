# 모델 지침 라이브러리

`registry.json`의 v0.3 원본 25개는 `backend/ovllPointer/promptComposer.js`가 실제로 조립한다. 활성 로컬 경로는 `localHttp.js → localHost.js`; PostgreSQL 런타임은 서버에 연결하지 않았다. 코드 연결과 실제 모델 품질·배포 확인은 별개의 검증이다.

대문, 소통·IR 구성·실행·함수화, 언어화는 논리적 책임이다. 역할마다 호출을 강제하지 않는다. 대화 판단 호출은 가능한 행동들을 함께 받고, 노드 실행 호출은 실행에 필요한 모듈만 받는다. 추가 조회나 막힌 실행의 재판단은 최대 3턴 안에서 처리한다.

공통 제품 설명 규칙은 `backend/ai/productInstructions.js`에서 Pointer Core에 공급한다. 제거된 Gemini 실행기·과거 플래너는 사용하지 않는다. 실제 가능한 일을 사용자 언어로 설명하는 것은 내부 구현·비공개 지침 공개와 구분한다. 없는 도구나 완료 사실은 설명으로 만들어내지 않는다.

반복 목적·지시·IO·고정 조건은 정의에, 이번 요청·자료는 인스턴스에 둔다. 기존 정의가 맞으면 재사용하고, 맞지 않으면 동적 정의를 만든다. 워크플로우 선택은 사용자의 검사·수정·재실행·재사용 가치로 판단한다. 직접 답할 수 있다는 사실만으로 실행 가능한 작업을 회피하지 않는다.

ModelTurn의 세부 wire 예시는 `backend/ovllPointer/modelContract.js`가 제공하고 JSON Schema와 실행 계약이 검증한다. 사용자 자료, 조회 결과, 이전 제안 및 실행 사실은 지침과 분리한다. `nodeContext`는 노드 실행 전용이며, 검토·언어화 사실은 `extraContext`다.

[검증 기록과 평가 시나리오](../docs/architecture/POINTER_QUALITY_VALIDATION.md)를 참조한다. `ALL_PROMPTS_REVIEW_v0.2.md`와 `PROMPT_AUTHORING_START.md`는 제작 당시 기록이며 현재 조립 원본이 아니다.

## Local host context and provider contracts (2026-10-10)

The host accepts optional `taskContext` with original `objective`, current Task
`requestText`, preserved `constraints` and chronological `historyDigest`. Node
purpose and instance instructions remain scoped to that node; they do not replace
Task intent. Full text beyond the frozen ContextBundle's 2400-character preview
lives in `extraContext.taskContext` / `currentRequestText`, with an explicit
omission marker. Constraints are never silently removed to fit a prompt.

UTF-8 budgets are named in `backend/ovllPointer/contextLimits.js`: snapshot
262144 bytes, ContextBundle 49152, combined prompt data 98304, messages 131072,
canonical model output 32768 and input artifacts 60000. Unreferenced definitions
are discoverable through compact `availableDefinitions`; graph-referenced
semantic definitions remain complete. Planner file/binding previews report
truncation. Node execution retains admitted exact inputs once in `nodeContext`.

Gemini native generation and the Groq GPT-OSS 20B/120B strict models use small
phase wire schemas. Other compatible providers use JSON mode unless the trusted
server explicitly configures `OVLL_POINTER_STRUCTURED_OUTPUTS=true`. Turn wire
records encode canonical action args / need selectors as JSON strings; node wire
records encode arbitrary inline values as JSON strings and name exact output
ports. This avoids projecting the frozen domain's conditional/oneOf/dynamic-key
schema onto a provider's more restricted dialect. These payloads are decoded and
validated against the unchanged canonical domain, followed by node port/evidence
validation. Provider schema adherence alone does not establish semantic success.

Response repair asks only for verified-fact presentation; node repair asks only
for outputs; turn repair targets action/need contract paths. There is at most one
correction, with clearly marked partial previews and no synthetic assistant
history. Host `_meta` reports actual provider/model, aggregate usage, call records,
physical HTTP `providerCalls`, repair and fallback. Metadata is separate from the
frozen domain; consumers can use `splitModelMetadata`. Admission failures report
zero provider calls. The maximum reserved physical calls per host operation is
six (bounded retry, optional standby and one correction). These behaviors are
verified with injected transports, without live model-quality claims.

실행 연결(2026-10-10): Task의 `requestHistory`는 원래 목적과 현재 요청을 중복하지 않는 중간 변경 원문이다. ContextBundle의 고정 스키마를 늘리지 않고 `extraContext.taskContext`로 제공한다. 일반 채팅이나 함수 저장 명령만으로 기존 Task를 변경하지 않으며, 적용된 Patch·실행·질문 대기 경계에서 보존한다. 함수 자동 탐색에는 값·레이아웃을 제외한 전체 ID/버전 인덱스를 주고, 구체 계약은 `needs(kind:contract, scope:ref, ref:functionId)`로 조회한다.
