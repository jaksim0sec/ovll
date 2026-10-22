# Ovll Independent Request Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 개의 가상 요청을 등록·대기·실행해 실제 Gemini 기반 Gate → Hallway Initial → 직접 응답까지 완료하되, 엔진은 모델/전송/저장 기술에 의존하지 않는다.

**Architecture:** 등록소는 요청별 상태, 스케줄러는 실행 순서, 엔진은 Gate·Hallway 판단을 소유한다. 엔진의 모델 호출과 자료 조회는 주입된 포트로만 수행하며, 초기 참조 자료는 구조화 Composer 초안의 Skill·Skill Block을 프론트가 해석해 제공한다.

**Tech Stack:** 기존 beta의 JavaScript ES modules, Node.js 내장 `node:test`, Node 내장 `fetch`/파일 읽기/crypto; 브라우저는 기존 Workspace API만 재사용. 신규 npm 패키지·웹서버·DB·배포 없음.

**Spec:** `docs/superpowers/specs/2026-10-23-independent-request-engine-design.md`

## Global Constraints

- `beta`만 작업한다. `main` 수정·병합·배포 금지. `AGENTS.md` 및 관련 `docs/developing/*`을 먼저 확인한다.
- 용어는 **Gate / Hallway / Workshop / Output**. `hallwayInitial`, `hallwayReturn`, `prompts/base/hallway*.md`, `docs/developing/workshops.md`로 변경. 실제 데이터셋 `need` 이름(`skillDef`, `canvasSkill`, `originalReq`, `chatContext`, `skillList`)은 변경하지 않는다.
- 최초 시연은 **Gate → Hallway Initial → 직접 응답**. 계획 분기에는 `unsupported_workshop`; Output 추가 호출·가짜 Workshop 실행 금지.
- Gemini 단일 모델만 사용하지만 엔진은 `gemini`, 인증키, 공급자 응답 구조를 import/참조하지 않는다. 모델명은 호출기 설정에서 주입하고 키는 소스에 저장하지 않는다.
- 첨부된 Skill Block은 해당 블록 **전체 로컬 편집 정보**와 참조 Skill의 **실제로 이용 가능한 메타데이터/정의**만 초기 주입. 다른 연결 블록·전체 그래프 자동 첨부 금지. 표시용 Skill 카탈로그를 실행 정의로 가장하지 않는다.
- 최초 상태 저장은 인메모리이며 프로세스 재시작 복구·영속 Revision·인증·HTTP/SSE·실제 파일 바이트 업로드·실행 IR은 범위 밖이다. `front/js/boot.js` 및 기존 화면 동작을 강제로 연결/수정하지 않는다.
- 매 작업에 `node --test` 실패→최소 구현→통과→`beta` 커밋 단계를 적용한다. 실제 Gemini 검증은 키가 있을 때만 수행하고 결과를 별도 기록한다.
- 기술적으로 미확정된 Workshop 실행 함수/IR/세션 충돌 병합/중단·재개 정책은 임의 확정하지 않는다. 막히면 구현을 중지하고 사용자에게 질문한다.

## Review Focus

아래는 단순 정상 흐름 테스트에서 빠지기 쉬운 다섯 입력/장애 유형이다. 각 담당 작업 테스트에 포함한다.

1. **다른 roomId에 같은 requestId 접근 / 외부가 얻은 스냅샷의 후속 변조** → 등록소가 거부하거나 복제본을 반환한다 (Task 2).
2. **대기 중인 요청 2건과 앞 요청의 실패** → 두 번째 요청도 실행되고 상태/결과가 섞이지 않는다 (Task 2, 6).
3. **잘못된 Skill/Block ID와 위조된 label, 파일 블럭의 Blob** → 누락을 표시하고 실제 카탈로그/블럭 정보를 사용하며 Blob은 전송하지 않는다 (Task 5).
4. **Gate의 중복 need / 모르는 dataset / Hallway의 잘못된 조건부 JSON** → 중복 재조회 방지, 명시적 부재/실패, 검증 전 완료 금지 (Task 5, 6).
5. **Gemini 429/권한 오류/빈 candidates/유효하지 않은 JSON** → 오류가 분류되고 비밀키·프롬프트가 요청 공개 결과에 포함되지 않는다 (Task 4, 6).

---

## File/Interface Map

