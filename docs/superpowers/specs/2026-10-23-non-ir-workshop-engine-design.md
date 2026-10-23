# Ovll beta — 비IR Workshop 실행 엔진 설계

**상태:** 2026-10-23 사용자 승인 방향의 세부 설계 명세. **아직 구현한 기능이 아니다.** 구현 계획 및 제품 코드 작업은 본 명세 검토 이후 진행한다.

## 1. 목적과 성공 기준

- **Gate → Hallway Initial → Workshop → Hallway Return(필요시 반복) → Output**의 실행 경로를 완성한다. 즉시 답할 수 있는 요청은 기존대로 최초 Hallway에서 종결한다.
- 기존 `docs/developing/workshops.md`의 IR 비의존 **11개 행동**만 구현 대상으로 삼는다. `defineFromIR`, IR 생성·실행, Saved Function 생성·실행은 제외한다.
- "모델이 성공했다고 말했다"와 "검증된 실행·저장 결과가 있다"를 구별한다. Skill 생성, Canvas 수정, 질문 대기는 실체가 확인된 경우에만 성공/진행 상태로 기록한다.
- 엔진은 DB, Render, 브라우저, IndexedDB, DOM, 전송 프로토콜을 직접 알지 않는다. 향후 서버가 자산을 DB로 옮기더라도 **포트 어댑터를 교체할 뿐 Engine coordinator/Workshop 판단·검증/복도·Output 의미는 그대로 유지**한다. 새로운 도메인 행동 추가 자체는 엔진 확장 대상일 수 있다.
- 사용자 요청으로 인프라 영속성을 높이는 것은 **향후 작업**이다. 이번 완성 기준은 엔진의 정확한 실행·실패 처리·종결이다.
- **금지:** `main` 변경, 기존 main 실행 계층 강제 이식, 모델 출력을 검증 없이 자산으로 적용, Skill과 Skill Block의 혼동, 테스트용 메모리 상태를 영속 원본이라고 주장.

## 2. 고려한 접근과 선택

| 방식 | 이점 | 판단 |
|---|---|---|
| 엔진 → 프론트 Canvas 직접 변경 | 현재 UI 활용 쉬움 | 브라우저 종속성·실행 성공 확인 애매 → 배제 |
| 엔진 → 특정 DB 테이블 직접 변경 | 초기 DB 접근 간단 | 마이그레이션 때 엔진 변경 강제 → 배제 |
| **엔진 → 데이터·행동·체크포인트 추상 포트** | 인프라 교체 독립성과 실행 사실 검증 | **선택**. Beta용 메모리 어댑터로 구현 |

Beta는 서버 메모리에 작업실의 검증된 자산·체크포인트를 유지하고, 프론트는 서버 확정 결과를 투영한다. 프론트와 서버 사이의 동기화는 **엔진 바깥**에서 처리한다.

## 3. 책임 경계

| 소유 컴포넌트 | 책임 | 금지 사항 |
|---|---|---|
| Engine coordinator | 계층 위치, 플랜·행동 커서, 재계획, 사용자 입력 대기·재개, 종료 제어 | 직접 DB/DOM 접근 |
| Gate | 추가 정보의 `need` 결정 | 실행 행동 선택 |
| Hallway Initial/Return | 요청 전체 목표·Workshop 종류·목표·순서 결정 및 결과 후 재계획 | Workshop 내부 행동·인수 선택 |
| Workshop decision | 해당 Workshop의 허용 행동 중 실제 행동 및 인수 선택 | 사전 검증 없이 부작용 발생 |
| Action validator | 인수 구조·대상·참조·revision·권한 경계 확인 | 모델의 잘못된 입력 임의 보정 |
| Asset execution port | 중복 방지·원자적 자산 변경·확정 결과 반환 | 모델 설명만 보고 성공 인정 |
| Checkpoint port | 요청별 실행 상태·진행 위치·검증 결과·대기 정보를 저장 | 맥락체와 맥락 데이터를 혼합 |
| Data read port | 대상 자료·실제 자산 정의·현 revision 제공 | 표시용 메타데이터를 실행 정의로 위장 |
| Event/transport adapter | 중간 발화·진행·질문·확정 결과 전달 | 이벤트 송신 성공을 자산 적용 성공으로 간주 |

