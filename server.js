import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import path from 'path';
import {fileURLToPath} from 'url';
import {randomUUID} from 'crypto';
import {
  createGeminiExecution,
  GeminiExecutionError
} from './geminiExecution.js';
import {
  bindRequestAbort
} from './requestAbort.js';
import {
  createStoredArtifact,
  getStoredArtifact
} from './artifactStore.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONT_DIR = path.join(__dirname, 'front');
const HOME_FILE = path.join(FRONT_DIR, 'index.html');
const CRON_FILE = path.join(__dirname, 'cron.txt');

app.use(express.json({limit: '1mb'}));
app.use(compression());

const DEFAULT_NATIVE_APP_ORIGINS = [
  'capacitor://localhost',
  'https://localhost'
];

const NATIVE_APP_ORIGINS =
  new Set(
    String(
      process.env.NATIVE_APP_ORIGINS ||
      DEFAULT_NATIVE_APP_ORIGINS.join(',')
    )
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );

app.use(
  '/api',
  (req, res, next) => {
    const origin =
      req.get('Origin');

    if (
      origin &&
      NATIVE_APP_ORIGINS.has(origin)
    ) {
      res.set(
        'Access-Control-Allow-Origin',
        origin
      );
      res.vary('Origin');
      res.set(
        'Access-Control-Allow-Methods',
        'GET,POST,OPTIONS'
      );
      res.set(
        'Access-Control-Allow-Headers',
        'Accept,Content-Type'
      );
      res.set(
        'Access-Control-Max-Age',
        '86400'
      );
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    return next();
  }
);

const PORT = process.env.PORT || 3000;

const geminiExecution =
  createGeminiExecution();

/*
 * Bump this for every deployed app update.
 * The frontend compares this server value with its locally stored version
 * before loading application assets.
 */
const APP_VERSION = '2026.10.05.83';

/* =========================================================
   CANONICAL NODE DEFINITION
========================================================= */

const defaultNodeDef = {
  start: {
    name: '시작하기',
    desc: 'AI 작업을 시작하는 기준점입니다.',
    llmdesc: 'workflow의 실행 흐름의 origin임',
    tag: 'START',
    color: '#10B981',
    icon: `
      <svg viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="6.1" stroke="currentColor" stroke-width="1.6"/>
        <path d="M8.35 7.45 12.45 10l-4.1 2.55v-5.1Z" fill="currentColor"/>
      </svg>
    `,
    inputs: [],
    outputs: [
      {
        id: 'out',
        name: '실행 방향',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ]
  },

  research: {
    name: '조사하기',
    desc: '찾아볼 내용을 자연스럽게 요청합니다.',
    llmdesc: '입력 자료와 대화 맥락을 바탕으로 request에 적힌 조사 목표를 수행함. request가 없을 때만 legacy topic/filter를 사용함.',
    tag: 'RESEARCH',
    color: '#4F8EF7',
    icon: `
      <svg viewBox="0.2 0.2 19.6 19.6" fill="none">
        <circle cx="10" cy="10" r="6.7" stroke="currentColor" stroke-width="1.55"/>
        <path d="M3.3 10h13.4M10 3.3c-1.75 1.9-2.65 4.1-2.65 6.7s.9 4.8 2.65 6.7M10 3.3c1.75 1.9 2.65 4.1 2.65 6.7s-.9 4.8-2.65 6.7" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 최근 3년 생성형 AI 시장 흐름과 주요 기업을 조사해줘',
        default: '',
        maxLength: 1800
      },
      {
        id: 'topic',
        name: '주제',
        hidden: true,
        legacy: true,
        maxLength: 700
      },
      {
        id: 'filter',
        name: '조건',
        hidden: true,
        legacy: true,
        maxLength: 500
      }
    ],
    inputs: [
      {
        id: 'in',
        name: '연결',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: [
      {
        id: 'result',
        name: '결과',
        type: 'research',
        required: false,
        multiple: true,
        accepts: ['research', 'any']
      }
    ]
  },

  organize: {
    name: '정리하기',
    desc: '자료를 원하는 모습으로 정리합니다.',
    llmdesc: '입력 자료를 request에 적힌 목적과 형태에 맞게 정리함. request가 없을 때만 legacy criteria/format을 사용함.',
    tag: 'ORGANIZE',
    color: '#E9A63A',
    icon: `
      <svg viewBox="0 0 20 20" fill="none">
        <path d="M4 5.25h12M4 10h12M4 14.75h8.25" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 핵심 수치와 기업별 특징을 비교하기 쉽게 정리해줘',
        default: '',
        maxLength: 1800
      },
      {
        id: 'criteria',
        name: '정리 기준',
        hidden: true,
        legacy: true,
        maxLength: 700
      },
      {
        id: 'format',
        name: '출력 형식',
        hidden: true,
        legacy: true,
        maxLength: 300
      }
    ],
    inputs: [
      {
        id: 'in',
        name: '데이터',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: [
      {
        id: 'result',
        name: '결과',
        type: 'structured',
        required: false,
        multiple: true,
        accepts: ['structured', 'any']
      }
    ]
  },

  judge: {
    name: '평가하기',
    desc: '자료를 원하는 기준으로 판단합니다.',
    llmdesc: 'request에 적힌 판단 기준으로 입력을 평가하고 true/false 한 경로만 엶. request가 없을 때만 legacy condition을 사용함.',
    tag: 'JUDGE',
    color: '#8B6BE8',
    icon: `
      <svg viewBox="0.2 0.2 19.6 19.6" fill="none">
        <circle cx="10" cy="10" r="6.15" stroke="currentColor" stroke-width="1.6"/>
        <path d="M7 10.1 9 12.05 13.1 7.95" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 신뢰할 만한 근거가 충분한지 판단해줘',
        default: '',
        maxLength: 1800
      },
      {
        id: 'condition',
        name: '조건',
        hidden: true,
        legacy: true,
        maxLength: 900
      }
    ],
    inputs: [
      {
        id: 'true',
        name: '참 자료',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      },
      {
        id: 'false',
        name: '거짓 자료',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: [
      {
        id: 'true',
        name: '참 출구',
        type: 'decision',
        required: false,
        multiple: true,
        accepts: ['decision', 'any']
      },
      {
        id: 'false',
        name: '거짓 출구',
        type: 'decision',
        required: false,
        multiple: true,
        accepts: ['decision', 'any']
      }
    ]
  },

  write: {
    name: '작성하기',
    desc: '원하는 결과물을 자연어로 작성 요청합니다.',
    llmdesc: '입력 자료와 맥락을 바탕으로 request에 적힌 최종 글을 직접 작성함. request가 없을 때만 legacy title/length/style/about을 사용함. 페이지 수·쪽 수·분량 목표가 있으면 여백이나 반복으로 때우지 말고 실제 내용 분량과 구조를 충분히 만들어야 함.',
    tag: 'WRITE',
    color: '#D96F83',
    icon: `
      <svg viewBox="0 0 20 20" fill="none">
        <path d="m4.65 15.35 1.15-4.2 6.75-6.75a2 2 0 0 1 2.82 0l.23.23a2 2 0 0 1 0 2.82L8.85 14.2l-4.2 1.15Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 고등학생도 이해하기 쉽게 5문단 정도의 보고서로 써줘',
        default: '',
        maxLength: 1800
      },
      {
        id: 'title',
        name: '제목',
        hidden: true,
        legacy: true,
        maxLength: 300
      },
      {
        id: 'length',
        name: '분량',
        hidden: true,
        legacy: true,
        maxLength: 200
      },
      {
        id: 'style',
        name: '스타일',
        hidden: true,
        legacy: true,
        maxLength: 300
      },
      {
        id: 'about',
        name: '내용',
        hidden: true,
        legacy: true,
        maxLength: 1200
      }
    ],
    inputs: [
      {
        id: 'in',
        name: '자료',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: [
      {
        id: 'result',
        name: '결과',
        type: 'document',
        required: false,
        multiple: true,
        accepts: ['document', 'any']
      }
    ]
  },


  file: {
    name: '파일 추가하기',
    desc: '작업에 사용할 파일을 추가합니다.',
    llmdesc: '사용자가 제공한 파일을 워크플로우에 입력함. 파일 자체를 생성하거나 변환하는 노드가 아님. 연결이 있어야만 실제로 참조가 가능.',
    tag: 'INPUT',
    color: '#718096',
    icon: `
      <svg viewBox="0.2 0.2 19.6 19.6" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path d="M7.35 10.45 11.7 6.1a2.25 2.25 0 0 1 3.18 3.18l-5.45 5.45a3.2 3.2 0 0 1-4.53-4.53l5.2-5.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    inputs: [],
    outputs: [
      {
        id: 'file',
        name: '전달',
        type: 'file',
        required: false,
        multiple: true,
        accepts: ['file', 'any']
      }
    ]
  },

  createFile: {
    name: '생성하기',
    desc: '원하는 파일 결과를 자연스럽게 요청합니다.',
    llmdesc: '입력 결과를 request에 적힌 파일명/형식으로 내보내는 최종 출력 노드임. createFile 자체는 문서 내용을 생성하거나 늘리지 않음. request가 없을 때만 legacy format/filename을 사용함. PDF/DOCX/RTF/HTML/MD 같은 문서 파일은 입력 단계에서 문단 줄바꿈과 제목·목록·표 등 필요한 구조와 요청된 페이지·분량을 갖춘 완성형 콘텐츠를 준비해야 하며 한 줄 텍스트 덩어리로 만들지 않음.',
    tag: 'OUTPUT',
    color: '#0EA5A4',
    icon: `
      <svg viewBox="0 0 20 20" fill="none">
        <path d="M10 2.9c.45 4.45 2.65 6.65 7.1 7.1-4.45.45-6.65 2.65-7.1 7.1-.45-4.45-2.65-6.65-7.1-7.1 4.45-.45 6.65-2.65 7.1-7.1Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 결과를 AI시장보고서.pdf 파일로 만들어줘',
        default: '',
        maxLength: 1200
      },
      {
        id: 'format',
        name: '파일 형식',
        hidden: true,
        legacy: true,
        maxLength: 40
      },
      {
        id: 'filename',
        name: '파일명',
        hidden: true,
        legacy: true,
        maxLength: 160
      }
    ],
    inputs: [
      {
        id: 'in',
        name: '대상',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: []
  }
};

/* =========================================================
   NODE DEFINITIONS
========================================================= */

const nodeDefinitionsPublic = JSON.parse(
  JSON.stringify(defaultNodeDef)
);

const GENERATABLE_NODE_TYPES = Object.keys(
  defaultNodeDef
).filter(
  type => type !== 'start'
);

function getNodeDefinition(type) {
  return defaultNodeDef[type] || null;
}

function getPortDefinition(type, direction, portId) {
  const def = getNodeDefinition(type);
  if (!def) return null;

  const ports =
    direction === 'input'
      ? def.inputs || []
      : def.outputs || [];

  return ports.find(
    port => String(port.id) === String(portId)
  ) || null;
}

function buildNodeDefinitionPrompt() {
  return GENERATABLE_NODE_TYPES
    .map(type => {
      const def = defaultNodeDef[type];

      const inputs =
        (def.inputs || [])
          .map(port => port.id)
          .join(',') || '-';

      const outputs =
        (def.outputs || [])
          .map(port => port.id)
          .join(',') || '-';

      const params =
        (def.params || [])
          .filter(
            param =>
              param.hidden !== true
          )
          .map(
            param =>
              param.id +
              (
                param.kind === 'request'
                  ? ':natural'
                  : ''
              )
          )
          .join(',') || '-';

      return [
        `type=${type}`,
        `name=${def.name}`,
        `입력=${inputs}`,
        `출력=${outputs}`,
        `params=${params}`,
        `설명=${def.llmdesc}`
      ].join(' ');
    })
    .join('\n');
}

const NODE_DEFINITION_PROMPT =
  buildNodeDefinitionPrompt();

/* =========================================================
   PLANNER PROMPT
========================================================= */

const SYSTEM_PROMPT = `
CONVERSATION AND WORKFLOW:
- mode="conversation" for greetings, questions, explanations, casual conversation, follow-up requests, and anything that does not require changing the workflow.
- mode="workflow" when the user asks to create, modify, delete, connect, disconnect, configure, rebuild, or otherwise change the workflow.
- A request to analyze, summarize, transform, organize, write from, judge, convert, or otherwise do work with an existing canvas file/source is also workflow intent whenever processing nodes or connections are needed, even if the user never says "workflow", "node", or "connect".
- Never answer a file-processing request with a future offer such as "tell me what the file is and I can help" when CURRENT WORKFLOW already contains authoritative file metadata. Build the needed Patch now.
- In conversation mode, ops MUST be [].
- MEMORY is persistent conversation state. The <MEMORY> block supplied in the current request is the PREVIOUS MEMORY STATE.
- The returned memory is the NEXT MEMORY STATE.
- Build NEXT MEMORY from PREVIOUS MEMORY + LATEST_USER_REQUEST + the actual user-facing response you generate in message/question.
- Finish the user-facing message and question first, then construct memory from the completed turn. Never describe a response that has not been generated yet.
- Preserve previous memory aggressively. Update only what the completed turn adds, changes, resolves, or explicitly replaces.
- Resolve short follow-ups, pronouns, omitted subjects, "그거/아까/계속" and similar references from MEMORY + CURRENT WORKFLOW before deciding intent.
- flow = broad ongoing subject and direction. Preserve the active project/thread, current objective, and meaningful subtopics. Dense factual sentence, not a category label.
- recent = near-term continuity. Preserve the latest 2-3-turn dependencies when they are still needed: what the user just changed, what remains unresolved, and what the assistant actually did or answered.
- detail = durable state. Preserve named entities, explicit constraints, design/behavior choices, decisions, preferences, unresolved requirements, and facts likely to matter later.
- Compression may remove filler and repetition, but must not remove referents or constraints needed to understand the next short follow-up.
- Every non-empty memory field must be one compact information-dense sentence. Prefer concrete nouns, values, actions, relationships, and constraints over prose.
- During ordinary conversation, flow normally continues, recent is refreshed without erasing still-needed local context, and detail changes only when durable information changes.
- Never clear unrelated memory merely because it was not repeated in the latest request.
- Never invent information. When uncertain, preserve the previous state.
- Never turn MEMORY into a transcript.
- Before returning memory, verify that the broader conversation context, important previously discussed topics, latest request, and actual response are still represented where relevant.
- Use the user's language for message and question.
- question must always be a string. Use "" when no clarification is needed.
- Only ask when guessing missing information could seriously break the workflow. Otherwise, infer a reasonable default and proceed.


You are ovll's deterministic workflow planner.
Your job is to reconstruct the user's intended final result from the complete supplied context and produce the smallest valid Patch that makes CURRENT WORKFLOW match that result.
Do not treat LATEST_USER_REQUEST as an isolated instruction. Reconstruct intent from MEMORY, CURRENT WORKFLOW, and LATEST_USER_REQUEST together.
Every turn is a fresh reconstruction of the intended final state. Do not mechanically append the latest request to an unfinished previous instruction.
Do not execute tools, research, create files, or claim that anything was executed.
Return only the JSON object required by the schema. Never output Markdown or explanatory text outside that object.
User-facing message and question must use the language of the latest user request.

DECISION PRIORITY:
1. Follow the output schema exactly.
2. Treat NODE DEFINITIONS and CURRENT WORKFLOW as authoritative machine-readable state.
3. Reconstruct the intended final result from all supplied context.
4. A newer explicit user instruction supersedes only the conflicting part of an older instruction.
5. Preserve all non-conflicting prior requirements.
6. Rewrite MEMORY as the next compact state snapshot rather than appending to it.

TASK MODE:
- Workflow request: reconstruct the intended final workflow from all relevant context, then produce the smallest Patch that makes CURRENT WORKFLOW match that result.
- File task: when the user asks to do something with an existing file node, treat that file as an already-supplied source. Reuse it, add only the processing/output nodes needed, and connect it without asking for metadata already present in CURRENT WORKFLOW.
- Modify/add request: preserve valid unrelated nodes and edges while retaining all non-conflicting requirements from prior conversation.
- Delete/reset/rebuild/restart/replace request: discard the current graph and construct the requested graph from an empty graph.
- Non-workflow conversation such as greetings or casual chat: return ops=[] and do not create, modify, delete, or connect nodes.
- If the request can be completed without asking anything, question must be the empty string.
- Only ask when guessing missing information could seriously break the workflow. Otherwise, infer a reasonable default and proceed.
- question is always a string, never null.

NODE TYPES:
The type field is an internal identifier. Never translate it.
Allowed generated types: ${GENERATABLE_NODE_TYPES.join(', ')}
Never generate start.
Use the canonical type identifiers exactly as listed above.

NODE IDS:
Existing nodes in CURRENT WORKFLOW use compact Planner aliases such as n1, n2, n3.
These aliases are temporary references for the current planning request.
Use these aliases when modifying or deleting existing nodes and when writing connection endpoints.
The server restores aliases to the real persistent node IDs after planning.

For newly added nodes, id MUST be:
__new_1
__new_2
__new_3
...
Each temporary ID must be unique within the Patch.
Never invent a persistent final ID.

WORKFLOW REPRESENTATION:
CURRENT WORKFLOW is a Planner-specific compact representation.
It may omit UI-only information and parameters that are identical to canonical defaults.
Do not assume omitted default parameters are missing from the real workflow.
Preserve existing state unless the user explicitly changes it.

PORTS AND ENDPOINTS:
Use only ports explicitly listed in NODE DEFINITIONS.
Never invent aliases such as result, input, output, in, out, data, or value when that port is not explicitly defined for the node type.
Every connection endpoint MUST be exactly nodeId.portId.
The nodeId portion must be an existing CURRENT WORKFLOW ID or a temporary add ID.
The portId portion must be an exact port ID on that node.
For every connection, independently resolve source node type, source output port, target node type, and target input port before writing the endpoint.
Connections always use output -> input direction.

GRAPH RULES:
c = add execution link
dc = delete execution link
d = add data edge
dd = delete data edge
links and data are separate collections.
Do not create duplicate edges.
Do not create dangling references.
Do not create execution cycles.
A connection delete must exactly match an existing edge in CURRENT WORKFLOW.
Do not emit an add followed by a delete of the same edge.

SPECIAL NODES:
- file: no inputs, one output file. It is a source. Never target file.
- Existing file nodes may include a file object with source, name, mime, size, lastModified, contentAvailable, and contentTruncated. This is authoritative metadata for a real file already present on the user's canvas.
- If exactly one existing uploaded file node exists, resolve generic references such as "이 파일", "업로드한 파일", "첨부한 거", "그 파일" to that node without asking the user to identify it again.
- If file metadata already supplies the name or MIME type, never ask the user what the file is. Use the existing file node directly.
- contentAvailable=true means runtime has readable uploaded text available for downstream nodes. Planning does not need the file text itself; connect the existing file node to the requested processing node.
- contentAvailable=false does not prevent workflow editing. Still preserve and route the existing file node when the user's request is about that file; ask only if the missing content makes the requested final workflow genuinely impossible.
- Never recreate an uploaded file node merely to rename or describe it. Existing file nodes are user-owned sources and should be preserved unless the user explicitly asks to remove them.
- createFile: one input in, no outputs. It is an output node.
- createFile does not generate or expand document content. If the user requests a page count, word/character count, section count, or other document-length target, preserve that requirement in the upstream write.request that produces the document body. The write node must create enough substantive content for the requested length; never satisfy a page target with padding, blank whitespace, or repetitive filler. For Korean A4 report prose rendered by ovll, a useful drafting estimate is roughly 1,250 to 1,500 meaningful characters per requested page, balanced across major sections; scale this estimate with the requested page count. Keep file naming/format instructions on createFile.
- judge: inputs true and false, outputs true and false. Never use in or result on judge.
- start exists in the canonical definitions but is not generatable by the planner.

PARAMS:
Only use parameter IDs defined for the exact node type.
For AI action nodes, request is the primary public parameter. Put the user's goal, constraints, desired style/shape, and other meaningful instructions into one concise natural-language request instead of splitting them into rigid option fields.
Legacy hidden params may exist in CURRENT WORKFLOW for compatibility. Do not generate or modify legacy hidden params when request is available.
For add and modify, paramsJson MUST be a valid JSON object encoded as a string. Prefer {"request":"..."} for nodes that expose request.
Keep request concise and self-contained. Do not copy the full conversation into a node.
Use {} when the node has no parameters.
Never invent parameter IDs.
For modify, include only values that actually change.

PATCH OPERATIONS:
- a = add node: id=temporary ID, type=canonical type, paramsJson=JSON object string
- m = modify node: id=existing node ID, paramsJson=JSON object string
- dn = delete node: id=existing node ID
- c/d/dc/dd = connection operation with source and target exact endpoints
Every op object must still contain action, id, type, paramsJson, source, and target because the JSON schema requires all six fields.
For unused fields, use the empty string. For an unused paramsJson field, use {}.
Do not use any other operation.

PATCH CONSTRUCTION ALGORITHM:
1. Decide whether this is workflow work or ordinary conversation.
2. Determine the intended final graph from CURRENT WORKFLOW and the latest request.
3. If rebuilding, treat CURRENT WORKFLOW as disposable and rebuild only the requested graph.
4. List the final nodes mentally and preserve every existing node that should remain.
5. For every new node, assign temporary IDs sequentially starting at __new_1.
6. Resolve every parameter ID against NODE DEFINITIONS.
7. Resolve every edge against the final node set and exact port definitions.
8. Remove stale connections when a node is deleted.
9. Produce only the Patch operations needed to reach the intended final graph.
10. Before returning, perform a full consistency pass over the complete resulting graph.

FINAL CONSISTENCY CHECK:
- every add ID is a unique __new_N ID
- every modify/delete ID exists in CURRENT WORKFLOW
- every added type is canonical and generatable
- every paramsJson string parses to a JSON object
- every parameter key exists for that node type
- every endpoint is nodeId.portId
- every endpoint references a node that exists in the final graph
- every source is an output port
- every target is an input port
- every edge direction is output -> input
- links and data are kept separate
- no duplicate edges
- no dangling edges
- no execution cycle
- judge uses only true/false ports
- file is never a target
- createFile is never a source
If any check fails, rebuild the Patch before returning. Never guess a missing identifier.

VALIDATION RETRY:
When the context contains FAILED PLANNER OUTPUT and VALIDATION ERROR, the previous Patch was NOT applied.
Treat the failed output only as a diagnostic example.
Re-read CURRENT WORKFLOW from scratch, identify the structural cause, and build a new complete Patch.
Do not copy an invalid ID, endpoint, parameter, or operation merely because it appeared in the failed output.

RESPONSE:
message is a concise plain-text fallback/summary for this turn and must always be a string.
blocks is the optional generative UI body.
- Use blocks=[] for ordinary short text responses.
- Use blocks only when structure materially helps, especially code, runnable HTML, or an answer too long for message.
- If the visible answer needs more than message's short summary, put the complete answer in one or a few markup blocks.
- block.type="markup" for user-facing prose/Markdown-like text.
- block.type="code" for source code that should be shown as code.
- block.type="live-html" only for complete or independently runnable HTML that should render as an interactive preview.
- When blocks is non-empty, it is the complete visible body. Include any needed explanation as markup blocks.
- Keep the number of blocks small. Never split plain prose into many tiny blocks.
question is only for a necessary clarification. It must always be a string; use \"\" when no question is needed.
Use the user's language.
Do not expose internal IDs, temporary IDs, Patch operations, schema details, or validation rules.
Do not claim execution, research, file creation, or results that did not actually happen.
memory.flow, memory.recent, and memory.detail must always be strings.

NODE DEFINITIONS:
${NODE_DEFINITION_PROMPT}
`;

/* =========================================================
   PLANNER SCHEMA
========================================================= */

const PLANNER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['conversation', 'workflow']
    },
    ops: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['a', 'm', 'dn', 'c', 'dc', 'd', 'dd']
          },
          id: {
            type: 'string'
          },
          type: {
            type: 'string'
          },
          paramsJson: {
            type: 'string',
            maxLength: 2400
          },
          source: {
            type: 'string'
          },
          target: {
            type: 'string'
          }
        },
        required: ['action', 'id', 'type', 'paramsJson', 'source', 'target']
      }
    },
    message: {
      type: 'string',
      maxLength: 300
    },
    blocks: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['markup', 'code', 'live-html']
          },
          language: {
            type: 'string',
            maxLength: 24
          },
          value: {
            type: 'string',
            maxLength: 12000
          }
        },
        required: ['type', 'language', 'value']
      }
    },
    question: {
      type: 'string',
      maxLength: 500
    },
    memory: {
      type: 'object',
      additionalProperties: false,
      properties: {
        flow: {type: 'string', maxLength: 700},
        recent: {type: 'string', maxLength: 1400},
        detail: {type: 'string', maxLength: 1900}
      },
      required: ['flow', 'recent', 'detail']
    }
  },
  required: ['mode', 'ops', 'message', 'blocks', 'question', 'memory']
};

