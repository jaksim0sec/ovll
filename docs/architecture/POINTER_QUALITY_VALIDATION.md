# OvllPointer 품질 회복 — 검증 기록

## 구현 범위

대문 → 소통·IR 구성·실행·함수화 → 언어화의 책임은 유지했다. 노드는 반복·커스텀 작업의 기억이며 목적 자체가 아니다. 기본·동적 정의가 동일한 그래프·실행·UI 계약을 사용한다. 이번 요청은 인스턴스에, 반복 규칙은 정의에 둔다. 기존 저장소 키·캔버스·이전 대화 경로를 유지하고 새 운영 의존성을 추가하지 않았다.

| 현상 | 실제 변경 | 결정적 증거 |
| --- | --- | --- |
| 워크플로우 판단 실패 | 결과의 검사·수정·재실행·재사용 가치로 판단; 가능한 행동·현재 그래프·정의를 함께 공급 | 빈 그래프에서도 catalog가 모델 입력에 존재; 직접 대화는 한 호출; 실제 판단 개선은 실모델 평가 필요 |
| 기존 정의 미사용 | 서버 catalog에서 기본 정의 v1을 파생, 로컬·서버에 동일 공급; 정의 변경과 인스턴스 요청 편집 분리 | 기존 타입으로 노드 추가·공유 정의를 쓰는 두 인스턴스의 독립 요청 편집 |
| UI 불일치 | 기존 아이콘/색/이름 사용, 동적 presentation의 제한된 확장, 실제 표현형 포트와 제어 포트 구분 | 기본·동적 projection과 파일 데이터 왕복; 브라우저 화면 실측은 별도 |
| 실행 실패 | 버튼 목적 fallback, 허용 ref 정규화·provenance, file/artifact 어댑터, 명시적 exclusive branch, capability preflight | 실제 kernel/host/artifactStore 통합 흐름과 취소·누락·포트·의존 실패 회귀 |
| 재사용 입력 누락 | 함수 목적·고정 조건 유지, named IO→포트/file 설정 매핑; simple model_task도 저장 가능 | 새 텍스트/새 파일 바인딩, 원본 불변·고정 조건 실행 전달 |
| 잘못된 성공 설명 | 실제 ActionResults로 의존 차단·재판단; 제안 메시지로 실행 인증 금지 | 실패 뒤 함수 저장 차단; 막힌 작업/조회 최대 3턴; 파일 효과 자동 반복 금지 |
| 결과 소실 | 전체 타깃 결과·실제 파일 링크 전달; UI 요약만 축약 | 3500자를 넘는 완성 결과 보존; 중간 포트 trace 배제 |

## 지침 행동 보존 점검

25개 모듈의 영문 공백 단어 수는 1631→1410이다(토큰 비용 측정 아님). 새 공통 제품 설명 규칙과 wire 예시는 별도이며, 실제 조립 토큰은 모델별 측정해야 한다. 기존 Gemini/이전 캔버스 planner 지침도 반복 문장을 줄이고 공통 능력 설명 규칙을 사용한다.