**맥락 구분:** `contextBlock.intent/progress`는 **요청별**, `contextData.overallFlow/currentTopic/details`는 **방별**. `focus`는 **모델 호출마다** Engine이 단계와 검증된 결과에서 합성하며 영속 맥락체 필드로 저장하지 않는다. 원본 요청·계획·산출물·실행 기록은 각각 별도 데이터다.

## 4. 저장매체 중립 포트

기술 구현 계획에서 정확한 JS 함수와 타입으로 매핑할 다음 **논리 계약**을 고정한다.

~~~text
model.generate({layer, prompt, context, format})
prompts.compose(layer, bindings)

resources.resolve({scope, requestId, need, initialResources, contextData, history})
resources.readWorkbench({scope, selectors})
  -> {assets, revisions, completeness}

actions.apply({scope, requestId, operationId, action, args, expectedRevision})
  -> {status:"applied", operationId, changeSet, revisions, artifacts}
   | {status:"rejected" | "conflict", code, details}

checkpoints.load({scope, requestId})
  -> revisioned request checkpoint
checkpoints.save({scope, requestId, expectedRevision, next})
  -> confirmed checkpoint | conflict

events.publish({scope, requestId, eventId, kind, data})
  -> delivery status
~~~

- `scope`는 신뢰할 수 있는 서버 인프라가 확인한 접근 범위다. Beta는 room 단위지만, 운영에서는 사용자/테넌트 검증이 필요하다. 클라이언트가 임의로 보낸 roomId는 인증이 아니다.
- 서버가 `requestId`와 `operationId`를 발급한다. **동일 operationId 재전송은 동일 결과·부작용 1회**를 보장한다. 명시적 재계획에서 새로운 행동이 결정되었을 때만 새 ID를 쓴다.
- `expectedRevision`이 다르면 `conflict`, **변경 없음**. 아무 대상이나 덮어쓰는 낙관적 갱신은 금지한다.
- 자산 반영·operation ID 중복키·revision 갱신은 **한 원자적 적용 경계**다. 나중에 DB로 교체하면 어댑터가 이 의미를 트랜잭션으로 제공해야 한다.
- `actions.apply`에서 `applied`가 반환되었을 때만 자산 적용 성공이다. 브라우저 전달에 실패하더라도 성공한 행동을 취소한 척하거나 재실행하지 않는다. 프론트는 동기화 지연으로 따로 처리한다.
- 실행 결과를 받기 전 연결이 끊겼다면 operationId로 적용 여부를 확인한 다음 진행한다. **결과 불명인 작업을 새로운 ID로 무조건 재시도하지 않는다.**
- 체크포인트 최소 필드: `roomId`, `requestId`, `status`, `stage`, `contextBlock`, `contextDataRevision`, `plan`, `planCursor`, `actionCursor`, `verifiedResults`, `waiting`, `checkpointRevision`. 비밀키·모델 내부 지침을 공개 요청 스냅샷에 넣지 않는다.
- 데이터 완전성은 `complete / metadata / missing`으로 유지한다. 없는 자료는 `DATA_UNAVAILABLE`로 명시한다. 출처와 자산 버전을 속이지 않는다.

## 5. Workshop 행동 목록·사후 조건

