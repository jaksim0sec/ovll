# Ovll — Skill 전면 명칭 이관, 참조 규격 및 메시지 렌더링 설계

- 날짜: 2026-10-13
- 상태: **설계 승인됨** (2026-10-13) — Superpowers 구현 계획 작성 중
- 기준: `main` (설계 브랜치: `design/skill-contract-migration-2026-10-13`)
- 절차: Superpowers brainstorming → 승인된 설계 → writing-plans → 단계별 TDD 구현·검증
- 제품 코드 변경: **없음** (이 문서는 계획 및 계약 설계임)

## 1. 의도, 성공 기준 및 비목표

사용자는 Ovll의 제품 개념인 **노드(Node)를 스킬(Skill)로 완전히 개명**하기를 원한다. UI 텍스트만이 아니라 관련 파일명, 코드 식별자, 저장·실행·모델 계약과 지침까지 신규 규격을 Skill 중심으로 바꾸되, 기존 사용자 데이터는 읽기 호환하여 손실 없이 유지한다. 이미 잘 작동하는 캔버스·입력기·함수 실행을 불필요하게 손대지 않는다.

또한 **스킬 정의 / 캔버스 스킬 인스턴스 / 저장 함수**의 참조를 하나의 명시적·버전 있는 규격으로 직렬화한다. 입력기, 사용자가 보낸 채팅 메시지, AI 응답에서 같은 참조가 같은 형태의 태그로 보이게 하고, 언어화(EXIT) 단계에는 정확한 출력 문법을 알려준다.

완료 조건:
1. 신규 영속 데이터와 공개 Skill 인터페이스가 `skills`, `skillId`, `skillDefinitionRef`, `skillDefinitions`를 사용한다. 신규 행동 명칭도 Skill 기반이며, 전용 코드/파일명에 Node를 남기지 않는다.
2. 구 `nodes`, `nodeId`, `definitionRef`, `definitions`, 기존 행동/저장 키/참조를 **입력 경계에서만** 읽어 신규 내부 표현으로 정규화한다. 이미 저장된 사용자 그래프·관계·ID·함수·실행 결과를 손실하거나 재실행하지 않는다.
3. 새로 저장하거나 전송하는 데이터는 신규 형식 하나만 사용하고, 혼합·충돌 형식은 조용히 선택하지 않고 명시적으로 거절한다.
4. 입력기/채팅 버블/AI 메시지의 태그는 공통 파서·컴포넌트·아이콘 스타일에 의해 표시되고 복사·검색·저장·복원해도 참조 ID가 유지된다.
5. 실제 Skill/Function 등록 상태를 조회하지 못하거나 식별자가 무효라면 태그나 연결·실행 성공을 지어내지 않는다.
6. 기존 코드의 스케줄링, 실행 권한·포트·IR 의미, 함수화, 호출 회수, SVG, 모바일 키보드 및 입력기 레이아웃을 바꾸지 않는다.

**비목표:** 새로운 스킬 실행 기능, 새로운 노드/스킬 종류, 스케줄러 교체, 새로운 API 공급자, 모델 호출 추가, 저장 함수(Function)를 Skill로 합치기, 외부 서비스와의 호환성 확대.

## 2. 범위 및 용어

- **스킬 정의 (SkillDefinition):** 기능과 입출력/지시/버전을 설명하는 재사용 가능한 정의.
- **스킬 인스턴스 (SkillInstance):** 특정 그래프에 놓인 실제 스킬, 위치·설정·연결·실행 상태를 가진다.
- **저장 함수 (Function):** Skill과 별도 자산. 기존 함수 저장·바인딩·실행은 유지.
- **그래프 (Graph), 링크 (Link), Task, Run:** 개념과 연산 의미를 유지한다.
- **제외할 Node:** Node.js 런타임, DOM `Node`/`NodeList`/`nodeType`, Node.js 패키지·표준 API, 프로젝트와 무관한 기술 용어. 구 데이터 및 과거 기록은 보존한다.
- 내부 레거시 `nodeId`가 들어간 **검증용 호환 변환기, 과거 증거 판별 코드, 마이그레이션 픽스처**는 허용한다. 새 공개 인터페이스에서 이를 사용하지 않는다.

## 3. 접근법과 선택

