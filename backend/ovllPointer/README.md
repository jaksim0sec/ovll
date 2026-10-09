# OvllPointer — 오블의 모델·행동 실행 아키텍처

## 역할
OvllPointer는 **대문(판단) → 소통/IR 구성/실행/함수화 → 언어화**의 논리적 역할을 구현한다. 각 역할마다 별도의 모델 호출을 강제하지 않는다. 행동 제안, 저장된 그래프, 실제 수행 결과를 구분한다.

## 실행 구성
- `server.js`: Express 진입점, 모니터링, 기존 HTTP 계약과 Pointer 라우트 연결
- `nodeCatalog.js`: 기존 고정형 캔버스 UI의 아이콘·기본 노드 정의 단일 원본
- `legacyCompatibility.js`: 저장된 이전 형식의 워크플로우와 함수 빌더를 깨지 않기 위한 **호환 어댑터**. 새로운 IR 생성·실행에 사용할 핵심 구조가 아님
- `localHttp.js`/`localHost.js`: 사용자 상태를 저장하지 않는 모델 호출 및 ModelTurn·NodeOutput 검증. 정식 라우트 `/api/pointer/local/*`
- `graph.js`, `executionPlan.js`, `validation.js`, `providers.js`: 동적 GraphPatch, 실행 계획, 데이터 계약, 공급자 독립 모델 인터페이스
- `front/js/ovllPointer*.js`: 대화별 로컬 그래프 저장, 노드 실행, 결과 기록, 함수 초안·재실행
- `sql/`, `durable.js`, `worker.js`: **비활성** PostgreSQL 기반 운영 모듈. `server.js`에 미연결. SQL이나 계정 생성은 현재 실행 조건이 아님

## 로컬 스토리지 호환성
`WorkspaceStore`의 기존 `ovll:workspace:v1` 키를 유지한다. `vnextGraph`/`vnextRuns` 옛 필드는 로딩할 때 `pointerGraph`/`pointerRuns`로 읽는다. `ovll:vnext:functions:v1` 함수 초안도 새 `ovll:pointer:functions:v1`로 전환 후 접근 가능하다.

## 호환 경계 — 제거하지 못한 기능
이전 사용자 워크플로우의 `/api/chat`, `/api/workflow`, `/api/execute-group`, `/api/finalize-run` 계약은 아직 실제 UI에서 사용된다. 이를 삭제하면 기존 데이터 및 함수 편집기 UX가 깨지므로 `legacyCompatibility.js`로 **격리만 완료**, 기능 자체 제거는 미완료다. 서버의 정식 신규 요청은 Pointer 라우트를 이용한다.

현재 로컬 Pointer의 `tool_task`, 서브그래프, 조건부 실행, 외부 출처의 사실 검증, 함수의 완전한 자연어 재사용 및 브라우저 통합 테스트 역시 미완성이다. 검증 전 전체 시스템 전환 완료로 표시하지 않는다.

## 추가 의존성 방침
기존 `GROQ_API_KEY` 또는 명시적 `OVLL_POINTER_MODEL_*` 설정으로만 모델 호출을 사용한다. 기존 `OVLL_VNEXT_MODEL_*` 환경변수도 이관 중 읽는다. 새 SQL/인증/유료 모델 의존성은 승인 없이 도입하지 않는다.

## 검증
`npm test`; `ovll-pointer-foundation`; `ovll-pointer-postgres-integration`(SQL 격리 테스트 전용); 실제 브라우저 통합·모델 품질 검사. 단위 테스트 통과는 실서비스 완성의 증명이 아니다.