| Workshop | 행동 | 성공·거절 기준 |
|---|---|---|
| `skillDefine` | `defineDirect` | 이름·설명·직접 작성된 지침·입출력·필드 정의 검증 후 **독립 Skill 자산** 생성; ID/revision 수신 |
| `skillDefine` | `revise` | 실제 완전 정의가 있는 Skill만 대상 revision으로 수정; 참조 중인 블록을 자동 재작성하지 않음 |
| `skillEdit` | `editAppearance` | 스킬 외형 속성만 변경; 동작 지침은 불변 |
| `skillEdit` | `delete` | 참조 중인 Skill 삭제 거절. 미참조 Skill만 제거하며 임의 연쇄 삭제 금지 |
| `canvasEdit` | `addBlock` | 존재하는 Skill 참조·배치 좌표·설정값을 검증해 **별도 Skill Block** 생성 |
| `canvasEdit` | `editBlock` | 해당 블록만 revision/필드 제약 확인 후 수정 |
| `canvasEdit` | `deleteBlock` | 블록과 그 블록에 연결된 링크를 **원자적으로** 함께 제거 |
| `canvasEdit` | `addLink` | 포트 존재, 입력/출력 방향, 타입, 중복, 다중 연결 제약, 순환을 검증 후 연결 |
| `canvasEdit` | `removeLink` | 존재하는 연결만 제거, 다른 링크 보존 |
| `textGenerate` | `basicText` | 진행 상황 등의 **중간 발화**를 확정 기록·전달; 최종 응답/자산 생성 아님 |
| `textGenerate` | `question` | 질문 내용 확정 후 사용자 입력 대기로 전환; 응답 전 완료 금지 |
| 계획 제어 | `terminate` | **Workshop이 아님.** 부작용 없이 Output 단계로 이동 |

- `defineFromIR`, Saved Function, IR 실행 작업은 이번 허용 목록에서 제외한다. 비슷한 작업을 다른 행동 이름으로 우회하지 않는다. 미지원 행동은 **`UNSUPPORTED_ACTION`**으로 거절하고 자산은 변경하지 않는다.
- `defineDirect` 성공은 **선언형 Skill 정의가 저장됐다는 뜻**이다. 그 Skill 내부에서 검색·파일 생성 등 실행 기능이 실제 수행됐음을 뜻하지 않는다.
- 표시용 내장 `front/js/skill/catalog.js`는 실행용 완전 Skill 정의가 아니다. 원본 없는 Skill에 대한 `revise`를 임의 허용하지 않는다. 읽기·배치·수정 허용 범위는 자산의 실제 완전성에 따르게 한다.
- Workshop은 하나의 목표 안에서 **한 번에 행동 하나 선택 → 인수 검증 → 실제 적용 → 확인된 결과 기반 다음 판단/완료**를 반복할 수 있다. Hallway가 내부 행동을 미리 지정하는 식으로 역할을 바꾸지 않는다.

## 6. 처리 단계와 종결 흐름

~~~text
queued → running:gate → running:hallwayInitial
                                 ├─ 직접 응답 → completed
                                 └─ 계획 생성
                                      ↓
                               running:workshop
                                 ├─ 검증·적용 성공 → 다음 행동/계획 단계
                                 ├─ question → awaiting_input → 재개
                                 ├─ 적용 실패·conflict → hallwayReturn
                                 └─ 현재 계획 소진
                                      ├─ terminate → output → completed
                                      └─ terminate 없음 → hallwayReturn → 새 계획
~~~

- **Gate:** 사용자 원문·기존 `contextData`·초기 리소스를 보고 필요한 추가 자료 조회만 수행한다.
- **Hallway Initial:** 직접 응답이면 `languageBlock/contextBlock/contextData` 반환 후 즉시 종결. 다른 행동·자료 요청 없이 `textGenerate(need:[]) → terminate`만 필요한 경우도 직접 응답으로 처리한다. 계획이면 `plan/contextBlock`만 생성한다.
- **Workshop:** 계획 항목의 `workshopName/objective/need`와 현재 자산·현재 요청 맥락체를 받고, 해당 전용 프롬프트의 허용 행동만 선택한다. 검증·적용·실행 결과가 확정될 때마다 체크포인트 갱신.
- **Hallway Return:** 검증된 결과·실패·기존 맥락체를 이용해 `plan/contextBlock`을 갱신. 최초 요청의 `intent` 보존, 미해결 부분과 실제 완료한 부분 구분. 의미 있는 추가 근거 없이 같은 실패 반복하지 않음.
- **Output:** `terminate` 이후에만 실행. 확정 결과를 근거로 최종 `languageBlock/contextBlock/contextData` 생성·검증·적용. 신규 행동 실행 금지. 직접 응답에는 Output 추가 호출 금지.
- **Output 오류:** 이미 변경된 자산을 되돌린 것으로 주장하지 않는다. 요청에는 확정 자산과 최종 응답 실패 사실을 모두 남기고, 추후 Output만 안전하게 재시도할 수 있게 한다.

