# Beta 독립 요청 엔진 — Action Shell 단계
상태: 2026-10-23. 이전 비IR 11행동 실행 구현은 **폐기**했고 이 문서는 현재 동작을 기록한다.

## 런타임
- `request/registry.js`: 방·요청별 큐/진행/완료·미구현 상태 기록. `handoff` 필드 보존.
- `request/scheduler.js`: FIFO, 같은 방 최근 완료 맥락 인계, 실행 실패 진단, HTTP 상태 스냅샷.
- `engine/promptComposer.js`: manifest 순서 기반 조립; 사용자 정보는 context로 별도 전달.
- `engine/dataProvider.js`: need 조회; 대화 이력·요청 원본·초기 참조. 서버에서 조회용 비어 있는 자산 카탈로그를 넣어 `skillList`는 빈 목록으로 조회 가능.
- `engine/engine.js`: Gate→Hallway Initial→선택된 첫 Action Shell, 또는 Hallway 즉시 언어 응답. 계획 후 추가 AI 호출 없음.
- `engine/actionShell.js`: 12개 자격 행동 검증 및 `not_implemented` 접수 객체. **실행 함수 없음**.
- `model/gemini.js` & `model/configuredGemini.js`: Gate/Hallway JSON 생성. Gemini 네이티브 Function Calling 사용하지 않음.
- `back/js/server.js`: Render Web Service, 정적 front + API, room 메모리, 읽기 전용 빈 자산 카탈로그.

## 상태
- 직접 답변: `completed`, Hallway Initial에서 생성한 `languageBlock`.
- 행동 계획: `unsupported_workshop` / `currentLayer=actionShell`, `plan`과 `handoff` 반환. `handoff.status=not_implemented`; 실제 스킬/블럭 생성 없음.
- 잘못된 응답 형태/미등록 행동: `ENGINE_OUTPUT_INVALID`; 실작업 요청을 말로만 완료하려 하면 교정 1회 뒤 `WORK_REQUIRED`; 자료 누락은 `DATA_UNAVAILABLE`.
- 모델이 `terminate` 계획을 생성해도 선행 작업의 적용 기록이 없으면 성공으로 전이하지 않는다.
- 세션 `contextData`는 완료된 직접 답변에서만 갱신. 서버 재시작 시 소실됨. 영속 자산이 없고 사용자 인증·IR·Saved Function 실행도 없음.

## API·프론트
- `POST /api/requests`, `GET /api/requests/:id?roomId=...`; 결과 상태에 `handoff`가 포함될 수 있다.
- `GET /api/rooms/:roomId/assets`는 rev 0/빈 자산만 반환. 확인된 새 작업으로 표시하지 않는다.
- 프론트는 Action Shell 도달과 미구현 상태/선택 행동명을 진행 카드에 표시. 완료 답변으로 위조하지 않는다.
- 기존 테스트 전용 `/answer`, `/retry-output` 라우트는 서버에 남아 있으나 실행기에 resume/retryOutput을 제공하지 않으므로 이 단계에서 진행 불가능.
- 테스트: `npm test` (Node 22). 실제 Gemini 모델 응답·Render 브라우저 검증과는 구분.
