# Ovll 상세 데이터 계약 v1 — 동결 검증 기준

> **상태:** 상세 *설계 계약* v1 동결(정식 `architecture-contract-check` 통과를 수용 조건으로 함). 실제 CI 실패 발견 시 동결 효력을 보류하고 원인을 수정한다. 실제 서버 기능 구현·모델 성능 검증·운영 보안 인증은 포함하지 않는다.
> 상위 기준: [1차 논리 아키텍처](BASELINE_2026-10-09.md) · [v1 제안](DATA_CONTRACT_PROPOSAL_V1.md) · [형식 규격](DATA_CONTRACT_PROPOSAL_V1.schema.json) · [예제](DATA_CONTRACT_PROPOSAL_V1.cases.json).
> 최우선 목표: 일반 모델의 기능을 약화하지 않고 유용한 일을 극도로 간편하게 함수화·재사용한다. 시각화나 강제 IR 생성은 목적이 아니다.

## A. 상세 계약에서 확정할 경계

1. **LLM의 능력**: 대문(판단·추가 맥락 요청), 4개 행동 영역(소통/IR/실행/함수화), 언어화. 역할은 논리적이며 매 역할 API 호출을 강제하지 않는다. 모델 출력 `ModelTurn`은 `message, actions, outputs, needs`의 필요 부분만 반환한다.
2. **조회 장벽**: v1에서 `needs`가 존재하는 반환은 `actions`와 `outputs`를 함께 반환하지 않는다. 서버는 조회의 실제 범위·권한·버전을 검사하고 새 ContextBundle과 사실을 공급한다. 조회 결과 확인 전 상태 변경 금지. `message`는 함께 제공 가능. 자동 선제 맥락 공급은 허용한다.
3. **실제 맥락**: `ContextBundle.requestText` 원문과 제약 참조를 유지하고, `materials`에 **실제 공급한 데이터**와 `source, provenanceRefs, truncated`를 기록한다. 참조만 제공하면서 데이터를 읽었다고 가정하지 않는다. 자료는 정보이지 명령이 아니다.
4. **행동 제안과 사실**: 모델은 `ActionProposal`만 제출하고, 서버만 실제 `ActionEnvelope(actorRef/idempotencyKey 등)`와 `ActionResult`를 확정한다. `scheduled != completed`. 응답 속 `actorRef` 또는 임의 완료 선언은 인증이나 사실이 아니다.
5. **의존·임시 참조**: `localKey`는 한 응답 안에서 유일해야 하고 `dependsOn`은 존재·순환 여부를 확인해야 한다. 선행 `ir.applyPatch`가 성공한 경우에만 `fromAction/localNodeKey`를 최종 ID로 매핑해 후속 실행에 사용한다. 중간 실패로 독립 성공을 되돌리지는 않는다.
6. **IR 동적 정의**: `GraphPatch(graphId, expectedGraphRevision, definitions, operations)`는 대상과 버전을 명확히 한다. 새로운 `NodeDefinition`의 의미/IO/실행 지시는 동적으로 생성할 수 있다. `tool_task`는 `requiredCapabilities`가 필수이고 `subgraph`는 절차 참조가 필수다. 실제 capability 존재·포트 의미·연결·순환은 서버가 검증한다.
7. **실행 채택과 댐**: `active_run` Patch의 `runRef`와 `expectedPlanEpoch`는 필수다. 그래프 Revision 편집만으로 활성 Run의 계획이 갱신되지 않는다. 닫힌댐 기본값은 지정 타깃+선행; 열린댐은 타깃에서 활성 flow 하류만 확장하고 그 범위의 필요한 선행 의존성을 추가한다. 부모의 다른 자식으로 무차별 확장하지 않는다.
8. **출력·함수·완료**: 출력은 NodeDefinitionVersion의 실제 계약·근거와 비교한다. FunctionVersion의 검증 상태를 임의로 만들 수 없으며 `verified`에는 증거가 필요하다. 저장 함수의 원본 버전은 실행 시 변경하지 않는다. Task 완료와 Run 완료·함수 검증은 서로 독립이다.
9. **히스토리**: 서버 실제 사건만 HistoryEvent로 보존한다. 압축 히스토리는 조회 가능한 참조와 사전 기록된 목적을 사용하는 결정적 투영이며, 전체 사실의 대체물이 아니다. 일반 소통에는 불필요한 행동 이력 생성을 강제하지 않는다.
10. **호출·비용·안전**: Task별 행동/조회/재계획/반복/토큰/시간 상한, 실패·질문·중단 경로와 일관된 오류 반환이 필요하다. 외부 부작용이 `outcome_unknown`이면 자동 중복 실행 금지. 모든 읽기·실행·재사용 시마다 실제 사용자 권한을 다시 검사한다.