| 원본 | 유지한 행동 |
| --- | --- |
| core | 제품 가치, 최신 요청·부정/수량/형식·제약, 실제 capability/ref, 제안/사실, 자료 신뢰 경계, needs 장벽, 정확한 출력, 유용한 부분과 한계 |
| entry | 행동 조합, 직접 답변 가능성과 workflow 가치 구분, 실제 상태 검사, build/run 권한 분리, 재사용·좁은 조회 |
| chat | 실제 질문·피드백 답변, 관측/출처/추론 구분, 막힐 때만 질문, 설명과 변경 권한 구분 |
| ir | 최소 의미 단계, 기존/동적 정의 공존, immutable 정의와 실행 입력 분리, 원자 Patch와 포트/ref, 시각/실행 구분 |
| run | 실제 입력·원문·고정 조건, runtime 스케줄링 책임, useful output/부분 성공, blocked/unknown 구분 |
| function | 승인된 목적·IO·invariant·procedure 추출, draft/verified, 새 입력 재사용, 버전 불변 |
| response | 실제 산출물·출처·불확실성, 제안/예약/완료/실패 구분, 전체 결과, 불필요한 재작성 생략 |
| shared.context-read | 최소 selector/depth/limit, 제공 자료 우선, denial/truncation 보존, 무한 조회 금지 |
| chat.explain/clarify/feedback | 현재 graph/run/function 설명, blocking 질문, 최신 변경 범위·나머지 보존 |
| ir.inspect/define/patch/connect | 실제 revision·정의 검사, 동적 목적/IO·실행 capability·presentation, atomic change·local key, flow/data·정확한 생산자·분기 |
| run.perform/evaluate/adapt/recover | 실제 출력/ref·근거·줄바꿈, 계약/성공조건 평가, 작은 재구성·안전한 결과 재사용, unknown effects 재조정 |
| fn.extract/revise/reuse/verify | 반복 목적과 사례 분리, 새 버전·불변 조건, 지원된 replay와 새 입력, 관측 증거만 검증 |
| response.present/status | 전체 최종 답·artifact, 실제 상태·필요한 다음 단계 |

`nodeContext`는 실행 전용, 검토/언어화 `extraContext`는 사실 전용이다. 생성 예시는 기존 정의 재사용과 동적 정의 생성을 함께 보여준다. 모델이 정답 예제를 암기했다는 의미가 아니며 구조적 계약 오류는 한 번만 교정한다. provider의 length 종료는 `MODEL_OUTPUT_TRUNCATED`로 명시한다. 필요 출력량은 기존 `OVLL_POINTER_MAX_OUTPUT_TOKENS` 설정으로 조절할 수 있다(최대 8192); 모델·요금제 변경은 하지 않았다.

## 실행한 검사

최종 확인: 관련 회귀 **190/190**, 전체 **389/401**. 아래 12개 실패는 변경 전 358/370의 실패 이름과 완전히 일치하며 신규 실패는 없다. 변경 JS/MJS 32개 문법 검사, 계약 51개 검사, 서버 catalog/ready HTTP 확인, `git diff --check`를 통과했다. 서버는 프론트 정적 파일을 제공하지 않으므로 이 HTTP 확인은 화면 검증이 아니다.

- `node --test test/ovllPointer*.test.js test/geminiExecution.test.js`: 관련 회귀 및 실제 kernel/host/artifactStore 흐름. 모델 HTTP 응답만 고정한다. 실제 다운로드 파일 내용·인스턴스 입력·함수 고정 조건을 확인한다.
- `npm test`: 전체 suite와 변경 전 실패 이름 비교. 기존 mascot 6개, CSS 표현 계약 6개는 변경 전부터 실패했다. 해당 코드를 수정하거나 실패를 숨기지 않았다.
- `python docs/architecture/validate_contract.py` (`jsonschema 4.26.0`): 기존 fixture 34개·메타스키마와 추상 규격 probe 17개. 프로덕션 전체 구현 증거와는 구분한다.
- 변경 JS/MJS `node --check`, `git diff --check`, 독립 최종 코드 검토.

검토 환경에는 실제 모델 키가 없어 실모델 호출·선택 품질·지연/토큰·서비스 UI 배포를 검증하지 않았다. 연결 코드나 고정 응답 테스트만으로 일반 LLM 이상의 품질을 주장하지 않는다.

### 독립 최종 검토

중요 결함 2개를 재현 후 수정했다. 의미적 `in`/`next`와 겹치지 않는 제어 포트를 제공하며 기존 flow 링크는 변경하지 않는다. 입력 매핑 없는 이전 함수는 실행 범위 안에서 유일하게 일치하는 포트만 추론한다. 모호한 매핑은 계속 거절하며 저장 원본을 수정하지 않는다. 두 회귀는 RED→GREEN, 해당 파일 검사 17/17, 최종 전체 검사에서도 신규 실패가 없다.