/* =========================================================
   HELPERS
========================================================= */

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `AI 응답 JSON 파싱 실패: ${error.message}`
    );
  }
}

function cloneWorkflow(workflow) {
  if (
    !workflow ||
    typeof workflow !== 'object' ||
    Array.isArray(workflow)
  ) {
    return {
      nodes: [],
      links: [],
      data: []
    };
  }

  const nodes =
    Array.isArray(workflow.nodes)
      ? workflow.nodes.slice(0, 96)
      : [];

  const links =
    Array.isArray(workflow.links)
      ? workflow.links.slice(0, 192)
      : [];

  const data =
    Array.isArray(workflow.data)
      ? workflow.data.slice(0, 192)
      : [];

  if (
    (
      Array.isArray(workflow.nodes) &&
      workflow.nodes.length > 96
    ) ||
    (
      Array.isArray(workflow.links) &&
      workflow.links.length > 192
    ) ||
    (
      Array.isArray(workflow.data) &&
      workflow.data.length > 192
    )
  ) {
    const error =
      new Error(
        '워크플로우가 너무 큽니다.'
      );

    error.status = 413;
    error.retryable = false;

    throw error;
  }

  return {
    nodes:
      JSON.parse(
        JSON.stringify(nodes)
      ),
    links:
      JSON.parse(
        JSON.stringify(links)
      ),
    data:
      JSON.parse(
        JSON.stringify(data)
      )
  };
}

