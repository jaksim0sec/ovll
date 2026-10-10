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
