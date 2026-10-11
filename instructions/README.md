# 모델 지침 라이브러리

현재 조립 버전은 0.6.0다. 규칙 소유권, 선언·참조 키, canonical/wire 예시와 고정 소스 스냅샷 평가의 변경 근거는 [프롬프트·출력 계약 정합성](../docs/architecture/PROMPT_CONTRACT_ALIGNMENT.md)에 기록한다. 이 문서의 오프라인 성공을 실모델 행동 개선으로 해석하지 않는다.

`registry.json`에 등록된 모듈은 `backend/ovllPointer/promptComposer.js`가 실제로 조립한다. 활성 로컬 경로는 `localHttp.js → localHost.js`; PostgreSQL 런타임은 서버에 연결하지 않았다. 코드 연결과 실제 모델 품질·배포 확인은 별개의 검증이다.

대문은 맥락·데이터셋 확인, 복도는 판단·조율, 작업실은 기존 소통·IR·실행·함수화, 출구는 언어화·맥락 갱신을 담당한다. 대문·복도는 같은 호출 안에서 책임을 분리한다. 상세 행동 지침은 모델이 `needs(kind:contract, scope:ref, ref:prompt:moduleId)`로 선택하며 기존 조립기가 의존 모듈과 함께 공급한다. 고정 단어로 의도를 분류하지 않는다. 노드 실행은 기존 실행 모듈과 정확한 입력을 유지한다.

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
definitions expose compact purpose/port metadata. Exact instructions, settings,
file contents and bindings are retrieved by existing needs; the canvas index reports
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

## Additional Context / EXIT (2026-10-12)

활성 로컬 경로의 기본 입력은 현재 요청 원문, 최근 2세트의 requestDigest/responseDigest, 갱신된 sessionContext, 별도 constraints 및 접근 가능한 데이터셋 인덱스다. 기존 taskContext/ContextBundle을 유지하고 새 세션 기록은 extraContext.additionalContext로 전달한다. 대화 원문은 저장된 메시지에 남고 history:index 참조 또는 현재 대화 scope로 조회한다. 전체 원문을 기본 프롬프트에 반복 공급하지 않는다.

출구는 message와 requestDigest, responseDigest, sessionContext, constraints를 같은 호출에서 생성한다. 전용 문법 없이 목적·결정·제약·수치·근거·미해결 사항을 의미 중심으로 보존하며 전체 맥락은 약 2문장을 목표로 한다. 고정 조건은 문장 수 제한으로 누락하지 않는다. 맥락 출력은 호스트가 검증해 _meta.contextRecord로 전달하므로 고정 ModelTurn/IR/실행 계약을 바꾸지 않는다. 행동 제안·needs의 기록은 실제 완료 맥락으로 저장하지 않는다. 복도는 행동 전에 이번 작업의 objective와 적용할 constraints를 taskContext 메타데이터로 선택하고 기존 실행 입력으로 전달한다. 다른 작업의 조건을 일괄 승계하지 않는다.

완성 산출물의 직접 전달과 함수 명령 등 출구 생략 경로는 기존 결과를 유지한다. 압축 기록이 없거나 유효하지 않으면 이전 맥락·제약을 보존하고 원문 조회 참조를 미갱신 상태로 남긴다. 별도 요약 호출이나 결과 재작성은 추가하지 않는다. 다음 응답이 필요한 원문을 읽은 경우에만 대응하는 미갱신 기록을 해소한다. 저장 실패는 이전 맥락으로 롤백한다. 최근 기록과 전체 맥락을 합친 UTF-8 입력 크기를 저장 전에 확인하며, 한도를 넘으면 제약을 자르지 않고 이전 맥락과 원문 조회 참조를 유지한다.

이번 변경은 활성 로컬 채팅 경로와 공통 프롬프트 조립을 대상으로 한다. 연결하지 않은 PostgreSQL 경로의 저장 체계·IR·스케줄러·실행기·함수 계약·UI/마스코트 동작은 교체하지 않는다. 검증은 오프라인 계약·회귀 검증이며 실모델 품질 검증과 구분한다.
