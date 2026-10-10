# 2026-10-10 안정화 구현과 제한

제품 버전: `2026.10.10.13`. 기준 코드: `6d10cec`. 제품 기준은 `docs/VISION.md`의 총노동 감소·모델 활용·대화에서 유용한 작업의 재사용이다. 대문·4개 행동 책임·언어화, 동적 정의와 닫힌댐/열린댐은 유지했다. 프레임워크·DB 전환이나 별도 판단 모델은 추가하지 않았다.

## 현재 운영 경로

활성 경로는 브라우저의 OvllPointerLocal 그래프/실행 + stateless `/api/pointer/local/{turn,node,response}` 모델 호스트다. 그래프·Task·질문·실행은 localStorage, 파일 원본과 내려받은 산출물은 IndexedDB에 저장한다. PostgreSQL 관제/이벤트 코드는 별도 구현이며 이번 작업으로 운영 전환되지 않는다. 과거 기준선의 `backend/ai`와 `runtimeEngine` 언급은 역사적 이관 대상이지 현재 엔트리 설명이 아니다.

## 변경 표

| 영역 | 확인된 문제 | 구현된 변화 | 사용자에게 보이는 결과 |
| --- | --- | --- | --- |
| 실행 소유권 | 직접 노드 실행의 busy/cancel 정리가 채팅과 달랐고 늦은 콜백을 대화 ID만으로 판단 | operation 세대·소유 대화·AbortSignal, 소유된 finally와 진행 전달 | 다른 대화/새 작업을 오래된 응답이 덮지 않음 |
| Task | 최신 발화만 전달해 원래 목적·제약이 소실 | objective/current request/constraints/intermediate requestHistory를 각 phase에 전달, 실제 적용·실행·질문 경계에서 저장 | 수정 요청 후에도 원래 작업 목적 유지 |
| 결과 유효성 | revision·UI 변화와 의미 변경이 섞였고 과거 성공을 그대로 표시 | 정의·입력·선행 의미와 실제 선행 출력 증거의 SHA-256, 원본 파일 contentRevision/바이트 확인 | 오래된 성공은 `재실행 필요`, 이력 원문은 유지 |
| 연결 | flow/data 검증과 UI 역변환이 불일치 | 독립된 가역 제어 소켓, data 단일 producer, 연결 ID/kind/논리 endpoint 유지 | 캔버스 이동·복원으로 제어 흐름이 바뀌지 않음 |
| 모델 계약 | 모든 phase에 같은 수정 문구, 정의/원문 중복, 사용량 손실 | 관련 정의만 상세 공급, phase wire schema/repair, canonical 검증 유지, trusted `_meta` | 오류 위치에 맞는 제한된 수정, 실제 제공자·호출·fallback 기록 |
| 함수 저장 | 전체 그래프와 샘플 입력이 다음 재사용에 섞임 | 결과의 선행 범위만 추출, 입력 계약/명시적 상수 구분 | 새 입력으로 재사용하고 무관한 노드 제외 |
| 함수 수정/검색 | 수정 시 새 ID, 일부 함수만 발견, 저장 값까지 매번 모델에 전달 | 같은 ID의 불변 버전, pinned get, 전체 30개 compact index + 개별 계약 needs | 기존 함수 수정·재사용, 큰 상수로 일반 채팅이 막히지 않음 |
| 함수 외형 | 고정 팔레트와 제한된 아이콘 선택 | 팔레트 + color picker + 3/6자리 HEX, 검색 가능한 서버 SVG 33개 | 색상 직접 지정과 업무별 아이콘 선택 |
| 원본 읽기 | 파일 메타/preview가 실제 원문처럼 사용 | FileStore 바이트 읽기, UTF-8 텍스트 지원, 정확한 읽기 범위·출처, 중복 preview 제거 | 원문 부재/미지원 파싱을 명시, 일부 읽기 안내 |
| 산출물 | 행/열 누락이 숨겨지고 메모리·수명이 불명확 | 누락 coverage, 생성/파일/보관 한도, TTL cleanup, IndexedDB 바이트 저장 시도 | 일부 내보내기·임시 링크·저장 실패 안내 |
| 결과 화면 | 결과 버튼 이벤트 누락, 요약만 남음 | nodeResult 이벤트, 저장된 outputs.values와 서버 authorized outputRefs의 전체 값 보기 | 350자 요약 뒤 원문 결과 확인 |
| HTTP | 대기 요청이 예산을 동시에 소비, 대기 취소 누락 | admission 예약/정산, 물리 호출 집계, 큐부터 deadline/취소 | 과호출·유령 대기 요청 감소 |
| 저장 | 진행마다 전체 상태 저장, 오래된 탭 덮어쓰기 | admission/tool-effect/terminal checkpoint, revision 충돌과 실패 표시 | 쓰기 부담 감소, 실패를 성공으로 숨기지 않음 |
| 오프라인 | boot dependency 일부가 SW cache에 없음 | 한 asset manifest에서 scripts/styles/modules/precache 도출 | 기존 방문 후 오프라인에서 필요한 코드 복원 |
| 마스코트 | 새 실행 경로에서 작업 반응 전달 누락 | 실제 live node transition만 work/success/error/cancel로 연결 | 실행 노드에서 작업 반응, 과거 복원 시 반응 없음 |

