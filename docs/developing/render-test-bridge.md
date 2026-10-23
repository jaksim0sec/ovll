# Render Beta 시험 연결 — Action Shell 단계
상태: 2026-10-24. `beta` 전용 독립 Web Service, `main` 변경 금지.

- `npm start` → `back/js/server.js`; `GET /api/health`로 HTTP 준비 확인. Render `PORT` 사용.
- 프론트는 같은 origin에 HTTP 요청을 접수하고 약 900ms 간격으로 상태 폴링. Chat/Canvas UI는 유지.
- 환경변수: `GEMINI_API_KEY` 또는 `OVLL_POINTER_MODEL_API_KEY` 또는 `OVLL_VNEXT_MODEL_API_KEY`; 모델 `OVLL_POINTER_MODEL_ID` → `OVLL_VNEXT_MODEL_ID` → `GEMINI_MODEL` → 기본 `gemini-3.5-flash-lite`. 키가 없어도 서버 시작 가능, 모델 요청은 실패.
- `OVLL_TEST_TOKEN`: 기본 `abcd`. 진짜 사용자 인증이 아니며 프로덕션 공개에 부적합.
- `POST /api/requests`은 202 접수, `GET /api/requests/:id?roomId=...`는 `status,currentLayer,plan?,planCursor?,handoff?,result?,error?`을 제공.
- **행동 요청은** Gate → Hallway Initial → Action Shell에서 `unsupported_workshop` 종료. 선택한 행동 이름이 `handoff.action`으로 노출되며 **실제 실행·저장 없음**.
- `GET /api/rooms/:roomId/assets`는 재시작마다 rev 0/빈 Skill·Block·Link 목록(읽기 전용)만 제공. 신규 생성 없음. `GET /api/rooms/:roomId/history`는 완료된 직접 대화 맥락만 저장한다.
- 요청 진행·예전 UI의 질문/Output 재시도 프레젠테이션은 남아 있지만 현재 엔진에서는 질문 실행·Output retry 불가능하다.
- Render 재배포, 실제 Gemini 응답, 모바일 브라우저 검증은 Node CI와 별개. 이전 비IR Workshop 검증 통과 기록은 지금 실행 기능의 증거가 아니다.

- `GET /api/requests/:id/calls?roomId=...`: 같은 공용 테스트 토큰으로 요청별 `{callId,path,route,status}` 최근 최대 100개 조회, 없는 room/request는 404. 내부 프롬프트는 응답에 넣지 않음.
- 현행 `back/js/server.js`는 하나의 관리형 Engine(`createEngine`)을 HTTP 서비스에 공급. 요청 동시 실행 기본 3 / Gemini 모델 호출 동시 실행 기본 2. 동시 방 대화 갱신의 revision 충돌은 실패로 표시.
- `engine.cancel`은 코드에 있지만 별도 HTTP 취소 라우트는 이 단계에서 제공하지 않음. 사용자 질문/재시도 UI는 여전히 미연결.
