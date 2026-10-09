# Ovll vNext — 독립 백엔드 핵심틀·검증 게이트

> 상태: **병렬 기반 구현 / 기존 서비스 미전환**. 동결된 [VISION](../VISION.md), [논리 아키텍처](BASELINE_2026-10-09.md), [데이터 계약 v1](DATA_CONTRACT_V1_FREEZE.md)을 상위 기준으로 삼는다. 현재 코드를 표준으로 삼지 않는다.
>
> 현재 `backend/vnext/`는 **구조·안전 경계 참조 구현**이다. 메모리 저장소를 운영 환경에 연결하면 작업/이벤트 유실이 발생하므로 금지한다.

## 1. 설계 의사결정

- **전면 교체를 위한 병렬 경로:** `server.js`를 계속 패치하지 않고 `backend/vnext/`에 독립 계층을 구축한다. 기존 Canvas/UX는 유지한다. 완성 후 경계 어댑터를 통해 점진 전환한다.
- **서버의 권한은 운영상 사실에만:** Task, GraphRevision, NodeDefinitionVersion, FunctionVersion, Run, Attempt, HistoryEvent의 주인은 서버다. LLM은 답변·조회·변경안을 제안하며 승인·상태·ID·검증 성공을 확정하지 못한다.
- **LLM 호출과 실제 실행을 분리:** `ModelGateway`는 모델-독립 호출 계약, `ProviderAdapter`는 개별 공급자의 wire format/stream/tool/schema 지원을 담당. `ProposalKernel`은 행동 의존성·권한·정합성만; Run의 실제 큐·스케줄러는 별개다.
- **클라이언트와의 통신:** 단발 명령·조회는 인증된 HTTP API, 진행/변경 알림은 SSE(+ `Last-Event-ID` 재연결). SSE는 상태의 원본이 아니다. 재접속은 마지막 커서부터 받고 누락 발생 시 스냅샷 재조회. 스트리밍 텍스트는 추후 별도 전용 이벤트 타입.
- **IR과 Canvas:** 서버 GraphRevision의 의미 모델은 표준; UI의 위치, 확대/축소, 색상, 접힘, 제스처는 별도 CanvasViewState. 기존 화면/노드 미감은 유지하되 현재 `runtimeEngine.js`·자연어 생성기/맥락유지 체계와 내부 계약을 억지로 맞추지 않는다.
- **함수화:** 작업 완료 증거에서 재사용 가치 후보를 식별 → 의미적 IO/제약을 모델과 사용자가 점검 → draft FunctionVersion 저장 → 검증 근거를 갖춘 경우에만 verified. 후보 발견과 자동 저장/실행은 별개다.
- **동적 노드:** 고정 nodeType 제한은 제거할 목표다. 의미적 정의·IO·필요 능력을 버전으로 관리하고, 실행기 종류만 제한된 `model_task/tool_task/subgraph` 중 선언한다. 사용자가 고정 절차를 지정하면 보존한다.

## 2. 지금 만든 핵심 모듈과 경계

| 파일 | 구현된 책임 | 구현하지 않은 것 |
| --- | --- | --- |
| `backend/vnext/graph.js` | 메모리 GraphRevision 보존, 동적 정의/버전, 원자적 Patch, Rev 충돌, 포트/data/순환 검사, 열린/닫힌댐 범위 계산 | 영속 트랜잭션, 실제 조건 분기/merge, 세밀한 flow 계약·프로토콜 |
| `backend/vnext/actions.js` | 서버 범위/권한 검사, 중복/순환 행동 의존성, 선행 Patch 임시 ID 매핑, 호출 내 멱등, 적용/거절/예약 구별 | 영속 멱등성, 작업 재개, 전체 Action 종류 구현 |
| `backend/vnext/providers.js` | 공급자 독립 `ModelGateway`, 기능 프로필, OpenAI-compatible Chat 어댑터, 네트워크 오류 정규화 | Gemini Interactions/Anthropic Messages/OpenAI Responses 별도 어댑터, streaming/tool calls, prompt cache별 비용 |
| `backend/vnext/events.js` | Workspace 구분 메모리 이벤트, 단조 증가 ID, 재생/커서 간극, SSE 프레이밍 | DB 이벤트 보존, 멀티 인스턴스 fan-out, 권한 회수 시 재연결 |
| `backend/vnext/functionization.js` | 증거 충족된 Task에서 함수화 후보 제안, 저장/검증을 임의 처리하지 않음 | 의미적 함수 계약 LLM 추출, FunctionVersion 저장/실행, 후보 랭킹 |
| `backend/vnext/http.js` | opt-in Express 앱, 주입형 인증/인가(필수), 그래프 생성·조회·turn 제안·SSE | 기존 `server.js` 장착, 브라우저 새 API 연결, 배포 운영 설정 |
| `test/vnextFoundation.test.js` | 동적 IR/원자성/Revision/댐/권한/멱등/API 등 새 코어 회귀 테스트 | 실제 외부 모델 결과, 영속 저장·크래시 복구, 현행 앱의 이전 UX 전체 |