- 일괄 정규식 치환: 파일 간 결합/의미 차이 때문에 거부.
- 화면만 Skill, 내부 Node 유지: 완전 개명 요구에 어긋나 거부.
- **단계별 신규 계약 도입 → 경계별 읽기 호환 → 전 사용처 전환 → 구 코드 제거: 채택.**

각 단계의 테스트가 성공한 경우만 다음 단계로 넘어간다. 코드 이동/이름 변경은 가능한 한 내용 변경과 분리해서 리뷰에서 이동을 인식하게 한다.

## 4. Skill v2 저장·실행 계약

### 4.1 신규 그래프 스키마

```json
{
  "graph": {
    "graphId": "g_1",
    "revision": 4,
    "skills": [
      {
        "skillId": "n_legacy_id_unchanged",
        "skillDefinitionRef": {"definitionId": "builtin:write", "version": 1},
        "settings": {},
        "inputBindings": {}
      }
    ],
    "connections": []
  },
  "skillDefinitions": [
    {"definitionId": "builtin:write", "version": 1, "purpose": "Write"}
  ]
}
```

ID **문자열의 값은 보존**한다. 기존 `n_...` 값도 유효하며 신규 생성 ID는 `s_...`를 사용할 수 있다. 기존 `graphId`, `revision`, 연결 ID 및 입출력 port key는 변경하지 않는다. 새 파일·타입·변수에서는 `Skill`을 쓰되, 데이터 값 자체가 스키마를 뜻하지 않는 식별자는 변경하지 않는다. 연결 endpoint의 참조 필드 `nodeId`도 `skillId`로 바꾼다.

### 4.2 호출·Patch·결과

신규 인터페이스는 `skill.*` 계열을 사용한다. 현재 `node.add`/`node.update`/`node.delete`/`node.define`는 `skill.add`/`skill.update`/`skill.delete`/`skill.define`로 변경한다. `definition.revise`/`definition.appearance`/`definition.delete`는 `skill.revise`/`skill.appearance`/`skill.definition.delete`로 변경한다. 링크·실행·함수 액션은 이름을 바꿀 이유가 없는 한 유지한다. Patch operation과 `localNodeKey`, `nodeRef`, `NodeSelector`, `nodeContext`, 실행 결과 `nodeId`/Run `nodes` 등 실제 Skill 개념을 가리키는 내부/공개 필드도 각각 `skill.*`, `localSkillKey`, `skillRef`, `SkillSelector`, `skillContext`, `skillId`/Run `skills`로 대응시킨다.

**중요:** 정확한 변화 목록은 구현 계획의 호출 그래프·스키마 감사에서 확정한다. 여기 명시하지 않은 의미·포트·데이터 타입은 재설계하지 않는다. 구 액션 명칭은 모델/HTTP/스토리지 **인입 호환 어댑터에서만** 허용하며, 모델에 공급하는 신규 계약과 출력은 Skill 표기로 통일한다.

### 4.3 읽기 호환 및 이관

1. 기존 스토리지 키 `ovll:workspace:v1` 및 구 함수 저장 키는 **읽을 수 있어야 한다**. 신규 저장 포맷에는 명시적 Skill 스키마 버전을 붙이되, 키 변경 여부는 안전한 이전 원본 보존을 전제로 결정한다.
2. 구 데이터는 순수 함수 `normalizeLegacySkillGraph` 계열의 **단일 인입 변환 계층**으로 변환한다. 읽기 성공 뒤 타입·포트·참조·링크 무결성을 검증한다. 입력 객체는 직접 변경하지 않는다.
3. 혼합 `nodes`+`skills`, 동일 참조의 `nodeId`+`skillId`가 동시에 있으면 값이 같다고 해도 **충돌/중복 계약 오류**로 취급한다. 모호한 정의·연결은 추측해 복구하지 않는다.
4. 성공적인 변환 상태를 새로 영속화하기 전에 구 원본 백업 저장을 검증한다. 백업 실패/공간 부족/검증 오류에서는 기존 원본을 덮어쓰지 않는다. 부분 이관은 중단하고 명시적 오류를 표시한다.
5. 과거 `nodeId`가 포함된 실행 증거/semantic fingerprint는 **옛 버전 스냅샷의 원래 정규 직렬화로 판별**한다. 구 증거가 옛 자료와 정확히 일치할 때만 신뢰한다. 신규 데이터와 신규 실행 증거는 신규 Skill 형식으로 계산한다. 스키마 변경 때문에 기존 결과를 성공으로 위장하거나 재실행하지 않는다.
6. 구 레코드/함수/그래프가 참조하는 변경 불가능한 `definitionId`, `version`, 외부 자산 값은 유지한다.
7. 구 데이터를 열지 않고 저장했을 때에도 복원과 재조회가 가능한지 확인한다. 실제 마이그레이션은 멱등성을 만족해야 한다.