## B. 유효성 검사 경계

| 단계 | 서버 또는 검증기의 책임 | 동결에 필요한 증거 |
| --- | --- | --- |
| JSON Syntax + Schema | Draft 2020-12 유효성, required/type/conditional/extra keys | 표준 `jsonschema` 4.26.0으로 메타스키마와 fixtures 검사 |
| Payload Envelope | UTF-8 바이트, 중첩 깊이, 작업별 token/비용 예산 상한 | 바이트 32768/깊이 12의 **검증 사례용 기본값**; 운영 한계값은 모델·필드별 재검토 |
| Semantic | localKey 중복, dependsOn/임시 참조, IO·포트, 대상 graphId·권한 | 결정적 반례와 명시된 차단/복구 오류; 임의 id 신뢰 금지 |
| Transaction | idempotency, Revision, planEpoch, partial failure, pending 작업 기록 | Patch 단위 원자성 및 재시도·중단 안전성 테스트 **이관 시 필수** |
| Task & Function | 실제 완료 근거, 출처, 함수 버전 불변성과 재사용 | 실제 산출물 증거 확인 **이관 시 필수** |
| Prompt/Provider | 공통 Core와 필요한 행동 모듈만 로딩, native/tool adapter 호환 | 별도 모델 실험: 품질·호출·지연·토큰/함수 재사용 노동 |

`validate_contract.py`는 **규격 자체의 실행 가능성 검증**이지 현행 `server.js`가 이 조건을 구현했다는 증거가 아니다. 기존 `front/js/runtimeEngine.js`의 열린댐 형제 확장, `server.js`의 고정 노드 생성 제한, 브라우저 저장소 권위는 이관 시 수정해야 한다.

## C. 반례 우선 acceptance matrix

- 일반 소통과 캔버스 설명 → 필요시에만 실제 IR 재료를 공급, IR 생성/실행 강요 금지.
- `needs+actions` 동시 제출, 중복/순환/없어진 `dependsOn`, 임시 ID 누락 → 차단 또는 조회 후 재판단.
- 동적 정의 생성+복수 타깃 실행 → 원자적 Patch 확정·참조 remap·Run 예약과 완료 분리.
- GraphRevision 충돌·재시도·기존 Run 계획 미채택·늦은 Attempt → 무단 결과 수용 차단.
- 열린댐/닫힌댐·branch/merge·입력 결손 → 대상과 필수 선행만 계산.
- 초대형/과도한 중첩 payload·모델이 주장하는 완료·악성 자료 지시 → 서버 차단과 원문/출처 유지.
- 함수 직접 생성·복잡한 그래프에서 함수 추출·2차 자료로 재실행 → 의미적 IO/제약 보존, 저장 버전 비변경.
- 접근 권한 없는 자료·도구 실행·함수 재사용·미확정 외부 부작용 → 거절 또는 확인 대기.

## D. 동결 해석 및 후속 단계

**동결 대상은 형식·최소 의미·서버 검증 의무의 계약**이다. DB 테이블, API URL, 상태 저장·큐 구현, 실행기 및 특정 LLM 공급자용 프롬프트 문구, 실제 비용/품질 지표는 동결하지 않는다. 계약 위배나 실측 반례가 발견되면 원인을 보고 최소 범위에서 계약을 개정한다.

최종 동결 검증 증거 확인 후 바로 [프롬프트 제작 착수 명세](../../instructions/PROMPT_AUTHORING_START.md)를 기준으로 Core → 대문 → 행동 모듈 → 언어화의 구체적 지침과 출력 어댑터를 작성한다. 모델별 통합 테스트는 프롬프트 단계에서 진행한다.