function clipCompactText(
  value,
  max
) {
  const text =
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  if (
    !Number.isFinite(max) ||
    max <= 0 ||
    text.length <= max
  ) {
    return text;
  }

  const tail =
    Math.max(
      80,
      Math.floor(max * .28)
    );

  const head =
    Math.max(
      0,
      max - tail - 3
    );

  return (
    text.slice(0, head) +
    ' … ' +
    text.slice(-tail)
  ).slice(0, max);
}

function cleanParams(type, params, fillDefaults = false) {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`존재하지 않는 노드 타입: ${type}`);

  let source = {};

  if (params != null) {
    if (
      typeof params !== 'object' ||
      Array.isArray(params)
    ) {
      throw new Error(
        `${type}.params는 JSON 객체여야 합니다.`
      );
    }

    source = params;
  }

  const allowed =
    new Map(
      (def.params || [])
        .map(param => [
          String(param.id),
          param
        ])
    );

  const unknown =
    Object.keys(source)
      .filter(
        key =>
          !allowed.has(key)
      );

  if (unknown.length) {
    throw new Error(
      `${type}.params에 허용되지 않은 파라미터가 있습니다: ${unknown.join(', ')}`
    );
  }

  const result = {};

  const assign = (
    id,
    value,
    param
  ) => {
    if (
      typeof value !== 'string'
    ) {
      if (
        value == null
      ) {
        return;
      }

      value =
        String(value);
    }

    const maxLength =
      Math.max(
        1,
        Number(
          param?.maxLength ||
          1800
        ) || 1800
      );

    result[id] =
      clipCompactText(
        value,
        maxLength
      );
  };

  if (fillDefaults) {
    for (
      const [id, param]
      of allowed
    ) {
      if (
        Object.prototype
          .hasOwnProperty.call(
            source,
            id
          )
      ) {
        assign(
          id,
          source[id],
          param
        );
      } else if (
        Object.prototype
          .hasOwnProperty.call(
            param,
            'default'
          )
      ) {
        assign(
          id,
          param.default,
          param
        );
      }
    }
  } else {
    for (
      const key
      of Object.keys(source)
    ) {
      assign(
        key,
        source[key],
        allowed.get(key)
      );
    }
  }

  if (
    result.request
      ?.trim()
  ) {
    for (
      const [id, param]
      of allowed
    ) {
      if (
        param?.legacy === true
      ) {
        delete result[id];
      }
    }
  }

  return result;
}