**안전 기본값:** 인증·스키마 검증 함수가 없으면 ProposalKernel 생성 거부. `run.start`는 신뢰 가능한 영속 `scheduleRun`이 없으면 `DURABLE_QUEUE_REQUIRED`로 거부. `active_run` 변경도 영속 안전 채택 구현 전 거부한다. 예시로 제시된 메모리 도구/의존성을 운영에서 주입하면 안 된다.

## 3. 실제 프론트/백엔드 통신안

1. 서버 인증 후 클라이언트는 `GET /api/vnext/graphs/:graphId`로 원본 스냅샷과 revision을 가져온다.
2. 사용자의 변경 또는 모델 제안은 `POST /api/vnext/turns`로 제출한다. `Idempotency-Key`는 사용자 입력에서 온 임의 actor ID가 아니며, 세션/Workspace 범위와 결합해 재시도 충돌을 방지한다.
3. 서버는 `ActionResult`를 즉시 반환한다. `applied/scheduled/rejected/awaiting_confirmation`을 구분하고, 실행 예약 이후 완료는 별도 사건으로 받는다.
4. SSE `GET /api/vnext/events`는 이벤트 알림. 재연결 시 `Last-Event-ID`. 간극(`resync_required`) 발생 시 최신 스냅샷과 작업 상태를 재조회한다.
5. 프론트는 `CanvasViewState`(위치/선택/레이아웃/접힘)만 소유하고, 실행 권위·노드 의미·Task 상태는 서버에서 동기화한다. 노드 ID ↔ 실제 DOM ID 연결 어댑터는 이관 단계에 만든다.
6. **운영 전 필수:** 세션 쿠키 보안/CSRF 또는 토큰·CORS 정책, Workspace membership, SSE 권한 재검사, 영속 event journal, 끊김·중복·재접속 테스트.

## 4. API 범용화 목표와 의도적 한계

공통 모델 호출 계약은 `{providerId, model, messages, output, signal, maxOutputTokens}` → `{text, usage, providerRequestId, providerId, model}`. 공급자에 없는 기능을 가장해 호출하지 않고 capability로 거절한다. 시스템 내부 `ModelTurn` 해석과 JSON Schema 검증은 **호출기 바깥**의 독립 후처리다. 공급자 native tool call과 구조화 JSON은 정규화 어댑터를 통해 공통 Proposal로 전환하되 원문, 사용량, 종료 사유, 공급자 모델 정보를 보존한다.

OpenAI Responses의 스트리밍 이벤트, Claude Messages의 `content_block_delta`, Gemini Interactions의 `step.delta`는 서로 다르므로 **공급자 SSE를 프론트에 그대로 전달하지 않는다**. 서버가 `text.delta / action.proposed / action.applied / run.state / result.ready / error` 등 자체 이벤트로 변환한다. 현재 구현은 OpenAI-compatible Chat 비스트리밍까지만 지원한다.

## 5. 순차 구현·검증 체크리스트 (사용자 확인 없이 기술적 작업 순서 유지)