함수의 모든 수정이 검증된 함수 승격을 뜻하지 않는다. `verificationStatus:'draft'`는 유지하며 실제 모델 품질·반복 재사용 가치는 별도 측정 대상이다. 함수 UI의 입력 계약/상수 편집기, 임의 SVG 업로드는 추가하지 않았다. 기존 19개 SVG 문자열은 byte-exact 회귀로 보존했다.

## 마스코트 원인과 수정

1. `runLocalNodes.onProgress → showLocalRun/pointerNodeProgress`는 실행 UI만 갱신했고 `Presence.workAtNode`를 호출하지 않았다. PostgreSQL live event 경로도 작업 반응 전달이 빠져 있었다. 새 실행기의 실제 상태 전이를 기존 마스코트 API로 연결했다.
2. `setThinking(false)`가 채팅 정리를 위해 실행 중 `working` 상태를 해제할 수 있었다. 작업 중에는 thinking 변화가 이를 덮지 않게 했다.
3. 반복 progress마다 같은 작업을 다시 시작하면 행동 타이머·시선 타깃이 리셋된다. run/node 전이 중복을 제거하고 동일 작업 시작을 멱등 처리했다.
4. 오래된 terminal 이벤트가 새 노드 작업을 끌 수 있었다. 현재 작업 nodeId와 다른 terminal 반응은 무시한다. 화면에 없는 함수 노드는 일반 작업 반응으로 연결한다.
5. 직접 실행도 busy lifecycle을 공유하고, 취소·destroy·대화 복원 때 소유 operation과 반응을 정리한다. 저장된 성공 복원은 애니메이션을 재생하지 않는다.

이는 실행 반응 소실의 코드 원인과 회귀 검증이다. 실제 화면의 미세한 눈 떨림·프레임 품질을 모든 환경에서 해결했다고 주장하지 않는다. 기존 reduced-motion·숨김 탭 처리와 기존 SVG/표정은 유지한다.

## 실제 한도와 중단

- Task 원래 목적/현재 요청 각 12,000자. 중간 변경 이력 JSON 12,000자, 저장 Task 전체 JSON 48,000자. 원래 목적과 최신 요청은 이력에 중복하지 않는다. 전체 필수 맥락이 한도를 넘으면 조용히 제약을 버리지 않고 명시적으로 중단한다. 더 긴 작업은 새 대화에서 범위를 지정해야 한다.
- 모델 입력: snapshot 262,144 UTF-8 bytes, ContextBundle 49,152, prompt data 98,304, messages 131,072, node upstream evidence 60,000, domain outputs 32,768. 서로 다른 경계의 한도다. 별도 대문 호출은 없고 계약 수정은 최대 1회다.
- 실제 파일 읽기 기본 64,000바이트, 최대 256,000바이트. 문자열 JSON 직렬화도 48,000바이트로 제한해 escape/다국어 비용을 반영한다. 필요한 prefix의 실제 범위와 누락을 기록한다. 여러 입력의 총 모델 예산을 넘으면 추가로 거절할 수 있다.
- 읽기 요청/후속 조정은 coordinator 최대 3회, source readNeeds 총 예산 32k. 질문 checkpoint는 다음 사용자 입력에 실제 결과 증거와 함께 공급한다. 실행 중 그래프 채택이나 자동 추측 재개는 지원하지 않는다. 모델이 임의 incomplete 필드를 반환할 권한을 canonical schema에 추가하지 않았다.
- 함수 최대 30 distinct IDs. 과거 버전은 제거/저장소 한도까지 보존하며 구버전 기반 편집은 충돌로 거절한다. 모델 탐색 index는 모든 ID를 유지하되 각 계약의 요약/누락과 상세 참조를 표시한다.
- local Run 저장은 최근 12회, snapshot JSON 최대 2,000,000자. browser quota로 더 일찍 실패할 수 있다. 모델 캐시는 coordinator 한 회차에만 공유한다. optional executorIdentity가 없으면 새 설정 프로필을 cache reuse 전에 알 수 없다는 제한이 남는다.
- HTTP 물리 호출 6회를 보수적으로 예약하고 실제 `_meta.providerCalls`로 정산한다. 마지막 일일 잔여 호출이 6회보다 적으면 조기에 admission을 막을 수 있다. 준비 상태는 설정 확인이며 `modelHealth:'unverified'`로 실제 모델 호출 가능성을 증명하지 않는다.
- artifact input 1MiB, 파일 4MiB, retained bytes 32MiB, 64파일, 생성 동시 2개, 30초 deadline, TTL 2시간. server process restart 시 사라지는 임시 저장이다. synchronous 생성은 중간 명령에서 즉시 interrupt할 수 없어 입력 상한과 완료 시 시간 검사를 함께 사용한다.
- 표 export: 최대 5,000행(+header)/40열. PDF fallback은 300행/12열/셀 3,000자. 누락을 coverage로 반환한다. 지원 형식은 PDF/DOCX/XLSX/CSV/TXT/MD/JSON/HTML/RTF이며 PPTX를 TXT 성공으로 바꾸지 않는다.