function parseParamsJson(value, label) {
  if (typeof value !== 'string') {
    throw new Error(
      `${label}가 문자열이 아닙니다.`
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${label} JSON 파싱 실패: ${error.message}`
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      `${label}는 JSON 객체여야 합니다.`
    );
  }

  return parsed;
}

function parseEndpoint(value) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    throw new Error(
      '연결 endpoint가 비어 있습니다.'
    );
  }

  const index = value.lastIndexOf('.');

  if (index <= 0 || index === value.length - 1) {
    throw new Error(
      `포트가 지정되지 않았습니다: ${value}`
    );
  }

  const nodeId =
    value.slice(0, index);

  const portId =
    value.slice(index + 1);

  if (
    !nodeId ||
    !portId
  ) {
    throw new Error(
      `잘못된 endpoint입니다: ${value}`
    );
  }

  return {
    nodeId,
    portId
  };
}

function edgeKey(source, target) {
  return `${source}=>${target}`;
}

function hasEdge(edges, source, target) {
  return edges.some(
    edge =>
      Array.isArray(edge) &&
      edge.length === 2 &&
      edge[0] === source &&
      edge[1] === target
  );
}

function removeNodeEdges(workflow, nodeId) {
  const prefix = `${nodeId}.`;

  const keep = edge =>
    Array.isArray(edge) &&
    edge.length === 2 &&
    !String(edge[0]).startsWith(prefix) &&
    !String(edge[1]).startsWith(prefix);

  workflow.links =
    workflow.links.filter(keep);

  workflow.data =
    workflow.data.filter(keep);
}

function normalizeMemory(memory) {
  const source =
    memory &&
    typeof memory === 'object' &&
    !Array.isArray(memory)
      ? memory
      : {};

  return {
    flow:
      clipCompactText(
        source.flow,
        700
      ),
    recent:
      clipCompactText(
        source.recent,
        1400
      ),
    detail:
      clipCompactText(
        source.detail,
        1900
      )
  };
}

function mergeMemory(previous, next) {
  const before = normalizeMemory(previous);
  const after = normalizeMemory(next);

  return {
    flow: after.flow || before.flow,
    recent: after.recent || before.recent,
    detail: after.detail || before.detail
  };
}


/* =========================================================
   LLM OPS -> INTERNAL ARRAY FORMAT
========================================================= */

function normalizePlannerOps(ops) {
  if (!Array.isArray(ops)) throw new Error('Planner ops가 배열이 아닙니다.');
  return ops.map((op, index) => {
    if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error(`ops[${index}] 형식이 잘못되었습니다.`);
    const action = String(op.action || '').trim();
    if (!['a', 'm', 'dn', 'c', 'dc', 'd', 'dd'].includes(action)) throw new Error(`알 수 없는 Patch operation: ${action}`);
    if (action === 'a') return ['a', String(op.id || '').trim(), String(op.type || '').trim(), String(op.paramsJson ?? '{}')];
    if (action === 'm') return ['m', String(op.id || '').trim(), String(op.paramsJson ?? '{}')];
    if (action === 'dn') return ['dn', String(op.id || '').trim()];
    return [action, String(op.source || '').trim(), String(op.target || '').trim()];
  });
}

/* =========================================================
   PATCH SHAPE VALIDATION
========================================================= */

function validatePatchShape(ops) {
  if (!Array.isArray(ops)) throw new Error('Patch ops가 배열이 아닙니다.');
  if (ops.length > 32) throw new Error('Patch가 너무 큽니다.');
  for (const op of ops) {
    if (!Array.isArray(op)) throw new Error('잘못된 Patch operation입니다.');
    const action = op[0];
    if (action === 'a') {
      if (op.length !== 4 || !op[1] || !op[2] || typeof op[3] !== 'string') throw new Error('add operation 형식이 잘못되었습니다.');
      continue;
    }
    if (action === 'm') {
      if (op.length !== 3 || !op[1] || typeof op[2] !== 'string') throw new Error('modify operation 형식이 잘못되었습니다.');
      continue;
    }
    if (action === 'dn') {
      if (op.length !== 2 || !op[1]) throw new Error('delete node operation 형식이 잘못되었습니다.');
      continue;
    }
    if (action === 'c' || action === 'dc' || action === 'd' || action === 'dd') {
      if (op.length !== 3 || !op[1] || !op[2]) throw new Error(`연결 operation 형식이 잘못되었습니다: ${action}`);
      parseEndpoint(op[1]);
      parseEndpoint(op[2]);
      continue;
    }
    throw new Error(`알 수 없는 Patch operation: ${action}`);
  }
}

function validatePlannerOps(currentWorkflow, ops) {
  validatePatchShape(ops);
  const existing = new Set(currentWorkflow.nodes.map(node => node.id));
  const added = new Set();
  const deleted = new Set();
  for (const op of ops) {
    const action = op[0];
    if (action === 'a') {
      const id = op[1];
      if (!/^__new_[1-9]\d*$/.test(id)) throw new Error(`새 노드 ID는 __new_N 형식이어야 합니다: ${id}`);
      if (existing.has(id) || added.has(id)) throw new Error(`새 노드 임시 ID가 중복됩니다: ${id}`);
      if (!GENERATABLE_NODE_TYPES.includes(op[2])) throw new Error(`존재하지 않는 노드 타입: ${op[2]}`);
      const params = parseParamsJson(op[3], `${id}.params`);
      cleanParams(op[2], params, true);
      added.add(id);
      continue;
    }
    if (action === 'm') {
      const id = op[1];
      if (!existing.has(id) || deleted.has(id)) throw new Error(`수정할 기존 노드가 없습니다: ${id}`);
      const node = currentWorkflow.nodes.find(item => item.id === id);
      const params = parseParamsJson(op[2], `${id}.params`);
      cleanParams(node.type, params, false);
      continue;
    }
    if (action === 'dn') {
      const id = op[1];
      if (!existing.has(id) || deleted.has(id)) throw new Error(`삭제할 기존 노드가 없습니다: ${id}`);
      deleted.add(id);
      continue;
    }
    const source = parseEndpoint(op[1]);
    const target = parseEndpoint(op[2]);
    if (source.nodeId.startsWith('__new_') && !added.has(source.nodeId)) throw new Error(`존재하지 않는 새 노드 endpoint입니다: ${source.nodeId}`);
    if (target.nodeId.startsWith('__new_') && !added.has(target.nodeId)) throw new Error(`존재하지 않는 새 노드 endpoint입니다: ${target.nodeId}`);
    if ((action === 'c' || action === 'd') && (source.nodeId.startsWith('__new_') || target.nodeId.startsWith('__new_'))) continue;
  }
}

function materializePlannerOps(currentWorkflow, ops) {
  validatePlannerOps(currentWorkflow, ops);
  const usedIds = new Set(currentWorkflow.nodes.map(node => node.id));
  const tempToReal = new Map();
  for (const op of ops) {
    if (op[0] !== 'a') continue;
    const tempId = op[1];
    let realId;
    do realId = `node_${randomUUID().replaceAll('-', '')}`; while (usedIds.has(realId));
    usedIds.add(realId);
    tempToReal.set(tempId, realId);
  }
  const remapEndpoint = value => {
    const {nodeId, portId} = parseEndpoint(value);
    return `${tempToReal.get(nodeId) || nodeId}.${portId}`;
  };
  return ops.map(op => {
    if (op[0] === 'a') return ['a', tempToReal.get(op[1]), op[2], op[3]];
    if (op[0] === 'm' || op[0] === 'dn') return op;
    return [op[0], remapEndpoint(op[1]), remapEndpoint(op[2])];
  });
}

/* =========================================================
   PATCH APPLY
========================================================= */

function applyPatch(currentWorkflow, ops) {
  validatePatchShape(ops);

  const workflow =
    cloneWorkflow(currentWorkflow);

  const nodeMap =
    new Map(
      workflow.nodes.map(node => [
        node.id,
        node
      ])
    );

  for (const op of ops) {
    const action = op[0];

    if (
      action !== 'dc' &&
      action !== 'dd'
    ) {
      continue;
    }

    const source = op[1];
    const target = op[2];

    const list =
      action === 'dc'
        ? workflow.links
        : workflow.data;

    const index = list.findIndex(
      edge =>
        Array.isArray(edge) &&
        edge.length === 2 &&
        edge[0] === source &&
        edge[1] === target
    );

    if (index === -1) {
      throw new Error(
        `${action === 'dc' ? 'links' : 'data'}에 삭제할 연결이 없습니다: ${source} -> ${target}`
      );
    }

    list.splice(index, 1);
  }

  for (const op of ops) {
    if (op[0] !== 'dn') continue;

    const id = op[1];

    if (!nodeMap.has(id)) {
      throw new Error(
        `삭제할 노드가 없습니다: ${id}`
      );
    }

    workflow.nodes =
      workflow.nodes.filter(
        node => node.id !== id
      );

    nodeMap.delete(id);
    removeNodeEdges(
      workflow,
      id
    );
  }

  for (const op of ops) {
    if (op[0] !== 'm') continue;

    const id = op[1];
    const node = nodeMap.get(id);

    if (!node) {
      throw new Error(
        `수정할 노드가 없습니다: ${id}`
      );
    }

    const params =
      parseParamsJson(
        op[2],
        `${id}.params`
      );

    node.params = cleanParams(
      node.type,
      {
        ...(node.params || {}),
        ...params
      },
      false
    );
  }

  for (const op of ops) {
    if (op[0] !== 'a') continue;

    const id = op[1];
    const type = op[2];

    if (nodeMap.has(id)) {
      throw new Error(
        `중복된 노드 ID: ${id}`
      );
    }

    if (!GENERATABLE_NODE_TYPES.includes(type)) {
      throw new Error(
        `존재하지 않는 노드 타입: ${type}`
      );
    }

    const params =
      parseParamsJson(
        op[3],
        `${id}.params`
      );

    const node = {
      id,
      type,
      params: cleanParams(
        type,
        params,
        true
      )
    };

    workflow.nodes.push(node);
    nodeMap.set(id, node);
  }

  for (const op of ops) {
    const action = op[0];

    if (
      action !== 'c' &&
      action !== 'd'
    ) {
      continue;
    }

    const source = op[1];
    const target = op[2];

    const list =
      action === 'c'
        ? workflow.links
        : workflow.data;

    if (hasEdge(list, source, target)) {
      throw new Error(`이미 존재하는 연결입니다: ${source} -> ${target}`);
    }
    list.push([source, target]);
  }

  return workflow;
}

/* =========================================================
   WORKFLOW VALIDATION
========================================================= */

function validateWorkflow(spec) {
  if (
    !spec ||
    typeof spec !== 'object' ||
    Array.isArray(spec)
  ) {
    throw new Error(
      '워크플로우가 없습니다.'
    );
  }

  if (!Array.isArray(spec.nodes)) {
    throw new Error(
      'nodes가 배열이 아닙니다.'
    );
  }

  if (!Array.isArray(spec.links)) {
    throw new Error(
      'links가 배열이 아닙니다.'
    );
  }

  if (!Array.isArray(spec.data)) {
    throw new Error(
      'data가 배열이 아닙니다.'
    );
  }

  const nodeMap = new Map();

  for (const node of spec.nodes) {
    if (
      !node ||
      typeof node !== 'object' ||
      Array.isArray(node) ||
      typeof node.id !== 'string' ||
      !node.id.trim() ||
      typeof node.type !== 'string'
    ) {
      throw new Error(
        '잘못된 노드입니다.'
      );
    }

    if (nodeMap.has(node.id)) {
      throw new Error(
        `중복된 노드 ID: ${node.id}`
      );
    }

    const def =
      getNodeDefinition(
        node.type
      );

    if (!def) {
      throw new Error(
        `존재하지 않는 노드 타입: ${node.type}`
      );
    }

    node.params = cleanParams(
      node.type,
      node.params,
      false
    );

    nodeMap.set(
      node.id,
      node
    );
  }

  function resolveEndpoint(
    value,
    direction
  ) {
    const {
      nodeId,
      portId
    } = parseEndpoint(value);

    const node =
      nodeMap.get(nodeId);

    if (!node) {
      throw new Error(
        `${direction}: 존재하지 않는 노드입니다: ${nodeId}`
      );
    }

    const port =
      getPortDefinition(
        node.type,
        direction === 'source'
          ? 'output'
          : 'input',
        portId
      );

    if (!port) {
      throw new Error(
        `${direction}: ${node.type}.${portId}는 존재하지 않는 ${
          direction === 'source'
            ? '출력'
            : '입력'
        } 포트입니다.`
      );
    }

    return {
      node,
      port,
      nodeId,
      portId
    };
  }

  function validateEdges(
    edges,
    mode
  ) {
    const seen =
      new Set();

    for (const edge of edges) {
      if (
        !Array.isArray(edge) ||
        edge.length !== 2
      ) {
        throw new Error(
          `잘못된 ${mode} 연결입니다.`
        );
      }

      const source =
        String(edge[0]);

      const target =
        String(edge[1]);

      const sourceResolved =
        resolveEndpoint(
          source,
          'source'
        );

      const targetResolved =
        resolveEndpoint(
          target,
          'target'
        );

      const key =
        edgeKey(
          source,
          target
        );

      if (seen.has(key)) {
        throw new Error(
          `${mode}: 중복된 연결입니다: ${source} -> ${target}`
        );
      }

      seen.add(key);

      const sourceType =
        sourceResolved.port.type ||
        'any';

      const accepts =
        Array.isArray(
          targetResolved.port.accepts
        )
          ? targetResolved.port.accepts
          : ['any'];

      const compatible =
        accepts.includes('any') ||
        accepts.includes(sourceType) ||
        sourceType === 'any';

      if (!compatible) {
        throw new Error(
          `${mode}: 타입이 호환되지 않습니다: ${source} -> ${target}`
        );
      }
    }
  }

  validateEdges(
    spec.links,
    'links'
  );

  validateEdges(
    spec.data,
    'data'
  );

  const adjacency =
    new Map();

  for (const node of spec.nodes) {
    adjacency.set(
      node.id,
      []
    );
  }

  for (const edge of spec.links) {
    const source =
      parseEndpoint(edge[0]).nodeId;

    const target =
      parseEndpoint(edge[1]).nodeId;

    adjacency
      .get(source)
      .push(target);
  }

  const visiting =
    new Set();

  const visited =
    new Set();

  function visit(nodeId) {
    if (visiting.has(nodeId)) {
      throw new Error(
        `workflow cycle detected at ${nodeId}`
      );
    }

    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);

    for (
      const next
        of adjacency.get(nodeId) || []
    ) {
      visit(next);
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const node of spec.nodes) {
    visit(node.id);
  }

  return spec;
}

/* =========================================================
   PROMPT BUILD
========================================================= */

function plannerRequestFromLegacy(
  type,
  params
) {
  const source =
    params &&
    typeof params === 'object' &&
    !Array.isArray(params)
      ? params
      : {};

  const parts =
    (...values) =>
      values
        .map(
          value =>
            clipCompactText(
              value,
              700
            )
        )
        .filter(Boolean)
        .join(' · ');

  switch (type) {
    case 'research':
      return parts(
        source.topic,
        source.filter
      );

    case 'organize':
      return parts(
        source.criteria,
        source.format
      );

    case 'judge':
      return source.condition
        ? clipCompactText(
            source.condition,
            900
          ) + '인지 판단해줘'
        : '';

    case 'write':
      return parts(
        source.about,
        source.title,
        source.length,
        source.style
      );

    case 'createFile':
      return (
        parts(
          source.filename,
          source.format
        ) +
        (
          source.filename ||
          source.format
            ? ' 파일로 만들어줘'
            : ''
        )
      );

    default:
      return '';
  }
}

function buildPlannerWorkflow(workflow) {
  const source =
    cloneWorkflow(
      workflow
    );

  const realToAlias =
    new Map();

  const aliasToReal =
    new Map();

  const nodes =
    source.nodes.map(
      (node, index) => {
        const alias =
          `n${index + 1}`;

        realToAlias.set(
          node.id,
          alias
        );

        aliasToReal.set(
          alias,
          node.id
        );

        const def =
          getNodeDefinition(
            node.type
          );

        const rawParams =
          node.params &&
          typeof node.params === 'object' &&
          !Array.isArray(node.params)
            ? cleanParams(
                node.type,
                node.params,
                false
              )
            : {};

        const params = {};

        if (
          !rawParams.request
        ) {
          const legacyRequest =
            plannerRequestFromLegacy(
              node.type,
              rawParams
            );

          if (legacyRequest) {
            params.request =
              clipCompactText(
                legacyRequest,
                node.type ===
                  'createFile'
                  ? 1200
                  : 1800
              );
          }
        }

        for (
          const [key, value]
            of Object.entries(
              rawParams
            )
        ) {
          const param =
            (def?.params || []).find(
              item =>
                String(item.id) ===
                String(key)
            );

          if (
            param &&
            Object.prototype.hasOwnProperty.call(
              param,
              'default'
            ) &&
            String(value) ===
            String(param.default)
          ) {
            continue;
          }

          if (
            param?.hidden === true
          ) {
            continue;
          }

          params[key] =
            typeof value === 'string'
              ? clipCompactText(
                  value,
                  Math.max(
                    1,
                    Number(
                      param?.maxLength ||
                      1800
                    ) || 1800
                  )
                )
              : value;
        }

        const compact = {
          id: alias,
          type: node.type
        };

        if (
          Object.keys(params).length
        ) {
          compact.params =
            params;
        }

        if (
          node.type ===
            'file' &&
          node.file &&
          typeof node.file ===
            'object' &&
          !Array.isArray(
            node.file
          )
        ) {
          compact.file = {
            source:
              String(
                node.file.source ||
                'upload'
              ).slice(
                0,
                40
              ),
            name:
              clipCompactText(
                node.file.name,
                240
              ) ||
              '파일',
            mime:
              clipCompactText(
                node.file.mime,
                160
              ) ||
              'application/octet-stream',
            size:
              Math.max(
                0,
                Number(
                  node.file.size ||
                  0
                ) || 0
              ),
            lastModified:
              Math.max(
                0,
                Number(
                  node.file.lastModified ||
                  0
                ) || 0
              ),
            contentAvailable:
              typeof node.file
                .textPreview ===
                'string' &&
              !!node.file
                .textPreview,
            contentTruncated:
              node.file
                .textTruncated ===
                true
          };
        }

        return compact;
      }
    );

  function remapEndpoint(
    value
  ) {
    const {
      nodeId,
      portId
    } =
      parseEndpoint(
        value
      );

    return (
      `${realToAlias.get(nodeId) || nodeId}.${portId}`
    );
  }

  return {
    workflow: {
      nodes,
      links:
        source.links.map(
          edge => [
            remapEndpoint(
              edge[0]
            ),
            remapEndpoint(
              edge[1]
            )
          ]
        ),
      data:
        source.data.map(
          edge => [
            remapEndpoint(
              edge[0]
            ),
            remapEndpoint(
              edge[1]
            )
          ]
        )
    },
    aliasToReal
  };
}

function translatePlannerOps(
  ops,
  aliasToReal
) {
  function remapNodeId(
    value
  ) {
    return (
      aliasToReal.get(
        value
      ) ||
      value
    );
  }

  function remapEndpoint(
    value
  ) {
    const {
      nodeId,
      portId
    } =
      parseEndpoint(
        value
      );

    return (
      `${remapNodeId(nodeId)}.${portId}`
    );
  }

  return ops.map(
    op => {
      const action =
        op[0];

      if (
        action === 'a'
      ) {
        return op;
      }

      if (
        action === 'm' ||
        action === 'dn'
      ) {
        return [
          action,
          remapNodeId(
            op[1]
          ),
          ...op.slice(2)
        ];
      }

      return [
        action,
        remapEndpoint(
          op[1]
        ),
        remapEndpoint(
          op[2]
        )
      ];
    }
  );
}

function buildUserPrompt(
  text,
  workflow,
  memory
) {
  return [
    '<PREVIOUS_MEMORY>',
    JSON.stringify(
      normalizeMemory(
        memory
      )
    ),
    '</PREVIOUS_MEMORY>',
    '<CURRENT_WORKFLOW>',
    JSON.stringify(
      workflow
    ),
    '</CURRENT_WORKFLOW>',
    '<LATEST_USER_REQUEST>',
    clipCompactText(
      text,
      6000
    ),
    '</LATEST_USER_REQUEST>'
  ].join('\n');
}

function buildPlannerMessages(
  text,
  workflow,
  memory
) {
  return [
    {
      role: 'system',
      content:
        SYSTEM_PROMPT
    },
    {
      role: 'user',
      content:
        buildUserPrompt(
          text,
          workflow,
          memory
        )
    }
  ];
}

function buildRetryPrompt(
  planner,
  error
) {
  return [
    '<RETRY_CONTEXT>',
    '<FAILED_PLANNER_OUTPUT>',
    planner
      ? JSON.stringify(
          planner
        )
      : '-',
    '</FAILED_PLANNER_OUTPUT>',
    '<VALIDATION_ERROR>',
    String(
      error ||
      'unknown error'
    ),
    '</VALIDATION_ERROR>',
    '<RETRY_INSTRUCTION>',
    'The previous Planner output was not applied.',
    'Reconstruct the intended final result again from the complete context.',
    'Treat FAILED_PLANNER_OUTPUT only as a diagnostic example.',
    'Return a completely new valid response.',
    '</RETRY_INSTRUCTION>',
    '</RETRY_CONTEXT>'
  ].join('\n');
}

/* =========================================================
   GROQ
========================================================= */

async function requestPlanner(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const error = new Error('GROQ_API_KEY가 설정되지 않았습니다.');
    error.retryable = false;
    throw error;
  }
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.1,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'workflow_planner',
          strict: true,
          schema: PLANNER_SCHEMA
        }
      }
    })
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Groq API 오류: ${response.status} ${body}`);
    error.status = response.status;
    error.retryable = response.status === 400 || response.status >= 500;
    throw error;
  }
  const payload =
    await response.json();

  if (payload?.usage) {
    console.info(
      '[Groq usage]',
      {
        prompt_tokens:
          payload.usage.prompt_tokens ??
          0,
        cached_tokens:
          payload.usage
            .prompt_tokens_details
            ?.cached_tokens ??
          0,
        completion_tokens:
          payload.usage.completion_tokens ??
          0,
        total_tokens:
          payload.usage.total_tokens ??
          0
      }
    );
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI 응답이 비어 있습니다.');
  const parsed = parseJson(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Planner 응답이 객체가 아닙니다.');
  if (parsed.mode !== 'conversation' && parsed.mode !== 'workflow') {
    throw new Error('Planner mode가 올바르지 않습니다.');
  }
  if (!Array.isArray(parsed.ops)) throw new Error('Planner ops가 배열이 아닙니다.');
  if (typeof parsed.message !== 'string' || !parsed.message.trim()) throw new Error('Planner message가 비어 있습니다.');
  if (!Array.isArray(parsed.blocks)) throw new Error('Planner blocks가 배열이 아닙니다.');
  if (typeof parsed.question !== 'string') throw new Error('Planner question이 문자열이 아닙니다.');

  parsed.blocks = parsed.blocks
    .map((block, index) => {
      if (
        !block ||
        typeof block !== 'object' ||
        Array.isArray(block)
      ) {
        throw new Error(`blocks[${index}] 형식이 잘못되었습니다.`);
      }

      const type =
        String(block.type || '');

      if (
        !['markup', 'code', 'live-html']
          .includes(type)
      ) {
        throw new Error(`blocks[${index}].type이 올바르지 않습니다.`);
      }

      return {
        type,
        language:
          String(block.language || '')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '')
            .slice(0, 24),
        value:
          String(block.value ?? '')
            .slice(0, 12000)
      };
    })
    .filter(block =>
      block.value.trim()
    )
    .slice(0, 6);

  parsed.ops = normalizePlannerOps(parsed.ops);
  parsed.message = parsed.message.trim();
  parsed.question = parsed.question.trim() || '';
  parsed.memory = normalizeMemory(parsed.memory);
  return parsed;
}

/* =========================================================
   PLANNER + ATOMIC VALIDATION
========================================================= */

async function planWorkflow(
  text,
  workflow,
  memory
) {
  const compact =
    buildPlannerWorkflow(
      workflow
    );

  let messages =
    buildPlannerMessages(
      text,
      compact.workflow,
      memory
    );

  let planner = null;
  let lastError = null;

  for (
    let attempt = 0;
    attempt < 2;
    attempt++
  ) {
    try {
      planner =
        await requestPlanner(
          messages
        );

      planner.memory =
        mergeMemory(
          memory,
          planner.memory
        );

      if (
        planner.mode ===
          'conversation' &&
        planner.ops.length > 0
      ) {
        throw new Error(
          'conversation mode에서는 workflow operation을 사용할 수 없습니다.'
        );
      }

      const translatedOps =
        translatePlannerOps(
          planner.ops,
          compact.aliasToReal
        );

      const materializedOps =
        materializePlannerOps(
          workflow,
          translatedOps
        );

      const result =
        applyPatch(
          workflow,
          materializedOps
        );

      validateWorkflow(
        result
      );

      return {
        planner,
        workflow:
          result
      };
    } catch (
      error
    ) {
      lastError =
        error;

      console.warn(
        'Planner attempt failed:',
        error.message
      );

      if (
        attempt === 1 ||
        error.retryable === false
      ) {
        break;
      }

      messages = [
        ...messages,
        {
          role: 'user',
          content:
            buildRetryPrompt(
              planner,
              error.message
            )
        }
      ];
    }
  }

  throw (
    lastError ||
    new Error(
      '워크플로우를 처리하지 못했습니다.'
    )
  );
}

function geminiHttpFailure(
  error,
  fallback
) {
  const known =
    error instanceof
      GeminiExecutionError;

  const code =
    known
      ? error.code
      : 'GEMINI_EXECUTION_ERROR';

  const status =
    code ===
      'INVALID_EXECUTION_GROUP' ||
    code ===
      'UNSUPPORTED_GEMINI_NODE' ||
    code ===
      'GEMINI_GROUP_TOO_LARGE'
      ? 400
      : code ===
          'GEMINI_REQUEST_REFUSED'
        ? 422
      : code ===
          'GEMINI_API_KEY_MISSING'
        ? 503
        : code ===
            'GEMINI_UPSTREAM_TIMEOUT'
          ? 504
          : error?.status === 429
            ? 429
            : 502;

  return {
    code,
    status,
    body: {
      ok: false,
      code,
      error:
        error?.message ||
        fallback,
      retryable:
        error?.retryable ===
          true,
      origin:
        'gemini',
      diagnostics:
        error?.diagnostics &&
        typeof error.diagnostics ===
          'object'
          ? {
              stage:
                error.diagnostics
                  .stage ?? null,
              thinkingLevel:
                error.diagnostics
                  .thinkingLevel ?? null,
              primaryAttempts:
                error.diagnostics
                  .primaryAttempts ?? null,
              transientRetries:
                error.diagnostics
                  .transientRetries ?? null,
              repairAttempts:
                error.diagnostics
                  .repairAttempts ?? null,
              durationMs:
                error.diagnostics
                  .durationMs ?? null
            }
          : null
    }
  };
}

/* =========================================================
   GENERATED ARTIFACT API
========================================================= */

app.post(
  '/api/create-artifact',
  async (req, res) => {
    try {
      const artifact =
        await createStoredArtifact({
          format:
            req.body?.format,
          filename:
            req.body?.filename,
          targetPages:
            req.body?.targetPages,
          sources:
            req.body?.sources
        });

      return res.json({
        ok: true,
        artifact
      });
    } catch (error) {
      console.error(
        '[artifact create]',
        error
      );

      const status =
        Number(
          error?.status
        ) || 400;

      return res
        .status(status)
        .json({
          ok: false,
          code:
            String(
              error?.code || ''
            ),
          error:
            error?.message ||
            '파일을 생성하지 못했습니다.'
        });
    }
  }
);

app.get(
  '/api/artifacts/:id',
  (req, res) => {
    const artifact =
      getStoredArtifact(
        req.params.id
      );

    if (!artifact) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            '파일을 찾을 수 없습니다.'
        });
    }

    const inline =
      String(
        req.query?.inline ||
        ''
      ) === '1';

    const responseHeaders = {
      'Content-Type':
        artifact.mime,
      'Content-Length':
        String(
          artifact.size
        ),
      'Content-Disposition':
        (inline
          ? 'inline'
          : 'attachment') +
        "; filename*=UTF-8''" +
        encodeURIComponent(
          artifact.name
        ),
      'X-Content-Type-Options':
        'nosniff',
      'Cache-Control':
        'private, no-store',
      'Referrer-Policy':
        'no-referrer'
    };

    if (
      inline &&
      artifact.format ===
        'HTML'
    ) {
      responseHeaders[
        'Content-Security-Policy'
      ] = [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "font-src data:",
        "media-src data: blob:",
        "connect-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join('; ');
    }

    res.set(
      responseHeaders
    );

    return res.send(
      artifact.buffer
    );
  }
);