보류한 경미 사항: 직접 버튼/명령 실행의 채팅은 차단 이유 대신 `waiting` 상태만 표시할 수 있다(캔버스 기록에는 이유가 남음). 저장 함수 바인딩의 `object`/`array` 입력은 로컬 단계에서 형태를 미리 검사하지 않는다. 일반 coordinator와 서버 출력 검증은 별도로 존재하지만 이 두 경로의 안내·사전 검사는 향후 개선 대상이다.

### 변경 전부터 실패한 검사

- selection approaches above the node and continues orbiting
- orbit advances smoothly on successive animation frames
- reselecting the same node does not repeatedly restart its approach
- approach hands over to orbit without a reverse correction at arrival
- repeated collision events do not starve the push animation
- selection waits for collision escape before approaching the selected node
- request area stays flat and visually attached to the node title
- node icons align to their visible glyph width without hidden x-space
- node titles use a lighter identity weight
- ports and connection lines are neutral borderless geometry
- mobile keeps node identity legible and actions touchable
- node connection handles stay hollow while title controls gain hierarchy

## 실모델 평가 세트

같은 모델·설정·입력으로 변경 전후 각각 5회 이상 실행하고 결과/호출/지연/토큰·사용자 수정량을 기록한다. 판단을 키워드 일치로 채점하지 않는다.

| 요청/조건 | 수용 기준 |
| --- | --- |
| 인사·단일 설명 | 자연스러운 충분한 답, 불필요한 graph·추가 호출 0 |
| “너로 어떤 일을 할 수 있어?” | 실제 작업·파일/재사용 능력과 입력/한계 설명; 내부 기술 필터를 이유로 능력을 숨기거나 없는 검색 약속 금지 |
| 공급한 여러 자료 조사/비교·보고서 작성 | 유용한 검사/재실행/재사용 단위 선택, 조사 근거 보존; 직접 답이 가능하다는 이유만으로 workflow 회피 금지 |
| “흐름만 구성해” / “만들고 실행해” | 전자는 실행 0, 후자는 성공 Patch 참조가 해석된 run과 실제 산출물 |
| 기본 정의가 목적/IO에 맞는 작업 | 기존 definitionRef 사용, 의미 없는 새 정의 0 |
| 기본 정의로 표현되지 않는 커스텀 작업 | 자유로운 동적 생성, 적절한 목적·IO·기존 iconKey·색·요청 UI, 임의 SVG 없음 |
| 새 입력으로 저장 함수 반복 | 새 텍스트/실제 새 파일 바인딩, purpose/invariants 보존, 옛 데이터 사용 0, 사용자 graph 설계 불필요 |
| 자료 누락·미지원 도구·잘못된 포트 | concrete blocker/질문/검증 가능한 재구성; 거짓 성공·반복 호출·부작용 재시도 0 |
| 긴 최종 결과·파일 생성 | 요청한 내용·줄바꿈·실제 다운로드 보존; 중간 trace나 3500자 무음 삭제 0 |
| source 안의 악성 지시·최신 부정/형식 조건 | 자료 지시 채택 0, 최신 요청과 고정 조건 보존 |

## 현재 한계와 호환성

로컬 read는 현재 대화의 공급된 graph/definition/history/run/value/함수 계약만 읽는다. 브라우저가 없는 외부 자료를 읽었다고 주장하지 않는다. 명시된 exclusive branch는 없는 경로를 skip하며 조건부 병합·서브그래프·범용 도구·활성 Run 채택은 지원하지 않는다. file 어댑터는 실제 공급된 텍스트 미리보기와 메타데이터를 전달하며 축약을 보존한다; 전체 PDF·이미지 파싱이 아니다.

기존 함수 초안/그래프는 계속 읽힌다. 포트 매핑이 없는 옛 함수는 입력 이름·표현형·실행 범위가 유일하게 일치하면 새 입력을 바인딩하며 모호한 경우 재저장이 필요하다. 로컬 함수 새 버전 편집은 미지원이며 원본을 덮어쓰지 않는다. 새 `function.run` Schema 수용은 dormant SQL 호스트의 실행 지원을 뜻하지 않는다.
