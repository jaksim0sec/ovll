# Ovll Pointer 프롬프트 행동 평가 — P2/P3 진입 기준

## 목적
`docs/VISION.md`의 모델 자율성, 동적 정의·재사용, 총노동 절감을 보호하면서 프롬프트 변경 전후의 출력 **제안 구조**를 비교한다. 평가 통과가 실제 작업 실행 또는 결과 품질을 증명하지는 않는다.

## 구성
- `backend/ovllPointer/promptEval.js`: 여섯 가지 공급자 독립 시나리오와 구조 평가기.
- `test/ovllPointerPromptEval.test.js`: 대화만, 새 정의/인스턴스, 편집만, 재사용 실행, 생성+실행 의존성, 기존 결과 PDF 연결의 양성·음성 회귀.
- `scripts/eval-pointer-prompts.mjs`: 같은 런타임·스키마·모델로 기준/후보 프롬프트를 비교하는 선택적 실모델 실행기.

## 실행과 예산
기본 실행은 API를 사용하지 않는 드라이런이다.
```sh
node scripts/eval-pointer-prompts.mjs
```
실제 모델 비교는 키가 준비된 로컬 환경에서 호출 비용을 확인한 후 명시적으로 실행한다.
```sh
node scripts/eval-pointer-prompts.mjs --allow-live --baseline 4d79cc7 --cases chat,new-kind,compose-run
```
- 기본 세 시나리오 × 기준/후보 = 6개 턴, 호스트 repair 포함 최대 12회 호출. 공급자 내부 schema fallback·전송 재시도는 HTTP 호출을 추가할 수 있다.
- 전체 범위: `--cases chat,new-kind,edit-only,reuse-run,compose-run,pdf-export`. 무료 할당량 보호를 위해 전부 자동 실행하지 않는다.
- baseline SHA는 로컬 Git 이력에 존재해야 한다. 얕은 clone인 경우 기준 커밋을 먼저 확보한다.
- 기준 대비 바뀌는 부분은 `instructions` 모듈뿐이며 출력 계약·정규화·검증·공급자는 동일하다.
- 결과는 시나리오별 제안 구조, 실패 이유 코드, providerCalls, repairCount, promptBytes, 가능한 경우 totalTokens. 사용자 파일 내용·API 키·모델 원문은 기록하지 않는다.

## P3 게이트
1. `new-kind`, `compose-run`, `edit-only`의 구조 정확도가 낮아진다면 모듈 자동 축소를 적용하지 않는다.
2. 단 한 번의 비교는 확률적 모델 행동의 품질을 입증하지 못한다. 실행 결과와 답변 품질은 별도로 검토해야 한다.
3. 단순 키워드 분기로 동적 IR 능력을 없애지 않는다. 실제 행동·API 비용 검증 전까지 일반 `turn` 모듈 공급을 변경하지 않는다.
4. typed wire, patchJson, 상위 모델 승격은 오류 분포와 폴백 비용을 실측한 후에만 논의한다.
5. `run.start`는 제안일 뿐이다. 노드 실행, 파일 카드, PDF 완료 등은 ActionResults와 통합 테스트로만 확정한다.

## 계획 복기 및 최종 오프라인 게이트 (2026-10-11)

원칙: `docs/VISION.md`의 첫 사용보다 **두 번째 사용의 사용자 노동 감소**가 더 중요한 성공 기준. 664/664 CI 통과는 실제 Gemini 출력 품질·함수 실행 효과를 증명하지 않는다.

### 단계별 결정
- **P0 / P1 계약·정규화:** 코어 수정은 적용됐으나 경계 매트릭스 및 실제 모델 출력 분포 검증을 별도로 남긴다.
- **P2 지침 책임:** core=목적·권한·실행 증거, entry=사용자 의도, ir=정의/그래프 의미, run=노드 실행 의미, function=저장·재사용, modelContract=공급자 wire 출력 형식, validation=강제 검증. 기존 계층은 유지. 실제 모델 비교 전에는 추가 지침 재작성을 하지 않는다.
- **P3 비용·모듈 최적화:** `turn`의 동적 생성·실행·함수화 능력을 키워드 분기로 삭제하지 않는다. 기본 전체 모듈은 유지. 실제 모델 출력·비용/재호출 비교 전에는 조건부 공급과 typed wire를 배포하지 않는다.
- **최종 오프라인 확인:** 함수 저장→새 자료 바인딩→두 개의 의미적으로 다른 노드 실행→결과 전달에서 각 노드 지시가 그대로 유지되어야 한다. 파일 export는 실제 data link와 ActionResults/파일 카드를 별도로 확인한다.

### 실제 발견·수정한 재사용 결함
`runSavedLocalFunction`은 함수 전체 목적을 `runLocalNodes.requestText`로 전달했고, 로컬 실행기가 그 값을 모든 `model_task` 노드의 개별 request보다 우선했다. 이 때문에 연구·작성 등 서로 다른 노드가 동일 제목을 작업 지시로 사용했다. 저장한 함수 실행에서만 공통 `requestText` 전달을 제거하고, `taskContext.objective` 및 invariants는 그대로 두었다. 직접 실행의 사용자 지정 `requestText` 흐름은 변경하지 않는다.

### 남은 최종 게이트
1. 실제 Gemini를 통한 대화만·새 정의·편집만·생성+실행·함수 저장/재실행의 동일 조건 A/B. API 비용 없이는 미실행으로 명시한다.
2. 기존 결과 → data link → PDF artifact 생성 → 파일 카드 반환까지 브라우저 종단 간 검증. 단순 모의 실행은 실제 PDF 반환을 증명하지 않는다.
3. P3의 선택적 모듈 공급은 전후 출력 품질이 기준선보다 악화되지 않고 총 비용이 감소할 때만 도입한다.
4. 앞선 테스트 수정 9건은 별도의 회귀 검증 적정성 감사 대상으로 유지한다. CI 0 failures를 제품 품질 100%로 해석하지 않는다.