/* =========================================================
   GEMINI GROUP EXECUTION API
========================================================= */

app.post(
  '/api/execute-group',
  async (req, res) => {
    const abortContext =
      bindRequestAbort(
        req,
        res
      );

    try {
      const result =
        await geminiExecution
          .executeGroup(
            {
              nodes:
                req.body?.nodes,
              connections:
                req.body?.connections,
              context:
                req.body?.context
            },
            {
              signal:
                abortContext.signal
            }
          );

      if (
        abortContext.signal
          .aborted
      ) {
        return;
      }

      console.info(
        '[Gemini execution]',
        {
          model:
            result.model,
          inputTokens:
            result.usage
              ?.inputTokens ??
            null,
          cachedTokens:
            result.usage
              ?.cachedTokens ??
            null,
          outputTokens:
            result.usage
              ?.outputTokens ??
            null,
          thoughtTokens:
            result.usage
              ?.thoughtTokens ??
            null,
          totalTokens:
            result.usage
              ?.totalTokens ??
            null,
          thinkingLevel:
            result.diagnostics
              ?.thinkingLevel ??
            null,
          primaryAttempts:
            result.diagnostics
              ?.primaryAttempts ??
            null,
          transientRetries:
            result.diagnostics
              ?.transientRetries ??
            null,
          repairAttempts:
            result.diagnostics
              ?.repairAttempts ??
            null,
          fallbackUsed:
            result.diagnostics
              ?.fallbackUsed ===
              true,
          durationMs:
            result.diagnostics
              ?.durationMs ??
            null
        }
      );

      return res.json({
        ok: true,
        model:
          result.model,
        usage:
          result.usage,
        diagnostics:
          result.diagnostics,
        results:
          result.results
      });
    } catch (error) {
      if (
        abortContext.signal
          .aborted ||
        error?.code ===
          'GEMINI_REQUEST_ABORTED'
      ) {
        return;
      }

      const failure =
        geminiHttpFailure(
          error,
          'Gemini execution failed.'
        );

      console.warn(
        '[Gemini execution failed]',
        {
          code:
            failure.code,
          status:
            error?.status ??
            null,
          retryable:
            error?.retryable ===
              true,
          diagnostics:
            error?.diagnostics ??
            null
        }
      );

      return res
        .status(
          failure.status
        )
        .json(
          failure.body
        );
    } finally {
      abortContext
        .cleanup();
    }
  }
);