### 4.4 파일·경로 변경

관련 이름은 역할에 맞게 이동한다. 예시: `front/js/canvasNode.js → canvasSkill.js`, `canvasNodeBuilder.js → canvasSkillBuilder.js`, `customNodes.js → customSkills.js`, `customNodeStore.js → customSkillStore.js`, `backend/ovllPointer/nodeCatalog.js → skillCatalog.js`, `nodeExecution.js → skillExecution.js`, `nodeOutput.js → skillOutput.js`, 해당 스타일·테스트 이름도 이전한다. JS 자산 manifest, HTML 참조, 서비스 워커 캐시, 서버 import, 동적 import, Vercel/Render 실행 환경, 검사 스크립트, 문서 링크를 함께 업데이트한다.

`/api/pointer/local/node` 등 외부 wire path도 신규 `/skill`로 이전하되 구 경로는 좁은 호환 라우트에서만 계속 수용한다. 실제 호환 기간은 기존 클라이언트 사용 가능성이 있는 한 제거하지 않는다. 저장 키/로그/외부 `node` 문자열은 의미와 호환성 위험에 따라 마이그레이션 예외 목록을 작성한다. 무관한 DOM/Node.js API는 변경 금지.

## 5. 공통 참조 모델 및 문법 v1

예시는 **의미 설명용**이었으므로 `@...`나 `#...` 특정 글자 조합은 요구 사항이 아니다. 아래 문법은 설계상 선택한 **버전 있는 기계 표현**이며, 사용자에게 보이는 텍스트와 구분된다.

```text
⟦ovll:ref:v1:skill-def:<encoded-definition-id>[:<version>]⟧
⟦ovll:ref:v1:skill-canvas:<encoded-graph-id>:<encoded-skill-id>⟧
⟦ovll:ref:v1:function:<encoded-function-id>[:<version>]⟧
```

- ID는 정해진 길이 한도 내의 안전한 **canonical RFC3986 UTF-8 percent-encoding**으로 직렬화한다. 버전은 양의 정수. 구분자 `:`는 ID 내부에서 반드시 인코딩한다. 인코딩 결과를 다시 인코딩한 값과 입력이 다르면 거부한다.
- `SkillReference`의 구조화된 진실은 `kind`, `definitionId`/`version`, 또는 `graphId`+`skillId`, 또는 `functionId`/`version`; 사용자에게 보일 이름과 SVG는 참조 시점의 레지스트리에서 조회한다. 역사적 이름은 선택적 display snapshot으로만 보관하며 진실의 소스가 아니다.
- 일반 텍스트와 문법 토큰을 잇는 공통 `parseSkillReferences`, `serializeSkillReference`, `resolveSkillReference`를 제공한다. 파서는 유효한 문법과 **실제로 확인되는 참조**를 구분한다. 권한/스코프 검증을 통과하지 못한 토큰은 **일반 텍스트**로 보인다.
- 입력기는 DOM dataset의 구조화된 태그를 원본으로 삼고 submit 직전에 정규 표기로 직렬화한다. 사용자가 직접 입력한 토큰처럼 보이는 문장은 원시 텍스트로 분리/이스케이프한다. 저장/복원/붙여넣기/복사에는 진짜 참조인지와 단순 텍스트인지 구분되는 자료를 보존한다.
- 이전 `node_type`, `node_instance`, `@이름〔노드 타입:ID〕` 같은 표시는 **구 저장 초안 읽기 호환**에서만 처리한다. 이 문자열을 그대로 전송하거나 신규 데이터에 다시 저장하지 않는다.
- 한 대화에서 다른 대화로 넘어갈 때 캔버스 인스턴스를 잘못 참조하지 않도록 **graphId를 토큰에 포함**한다. 존재하지 않는 스킬·함수, 다른 그래프나 범위를 무단 참조한 경우 실행 대상으로 승격하지 않는다.

## 6. 모델·프롬프트·언어화 계약

