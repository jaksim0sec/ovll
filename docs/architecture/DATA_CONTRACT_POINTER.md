# Ovll 데이터 계약 OvllPointer — 상세 설계 초안

> **상태: 다음 단계 제안 / 미동결 / 코드 미구현.** [동결 기준선](BASELINE_2026-10-09.md)의 논리적 계약을 기계 검증 가능한 스키마로 옮기기 위한 초안. 아래 필드명·자료구조·상태값은 검토 대상이며 확정 API가 아니다.

## 1. 설계 경계와 데이터 소유권

| 경계 | 소유권 및 역할 |
| --- | --- |
| User Request / Task | 서버가 원문 요청·수정·제약을 참조 가능한 사실로 보유 |
| ContextBundle | 서버가 매 호출마다 필요한 일부 사실·권한 있는 조회 수단만 제공 |
| ProposalSet / needs | 모델은 제안/자료 요청만 반환. 사용자 역할·실제 권한·확정 상태를 지정하지 않음 |
| ActionEnvelope / ActionResult | 서버가 인증 주체·Task/Workspace·멱등 키·Revision 경계를 보충, 검증·상태 확정 |
| Graph / Definition / Function | 불변 구조·정의·재사용 계약; 의미/버전과 UI 좌표 분리 |
| Run / Attempt / Value | 실행 계획, 실제 시도, 결과와 근거·유효성 분리 |
| HistoryEvent | 서버 원본 기록. 압축 히스토리는 계산된 투영, 권위 있는 원본 아님 |

## 2. 공통 입력 / 출력 후보

**ContextBundle 최소 의미(일회성):** `taskRef`, `requestRef`, `constraints`, `purpose`, `capabilities`, `scopeRefs`, `historyDigest`, `outputContract`, `omissions`(실제 축약이 있을 때), `readHandle`(필요할 때). 모든 필드를 모든 호출에 넣지 않는다. 자동 제공·추가 조회 양쪽에 동일한 권한 경계 적용.

**LLM 반환:** `message?`, `actions[]?`, `outputs?`, `needs[]?`. 빈 배열·임의 빈 문자열을 강제하지 않는다. `actions[]` 요소는 `localKey`, `kind`, `args`, `dependsOn[]?` 의미를 갖는다. 동시 행동 간 ID 참조는 `localKey`를 사용하고 확정 ID인 척하지 않는다.

**서버 ActionEnvelope:** `actionId`, `actorRef`(서버 인증 정보), `workspaceRef`, `taskRef?`, `runRef?`, `idempotencyKey`, `expectedGraphRevision?`, `expectedPlanEpoch?`, `kind`, `args`. 모델이 actorRef나 권한을 임의로 부여할 수 없다.

**ActionResult:** `actionId`, `status`(rejected/applied/scheduled 등), `createdRefs?`, `newRevision?`, `runRef?`, `resultRefs?`, `error?`(`code`, `retryable`, `recoveryHint?`). 예약·진행·완료는 상태값을 혼동하지 않는다.

**needs:** `kind`(graph/definition/value/artifact/history/capability/contract 등), `selector`(정확한 대상·범위), `purpose`; 시스템은 부족한 정보·접근 거부·조회량 초과를 구별하여 반환한다. 관련 IR이 자명하면 서버에서 선제 제공할 수 있다.

## 3. 불변 도메인 데이터 후보

| 객체 | 최소 필드 또는 검증 대상 |
| --- | --- |
| Task | id, requestRef, objective, constraintRevisions, requiredOutcomes, outcomeEvidence, status, questionRefs, runRefs |
| GraphRevision | graphId, revision, parentRevision, nodes(instances), connections(kind: flow/data, endpoint+port), 생성 근거 |
| NodeDefinitionVersion | id, version, purpose, executorKind(model_task/tool_task/subgraph), inputContracts, outputContracts, instruction, requiredCapabilities |
| NodeInstance | id, definitionRef(버전 고정), inputBindings, settings; 현재 실행 상태/좌표는 포함하지 않음 |
| FunctionVersion | id, version, purpose, input/outputBoundary, invariants, procedureRef(고정), verificationStatus(draft/verified 등) |
| Run | id, taskRef, executionOwner, graphRevision, planEpoch, targets[], damMode(closed/open), status, budgets |
| Attempt | id, runRef, nodeRef, generation, definitionRef, inputRefs, executor/model/instruction fingerprint, status, outputRefs |
| Value / Artifact | id, semanticContract, contentRef, sourceRefs, producerAttemptRef, parseStatus/coverage/uncertainty(해당 시) |
| Question | id, taskRef, prompt, blockedActionRefs, status, answerRef? |
| HistoryEvent | eventId, taskRef, actionRef, type, status, targetRefs, before/afterRefs, resultRefs, time |
| Capability / InstructionModule | id, version, 실제 지원 조건 또는 activation/dependencies/conflicts/requiredCapabilities |

**비정상 사례:** 파일을 첨부했다는 이유만으로 내용을 읽었다고 간주하지 않는다. 정의·입력·모델/지침/실행기 조건이 달라진 Attempt 출력은 구버전 기록으로 보존하되 현재 결과로 무조건 수용하지 않는다.