app.post(
  '/api/finalize-run',
  async (req, res) => {
    const abortContext =
      bindRequestAbort(
        req,
        res
      );

    try {
      const result =
        await geminiExecution
          .finalizeRun(
            {
              run:
                req.body?.run,
              userRequest:
                req.body
                  ?.userRequest,
              memory:
                req.body?.memory
            },
            {
              signal:
                abortContext.signal
            }
          );

      if (
        abortContext.signal
          .aborted
      ) {
        return;
      }

      console.info(
        '[Gemini final response]',
        {
          model:
            result.model,
          inputTokens:
            result.usage
              ?.inputTokens ??
            null,
          cachedTokens:
            result.usage
              ?.cachedTokens ??
            null,
          outputTokens:
            result.usage
              ?.outputTokens ??
            null,
          thoughtTokens:
            result.usage
              ?.thoughtTokens ??
            null,
          totalTokens:
            result.usage
              ?.totalTokens ??
            null,
          thinkingLevel:
            result.diagnostics
              ?.thinkingLevel ??
            null,
          primaryAttempts:
            result.diagnostics
              ?.primaryAttempts ??
            null,
          transientRetries:
            result.diagnostics
              ?.transientRetries ??
            null,
          repairAttempts:
            result.diagnostics
              ?.repairAttempts ??
            null,
          durationMs:
            result.diagnostics
              ?.durationMs ??
            null
        }
      );

      return res.json({
        ok: true,
        model:
          result.model,
        usage:
          result.usage,
        diagnostics:
          result.diagnostics,
        message:
          result.message
      });
    } catch (error) {
      if (
        abortContext.signal
          .aborted ||
        error?.code ===
          'GEMINI_REQUEST_ABORTED'
      ) {
        return;
      }

      const failure =
        geminiHttpFailure(
          error,
          'Gemini final response failed.'
        );

      console.warn(
        '[Gemini final response failed]',
        {
          code:
            failure.code,
          status:
            error?.status ??
            null,
          retryable:
            error?.retryable ===
            true
        }
      );

      return res
        .status(
          failure.status
        )
        .json(
          failure.body
        );
    } finally {
      abortContext
        .cleanup();
    }
  }
);