| 책임 | 경로 | 주요 출력 |
|---|---|---|
| 활성 docs/prompts/manifest 용어·경로 정리 | `docs/developing/*`, `docs/notes/*`, `prompts/*`, `AGENTS.md` | 활성 레이어 식별자 `gate`, `hallwayInitial`, `hallwayReturn`, `output` |
| 문서·프롬프트 참조 검사 | `tests/backend/terminology.test.mjs` | 이전 경로 부재, manifest 가리키는 파일 실존 |
| 요청·상태 등록 | `back/js/request/registry.js` | `createRequestRegistry({createId?})` → `{register,get,transition}` |
| 동시 실행 관제 | `back/js/request/scheduler.js` | `createRequestScheduler({registry,execute,maxConcurrent?})` → `{enqueue,get,whenIdle}` |
| 계층 지침 조립 | `back/js/engine/promptComposer.js` | `createPromptComposer({promptsRoot})` → `{compose(layer,bindings)}` |
| 외부 모델 어댑터 | `back/js/model/gemini.js` | `createGeminiCaller({apiKey,model,fetchImpl?})` → `{generate}` |
| 프론트 최초 자료 묶음 | `front/js/workspace/requestInput.js` | `prepareRequestInput({draft,dataAccess})` → `{request,initialResources}` |
| 추가 자료 공급 | `back/js/engine/dataProvider.js` | `createMemoryDataProvider({fixtures?})` → `{resolveNeed}` |
| 독립 판단 엔진 | `back/js/engine/engine.js` | `createRequestEngine({composer,modelCaller,dataProvider})` → `{run}` |
| 가상 요청 실행 | `back/js/demo.js` | `GEMINI_API_KEY`·`GEMINI_MODEL` 환경변수로 단일 요청 실행 및 공개 결과 출력 |
| 구현 사실 명세 | `docs/developing/request-engine.md` | 현재 API·상태·비구현 범위 |

신규 백엔드 테스트는 `tests/backend/request-lifecycle.test.mjs`, `prompt-composer.test.mjs`, `gemini-caller.test.mjs`, `request-input.test.mjs`, `engine.test.mjs`에만 작성한다. 요청 전체를 객체화하는 것과 모델 호출 한 회의 임시 데이터 구조를 혼합하지 않는다.

### Task 1: 전체 용어·파일·매니페스트 정합성

**Files:**
- Rename: `prompts/base/corridorInitial.md` → `prompts/base/hallwayInitial.md`
- Rename: `prompts/base/corridorReturn.md` → `prompts/base/hallwayReturn.md`
- Rename: `docs/developing/workrooms.md` → `docs/developing/workshops.md`
- Modify: `prompts/manifest.json`, `prompts/base/gate.md`, `prompts/blocks/planGeneration.md`, `prompts/blocks/contextBlockUpdate.md`, 기타 모든 `docs/**`·`prompts/**`의 해당 참조와 명칭, `AGENTS.md`
- Test: `tests/backend/terminology.test.mjs`

**Interfaces:**
- Consumes: 현재 docs/prompt 파일 목록 및 `manifest.layers`.
- Produces: `manifest.layers.gate/hallwayInitial/hallwayReturn/output`와 각 실존하는 파일 경로. 의미는 기존 1014 계약 그대로.

- [ ] **Step 1 — 실패 테스트 작성**: `terminology.test.mjs`에서 모든 `prompts/manifest.json` 레이어 파일이 실존·중복 없이 순서대로 열리는지, 이전 `corridor*.md`/`workrooms.md` 경로가 없는지, 활성 `docs/developing`·`docs/notes`·`prompts`에 옛 용어 참조가 남지 않는지 검사. 승인된 설계 명세의 **마이그레이션 기록에 등장하는 과거 명칭은 역사적 설명으로서 예외**.
- [ ] **Step 2 — RED 확인**: `node --test tests/backend/terminology.test.mjs`; 기존 이름과 경로 때문에 FAIL.
- [ ] **Step 3 — 최소 변경**: 전 파일 목록을 다시 순회해 Gate/Hallway/Workshop/Output로 용어 통일, manifest/파일명/상대 참조 수정. 프롬프트의 수행 의미·`need` 데이터셋·plan의 실제 step keys는 보존. 오래된 상태 설명은 새 엔진의 실제 구현 시점 Task 7에서만 갱신. `AGENTS.md` 트리·경로 설명도 현실화.
- [ ] **Step 4 — GREEN 확인**: `node --test tests/backend/terminology.test.mjs` PASS, `node --test tests/frontend/*.test.mjs` 실행(브라우저 전용 테스트는 지원 환경에 따라 SKIP/실행 여부 기록).
- [ ] **Step 5 — 커밋**: `git add -A docs prompts AGENTS.md tests/backend/terminology.test.mjs && git commit -m "refactor: standardize gate hallway workshop terminology"`.