## 남은 제한과 방향성 검증

- PDF/이미지/Office 입력 원문 파서는 아직 없다. 메타데이터와 원문 읽기를 구분한다.
- localStorage revision 검사는 순차적으로 오래된 탭 쓰기를 막지만 simultaneous CAS/merge를 보장하지 않는다. IndexedDB 저장은 기기 로컬이며 eviction/삭제 가능하다. 서버 중앙 영속화·account 권한 경계는 운영 전환 전 별도 과제다.
- asset manifest는 dependency 누락을 줄인다. mutable network-first 자산의 서로 다른 배포 버전이 섞이는 문제까지 원자적 빌드 버전으로 해결한 것은 아니다.
- 모델 실제 품질·토큰 효율·회귀, 모바일/PC 시각 동작, PostgreSQL 통합·운영 배포 건강은 이번 오프라인 검증으로 증명되지 않는다.
- 다음 제품 검증은 동일 모델의 직접 사용과 비교해 하나의 자료 비교→표/보고서→새 자료 2·3회 재사용 흐름에서 총 시간·수정/재설명·오류 복구 노동을 측정하는 것이 우선이다. 캔버스나 노드 수를 성과 지표로 삼지 않는다.

## 검증 증거

최종 오프라인 검증 결과는 이 절에 기록한다. 실제 모델·유료 API 호출은 하지 않았다. 개별 회귀는 실패를 확인한 뒤 수정했고, 독립 검토에서 Task 필드 불일치·원문 중복·함수 index 부하·저장 원문 보기·직접 실행의 누락 안내를 추가 수정했다.

- Node.js 24.19.0 `npm test`: **530/530 pass**, 0 skipped. AI key 환경을 비우고 고정 제공자/주입 transport만 사용했다.
- `validate_contract.py` + jsonschema 4.26.0: schema fixtures **34/34**, abstract semantic probes **14/14**, payload/depth probes **3/3**, 총 **51 checks**. 실제 운영 통합을 증명하는 검사는 아니다.
- 변경 JavaScript **66파일 syntax 검사**, 이후 통합 수정 파일 재검사, `git diff --check` 통과.
- 실제 `server.js` 로컬 실행: 버전, 모델 비활성 readiness(no call), catalog, SVG 33개, TXT artifact/temporary expiry, unsupported PPTX 422 확인. 프론트는 별도 호스팅 구조이며 서버가 프론트 static을 제공한다고 가정하지 않았다.
- 실제 원문→local runner→model host→artifact→새 입력 함수 재사용 고정 출력 회귀 통과. 실행 소유권/취소, 현재·과거 결과, 실제 저장 원문 보기, 필수 누락 안내, offline manifest를 포함했다.
- 실제 모델 호출, PostgreSQL integration, 배포 사이트/브라우저 pixel 검증은 실행하지 않았다. CI 및 배포 완료는 push 후 별도 상태다.
