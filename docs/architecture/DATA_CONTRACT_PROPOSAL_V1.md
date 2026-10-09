# Ovll 데이터 계약 제안 v1 — 검증본

> **상태: v1 제안 이력. 상세 계약 동결·검증 현황은 [상세 설계 동결 기준](DATA_CONTRACT_V1_FREEZE.md)에 기록한다. 실제 서버 이관 전.** 상위 [1차 동결 기준선](BASELINE_2026-10-09.md)과 기존 [vNext 논의](DATA_CONTRACT_VNEXT.md)를 구체화한다. 사용자 승인 없이 동결 기준을 변경하지 않는다.
>
> **검증 범위:** JSON Schema Draft 2020-12 형식 검증용 [단일 스키마](DATA_CONTRACT_PROPOSAL_V1.schema.json) 및 [양성·음성 사례](DATA_CONTRACT_PROPOSAL_V1.cases.json). 권한·의존 그래프·재시도 의미는 **서버 검증 구현이 필요**하며 이 테스트만으로 안전함을 보장하지 않는다.

## 1. 결정적 경계

| 경계 | LLM이 반환 | 서버가 공급/확정 |
| --- | --- | --- |
| 대문/행동/언어화 | `ModelTurn.message/actions/outputs/needs` 중 필요한 것만 | 권한 있는 `ContextBundle`(원문 요청·실제 자료·참조), 검증된 도구와 상태 |
| 정보 조회 | `Need(kind,selector,purpose)` | 조회 범위·권한·응답 크기·실제 문서 내용 |
| 복합 행동 | `ActionProposal(localKey,kind,args,dependsOn)` | 서버 생성 `ActionEnvelope`, 실제 `ActionResult` |
| IR | `DefinitionDraft` 및 `GraphPatch` | 실제 DefinitionVersion·GraphRevision·노드 ID |
| 실행 | 의미적 노드 출력, 필요시 후속 행동 제안 | Run·Attempt·실제 도구 결과·진행 상태 |
| 함수화 | `FunctionDraft` (목적/IO/제약/절차) | 버전·저장·검증 상태·재사용 실행 권한 |
| 기록 | 작성 의무 없음 | `HistoryEvent` 확정 원본 → 압축 텍스트 파생 |

`ContextBundle.requestText`는 현재 요청 원문이고 `materials[]`는 실제 공급한 부분 자료(종류·출처·축약·근거 포함)다. 단순 `scopeRefs`만으로는 캔버스를 설명할 수 없다. 대문이 '캔버스 설명'을 소통으로 선택하더라도 IR 정보를 요청할 수 있다. 서버가 해당 맥락의 필요성을 확실히 안다면 선제 공급하며, 소통계층에서도 `needs`로 상세 조회가 가능하다. 단순 질문은 `message`만 반환하고 다른 필드·행동 히스토리를 강요하지 않는다.

## 2. 기계적 스키마와 그 한계