### Task 2: 요청 등록소와 단일 실행 큐

**Files:**
- Create: `back/js/request/registry.js`, `back/js/request/scheduler.js`
- Test: `tests/backend/request-lifecycle.test.mjs`

**Interfaces:**
- `createRequestRegistry({createId = () => crypto.randomUUID()} = {})`의 `register({roomId,request,contextData,initialResources=[]})`는 복제된 상태 스냅샷 `{roomId,requestId,status:'queued',currentLayer:'gate',request,contextData,initialResources,contextBlock:{intent:'',progress:''}}` 반환. `get(roomId,requestId)`는 복제본 또는 `null`; `transition(roomId,requestId,changes)`은 유효 전이만 적용.
- `createRequestScheduler({registry,execute,maxConcurrent=1})`의 `enqueue(input)`는 `{roomId,requestId,completion}` 반환, `completion`은 종료 시 공개 스냅샷. `get(roomId,requestId)`와 `whenIdle()` 제공. `execute(snapshot,{onStage})`는 엔진 구현과 맞출 콜백으로, `onStage(layer)`가 현재 계층을 갱신한다.
- 상태 전이는 `queued → running → completed | unsupported_workshop | failed`만 허용. 실패 공개 값은 `{code,message}`; 예외 원문, 비밀키, 프롬프트는 저장 금지.

- [ ] **Step 1 — 실패 테스트 작성**: 요청 생성/복제/room 격리/잘못된 전이 거부, defer된 Promise의 FIFO 단일 실행, 요청 1 실패 후 요청 2 정상 실행, 동일 ID 충돌 거부, 상태와 contextBlock 혼합 방지.
- [ ] **Step 2 — RED 확인**: `node --test tests/backend/request-lifecycle.test.mjs`; 미구현 모듈 import로 FAIL.
- [ ] **Step 3 — 최소 구현**: registry의 상태 소유·검증·복사, scheduler의 최대 1 실행·대기·실패 확정/후속 진행 구현. `whenIdle()`은 모든 활성/대기 실행이 끝났을 때 해결. 동시 실행 수 조정이 엔진 입력을 바꾸지 않도록 함.
- [ ] **Step 4 — GREEN 확인**: `node --test tests/backend/request-lifecycle.test.mjs` PASS.
- [ ] **Step 5 — 커밋**: `git add back/js/request tests/backend/request-lifecycle.test.mjs && git commit -m "feat: isolate requests behind registry and scheduler"`.

### Task 3: 레이어 프롬프트 조립기

**Files:**
- Create: `back/js/engine/promptComposer.js`
- Modify: `prompts/base/gate.md`, `prompts/blocks/informationRequest.md`, `docs/developing/prompt-composition.md` (초기 자료 입력 규칙 확정 부분)
- Test: `tests/backend/prompt-composer.test.mjs`

**Interfaces:**
- `createPromptComposer({promptsRoot})` → `await compose(layer,bindings)` = 문자열. layer는 `gate` 또는 `hallwayInitial` (나머지 두 레이어 파일/순서는 유지하고 조립 가능하게 할 수 있으나 런타임 호출 금지).
- `bindings`는 활성 프롬프트 플레이스홀더용 `{languageSettings,interfaceSyntax}`이며 누락된 치환값을 조용히 원문 상태로 내보내지 않는다. 사용자 요청/자료/contextData는 **이 문자열에 직접 합성하지 않고** 모델 호출 포트의 별도 `context` 인수로 보낸다.
- 프롬프트 순서는 manifest 배열을 유일 원본으로 사용한다. 인식하지 못하는 레이어/없는 파일 경로는 실패한다.

