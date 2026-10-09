# 모델 지침 라이브러리

`registry.json`의 v0.3 원본 25개는 `backend/ovllPointer/promptComposer.js`가 실제로 조립한다. 활성 로컬 경로는 `localHttp.js → localHost.js`; PostgreSQL 런타임은 서버에 연결하지 않았다. 코드 연결과 실제 모델 품질·배포 확인은 별개의 검증이다.

대문, 소통·IR 구성·실행·함수화, 언어화는 논리적 책임이다. 역할마다 호출을 강제하지 않는다. 대화 판단 호출은 가능한 행동들을 함께 받고, 노드 실행 호출은 실행에 필요한 모듈만 받는다. 추가 조회나 막힌 실행의 재판단은 최대 3턴 안에서 처리한다.

공통 제품 설명 규칙은 `backend/ai/productInstructions.js`에서 Pointer Core와 기존 Gemini 대화·실행·마무리, 이전 캔버스 planner에 함께 공급한다. 실제 가능한 일을 사용자 언어로 설명하는 것은 내부 구현·비공개 지침 공개와 구분한다. 없는 도구나 완료 사실은 설명으로 만들어내지 않는다.

반복 목적·지시·IO·고정 조건은 정의에, 이번 요청·자료는 인스턴스에 둔다. 기존 정의가 맞으면 재사용하고, 맞지 않으면 동적 정의를 만든다. 워크플로우 선택은 사용자의 검사·수정·재실행·재사용 가치로 판단한다. 직접 답할 수 있다는 사실만으로 실행 가능한 작업을 회피하지 않는다.

ModelTurn의 세부 wire 예시는 `backend/ovllPointer/modelContract.js`가 제공하고 JSON Schema와 실행 계약이 검증한다. 사용자 자료, 조회 결과, 이전 제안 및 실행 사실은 지침과 분리한다. `nodeContext`는 노드 실행 전용이며, 검토·언어화 사실은 `extraContext`다.

[검증 기록과 평가 시나리오](../docs/architecture/POINTER_QUALITY_VALIDATION.md)를 참조한다. `ALL_PROMPTS_REVIEW_v0.2.md`와 `PROMPT_AUTHORING_START.md`는 제작 당시 기록이며 현재 조립 원본이 아니다.