- **스키마 진입점:** 기본 `ModelTurn`; 서버 계약/도메인 계약 검증은 같은 문서의 `#/$defs/ActionEnvelope`, `#/$defs/ActionResult`, `#/$defs/GraphRevision`, `#/$defs/Task` 등 개별 참조를 이용한다. 내부 Domain JSON은 LLM 응답 그대로 신뢰하지 않는다.
- **행동 명령:** `ir.applyPatch`, `run.start`, `run.revise`, `run.cancel`, `run.retry`, `function.save`, `question.ask`, `task.complete`. 단순 소통은 `message`, 맥락 조회는 `needs`이므로 불필요한 명령이 없다.
- **참조:** 한 번의 모델 반환 내 행동은 `localKey`로 서로를 참조한다. Patch 내부의 `localNodeKey`와 `localDefinitionKey`는 임시 명칭이다. `run.start.targets[]`는 기존 `nodeId` 또는 선행 `fromAction+localNodeKey`를 사용한다. 서버의 `createdRefs`를 확인하기 전엔 최종 ID가 아니다.
- **IR:** `GraphPatch(graphId, expectedGraphRevision)`는 수정할 대상 그래프와 예상 버전을 명시하며 정의 생성/개정과 node/link operation을 한 원자적 그래프 변경으로 제안한다. 새 정의의 `executorKind`는 초기 `model_task/tool_task/subgraph`이며 **업무 의미는 purpose·IO·instruction으로 자유롭게 정의**된다. `tool_task`의 requiredCapabilities, `subgraph`의 procedureRef를 구조적으로 요구한다.
- **함수:** `FunctionDraft.procedure`는 `graph` 또는 `model_task`. 대화에서 바로 함수화하더라도 억지로 캔버스를 만들지 않기 위한 대안이다. 저장 함수의 검증 상태는 서버 전용이어서 LLM이 마음대로 `verified`를 지정할 수 없다.
- **노드 출력:** `outputs.status=produced`일 때 하나 이상의 출력 값, `blocked`이면 사유가 필수. 실제 포트 이름·형식·근거 적합성은 저장된 정의로 검증한다.
- **보안:** LLM 반환에는 `actorRef`, 임의 권한, 성공한 `ActionResult`를 넣을 수 없다. 서버 ActionEnvelope의 인증 정보는 **반드시 신뢰 가능한 세션에서 생성**하고, 클라이언트/모델 입력을 그대로 복사해선 안 된다.

### 행동별 최소 제약

| kind | LLM 인자 | 서버 검사 |
| --- | --- | --- |
| ir.applyPatch | `patch(expectedGraphRevision, definitions[], operations[], adoption?, runRef?, expectedPlanEpoch?)` | Revision, 실제 refs, 포트/의미 IO, DAG, capability, 권한, 원자성. active_run은 runRef+planEpoch 필수 |
| run.start | `targets[]`, 선택적 `damMode` | 최종 ID 확정, 실행 의도/승인, 닫힌댐 기본, 선행 폐쇄, 예산 |
| run.revise | `runRef, graphRef, expectedPlanEpoch, adoption` | 안전한 계획 채택 지점·영향 범위·시도 유효성 |
| run.cancel | `runRef` | 현재 취소 가능 여부와 외부 부작용 상태 |
| run.retry | `runRef, nodeId`, 선택적 `attemptRef` | 중복·비용·outcome_unknown·새 generation |
| function.save | `function`, 필요시 `baseFunctionRef` | 절차·IO 계약, 버전 고정, 검증 증거 |
| question.ask | `question`, 필요시 `blockedActions` | Task 대기 상태 영속화와 재개 위치 |
| task.complete | `outcomeRefs[]` | 모든 요구 결과와 증거·미완료 대기 조건 |

## 3. 핵심 객체 수명

`Task`는 원본 요청, 제약, 요구 산출물의 충족 상태를 지속 관리한다. `GraphRevision`은 노드·연결의 불변 구조, `DefinitionVersion`은 노드 실행 의미의 불변 계약, `FunctionVersion`은 사용자가 재사용할 목표와 경계의 불변 버전이며 `verified` 전이에는 근거 참조가 필요하다. `Run`은 특정 계획(epoch)·타깃·댐 범위, `Attempt`는 버전이 고정된 개별 시도, `ValueArtifact`는 출처를 갖는 실제 결과, `HistoryEvent`는 **서버 확정 사건**이다. 좌표·아이콘·접힘은 결과 fingerprint와 분리한다.

함수 재실행은 FunctionVersion을 참조하며 실행용 그래프가 동적으로 조정돼도 저장 버전은 바뀌지 않는다. `Run.completed` 자체는 `Task.completed`의 증거가 아니다. 단일 `ActionResult.scheduled`도 실제 실행 성공이 아니다.

## 4. JSON Schema에 담을 수 없는 필수 서버 검증

