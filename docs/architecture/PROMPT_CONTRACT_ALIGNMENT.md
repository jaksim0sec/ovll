# Ovll 프롬프트·출력 계약 정합성 — 2026-10-11

기준 main: 2face8a · 설계: GitHub #23 · APP_VERSION: 2026.10.11.13 · assemblyVersion: 0.4.2

## 실제 문제와 수정

이전 평가 CLI는 과거 모듈 본문만 대체하고 양쪽에 현재 localHost/modelContract/제품 규칙을 사용했다. 출력 계약 변경의 전후 비교가 불가능한 상태였다. 이제 baseline/candidate 전체 소스를 각각 고정 SHA에서 임시 디렉터리에 풀고 해당 host·composer·계약을 import한다. 의존성 환경, provider 설정, fixtures와 requestRef는 공유한다. candidate 생략 시 작업 디렉터리가 아니라 **커밋된 HEAD**를 사용한다.

host가 gateway에 제출한 요청의 메시지별 UTF-8 bytes/SHA-256, wire schema 이름/지문, 모델 설정을 기록한다. live 경로에서는 adapter가 실제 HTTP로 보내는 payload의 bytes/지문·schema 지문·응답 상태도 따로 기록한다. host의 schema 제안과 provider의 plain JSON fallback을 구분한다. 입력 원문·모델 출력·API 키·전송 URL/헤더는 보고서에 기록하지 않는다. 기본 대상은 기존 6개와 경계 4개, 총 10개다. 반복 표본 수, 호출·repair·fallback, provider token usage와 구조 성공을 구분한다.

각 case/표본/variant마다 같은 설정의 새 gateway를 사용한다. baseline의 schema 거부 캐시와 rate-limit cooldown이 candidate에 영향을 주지 않는다. host 상한은 초기 호출·대체 provider·repair를 포함한 3회이며 repair 상한은 기존 1회다. adapter의 최대 2회 시도와 schema 거부 후 최대 2회 시도를 포함하면 물리 호출의 이론상 상한은 평가 하나당 12회다. dry-run은 두 variant 전체의 상한을 공개하고 보고서의 providerCalls는 실제 fetch 시도 수로 센다. host 보고 수는 별도 reportedProviderCalls로 남긴다. 로컬 상한 거부는 providerCalls:0이다.

단일 case enum이나 키워드 라우터는 추가하지 않았다. 설명+저장, 정의+연결+실행의 복합 행동을 유지한다. 편집·저장만으로 실행 허가가 생기지 않는다. 동적 정의/노드 생성, 그래프 검증, repair 횟수와 provider 전송 schema는 유지한다. 조건부 모듈 공급·typed wire·모델 변경은 포함하지 않는다.

## 규칙 책임과 참조

| 위치 | 책임 |
|---|---|
| core | 현재 요청·제약, 실제 증거, 신뢰 경계, needs 장벽, 공통 소통 |
| entry | 행동 조합, 실행·저장 권한, 질문 기준 |
| ir / define / patch / connect | 정의 수명 / 재사용·신규 생성 / atomic 변경 / 실제 값·다중 입력·export |
| function / extract / reuse | 목적·IO·불변 조건 / 공개 매핑·저장 절차 / 새 입력 재사용 |
| modelContract | 전송 형식, 선언·참조 키, schema에서 파생한 operation 필드, 완전한 예시 |

DefinitionDraft 선언 localKey와 참조 definitionRef.localDefinitionKey를 구분한다. action localKey는 dependsOn/fromAction에, 새 node localNodeKey는 patch endpoint/run target에 사용한다. 기존 대상은 실제 nodeId 또는 definitionId/version이다. wire argsJson은 canonical action.args의 JSON이며 ir.applyPatch의 patch 래퍼를 유지한다.

동일 의미의 규칙을 소유 위치로 옮기되 turn/node/response의 실제 조립 경로에 필요한 권한·증거 지침을 남겼다. 질문은 목적·입력·대상·권한·지속 변경이 실질적으로 달라지는 불확실성에 사용한다. 안전 제한을 약하게 만들거나 검증기를 완화하지 않았다.