### P0 — 표준 경계 / 독립 핵심틀
- [x] 동결 계약/기존 Canvas 경계 검토.
- [x] 새 GraphRevision 저장 인터페이스·동적 정의·Patch와 설계상 댐 범위 참조 구현.
- [x] ProposalKernel, 권한 주입, 의존성·임시 ID 해석, 서버 fact/result 구분.
- [x] ProviderGateway와 하나의 공급자별 기본 어댑터 분리.
- [x] SSE replay 계약 및 opt-in HTTP 진입점.
- [x] 함수화 후보의 증거 기반 gate.
- [ ] vNext 단독 회귀 CI 통과 확인 (실제 결과에 맞게 상태 갱신).

### P1 — 실행 가능한 운영 코어 (다음 우선순위)
- [ ] PostgreSQL/SQLite 등 **영속 Task/Graph/Definition/Function/Run/Attempt/Event 저장소** 결정, 마이그레이션/인덱스/권한 경계 및 실제 트랜잭션 구현.
- [ ] 실제 Identity/Workspace membership + 읽기/수정/파일/도구/함수 재실행 권한; 인증/인가 접근 시점과 스냅샷 권한 회수.
- [ ] Draft 2020-12 JSON Schema 운영 검증기, payload bytes/depth, 참조 provenance/사이클/포트/조건 branch/merge/예산 단위 테스트.
- [ ] 내구성 있는 Run 예약 outbox + worker + 크래시 재개/중복 요청/모호한 외부 효과 방지.
- [ ] planEpoch, 영향범위 재계산, Attempt fingerprint, 부분 무효화/병렬 보존.
- [ ] 모든 action 종류(질문·중단·재시도·함수 저장 등)의 상태 머신/오류/완료 근거.

### P2 — 모델 호출·프롬프트·재사용
- [ ] 이전 v0.2 프롬프트 25개 원본을 `instructions/` 라이브러리와 확정 registry로 연결.
- [ ] Prompt Composer(안정 prefix → 선택 layer → micro → dynamic ContextBundle)·provider cache usage 측정.
- [ ] Gemini Interactions/Anthropic/OpenAI Responses의 adapter와 streaming normalization, 프롬프트/Tool JSON 기능 부분집합 검증.
- [ ] 실제 문서·웹·도구의 컨텍스트 조회/유효성 검증, 악성 자료 지시 분리.
- [ ] 명시적 함수화 + 작업 성공 후 후보 제안 + FunctionVersion draft/verified 및 2회차 재사용 세로 슬라이스.
- [ ] 동일 작업에서 기존 모델 단독 vs Ovll 품질·비용·반복 노동 비교.

### P3 — 프론트와 UX 보존 이관
- [ ] 기존 Canvas 노드 표시/연결/선택/편집의 semantics↔viewstate 어댑터.
- [ ] 모바일/PC 그래프 조작·마스코트·컴포저·다크/라이트 UX 회귀.
- [ ] SSE 재연결/스냅샷 동기화/낙관적 UI·충돌 해결/백그라운드 복귀 테스트.
- [ ] feature flag 기반 수직 단위 cutover; 기존 실행기 제거는 동등 기능 확인 이후.
- [ ] 기존 `npm test`에서 이전부터 실패 중인 12개 UI 테스트를 **별도 조사**. 프롬프트/새 코어 변경을 이유로 무작정 테스트 삭제하지 않는다.

### P4 — 베타 판단
- [ ] 인증·권한 침해/오염·무한 루프·코스트 폭주 테스트, 관측·롤백·스냅샷 복구.
- [ ] 실 사용자 첫 수행/2회차 재사용 노동 감소가 제품 비전에 실제로 기여하는지 검증.

## 6. 검증과 완료 정의

P0는 **새 코어 단독 테스트 통과**까지만 뜻하며 '운영 가능한 서버 완성'이 아니다. P1의 영속성·권한·큐·상태 머신, P2의 실제 provider·프롬프트 검증, P3의 UI 호환 전에는 서비스 코드 전환 금지. `server.js`는 프로젝트 버전 규칙 때문에 버전만 변경할 수 있으며, 핵심 구조는 새 backend에 만든다.

참고: [OpenAI Responses SSE](https://developers.openai.com/api/reference/resources/responses/streaming-events), [Claude Messages 스트리밍](https://platform.claude.com/docs/en/build-with-claude/streaming), [Gemini 스트리밍](https://ai.google.dev/gemini-api/docs/streaming), [Groq API 호환성](https://console.groq.com/docs/openai).