- [ ] **Step 1 — 실패 테스트 작성**: manifest 순서·각 마크다운 포함, `hallwayInitial` 구별, 필수 치환 성공/누락 실패, Gate·InformationRequest 안내에 *사전 제공 자료 중복 need 금지* 문구 존재, 잘못된 레이어 거부, 실행 시 cwd 변화에도 파일 조회 성공.
- [ ] **Step 2 — RED 확인**: `node --test tests/backend/prompt-composer.test.mjs`; FAIL.
- [ ] **Step 3 — 최소 구현**: Node `fs/promises`·`path`로 manifest 순회, 안전한 경로 결합 및 치환, 기존 마크다운 그대로 조립. Gate에는 처음부터 제공된 Skill/Skill Block의 출처·완전성으로 부족분만 `need`에 담도록 문구를 명시.
- [ ] **Step 4 — GREEN 확인**: `node --test tests/backend/prompt-composer.test.mjs` PASS.
- [ ] **Step 5 — 커밋**: `git add back/js/engine/promptComposer.js prompts docs/developing/prompt-composition.md tests/backend/prompt-composer.test.mjs && git commit -m "feat: compose model-neutral layer prompts from manifest"`.

### Task 4: 실제 Gemini 어댑터 및 모델 중립 호출 규격

**Files:**
- Create: `back/js/model/gemini.js`
- Test: `tests/backend/gemini-caller.test.mjs`

**Interfaces:**
- 엔진이 의존하는 단 하나의 포트: `await modelCaller.generate({layer,prompt,context,format:'json',signal?})` → `{jsonText:string}`. 공급자/SDK의 응답 객체는 포트 밖으로 나오지 않는다.
- `createGeminiCaller({apiKey,model,fetchImpl=globalThis.fetch})`는 설정값을 검증하고 동일 포트를 구현. REST `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, `x-goog-api-key` 헤더, `systemInstruction`에 prompt, `contents`에 JSON 직렬화된 context, `generationConfig`에 JSON 응답 모드. 실측 시 공급자 지원 여부 확인. 공급자 문제는 `{code,message}`로 구분 가능한 오류를 던지되 키·원문 프롬프트 노출 금지.
- 호출기 설정의 `model`은 모든 레이어에 동일하며 엔진 포트에는 전달하지 않는다. 재시도·스트리밍은 이 단계에서 추가하지 않는다.

- [ ] **Step 1 — 실패 테스트 작성**: `fetchImpl` 주입으로 URL/헤더/본문/JSON 모드, `candidates[0].content.parts[].text` 추출, 429·401/403·빈 candidates·비텍스트 응답·네트워크 실패·중단 시 오류 분류, 비밀키 비노출 검증. 모의 caller가 동일 `generate` 형태로 동작하는지도 검증.
- [ ] **Step 2 — RED 확인**: `node --test tests/backend/gemini-caller.test.mjs`; FAIL.
- [ ] **Step 3 — 최소 구현**: Node 내장 fetch REST 어댑터만 구현. 입력 `context`는 전송용 직렬화 외에 도메인 변환 금지; 공급자 후보 추출만 담당. 별도 실행 도구나 요청 재시도 없음. REST 구현 세부는 Google 공식 `https://ai.google.dev/api/generate-content` 참조.
- [ ] **Step 4 — GREEN 확인**: `node --test tests/backend/gemini-caller.test.mjs` PASS.
- [ ] **Step 5 — 커밋**: `git add back/js/model/gemini.js tests/backend/gemini-caller.test.mjs && git commit -m "feat: adapt Gemini responses to model-neutral call port"`.

### Task 5: 프론트 초기 참조 묶음과 메모리 데이터 공급자

**Files:**
- Create: `front/js/workspace/requestInput.js`, `back/js/engine/dataProvider.js`
- Test: `tests/backend/request-input.test.mjs`

**Interfaces:**
- `prepareRequestInput({draft,dataAccess})`는 `{request:{parts,attachments},initialResources}` 반환. `dataAccess.readCanvasSnapshot()` 및 `readSkillCatalog()`만 사용하고 파일 Blob은 제거. 입력 `parts` 순서/`type`/`id` 유지. 참조되지 않은 연결 블럭은 제외.
- `initialResources` 항목: `{dataset:'skillDef'|'canvasSkill',key,source,completeness:'complete'|'metadata'|'missing',value}`. `canvasSkill.key`는 블록 ID, `skillDef.key`는 실제 Skill **name** (need 계약의 `skillDef`는 이름으로 조회). 같은 정의를 여러 블럭이 참조하면 한 번만 포함. 현재 Skill catalog는 `metadata`만. 없는 Skill/Block은 `missing`, `value:null`로 명시.
- `createMemoryDataProvider({fixtures={}})`의 `resolveNeed({roomId,requestId,need,availableResources,request,contextData})` → `{resources,missing}`. 이미 완전하게 있는 항목은 재조회하지 않음. 메타데이터만 있는 항목은 완전한 정의라고 판단하지 않음. `originalReq`의 현재 요청, `chatContext` 미보유 기록, `skillDef` 이름, `canvasSkill` ID, `skillList` 데이터셋을 구별하고 허용되지 않은 need 종류는 명시적 오류. 메모리 fixture 외 자산을 자동 창조하지 않는다.