1. **안전한 조회:** 모든 `needs`·artifact·function 재실행은 실제 actor/workspace/task 권한과 경로/참조 허용을 검사한다. 모델 문서·노드 출력의 명령은 데이터로 취급한다.
2. **참조 그래프:** `localKey` 중복/없는 의존성/순환 검출, 참조한 선행 행동의 확정 성공, 임시 ID 매핑, 교차 Workspace 참조 금지.
3. **원자성:** Patch 내 새 정의·노드·링크의 형식/실행 가능성 검증과 저장을 하나의 GraphRevision으로 확정한다. Patch 성공 뒤 Run 실패는 Patch를 소급 취소하지 않는다. Run 예약의 상태·pending 작업은 같은 원자적 경계로 보존한다.
4. **실행 범위:** closed=지정 타깃+필수 선행. open=지정 타깃부터 활성 flow 하류 선택 → 범위의 선행 flow/data 의존 추가. 조상 노드의 다른 자식은 포함하지 않는다. judge 분기와 merge 필수 입력은 실행 시 계산한다.
5. **동시성:** expected Revision/planEpoch, 중복 idempotencyKey, 실행 결과 fingerprint/세대/멤버십 확인. 무관한 병렬 결과 유지, 영향받는 결과는 stale. 미확정 외부 부작용은 자동 재실행 금지.
6. **완료/보존:** 필수 결과 증거·질문 대기·미완료 실행을 검사해 Task 완료 확정. 파일 처리 실제 parseStatus/coverage와 출처 보존. 서버 이벤트에서만 히스토리를 짧게 조합하며 의미를 추측해서 채우지 않는다.
7. **예산/종료:** Task와 조회·재계획별 호출 수/토큰/시간/시도 상한, 실제 지원 모델/도구/권한의 유효성 검사, 중단·복구 상태 기록.

이 항목들을 검증하지 않으면 **형식 검증 통과만으로 적용/실행하면 안 된다.** 특히 `ActionEnvelope.actorRef`의 필드 존재 여부가 인증을 증명하지는 않는다.

## 5. 상태 전이 초안

| 객체 | 허용할 진행 흐름 | 차단해야 할 잘못된 전이 |
| --- | --- | --- |
| Task | active ↔ waiting, active → completed/blocked/cancelled | 근거 미충족 completed |
| Run | queued → running/waiting → completed/failed/cancelled | 예약 즉시 completed, 종료 후 무단 재개 |
| Attempt | queued → running → success/failed/cancelled/outcome_unknown | 불명확한 부작용을 실패처럼 무조건 재시도 |
| Question | open → answered/cancelled | 답 없는 자동 answered |
| FunctionVersion | immutable draft → 별도 검증/새 버전 기록 | 기존 버전을 직접 덮어쓰기 |
| GraphRevision | revision N → N+1(별도 불변 객체) | 예상 버전 무시·활성 Run 자동 변경 |

이 표는 요구 전이 집합의 최소 제안이며 세부 취소·재개·중단 가능한 경계는 상세 구현에서 검증한다.

## 6. 제안 검증 기준 및 통과 조건

[JSON 양성·음성 fixture](DATA_CONTRACT_PROPOSAL_V1.cases.json)는 단순 대화·캔버스 IR 조회·복합 Patch→Run·노드 출력·대화로부터 함수화와, 권한 위조 필드·빈 행동·정의 출력 누락·대문/행동 권한 혼동·실행 상태 위조를 포함한다. 형식 검사뿐 아니라 위 4장의 서버 의미·권한·동시성 반례도 실제 구현 전에 모두 통과시켜야 한다.

**제안 당시 판정(이력):** 27개 형식 사례 사전 검증. 이후 보완된 34개 fixture와 정식 표준 검증 판정은 [동결 기준](DATA_CONTRACT_V1_FREEZE.md)을 따른다. 아직 모델 호출/DB/권한/실제 실행 통합 테스트를 통과했다고 주장하지 않는다.

## 7. 구현 이관 후 다음 단계

1. Node.js 도메인/Action handler 안에 모델 응답 검증 + 별도 서버 권한·참조·상태 검증을 구축하고 fixtures를 실제 테스트로 이관.
2. 서버의 영속 Task/Graph/Run/Attempt/History 경계를 도입하고 현재 브라우저 실행기·customNodeStore로부터 안전하게 전환.
3. 계층 지침은 이번 ModelTurn/needs/행동 스키마를 보고 작성. 모델 공급자별 JSON Schema subset은 별도 adapter에서 필요한 형식으로 변환하고 효용을 실측한다.
4. 일반 모델 직접 사용 대비 첫 수행·두 번째 함수 재사용의 결과 품질/노동/비용을 실제 측정.