/* =========================================================
   WORKFLOW API
========================================================= */

app.post(
  '/api/workflow',
  async (req, res) => {
    try {
      const text =
        clipCompactText(
          req.body?.text,
          6000
        );

      const currentWorkflow =
        cloneWorkflow(
          req.body?.workflow
        );

      validateWorkflow(
        currentWorkflow
      );

      const memory =
        normalizeMemory(
          req.body?.memory
        );

if (!text) {
        return res.status(400).json({
          ok: false,
          error:
            '작업 내용을 입력해주세요.'
        });
      }

      const result =
        await planWorkflow(
          text,
          currentWorkflow,
          memory
        );

      return res.json({
        ok: true,
        mode:
          result.planner.mode,
        workflow:
          result.workflow,
        message:
          result.planner.message,
        blocks:
          result.planner.blocks,
        question:
          result.planner.question,
        memory:
          result.planner.memory
      });
    } catch (error) {
      console.error(
        '[workflow]',
        error
      );

      const status =
        error?.status === 429
          ? 429
          : error?.status === 413
            ? 413
            : 500;

      return res.status(
        status
      ).json({
        ok: false,
        code:
          String(
            error?.code ||
            (
              status === 429
                ? 'PLANNER_RATE_LIMIT'
                : status === 413
                  ? 'PLANNER_PAYLOAD_TOO_LARGE'
                  : 'PLANNER_ERROR'
            )
          ),
        error:
          error?.message ||
          '워크플로우를 처리하지 못했습니다.',
        retryable:
          error?.retryable ===
            true ||
          status === 429 ||
          status >= 500
      });
    }
  }
);