## 예시와 경계 평가

완전한 예시는 설명만, 기존 노드 편집만, 새 정의+인스턴스 생성만, 생성 후 실행의 네 종류다. 각각 독립 요청과 그래프 fixture를 가지며 canonical 객체 한 벌에서 wire를 생성한다. schema/phase 검사, decode 왕복, 실제 MemoryGraphRepository.apply와 생성 target 해석, host의 repair 없는 반환을 검증했다.

평가의 chat/new-kind/edit-only/reuse-run/compose-run/pdf-export를 유지하고 explain-save/new-kind-run/multi-source/read-before-plan을 추가했다. 새 네 사례는 프롬프트 예시를 복사한 정답 검사가 아니다. 채점기가 정상 제안에 추가된 무단 저장·실행 대상·관련 없는 계약 조회·삭제를 통과시키던 결함을 재현 후 수정했다. 각 fixture의 모든 action/target/read/operation과 개수를 검사한다. 이 제한은 평가 정답의 요청 범위이며 제품 모델의 일반 행동 제한으로 적용하지 않는다.

결과 fixture는 실제 프론트 coordinator의 resultIndex와 동일한 runId/status/outputs 배열·port/ref/preview/truncated/count 형식을 사용하며 실제 함수 출력과 비교한다. stale 결과 및 잘린 preview의 조회·내보내기 결과까지 검증한 것은 아니다.

고정 응답을 사용하는 오프라인 검사는 transport·실제 참조·실행 권한 장벽·채점 정합성을 확인한다. 모델이 프롬프트를 보고 올바른 결정을 내렸다는 증거가 아니다.

## 평가 도구 사용

~~~bash
# 키와 provider 호출 없이 범위 확인
node scripts/eval-pointer-prompts.mjs

# 두 커밋의 실제 canonical/wire host 요청 조립 확인
node scripts/eval-pointer-prompts.mjs --inspect --baseline 2face8a --candidate <candidate-sha>

# 모델 접근·평가 예산이 있을 때만 실행
node scripts/eval-pointer-prompts.mjs --allow-live --baseline 2face8a --candidate <candidate-sha> --samples 3
~~~

inspect와 allow-live는 함께 사용할 수 없다. inspection은 고정 설명 응답의 offline gateway를 사용하며 모델 행동을 채점하지 않는다. 두 스냅샷은 동일한 설치된 dependency 환경에서 실행한다. 의존성 버전 변경을 비교하는 도구는 아니다. 정상 git 이력과 node_modules가 필요하고 추출한 임시 소스는 종료 시 정리한다.

## 검증과 한계

스냅샷 계약·제품 규칙·wire schema 분리, 네 예시, 복합 요청·다중 입력·계약 선행 조회·무단 추가 작업의 회귀를 실패→통과로 확인했다. 독립 리뷰의 중요한 지적 3개와 fixture 형식 지적 1개를 수정하고, schema fallback의 양쪽 독립 전송 및 primary 실패→standby invalid JSON→실제 repair를 가짜 HTTP로 재현했다. 전체 테스트 697/697, 독립 JSON Schema/추상 의미/경계 검사 51/51 통과. 독립 추상 검사는 실제 실행 통합 검증과 구분한다. 최종 원격 CI와 리뷰 결과는 #23 실행 기록에서 관리한다.

실제 모델 호출은 0회다. 모델 행동 개선, 사용자 총노동 감소, 배포 브라우저/PDF 화면은 미검증이다. M4의 실모델·제품 결과 부분을 오프라인 성공으로 대체하지 않는다.

10개 선택 모듈의 trim한 UTF-8 내용은 10,487→8,733 bytes, canonical 계약은 4,800→5,091, wire 계약은 4,997→5,626, turn wire guidance는 402→183 bytes다. wire 경로 부분합은 15,886→14,542 bytes다. 제품 소통 규칙·구분자·사용자/그래프 문맥·schema·repair 제외이며 token/API 비용이나 성능 수치가 아니다. 아이콘 33개와 호출 시 모듈 공급 범위는 유지했다.