- [ ] **Step 1 — 실패 테스트 작성**: Skill+Block 중복 참조, block의 실제 skillId/실제 Skill name 사용과 위조 label 무시, 참조 누락, file Blob 제외·파일 정보 존재, 연결된 다른 블럭 제외, 원본 스냅샷 불변, 필요 자료를 이미 보유한 경우 조회 횟수 0, 부분 메타데이터는 완전 데이터로 오판 금지, 미지원 dataset·누락 목록.
- [ ] **Step 2 — RED 확인**: `node --test tests/backend/request-input.test.mjs`; FAIL.
- [ ] **Step 3 — 최소 구현**: 프론트 UI·모델 모듈을 엔진에 import하지 않도록 준비 함수는 front에 두고, 데이터 공급자는 외부 조회 대신 메모리 fixtures를 사용. 자료의 신뢰·소유권 판정 기능은 구현했다고 주장하지 않는다.
- [ ] **Step 4 — GREEN 확인**: `node --test tests/backend/request-input.test.mjs` PASS.
- [ ] **Step 5 — 커밋**: `git add front/js/workspace/requestInput.js back/js/engine/dataProvider.js tests/backend/request-input.test.mjs && git commit -m "feat: prefill typed request references and resolve additional data"`.

### Task 6: 독립 엔진 — Gate → Hallway 직접 응답

**Files:**
- Create: `back/js/engine/engine.js`
- Test: `tests/backend/engine.test.mjs`
- Modify: `tests/backend/request-lifecycle.test.mjs` (Scheduler 통합 사례)

**Interfaces:**
- `createRequestEngine({composer,modelCaller,dataProvider})`의 `run(snapshot,{onStage=()=>{}}={})` → `{status:'completed'|'unsupported_workshop',currentLayer:'hallwayInitial',contextBlock,contextData?,result?,plan?}`. 각 모델 호출은 `modelCaller.generate({layer,prompt,context,format:'json'})`, `composer.compose(layer,bindings)`로 수행.
- `run`은 요청·초기자료를 Gate에 공급, `{need:[]}`를 **정확한 구조로** 검증, 초기자원과 resolveNeed를 결합, Hallway Initial JSON의 두 분기를 상호 배타적으로 검증. 직접 응답은 `result:{languageBlock}`과 완전한 `contextData` 반환, 추가 Output 호출 금지. plan 분기는 유효한 스텝/객체/need를 검증하여 `unsupported_workshop`만 반환.
- 호출별 일시 정보 `{layer,prompt,modelResult,need}`는 요청 영속 state 필드와 분리. `focus`를 영속 상태로 쓰지 않음. 동일 방 다른 요청의 contextData는 독립 복제하며, 이번 프로토타입은 공유 세션 데이터를 자동 저장/병합하지 않는다.
- 실패는 throw `{code,message}`(scheduler가 `failed` 확정); 원문 모델 응답/비밀키/시스템 프롬프트는 공개 상태에 남기지 않는다.

- [ ] **Step 1 — 실패 테스트 작성**: Gate→Hallway 정상 종료(호출 layer 순서 정확히 2개), Initial에서 제공된 데이터가 Gate 호출 입력에 들어감, 중복 need 재사용, 필요한 추가자료가 없을 때 명시적 실패, Gate가 plan/contextBlock를 내면 거부, Hallway direct JSON 필드 부족/extra/혼합 분기 거부, plan branch 유효 시 unsupported(실행·Output 없음), contextData 원본 보존, 복수 요청/모의 모델 순서와 실패 격리.
- [ ] **Step 2 — RED 확인**: `node --test tests/backend/engine.test.mjs tests/backend/request-lifecycle.test.mjs`; FAIL.
- [ ] **Step 3 — 최소 구현**: 스키마·분기 검증을 엔진에 구현하되 모델 호출·자료 조회는 포트만 사용. 태스크에 없는 Workshop/IR/Output 구현·호환 레이어·서버 HTTP/SSE는 만들지 않는다.
- [ ] **Step 4 — GREEN 확인**: `node --test tests/backend/*.test.mjs` PASS.
- [ ] **Step 5 — 커밋**: `git add back/js/engine/engine.js tests/backend/engine.test.mjs tests/backend/request-lifecycle.test.mjs && git commit -m "feat: run independent gate hallway direct-response engine"`.