### 6.1 질문 대기와 재개

- `textGenerate.question`은 사용자에게 질문을 보여주는 **대기형 행동**이다. 질문 메시지·requestId·waitingId·checkpoint revision을 저장하고 `awaiting_input`으로 전이한다. 이때 **실행 슬롯을 즉시 반환**한다.
- 전송 연결이 끊겨도 질문은 완료로 변하지 않는다. 외부 입력 포트가 답변 대상과 권한을 확인하고 **동일 요청의 continuation**으로 재개한다. 사용자 답변으로 최초 요청 원문을 덮어쓰지 않는다.
- 동일 waitingId의 중복 답변·늦은 응답은 한 번만 처리한다. 재개 후 답변과 이전 실행 결과를 이용해 해당 Workshop을 계속 진행하거나 Hallway로 복귀한다.
- 다른 요청이 대기 중 자산을 바꾸었다면 현재 revision을 다시 확인한다. 오래된 체크포인트를 다른 방의 최신 정보 위에 강제로 적용하지 않는다.
- `basicText`는 진행 메시지 확정 후 같은 실행을 계속한다. 질문 대기처럼 취급하지 않는다.

### 6.2 실패 및 반복 상한

- 스키마 위반·존재하지 않는 ID·권한 부족·revision 충돌·실제 적용 실패는 결과별로 구분하고, 가능한 경우 Hallway Return에 **검증된 실패**로 전달한다.
- 검증되지 않은 모델 JSON이나 적용 결과를 성공으로 간주하지 않는다. 적용 여부 불확실은 operationId 상태 조회가 선행한다.
- Beta 안전 기본 예산: **Hallway Return 최대 5회, Workshop 실제 행동 최대 24회, 전체 모델 호출 최대 40회/요청**. 설정은 변경 가능하지만 무한 루프 불허. 상한에 도달하면 추가 실행을 멈추고 확정된 결과·미해결 사항을 보존해 정직하게 종결/실패 처리한다.
- `terminate`는 계획 맨 끝에만 올 수 있으며 행동 없는 종료 표시다. 계획에 존재한다는 사실만으로 실제 작업을 성공했다고 하지 않는다.

## 7. Beta 인프라 연동과 미래 교체

- **임시 실행 원본:** 서버의 메모리 자산 어댑터에 room별 Skill 정의·Canvas 그래프, revision과 operation 적용 결과를 저장한다. 서버가 재시작하면 보존을 보장하지 않는다. 체크포인트도 동일하게 **임시**이다.
- **기존 프론트 구조:** `front/js/skill/catalog.js`는 표시용 카탈로그이고, `front/js/workspace/model.js`는 로컬 Canvas 편집 모델이다. 둘을 암묵적으로 서버의 검증된 자산으로 취급하지 않는다.
- **명시적 초기 동기화:** 처음 실행하거나 메모리 재시작 후 프론트 로컬 상태와 서버 상태의 출처·revision을 비교한다. 충돌 시 양쪽을 무조건 덮어쓰지 않는다. 수정 대상이 로컬에만 있다면 **검증된 baseline 가져오기/등록**을 별도 어댑터에서 처리하고 참조되는 Skill의 완전성을 확인한다. 불가능하면 해당 수정 요청을 거절하며 원본을 보존한다.
- **프론트 투영:** 서버에서 확정된 `changeSet`의 ID·revision을 받아 Skill 목록과 Canvas 화면을 갱신한다. 프론트 반영 실패 시 **동기화 실패**로 표시하며 이미 적용된 서버 행동을 중복 실행하지 않는다.
- **인프라 교체:** 이후 PostgreSQL/Supabase 등의 DB, 정식 인증, 전송/SSE와 별도 저장 계층을 도입해도 `resources/actions/checkpoints/events` 포트를 동일 의미로 구현하면 된다. 동일 행동을 메모리 포트와 DB 포트에 실행한 **계약 적합성 테스트**를 통과해야 한다.
- **Beta 보안 한계:** 테스트용 공유 토큰은 실서비스 인증이 아니다. 현재 운영 신뢰성·사용자별 완전 격리를 주장하지 않는다. 장래의 권한 검사는 인프라가 검증한 `scope`를 통해 강제한다.