모델에게 주는 작업 요청은 단순 `@라벨` 문자열이 아니라, **사람이 읽을 수 있는 스킬 설명 + 기계식 식별자 + 실제 허용된 정의/스코프**의 세 요소를 함께 제공한다.

예:
- 정의: `정의된 스킬 '자료 분석' (참조: ⟦ovll:ref:v1:skill-def:builtin%3Areview:1⟧)`
- 인스턴스: `현재 캔버스의 스킬 #n_17 (그래프 g_1, 참조: ⟦ovll:ref:v1:skill-canvas:g_1:n_17⟧)`

이 텍스트는 **프롬프트에 대한 설명과 대상 명시**일 뿐, 실행을 승인하거나 실제 수행되었다고 증명하지 않는다. 해석 후 런타임 인가/실행 검증은 기존 정책 그대로다.

단일 원본 지침: `instructions/prompts/shared/skill-references.md` (신규).
- 참조 종류/직렬화 문법/유효 ID 및 스코프/출력 방식/잘못된 참조 처리와 escaping만 기술한다.
- 활성 `instructions/registry.json`, `backend/ovllPointer/promptComposer.js`, 서버 로컬 모델 계약(`modelContract.js`)이 **같은 지침 버전**을 사용한다. 개발자 프롬프트에 중복 전문을 삽입하지 않는다.
- EXIT/언어화 `instructions/prompts/layers/response.md`에 이 지침 사용을 연결한다. 대문·복도·작업실의 직답/결과 반환 경로에도 필요한 최소 규칙만 공급한다. 직접 응답이나 이미 완성된 산출물 전달에 **새 모델 호출을 추가하지 않는다**.
- 모델에는 실제 접근 가능한 `allowedReferences` 또는 동등한 현재 스코프 인덱스만 전달한다. 모델이 새 토큰을 지어내도 렌더러는 무조건 태그화하지 않는다.
- 스트리밍/부분 응답은 열린 토큰을 임의의 임시 태그로 만들지 않고 완결/검증 시점에만 렌더링한다.
- 사용자가 직접 타이핑한 참조 토큰을 모델이 반복했다고 해서 사용자 승인 없이 그래프 동작으로 해석하지 않는다.

## 7. 프론트 메시지 구조 및 표시

**공통 렌더 경로:** `front/js/ovllComposer.js` (향후 Skill 작명) → 저장/전송 → `front/js/app.js` 메시지 생성 → `front/js/ovllWorkspace.js` 보조 워크스페이스 메시지 생성까지 동일한 파서·태그 컴포넌트를 사용한다.

- 입력기 contenteditable 레이아웃은 유지. 멘션 UI의 DOM tag 생성자와 채팅 렌더러가 똑같은 `SkillReferenceChip` 디자인/아이콘 데이터/색상 규칙 및 기존 공통 `.svg-icon`을 사용하도록 추출한다.
- 저장 메시지는 raw `text`의 진실성과 검색/복사를 보존하고, 필요하면 검증된 구조화된 parts를 보조 데이터로 추가한다. 구 `text`만 있는 메시지도 일반 텍스트로 보인다. 레거시 언급은 확인 가능한 경우에만 업그레이드한다.
- 임의 HTML `innerHTML`에 모델 출력 삽입 금지. 인라인 문자를 `textContent`로 만들고, 검증된 참조 토큰만 DOM `span`으로 구성한다. 서버 SVG는 현행 신뢰 경계와 sanitizer 규약 그대로 처리한다.
- 참조된 정의가 삭제되거나 다른 대화에만 있으면 `참조할 수 없는 스킬` 등 **안전한 비활성 표시** 또는 원시 텍스트. 다른 동명 항목으로 잘못 연결하지 않는다.
- 채팅 메시지와 입력기의 태그는 시각적으로 동일하나, 삭제/커서/키보드 조작은 입력기에만 적용한다. 렌더러는 입력기 높이 계산이나 모바일 포커스 제어에 관여하지 않는다.

## 8. 구현 순서 및 위험 분리

