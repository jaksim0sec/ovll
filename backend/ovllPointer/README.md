# OvllPointer — 오블의 모델·행동 실행 아키텍처

## 역할
OvllPointer는 **대문(판단) → 소통/IR 구성/실행/함수화 → 언어화**의 논리적 역할을 구현한다. 각 역할마다 별도의 모델 호출을 강제하지 않는다. 행동 제안, 저장된 그래프, 실제 수행 결과를 구분한다.

## 실행 구성
- `server.js`: Express 진입점, 모니터링, 파일 API와 Pointer 모델 라우트 연결
- `nodeCatalog.js`: 기존 UI 아이콘·기본 정의와 canonical Pointer 정의의 단일 원본 (`GET /api/pointer/local/catalog`)
- `legacyCompatibility.js`와 `backend/ai/geminiExecution.js`: 이전 구현 코드. **현재 서버 진입점과 UI 요청/실행 경로에서는 사용하지 않음**
- `localHttp.js`/`localHost.js`: 사용자 상태를 저장하지 않는 모델 호출 및 ModelTurn·NodeOutput 검증. 정식 라우트 `/api/pointer/local/{turn,node,response}`
- `graph.js`, `executionPlan.js`, `validation.js`, `providers.js`: 동적 GraphPatch, 실행 계획, 데이터 계약, 공급자 독립 모델 인터페이스
- `front/js/ovllPointer*.js`: 대화별 로컬 그래프 저장, 노드 실행, 결과 기록, 함수 초안·재실행
- `sql/`, `durable.js`, `worker.js`: **비활성** PostgreSQL 기반 운영 모듈. `server.js`에 미연결. SQL이나 계정 생성은 현재 실행 조건이 아님

## 로컬 스토리지 호환성
`WorkspaceStore`의 기존 `ovll:workspace:v1` 키를 유지한다. `vnextGraph`/`vnextRuns` 옛 필드는 로딩할 때 `pointerGraph`/`pointerRuns`로 읽는다. `ovll:vnext:functions:v1` 함수 초안도 새 `ovll:pointer:functions:v1`로 전환 후 접근 가능하다.

## 이전 워크플로우 이관 경계
`/api/chat`, `/api/workflow`, `/api/execute-group`, `/api/finalize-run`은 더 이상 서버에서 제공하지 않는다. 채팅/실행은 Pointer를 사용한다.
이전 대화의 기본 노드는 첫 복원에서 의미/연결/ID/파일 메타데이터를 검사해 Pointer 그래프로 변환한 다음 원래 UI 위치를 복원한다. 원본 캔버스 상태는 삭제하지 않는다. 함수 편집기도 Pointer의 제안·Patch와 `OvllPointerFunctions` 저장을 사용하며, 이전 편집기 레코드는 삭제하지 않고 호환 가능한 내용만 새 계약으로 저장한다.
의미를 검증할 수 없는 구형 커스텀 서브플로우 등의 자동 변환은 **실패로 종료하고 원본을 보존한다**. 레거시 모델/실행기로 우회하지 않는다. 해당 자산의 동등성 보장·완전한 데이터 이관은 별도 후속 작업으로 남는다.

## 언어화
직접 대화는 판단 모델의 `message`를 사용한다. 사용자에게 이미 완성된 검증 출력이 있으면 그대로 전달한다. 실패·대기처럼 별도 설명이 필요한 상황에서만 `layer.response`와 `response.present`를 호출하고, 호출 실패 시 실제 상태의 결정적 표현으로 대체한다.

로컬 Pointer는 모델 작업, 업로드 파일의 저장된 텍스트/메타데이터 전달, 기존 artifact API를 통한 파일 출력, 명시된 `branch.exclusive` 분기, named input을 바인딩하는 `function.run`을 지원한다. 파일 전달은 전체 PDF/이미지 파싱을 의미하지 않으며 미리보기 축약 표시를 유지한다. 범용 도구, 라이브 검색, 서브그래프 실행, 조건부 병합, 활성 Run 채택, 저장 함수 버전 수정은 미구현이다.

그래프 편집·실행 결과는 브라우저 저장소가 소유하고 서버는 모델 출력/포트/표현을 검증한다. 최대 3턴의 맥락 조회·막힌 작업 재판단과 요청 범위의 동일 모델 결과 재사용을 지원한다. 파일 효과가 시작된 경우 자동 재실행하지 않는다. 산출물은 전체 타깃 결과를 전달하며 UI 요약만 짧게 표시한다. [검증 범위](../../docs/architecture/POINTER_QUALITY_VALIDATION.md)를 참조한다.

## 추가 의존성 방침
기존 `GROQ_API_KEY` 또는 명시적 `OVLL_POINTER_MODEL_*` 설정으로만 모델 호출을 사용한다. 기존 `OVLL_VNEXT_MODEL_*` 환경변수도 이관 중 읽는다. 새 SQL/인증/유료 모델 의존성은 승인 없이 도입하지 않는다.

## 검증
`npm test`; `ovll-pointer-foundation`; `ovll-pointer-postgres-integration`(SQL 격리 테스트 전용); 실제 브라우저 통합·모델 품질 검사. 단위 테스트 통과는 실서비스 완성의 증명이 아니다.