## 8. 단계별 구현 검증 조건

1. **공통 엔진 계약·상태 머신:** 기존 직접 응답 회귀, 실행 순서, 체크포인트, 동작 완료/오류의 명시적 전이 검증.
2. **Workshop 행동 결정/전용 프롬프트 + textGenerate:** 직접 응답과 중간 발화 구분, 질문 대기·입력 재개·중복 답변 방지.
3. **Skill 자산 행동 4종:** 생성 후 서버 원본 조회, 실제 수정·외형 변경·삭제, 참조 중 삭제 거절.
4. **Canvas 자산 행동 5종:** 생성·수정·삭제·연결·해제, 잘못된 포트/순환/버전 충돌 거절, 서버 확정 투영.
5. **Hallway Return + Output:** 연속 계획·부분 계획·대안 재계획, `terminate` 종결, Output 실패 후 자산 행동 미재실행.
6. **메모리·프론트 통합:** 실제 HTTP 접수, 진행, 질문, 재개, 결과/오류, 브라우저 UI 동기화. 구현된 사실에 맞게 `docs/developing/` 및 `AGENTS.md` 갱신.

**필수 회귀 예시:** (a) 단순 인사는 Workshop 없이 종료, (b) Skill 새 정의→Canvas 블록→Output 완료, (c) Skill 개정·외형 변경·참조 중 삭제 거절, (d) Canvas 5행동과 불법 연결, (e) 중간 발화와 질문 대기 후 동일 요청 재개, (f) 방 사이 상태 분리, (g) 동일 operationId 재전송 효과 1회, (h) revision 충돌 후 재계획, (i) Output 실패 후 변경 재실행 없음, (j) IR 행동 미지원 시 무변경, (k) 저장 포트 교체 계약 테스트, (l) 맥락체/맥락데이터 수명 및 기존 Gate 기능 회귀.

**완료 판정:** 실제 저장된 상태를 재조회해 확인할 수 있어야 한다. 질문 대기·실행 실패는 정확한 상태로 보이고 가짜 완료를 만들지 않는다. 단위 테스트와 실제 Render/Gemini/브라우저 시험은 **서로 다른 검증 단계**이다.

## 9. 범위 확정과 구현자의 선택

**이번 설계에서 확정:** 비IR 11행동, `terminate`의 제어 단계 성격, 엔진/인프라 포트 분리, 서버 검증된 적용 결과만 성공, 질문 대기·재개, 멱등성·revision, Hallway Return/Output, 요청별 맥락체·방별 맥락 데이터, `main` 미수정.

**구현 계획에서 정할 세부:** 모듈·함수의 구체 이름, 공급자 네이티브 Function Calling 또는 엄격한 JSON 기반 행동 선택(허용 행동·서버 검증 동일), API URL, UI 투영의 디자인 및 이벤트명. 이러한 구현 선택이 위 책임·실행 의미·상태 전이를 바꾼다면 명세를 먼저 수정해야 한다.

**참고:** `docs/developing/architecture.md`, `workshops.md`, `context.md`, `prompt-composition.md`, `request-engine.md`, `docs/notes/request-state-sync.md`.
