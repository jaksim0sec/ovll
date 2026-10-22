# 작업실·행동 계약

상태: 1014에 합의한 역할/명칭. **작업실 베이스 프롬프트·Function Calling 스키마·실행 구현은 미완성.**

## 책임 분할
- 복도: `workshopName` / `objective` / `need` / 실행 순서 계획. 내부 행동 선택 금지.
- 작업실: 목표·맥락체·조회 결과를 보고 적절한 행동 결정. 실제 실행은 서버의 검증 가능한 명령·자산·상태 계약 사용.
- 작업실 기준 복수 행동을 한 호출로 처리할 수도, 결과 의존성/규모에 따라 행동별 호출로 나눌 수도 있음. **분기 기준 미확정**.
- 공통 지침 5종과 별개로, 작업실 내부는 **선택한 행동의 전용 지침만 조립**. 행동별 지침·Function Calling 함수 선언은 아직 파일이 없음.

## 확정한 작업실·행동 분류

| 계획 항목 | 행동 | 책임 |
|---|---|---|
| `skillDefine` | `defineDirect` | 새로운 Skill 정의 직접 작성(초기명 `defineByJSON`) |
| `skillDefine` | `defineFromIR` | IR 작업 흐름 추출 → 재사용·저장 Function 자산 생성(초기명 `defineByIR`; 기존 `function.save` 목적) |
| `skillDefine` | `revise` | 기존 Skill 정의 수정 |
| `skillEdit` | `editAppearance` | Skill 외형 수정 |
| `skillEdit` | `delete` | Skill 삭제 |
| `canvasEdit` | `addBlock` | 캔버스에 Skill Block(Skill Node) 배치 |
| `canvasEdit` | `editBlock` | 배치 인스턴스 수정 |
| `canvasEdit` | `deleteBlock` | 배치 인스턴스 삭제(초기 오기 `delteBlock`) |
| `canvasEdit` | `addLink` | 블록 간 연결 추가 |
| `canvasEdit` | `removeLink` | 블록 간 연결 제거 |
| `textGenerate` | `basicText` | 자연어 중간 발화 |
| `textGenerate` | `question` | 사용자 질문 |
| `terminate` | 없음 | 요청 완전종결을 표시하는 계획 항목 |

- `skillDefine`에서 Skill 직접 정의와 IR→Function 함수화를 논리적으로 함께 선택하되, **Skill과 Saved Function의 자산·버전·실행·저장 계약은 다름**. 임의 병합 금지. 별도 함수화 작업실 신설 금지.
- `Skill` 정의 자산과 캔버스 `Skill Block` 인스턴스는 별개. 기존 코드의 `node` 명칭에 맞춰 자동 변환/재해석하지 않음.
- `textGenerate` 전 논의명: `language`; `text.add`는 사용자 발화 인터페이스의 임시안. 확정 분류는 `textGenerate.basicText/question`.
- `terminate`는 행동을 수행하는 Workshop으로 취급하지 않음. 마지막 답변만을 위한 `textGenerate` 단계도 의무 아님.

## 계획 예시 (스키마 확정안 아님)
```json
{
  "plan": [
    { "skillDefine": { "objective": "일본어 단어장 스킬 정의", "need": [["skillList"]] } },
    { "canvasEdit": { "objective": "캔버스에 일본어 단어장 스킬 블록 추가", "need": [] } },
    { "terminate": { "objective": "작업 결과 안내", "need": [] } }
  ]
}
```
- `skillList`는 기존 정의 확인용 사례. 캔버스 상태 등 서버가 항상 제공하는 값은 `need`로 중복 요청하지 않음.
- 기존 정의를 발견했을 때: 목표 안에서 재사용을 판단하거나 필요시 Hallway에 회귀. **발견 = 반드시 회귀**는 아님.
- 계획대로 진행한 결과와 확인되지 않은 '완료' 주장 구분. 자산 저장·실제 적용 성공은 서버 검증 뒤 반영.

## 진행 발화·종결
- 중간 발화 가능: 예) "수준과 일본어를 입력하는 일본어 단어장 스킬을 만들어드릴게요." 수행 완료의 증거로 사용하지 않음.
- 중간 언어화 및 맥락 갱신은 필요한 조립 블록 조합으로 수행 가능; 호출 경계 별도 확정.
- 계획상 `terminate` → 최종 Output(언어 생성 + 맥락체 갱신 + 맥락데이터 갱신).
- `terminate` 없이 계획 소진 → Hallway Return. 전제 변경·실패·중요 신규 확인 사실도 복도 재판단 사유가 될 수 있음.
- 실행 `execute` 경로는 별도 Workshop을 만들지 않기로 논의; 정확한 표현·종결 연결은 미확정.

## 후속 확정 필요
- 작업실별 Function Calling 도구명·인수·응답 검증·모델 반환 구조.
- Skill 정의 vs IR→Function 추출의 상위 호출/내부 저장 경계.
- 호출을 작업실 단위로 묶을지 행동별로 나눌지의 실제 선택 조건.
- `execute` 계획 표현과 완료/중단/실패 시 처리, 복도회귀 반환 데이터·수정 규칙.
- 프롬프트 조건부 조립 및 Workshop 베이스 문구.
