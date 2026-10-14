# Ovll — 조립식 지침 블록 아키텍처

> 설계 기록 · 합의된 구조 중심 · 구현 상태를 의미하지 않음

## 1. 기본 구조

기존의 고정된 `대문 → 복도 → 작업실 → 출구`별 LLM 호출 구성에서 벗어나, 서버가 호출 목적에 따라 **지침 블록과 출력 계약을 조립**하여 모델을 호출한다. 계층의 역할과 개별 API 호출 횟수를 동일시하지 않는다.

- 목표: 불필요한 모델 호출 감소, 계층 사이 의미 연결, 상황에 따른 중간 발화, 저가 Gemini 모델의 부담 완화
- 보존: 기존 IR, 실행기, 스케줄러(닫힌 댐/열린 댐), 동적 노드 생성·정의, 함수화 및 버전 자산
- 작업실 내부도 장기적으로 function calling 방식으로 전환하고 공통 지침 블록을 점진적으로 재사용할 예정. **현재 작업실 내부의 상세 계약은 미확정**
- 지침 블록은 특정 계층에 일괄 종속되지 않는다. 각 블록은 담당하는 출력 필드의 작성 규칙을 정의하며, 최종 응답의 머릿글과 스키마 조립은 서버가 담당한다.

## 2. 임시 확정된 지침 블록 5종

| 블록 | 책임 |
|---|---|
| 복도 판단 | 현재 요청 및 진행 상태를 바탕으로 다음 방향을 판단 |
| 계획 생성 | 작업실 실행 순서, 복도회귀·완전종결, 예외적 데이터 예약을 계획 문법으로 작성 |
| 언어 생성 | 사용자에게 전달할 중간·최종 자연어 발화를 공통 규칙으로 작성 |
| 맥락체 생성·갱신 | 현재 **응답 내부**의 의도 및 전체 진행 의미를 `contextBlock`에 작성·갱신 |
| 정보 요청 | 추가 정보 요청의 출력 작성. 구체적 조립 조건은 아직 미확정 |

별도 `맥락체 활용` 지침 블록은 **두지 않는다**. 맥락체는 필요한 모델 호출에 입력으로 제공되며, 각 블록은 자신의 책임에 맞춰 이를 참고한다.

## 3. 호출 구성 및 계획 제어

호출 시 조립 예시(세부 조건은 계속 설계 대상):

| 호출 | 적용 블록 |
|---|---|
| 최초 복도 | 복도 판단 + 계획 생성 + 언어 생성 + 맥락체 생성·갱신 |
| 복도 재진입 | 복도 판단 + 계획 생성 + 언어 생성 + 맥락체 생성·갱신 |
| 완전종결 | 언어 생성 + 맥락체 생성·갱신 |
| 추가 정보 필요 | 정보 요청 블록을 필요할 때 선택적으로 조립 |

대문은 필요한 최초 정보 조회 및 맥락 준비를 수행한다. 최초 복도에서 단순 요청을 바로 응답할 수 있으며, 각 작업실 뒤에 복도를 반드시 호출하지 않는다.

계획 표현의 논리 형식:

```text
작업실명 (필요 시 데이터 예약)
작업실명 (필요 시 데이터 예약)
복도회귀 (필요 시 데이터 예약)

또는

작업실명
작업실명
완전종결
```

- 작업실이 연속되면 서버가 순서에 따라 실행하며 불필요한 복도 호출을 생략한다.
- 복도회귀는 실행 결과에 기반한 재판단·계획 유지/수정/종결에 사용한다.
- 완전종결은 무거운 계획·판단 지침 없이 실제 결과를 바탕으로 사용자에게 전달한다.
- 데이터 예약은 예외적인 수단이다. 서버가 자동 제공할 정보와 유사한 선택지를 모델에 노출하지 않으며, 예약 필요성을 과장하지 않는다.

## 4. 맥락데이터와 맥락체

**맥락데이터(Context Data)**는 세션 전체의 대화·작업 맥락으로, 언어 생성·최초 계획·맥락체 생성에 필요한 참조 자료다.

**맥락체(Context Object)**는 한 번의 사용자 요청을 처리하는 **응답 내부**에서 계층을 연결하는 가벼운 의미 전달체다. 세션 전체의 요약이나 실행 결과 원본 저장소가 아니다.

| 필드 | 작성 주체 | 내용 | 변경 시점 |
|---|---|---|---|
| `intent` | 모델의 맥락체 블록 | 이번 요청 목표·의도·원하는 결과·핵심 제약 | 맥락체 블록이 포함된 호출에서만 |
| `progress` | 모델의 맥락체 블록 | 계획 묶음 단위의 전반적인 완료·미해결·남은 목표 | 맥락체 블록이 포함된 호출에서만 |
| `focus` | 서버 | 이전 계층/작업의 관련 사실 및 참조와 이번 호출의 위치·역할 | **모든 모델 호출 때 교체** |

- 맥락체 생성기는 **`focus`의 존재를 알지 못한다**. 생성기는 `intent`와 `progress`만 작성한다.
- 일반 작업실 호출 시 맥락체를 재작성하지 않는다.
- 실제 실행 상태, 계획 원문, 상세 로그, 산출물은 별도로 유지한다. 맥락체는 그 의미와 연결 관계만 전달한다.
- 서버가 모델 입력을 구성할 때 현재 호출에 맞는 `focus`를 동적으로 결합한다. `focus`에 실행 미확인 내용을 완료 사실처럼 쓰지 않는다.
- 계층별 명령을 맥락체에 중복 기록하지 않는다. 작업실은 맥락체의 공통 상황, 자신의 작업 지침, 실행 입력을 함께 참고한다.

### 맥락체 블록 출력 계약

최종 모델 반환은 여러 블록의 출력을 포함하는 JSON 객체이며 맥락체 블록은 해당 객체 안의 **`contextBlock` 키 내용만** 설명한다. 반환 객체의 공통 구조·머릿글·블록 조립 지침은 이 블록의 책임이 아니다.

```json
{
  "contextBlock": {
    "intent": "Research topic and deliver a PDF report; retain source references",
    "progress": "Research complete; PDF generation pending"
  }
}
```

위 객체는 `contextBlock` 부분 예시이며, 다른 블록 키는 생략했다. `focus`는 모델 생성 결과에 포함하지 않는다.

### 맥락체 생성·갱신 지침 원문 (확정 v1.1)

```text
Write the `contextBlock` JSON object to preserve continuity
within the current user request, not the overall conversation.

Fields:
- intent: The current request's objective, desired outcome,
  and essential constraints.
- progress: The overall progress of the current request,
  including meaningful completed work, unresolved issues,
  and remaining goals.

Rules:
- Record only information needed to maintain continuity
  across processing stages.
- Preserve essential details without duplicating plans,
  execution logs, or raw outputs.
- Use concise, unambiguous English.
- Preserve valid existing information; update only when needed.
- Never invent facts, requirements, or completed work.
- Exclude irrelevant details. No fixed length limit.
```

## 5. 경계와 미확정 사항

- **확정/임시 확정**: 5종 블록 구성, 맥락데이터와 맥락체의 구분, `intent`/`progress` 모델 작성과 `focus` 서버 주입의 책임 분리, 위 맥락체 블록 지침
- **추가 논의 필요**: 복도 판단·계획 생성·언어 생성·정보 요청의 구체적 JSON 키 및 지침, 정보 요청 블록 선택 조건, 호출별 최종 스키마의 상세 형식, 맥락체 최초 생성 위치의 구체적 연결
- **현재 범위 밖**: 작업실 내부 function calling 세부 계약, 성능 측정과 예외 처리의 세부 구현