/* =========================================================
   APP VERSION API
========================================================= */

app.get(
  '/api/version',
  (req, res) => {
    res.set({
      'Cache-Control':
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0'
    });

    return res.json({
      ok: true,
      version: APP_VERSION
    });
  }
);

/* =========================================================
   NODE DEFINITION API
========================================================= */

app.get(
  '/api/node-definitions',
  (req, res) => {
    return res.json({
      ok: true,
      nodes:
        nodeDefinitionsPublic
    });
  }
);

/* =========================================================
   CRON TEXT
========================================================= */

app.get(
  '/cron.txt',
  (req, res, next) => {
    res.type('text/plain');

    res.sendFile(
      CRON_FILE,
      error => {
        if (!error) {
          return;
        }

        if (
          error.code === 'ENOENT' ||
          error.status === 404
        ) {
          return res
            .status(404)
            .send('Not Found');
        }

        next(error);
      }
    );
  }
);

/* =========================================================
   HOME
========================================================= */

app.get(
  ['/home', '/home/'],
  (req, res, next) => {
    res.sendFile(
      HOME_FILE,
      error => {
        if (error) {
          next(error);
        }
      }
    );
  }
);

/* =========================================================
   ROOT
========================================================= */

app.get(
  '/',
  (req, res) => {
    res.redirect('/home');
  }
);

/* =========================================================
   FRONT STATIC
========================================================= */

app.use(
  express.static(
    FRONT_DIR,
    {
      index: false,
      fallthrough: true
    }
  )
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {
    console.error(
      '[server]',
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    return res.status(500).json({
      ok: false,
      error:
        err?.message ||
        'Internal Server Error'
    });
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).send(
      'Not Found'
    );
  }
);

/* =========================================================
   SERVER
========================================================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Server running on http://localhost:${PORT}`
    );
    console.log(
      `Home: ${HOME_FILE}`
    );
    console.log(
      `Version: ${APP_VERSION}`
    );
  }
);