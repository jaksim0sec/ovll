# 맥락체·맥락데이터

상태: 1014 설계 계약(런타임 미연결).

## 범위·작성자
| 구분 | 수명·소유 | 필드·작성 |
|---|---|---|
| `contextBlock.intent` | **요청별** | 현재 사용자 요청의 전체 목표·기대 결과·핵심 제약/의존. 모델의 맥락체 갱신 블록 |
| `contextBlock.progress` | **요청별** | 전체 목표 기준 누적 완료·미해결·실패·남은 작업. 모델의 맥락체 갱신 블록 |
| `contextBlock.focus` | **호출별** | 직전 검증 사실/참조와 현재 계층·작업 위치. 서버가 매 모델 호출마다 새로 조립 |
| `contextData` | **방/세션별** | `overallFlow`, `currentTopic`, `details`. 모델의 맥락데이터 갱신 블록 + 서버 저장 |

- `intent`·`progress`: **맥락체 갱신 블록을 포함한 호출에서만 변경**. 일반 Workshop 호출에서 자동 재작성 금지.
- `focus`: 서버 전용 동적 입력. 맥락체 작성기는 존재를 모르며 **`intent`·`progress`만 출력**; 서버가 전달할 때만 focus 결합. focus를 요청의 영속 필드처럼 누적 편집 금지.
- `contextData`: 대화 전반의 흐름, 현 주제, 지속 조건/결정·관련 정보. 요청 1개의 맥락체와 별개. 이전 값을 입력으로 제공; 주제 전환만으로 지속 조건 삭제 금지.
- 채팅 원문, 전체 계획, 작업 로그, 실행 기록·산출물, 실제 Skill/Canvas 상태는 별도 원본/참조로 관리. 두 맥락 객체에 복제하지 않음.
- 영어 기반 간결·정밀 표현. 고정 토큰 길이 강제 없음. 확인되지 않은 성공, 추측, 중복 기록 금지.
- `currentTopic`은 직전 대화의 주제이지 다음 사용자 요청의 주제를 선결정하지 않음.
- 요청 동시 실행 시 같은 세션 `contextData` 저장 충돌 감지 필요; 병합 정책·DB 트랜잭션 등 세부는 미정(`docs/notes/request-state-sync.md`).

## 전달 예시 (실제 완료 사실 아님)
맥락체 작성기 출력:
```json
{"intent":"Research topic and deliver a PDF report; retain source references","progress":"Research complete; PDF generation pending"}
```

호출용 서버 결합:
```json
{"intent":"Research topic and deliver a PDF report; retain source references","progress":"Research complete; PDF generation pending","focus":"Previous: research completed, output ref=R12; current: createFile.generatePDF"}
```

## 갱신·종결
- 초기 계획: 복도에서 요청 전체 의도/제약과 이후 회귀에 충분한 누적 진행 정보를 남김.
- 회귀: 최신 미니 계획만으로 `intent` 덮어쓰기 금지; 전체 요청 기준 `progress` 갱신.
- 최초 복도 즉시 응답: 한 호출에서 최종 언어+얕은 요청 맥락+세션 맥락 갱신; 불필요한 Output 반복 금지.
- Output: 검증 결과를 근거로 최종 `contextBlock` + `contextData` 작성. 실제 영속 적용은 서버 책임.
- 중단/실패 시 `contextData`를 별도 모델 호출로 갱신할지 등은 아직 확정되지 않음.
- 작성 규칙 원문: `prompts/blocks/contextBlockUpdate.md`, `prompts/blocks/contextDataUpdate.md`.