### Task 7: 실행 가능한 프로토타입 시연과 문서 정합성

**Files:**
- Create: `back/js/demo.js`, `docs/developing/request-engine.md`
- Modify: `AGENTS.md`, `docs/developing/architecture.md`, `docs/developing/prompt-composition.md`, `docs/notes/frontend-backend-handoff.md` (새 구현 상태와 구분)
- Test: `tests/backend/engine.test.mjs` (추가 종단 모의 caller 사례)

**Interfaces:**
- `back/js/demo.js`: 하나의 가상 `request:{parts:[{type:'text',text:'안녕하세요'}],attachments:[]}`, 빈 `contextData`, `initialResources:[]`를 enqueue하고 공개 최종 상태만 콘솔 출력. 모델 ID와 키는 `GEMINI_MODEL`, `GEMINI_API_KEY` 환경변수로 설정; 값이 없으면 의미 있는 설정 오류와 비영(非0) 종료 코드. `GEMINI_API_KEY`는 코드·로그·명세에 저장하지 않음.
- 테스트의 모의 caller는 같은 scheduler/engine에 주입하는 별도의 fixture이며 CLI에서 AI 결과를 꾸며내지 않는다.

- [ ] **Step 1 — 실패 테스트 작성**: 모의 modelCaller + 실제 registry/scheduler/composer/dataProvider를 묶어 전체 2단계 호출·정확한 종료 상태 및 실패 시 다음 대기 요청 실행을 테스트한다.
- [ ] **Step 2 — RED 확인**: `node --test tests/backend/engine.test.mjs`; 새 종단 사례가 실패하도록 먼저 기록.
- [ ] **Step 3 — 최소 구현**: 단일 요청 CLI, 정확한 문서 업데이트, AGENTS.md 경로/테스트 명령/현재 서버 구현 범위 갱신. 실행 API/DB/SSE는 존재한다고 표기하지 않는다. 진짜 자격증명은 환경변수에서만 읽는다.
- [ ] **Step 4 — 전체 자동 검증**: `node --test tests/backend/*.test.mjs` PASS, `node --test tests/frontend/*.test.mjs` 실행 결과 보고, `node --test tests/backend/terminology.test.mjs` 재확인. 유효한 환경변수 확보 시에만 `GEMINI_API_KEY=… GEMINI_MODEL=… node back/js/demo.js` 실제 호출, 두 레이어 통과·종료·응답 확인. 키가 없으면 실모델 미검증 표시하고 코드/테스트 성공과 혼동 금지.
- [ ] **Step 5 — 커밋**: `git add back/js/demo.js docs/developing docs/notes/frontend-backend-handoff.md AGENTS.md tests/backend/engine.test.mjs && git commit -m "test: demonstrate isolated request engine and document verified scope"`.

## Plan Self-Review / Execution Gate

- **Coverage:** 설계의 용어·파일 전수, 등록소/대기열, 모델 독립 포트/Gemini, 초기 참조 전달+Gate 정보요청, 직접 응답/계획 미지원, 가상 요청 시연·오류 검증 모두 Task 1–7에 대응한다.
- **Not claimed:** DB/서버 HTTP/SSE/네트워크 화면 연결/Workshop/IR/영속·재개/실모델 인증정보 없이 실호출 완료.
- **Review Focus:** 다섯 입력/장애 범주가 Task 2/4/5/6의 명시적 테스트에 포함된다.
- **Name consistency:** registry `register/get/transition` → scheduler `enqueue/get/whenIdle` → engine `run`; caller `generate`; data provider `resolveNeed`; prompt composer `compose`.
- **Spec ambiguity:** 최초 프로토타입은 공유 세션 상태를 영속 저장하거나 동시에 덮어쓰지 않음. 나중의 DB 충돌 정책은 별도 설계. 신규 결정을 요구하는 차이가 생기면 중단·질문.