## 4. IR Patch와 실행 연계 후보

- Patch의 의미 단위: `definitions[]`, `operations[]`, `expectedGraphRevision`, `adoption?(workspace_only/active_run)`. 새 노드 정의를 생성한 뒤 그 인스턴스와 연결을 같은 Patch에서 참조할 수 있다.
- 서버는 Patch 전체의 형식·포트/입출력 의미·cycle·capability·권한·Revision을 검증한 후 한 새 GraphRevision으로 확정한다. 하나라도 불가능하면 그 Patch는 반영하지 않는다.
- 동일 LLM 응답에서 Patch와 `run.start`가 함께 제안되면 후자가 전자의 `localKey`를 참조한다. 서버의 `createdRefs` 매핑으로 실행 타깃을 해석한 뒤 실행 의도·확인 정책·준비 상태를 검사한다.
- Patch의 성공과 이후 Run의 성공은 다른 사실이다. 실행을 예약하는 상태 전이와 pending 작업의 영속 기록은 원자적으로 보장해 크래시로 작업이 사라지지 않게 한다.
- **댐의 의미:** closed는 타깃+선행, open은 타깃에서 활성 flow 하류 선택 → 선택된 범위의 flow/data 선행 closure. 선행 노드의 형제 자동 실행 금지. 조건 분기·필수 입력·merge 충족은 별도 검사.

## 5. 실행 중 변경과 결과 수용

Workspace GraphRevision과 Run의 `planEpoch`를 독립 관리한다. 편집은 새 GraphRevision을 만들지만 기존 Run은 채택 전까지 원래 실행 계획을 유지한다. 초기 안전 정책은 관련 진행 Attempt가 없을 때만 변경 영향 범위를 채택하고, 영향받는 실행 중 Attempt가 있으면 대기·거부·별도 중단 요청으로 처리한다. 영향을 받지 않는 병렬 결과는 버전 번호만 바뀌었다는 이유로 폐기하지 않는다.

- fingerprint에 의미적으로 영향을 주는 값: definitionVersion, inputRefs, executorVersion, instructionVersion, actualModel, outputContract.
- 좌표·아이콘·접힘 같은 표현 상태는 fingerprint에서 제외한다.
- 외부 부작용의 `outcome_unknown`은 자동 중복 재실행하지 않고 결과 조회/조정을 요구한다.
- Task의 완료는 `requiredOutcomes` 충족 근거와 대기 중인 필수 작업이 없는지 확인한 뒤에만 허용한다.

## 6. 히스토리와 압축 맥락

`HistoryEvent`는 성공/실패한 서버 행동·대상·결과 참조를 기록한다. 이전 단계의 모든 Patch 원문을 다음 LLM에 넣지 않는다. 서버는 관련 이벤트로부터 짧은 문장을 결정적으로 조합한다.

예: `IR: created 10 nodes for comparison; rev8, validated, not executed.`

의미를 나타내는 'comparison'은 기존 Task 목적 또는 정의 메타데이터에서만 선택한다. 근거 없이 생성한 문장을 확정 기록에 섞지 않는다. 주로 최신 관련 사건을 전달하지만 작업 완료·실패 판단에 필요한 모든 참조는 보존한다. 단순 소통은 행동 히스토리 생략 가능; 질문·요청 변경·대기는 별도 상태로 저장한다.

## 7. 구현 전에 결정·검증할 사항

1. 행동별 JSON Schema와 허용 타입/크기/필수 조건; 공급자별 native tool/strict schema 호환.
2. 사용자·Workspace·Task 권한 모델과 각 `needs`/함수 재실행/툴 동작의 검증 방식.
3. Patch·Run 채택·Event·pending 작업의 영속 트랜잭션 및 멱등 키 범위.
4. flow/data·조건 분기·다중 타깃과 오류 복구/보류의 상태표.
5. 파일 파싱 출처/범위, History digest 압축 손실, 모델/업무별 실제 비용 상한.
6. 기존 브라우저 로컬 Run/customNodeStore에서 서버 권위로 이관하는 경계와 회귀 검사.
7. 모델별 직접 채팅과 Ovll의 같은 요청 품질·호출 수·지연·함수 2회차 노동 비교.

**검증 시나리오(필수):** 일반 대화 직답, 캔버스 설명에 IR 제공, IR 10개 생성 뒤 압축 히스토리, Patch+복수 실행 종속, 없는 타깃 원자적 실패, 낡은 Revision 충돌, 사용자 실행 금지, 재시도 중복 방지, 병렬 중 일부 수정, 실행 결과 기반 새 정의, 질문 후 복귀, 저장 함수 재사용·버전 보호, 악성 문서 내용의 명령 승격 방지, 권한 없는 맥락 조회 거부, 무한 재계획 예산 종료.

## 8. 다음 작업 절차

최소 행동/객체 스키마 작성 → 별도 검증 fixture와 오류 계약 확정 → 계층형 프롬프트 조합 → 실제 LLM 통합 시나리오 검증 → 수직 단위 코드 이관. 구현 선택을 동결 기준선에 소급하여 기정사실화하지 않는다.