1. **Inventory/Baseline:** 파일명, 문자열, 저장 키, 패치 op, 요청 경로, 프롬프트 지침 및 tests 목록을 자동 추출. 현재 `npm test`와 실행 경계의 smoke test 기준선을 기록한다.
2. **Skill v2 + Legacy ingress:** 계약/변환/증거 검증 테스트 RED → 신규 normalized schema 구현 → GREEN. 구 데이터 fixture, 혼합 오류, 이전 ID, 사용자 정의 정의와 기존 실행 결과를 포함한다.
3. **핵심 코드·파일명 이전:** 코드 파일 이동, import/manifest/route 수정과 API alias를 구분된 커밋으로 진행. 구조와 이름 외의 의미 변경 금지.
4. **Reference protocol:** 공유 SkillReference 모델·파서·직렬화·resolver·XSS/스코프 검사와 과거 초안 복원 추가.
5. **화면 통합:** 입력기 → 저장 사용자 메시지 → AI 메시지 및 워크스페이스 순으로 동일 UI 적용. 뒤틀림 방지를 위해 실제 모바일 키보드/그리드 검사를 포함한다.
6. **언어화 및 모델 지침:** 단일 규범, registry/context 제공과 direct/EXIT 답변 실례를 검증. 필요하지 않은 재호출 없음.
7. **잔여 Node 감사 및 전체 검증:** 참조 유실, 과거 저장 데이터 재개방, 그래프 실행, 함수 바인딩, 역직렬화, 파일 캐시, 빌드/테스트, 실제 모델의 지침 준수 점검.

**각 단계의 차단 조건:** 사용자 데이터 손실·변환 비결정성·실행 증거 오인·새 인터페이스의 구 표기 유출·회귀 실패. 실패 시 해당 단계 중단/롤백; 다른 동작까지 손대며 추측 수정하지 않는다.

## 9. 검증 시나리오 및 승인 기준

1. 그래프/캔버스/함수 저장 구 v1 스냅샷 → 읽기 → Skill v2 → 재읽기. ID·연결·포트·설정·정의 버전 동일; 원본 불변.
2. 구 결과 fingerprint 정당성/오래됨/위조/스키마 변환 시나리오가 이전보다 느슨해지지 않는다.
3. Node 이름을 전부 Skill로 바꾼 후 전체 빌드, JS 모듈 import, 자산 manifest, 서비스 워커, 라우트, 스키마 검증 통과.
4. 동적 정의/커스텀 플러그인 포함 새 Skill 생성·수정·연결·실행·결과 반환·함수 재사용 결과가 이름 변경 전과 의미적으로 동등.
5. 스킬 정의, 특정 그래프의 인스턴스, 저장 함수에서 ID가 같은 경우에도 정확한 종류만 태그 처리한다. 대화 전환/이름 변경/삭제/없는 참조/구 포맷 포함.
6. 초안 편집·IME 조합 중 @ 검색·키보드 열림/닫힘·확장/축소·붙여넣기/한 번의 제출과 메시지 복원.
7. 사용자 메시지와 AI 답변 모두 텍스트와 혼합 태그를 올바르게 렌더링, 악성 HTML과 위조 참조를 무해한 텍스트로 처리.
8. LLM/EXIT 직접 대화·단일 작업·실행 결과 요약·상태 불명 응답의 문법 준수. 서버 결과와 모델 출력이 충돌할 때 기존 검증 권위를 보존.
9. 모델 호출 수, 저장 함수 스냅샷, 컨텍스트 제한, 권한 게이트와 포트 계약의 회귀 없음.
10. 구명칭 검색에서 남은 항목이 **예외 목록(과거 기록, 변환기, DOM/Node.js, 외부 호환)**과 정확히 일치하는지 확인.

실제 브라우저와 외부 모델 테스트가 실행되지 않았다면 정적 테스트만으로 배포 완료 또는 성능 동등성을 주장하지 않는다.

## 10. 결정 상태

**확정:** Skill v2 신규 형식, Legacy 읽기 호환, 모든 제품 표면 개명, 공통 참조 규격/렌더러, 단일 프롬프트 지침, 불필요한 기능 변경 금지.

**검토 요청:** 직렬화 토큰의 정확한 delimiter/접두어는 기술 선택이다. 사용자 예시를 문자 그대로 복제한 것이 아니다. `graphId`와 정의 버전을 포함하는 식별 안정성, 별도 Function 유지, 안전한 하위 호환을 우선했다.

**다음 단계:** 설계 승인 완료 → Superpowers writing-plans로 경로·호출자·테스트·커밋 순서를 작성 → 구현 계획 검토 및 실행 방식 선택 → 격리 브랜치에서 진행.