**주의:** JSON Schema Draft 2020-12를 실제 Ajv로 사용할 경우 2020 전용 인스턴스가 필요하며, 최신 제안 스키마가 특정 모델의 strict structured-output subset에 그대로 통과한다는 보장은 없다. 런타임 종속성 추가 및 provider 호환성은 아직 미결정.

## 8. 설계 역검증 기록 (2026-10-09)

**점검 방법:** 기존 동결 기준선 및 현재 `server.js`·`front/js/runtimeEngine.js`와 정합성 대조, 독립 경량 JSON Schema 규칙 검증기에서 27개 양성/음성 fixture 실행(13 허용 + 14 거부, 27 일치), `$ref` 정의 연결 37개 점검(누락 0). 경량 검사기는 스키마가 사용하는 주요 키워드(`type`, `properties`, `required`, `additionalProperties`, `$ref`, `oneOf`, `allOf`, `if/then`, `const`, `enum`, 최소·최대 조건)를 대상으로 한 **사전 점검**이며 정식 Draft 2020-12 표준 검증기 실행을 대신하지 않는다.

**설계 검토 중 보완한 결함:**
- ContextBundle에 참조만 있으면 '캔버스 설명'의 자료를 읽지 못하므로 `requestText`와 출처/축약 상태가 포함된 `materials[]` 추가.
- 함수 초안과 실제 검증된 FunctionVersion의 계약이 불명확하여 별도 `FunctionVersion`과 `verifiedEvidenceRefs` 구조적 의무 추가.
- 활성 Run으로 Patch를 채택할 때 대상 Run을 구분할 수 없어서 `active_run`에 `runRef + expectedPlanEpoch`를 함께 요구.
- 반환 형식만으로 모델이 인증 주체나 성공 상태를 생성하지 못하도록 `ModelTurn`을 허용 필드만 있는 닫힌 구조로 제한.

**미해결/필수 후속 검증:**
- 정식 JSON Schema Draft 2020-12 검증기로 schema 자체 및 fixtures를 재실행하고, Node.js Ajv 2020 호환 여부 확인.
- 모델 공급자의 tool/structured-output subset 변환, 실측 토큰·지연·정확도 확인.
- 도메인 검증(임시 참조/포트/권한/동시성/데이터 provenance)과 저장소 트랜잭션·재시도·재개를 실제 테스트로 구현.
- `Task.completed` 상태가 스키마를 통과하는 것은 **완료의 업무적 정당성을 보증하지 않는다**. 의도적으로 fixture에 구조상 허용 사례를 포함해 이 검증 경계를 분명히 한다.

**판정:** 논리 아키텍처를 수정하지 않고도 상세 형식 계약을 제안할 수 있음. **제안 문서 검토 완료, 실제 구현 또는 상세 계약 동결 아님.**

## 9. v1 상세 계약 보완(2026-10-09)

- `GraphPatch.graphId` 필수: 대상 그래프를 Revision 숫자만으로 추측하지 않는다.
- `ModelTurn.needs`가 있으면 v1에서는 `actions/outputs`를 함께 제출할 수 없다. 조회 장벽 이후 재평가한다.
- `NodeDefinitionVersion`의 `tool_task`에는 `requiredCapabilities`, `subgraph`에는 `procedureRef` 필수.
- `ContextBundle.materials`의 실제 내용·출처·축약·원문 요청 보존. 전체 payload 바이트/깊이는 별도 입구 검증으로 제한한다.
- [규격 검증 스크립트](validate_contract.py)와 [검증 사례 34개](DATA_CONTRACT_PROPOSAL_V1.cases.json)를 검증 범위에 추가했다. 기존 27개 검증 이력은 원문 그대로 보존한다.
