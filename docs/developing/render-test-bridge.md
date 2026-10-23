# Render Beta 테스트 서버 · Stage 2

상태: 2026-10-24. beta 전용 단일 origin Web Service. `main` 변경 금지.

- 실행: `npm start` → `back/js/server.js` → `createBetaRuntime()`에서 한 Engine·MemoryActionStore·MemorySessions·HTTP 구성. `GET /api/health` HTTP 확인. `PORT` 환경변수 사용.
- Gemini 인증: `GEMINI_API_KEY` → `OVLL_POINTER_MODEL_API_KEY` → `OVLL_VNEXT_MODEL_API_KEY`. 모델은 `OVLL_POINTER_MODEL_ID` → `OVLL_VNEXT_MODEL_ID` → `GEMINI_MODEL` → `gemini-3.5-flash-lite`. 키가 없으면 서버는 시작해도 모델 요청 실패.
- `OVLL_TEST_TOKEN` 기본값은 `abcd`. **기본값이나 16자 미만인 설정값은 실제 Workshop 자산 변경 비활성화**로 안전하게 제한. 강한 비공개 테스트 토큰을 명시 설정한 경우에만 `defineDirect/addBlock` 실행 가능. 토큰 길이 기준만으로 정식 사용자 인증·권한/비밀강도가 보장되는 것은 아니다.
- `POST /api/requests` 접수 → `GET /api/requests/:id?roomId=...` 폴링. 완료시 `verifiedResults`, `planCursor`, `result.languageBlock` 반환. `GET /api/requests/:id/calls?roomId=...`는 callId·path·route·status 요약만 공개. `/api/rooms/:roomId/assets`는 실제 서버 저장 Skill/Block/Links/revision, `/history`는 완료 대화.
- 예시 작업: `skillDefine.defineDirect → canvasEdit.addBlock → terminate`를 완료하고 Output, 각 action Call ID와 operation ID 별도. 기타 행동은 `unsupported_workshop` (이전에 적용된 부분 결과 보존).
- 프론트 `requestBridge`는 완료 뒤 자산 재조회. `workspace.applyServerAssets`는 provisional 로컬 캔버스가 별도 수정됐으면 **덮어쓰지 않고** 충돌 경고.
- 서버 자산·호출·대화는 **메모리 전용**, 재시작으로 사라짐. DB 영속화·실질 사용자별 auth·IR·일반 Hallway Return·질문/답변 연결·모든 행동 실행·실 Skill 연구 수행·다중 worker 미구현.
- 백엔드 CI는 Node+fake Gemini 계약 검증, 브라우저 독립 프론트 단위 테스트 별도. 실제 Gemini REST 네트워크, Render 배포 후 API, Playwright/Android 모바일 기능은 별도 확인해야 함.

- `POST /api/requests/:id/retry-output`: 해당 room/request의 실패 단계가 Output인 경우 동일 requestId를 재사용해 Output 호출만 재시도. 적용된 Skill/Block을 다시 만들지 않음. 요청별 모델 호출 기본 40회, Hallway 계획 행동 최대 24회 제한. `/answer` 질문 재개는 아직 미구현.
