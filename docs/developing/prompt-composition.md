# Gate·Hallway·Output 호출 조립 계약

상태: 1014 합의. 모델 원문은 `prompts/`; 이 파일은 **서버 측 입력·분기·반환·조립 순서** 규정. 코드는 아직 연결되지 않음.

## 공통
- 각 호출: 공유 개념 지침 → 계층 베이스 → 공통 JSON 규칙 → 그 호출의 선택적 블록 순서로 조립.
- `prompts/manifest.json`이 기존 1014의 조립 순서 목록. 모델 입력 데이터의 정확한 삽입 위치·최종 API body는 아직 미확정.
- 모든 출력은 단일 JSON. 조건 분기에서 선택하지 않은 출력 키는 포함 금지. 활성 블록의 출력만 반환.
- 서버가 `need` 조회, 응답 검증, 실행, 지침 합성, ID/참조·상태·`focus` 관리를 담당.

## Gate
입력: 현재 사용자 요청 원문 + 기존 세션 `contextData`.
조립: `common/concepts → base/gate → common/json → blocks/informationRequest`.
출력: `{"need":[...]}`. 없으면 `{"need":[]}`.
동작: 자료 조회 후 최초 Hallway로 전달. Gate는 계획·실행·초기 `contextBlock` 생성하지 않음.

## Hallway Initial
입력: 사용자 요청 원문 + Gate가 조회한 자료. 직접 답변 분기에서 `contextData`를 갱신하므로 **기존 세션 맥락데이터 입력 필요**.
조립: `common/concepts → base/hallwayInitial → common/json → blocks/languageGeneration → blocks/planGeneration → blocks/contextBlockUpdate → blocks/contextDataUpdate`.
분기:
- **즉시 응답 가능**(스킬·행동·추가 절차 불필요): `{"languageBlock":"...","contextBlock":{"intent":"...","progress":"..."},"contextData":{"overallFlow":"...","currentTopic":"...","details":"..."}}`. 이 호출에서 종결; Output 추가 호출 금지.
- **작업 필요**: `{"plan":[...],"contextBlock":{"intent":"...","progress":"..."}}`. `languageBlock`·`contextData` 반환 금지. `contextBlock`은 원 요청을 다시 읽지 않고 회귀 가능한 깊이 유지.
- `plan: []` 예시는 구조 표시에 쓰일 수 있으나 작업 분기의 권장 빈 계획이 아님.
- 최초 계획: 가능한 연속 목표를 묶되 이후 판단이 검증 결과에 달리면 의미 있는 체크포인트에서 멈추고 `terminate` 없이 반환. 성공 가정 계획에 가상 복구 작업 추가 금지.

## Hallway Return
입력: 기존 `contextBlock` + 검증된 작업실 결과·실패/오류·관련 서버 자료. `focus`는 서버가 현재 호출에 맞춰 교체. 원본 사용자 요청을 매번 재전달하는 구조에 의존하지 않음.
조립: `common/concepts → base/hallwayReturn → common/json → blocks/planGeneration → blocks/contextBlockUpdate`.
출력 고정: `{"plan":[...],"contextBlock":{"intent":"...","progress":"..."}}`. `languageBlock`·`contextData` 없음.
- 전체 요청 목표 달성 → `plan`에 `terminate`.
- 남은 목표 → 다음 적절한 계획. 실패 → 검증된 사실과 다른 대안 평가; 진전 불가능하면 미해결 상태를 보존해 `terminate`.
- 이미 완료한 작업 반복 금지. 근거 없는 재시도·무한 회귀 방지. 회귀 원인은 실패만이 아님.

## Output
입력: 현재 `contextBlock`(서버 결합 `focus` 포함), 기존 `contextData`, 확인된 실행 결과·생성 기록·참조.
조립: `common/concepts → base/output → common/json → blocks/languageGeneration → blocks/contextBlockUpdate → blocks/contextDataUpdate`.
출력: `{"languageBlock":"...","contextBlock":{"intent":"...","progress":"..."},"contextData":{"overallFlow":"...","currentTopic":"...","details":"..."}}`.
- 사용자 요청 **전체** 기준 결과 종합 + 최종 맥락 + 세션 맥락 갱신. 새 계획·행동 실행 금지.
- 계획 `terminate` 후 사용. 서버가 실제 결과를 검증했는지가 성공 표현의 조건.
- 기존 계획/실행 기록 원본은 별도 보관. Output에 제공할 정확한 결과·기록 범위는 추가 확정 필요.

## 참조
- `docs/developing/architecture.md`: 호출·실행 순환/계획 전체.
- `docs/developing/workshops.md`: 작업실 행동 책임.
- `docs/developing/context.md`: 맥락 수명·필드 소유권.
- `prompts/manifest.json`: 지침 상대 경로와 순서.
