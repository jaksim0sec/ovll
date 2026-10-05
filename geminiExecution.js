const INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

export const DEFAULT_GEMINI_MODEL =
  "gemini-3.5-flash-lite";

export const DEFAULT_GEMINI_FALLBACK_MODEL =
  "gemini-3.1-flash-lite";

const DEFAULT_MAX_GROUP_NODES = 6;
const DEFAULT_MAX_INPUT_CHARS = 42000;
const DEFAULT_MAX_ATTEMPTS = 3;

const GEMINI_NODE_TYPES =
  new Set([
    "research",
    "organize",
    "judge",
    "write",
    "convert"
  ]);

const THINKING_LEVELS =
  new Set([
    "minimal",
    "low",
    "medium",
    "high"
  ]);

const NODE_INSTRUCTIONS = {
  research:
    "Follow params.request as the primary natural-language research instruction. If request is empty, fall back to legacy topic/filter. Use supplied material and general model knowledge only unless actual search evidence is supplied. Never fabricate browsing or citations. Put the useful result on outputs.result.",
  organize:
    "Follow params.request as the primary natural-language organization instruction. If request is empty, fall back to legacy criteria/format. Preserve facts and structure the available input for the requested use. Produce readable structure with real paragraph breaks; use concise Markdown headings, lists, and tables when they improve a document or file result. Never collapse multi-paragraph material into one line. Put the result on outputs.result.",
  write:
    "Follow params.request as the primary natural-language writing instruction. If request is empty, fall back to legacy title/style/length/about. Produce directly usable content from upstream material and context. Preserve deliberate paragraph breaks. If params.request or continuity context specifies a page count, page range, word/character count, or other length target, treat it as a substantive content-length requirement: produce enough useful content and structure to reasonably fill that target, without padding, blank whitespace, repetition, or filler. For Korean A4 report prose in ovll's current document template, use roughly 1,250 to 1,500 meaningful characters per requested page as a drafting target and distribute substance across major sections; scale proportionally for the requested page count. For other languages, infer an equivalent readable report density rather than copying the Korean character heuristic mechanically. For reports, documents, and file-bound writing, use lightweight Markdown structure such as headings, lists, quotes, or tables when useful so renderers can create a real document instead of a text wall. Never return the whole document as one continuous line. Put the result on outputs.result.",
  convert:
    "Follow params.request or legacy params.instruction to transform the available material while preserving meaning unless transformation is explicitly requested. Put the result on outputs.result.",
  judge:
    "Follow params.request as the primary natural-language decision criterion. If request is empty, fall back to legacy condition. Evaluate the available input, set decision to a boolean, and place useful branch data only on the selected true/false output."
};

const SYSTEM_INSTRUCTION = [
  "You execute a fixed workflow segment for ovll.",
  "The graph and node order are already decided by the runtime.",
  "Execute every supplied node exactly once and in the supplied order.",
  "Do not add, remove, reorder, rename, or skip nodes.",
  "Each node consumes its declared inputs plus outputs produced by earlier nodes in this same group when connected.",
  "The supplied context contains ovll's continuity memory plus the latest user request. Actively use it to resolve omitted subjects, short follow-ups, pronouns, prior choices, constraints, tone, and references such as 'that', 'the previous one', or 'continue'.",
  "A node's params.request is its local primary instruction. Context supplies continuity and missing referents but must not contradict an explicit request or supplied node input.",
  "If request is empty, use legacy params only as fallback and use context to recover the user's established intent.",
  "Before execution, run a strict feasibility gate on the user's actual requested outcome.",
  "Refuse only when the requested outcome is clearly impossible with the supplied nodes/tools/context, the requested scale is far beyond what one execution can meaningfully produce, or the request is so incoherent that no reasonable execution target exists.",
  "Do not refuse merely because the task is difficult, uncertain, underspecified, unusual, or missing external data. In those cases execute the useful supported portion and preserve limitations.",
  "For a normal run set refusal to null.",
  "For a refusal set refusal.code to UNEXECUTABLE_REQUEST and refusal.message to one short user-facing explanation in the user's language. Still return one placeholder result per supplied node, in the exact same order, with empty outputs, a boolean decision for judge nodes, null decision for other nodes, and a short report. Do not pretend the work completed.",
  "Follow each node type and params precisely.",
  "Return only the schema-conforming result.",
  "Keep outputs useful for the next node instead of explaining your process.",
  "Preserve semantic line breaks in generated prose. A document-like result should have paragraphs and, when useful, headings/lists/tables rather than one flattened text block.",
  "For every node, report must be a short user-facing summary of what the node actually produced. Write it naturally, in the dominant language of the supplied params/inputs, with concrete facts rather than JSON or process narration.",
  "Keep report concise: normally one or two sentences. Preserve uncertainty and limitations. Never claim live browsing, tool use, citations, or external verification unless such evidence is explicitly supplied in the node input.",
  "Do not include chain-of-thought, hidden reasoning, markdown fences, or commentary.",
  "For judge nodes, make a boolean decision from the condition and available input. Do not decide graph traversal yourself.",
  "If information is missing, use only reasonable transformations supported by supplied inputs, params, and general model knowledge. Do not invent external facts or pretend live research occurred.",
  "",
  "NODE TYPE RULES:",
  ...Object.entries(
    NODE_INSTRUCTIONS
  ).map(
    ([type, instruction]) =>
      type + ": " + instruction
  )
].join("\n");

const FINAL_RESPONSE_SYSTEM_INSTRUCTION = [
  "You write ovll's final user-facing response after a workflow execution.",
  "Use only the supplied execution results and user context. Do not invent missing facts.",
  "Answer the user's actual request, not the internal workflow mechanics.",
  "Do not expose node IDs, raw JSON, token usage, hidden reasoning, or implementation details.",
  "Do not claim live web browsing, citations, external verification, or file creation unless the execution results explicitly prove it.",
  "Preserve useful names, numbers, constraints, caveats, and uncertainty from the execution results.",
  "If the run partially failed, clearly distinguish completed results from failures without fabricating the missing part.",
  "Use the user's language when it can be inferred from userRequest or memory. Otherwise use the dominant language of the node params and reports.",
  "Synthesize the outcome. Do not narrate every node, enumerate the whole execution trace, or repeat all intermediate outputs.",
  "If files or artifacts were produced, mention them briefly at most once. Do not restate the full file contents unless the user explicitly asked for the contents in chat.",
  "Default to a compact answer of roughly 2 to 6 sentences or a short list. Expand only when the user's task genuinely requires a detailed deliverable.",
  "Prefer a direct natural answer first, then concise supporting detail.",
  "Light Markdown is allowed and preferred when it improves readability: short headings, bullets, bold, inline code, and fenced code for code tasks. Do not emit raw JSON or Markdown tables unless the user's task itself requires them."
].join("\n");

const FINAL_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    message: {
      type: "string"
    }
  },
  required: [
    "message"
  ],
  additionalProperties: false
};

function isPlainObject(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

function positiveInteger(
  value,
  fallback
) {
  const number =
    Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
      ? number
      : fallback
  );
}

function normalizeThinkingLevel(
  value
) {
  const normalized =
    String(
      value || "minimal"
    )
      .trim()
      .toLowerCase();

  return THINKING_LEVELS.has(
    normalized
  )
    ? normalized
    : "minimal";
}

export class GeminiExecutionError
  extends Error {
  constructor(
    message,
    options = {}
  ) {
    super(message);
    this.name =
      "GeminiExecutionError";
    this.code =
      options.code ||
      "GEMINI_EXECUTION_ERROR";
    this.status =
      options.status ??
      null;
    this.retryable =
      options.retryable === true;
    this.fallbackEligible =
      options.fallbackEligible ===
      true;
    this.semantic =
      options.semantic === true;
  }
}

function compactConnection(
  connection
) {
  return {
    fromNode:
      String(
        connection?.from?.node ||
        connection?.fromNode ||
        ""
      ),
    fromPort:
      String(
        connection?.from?.port ||
        connection?.fromPort ||
        ""
      ),
    toNode:
      String(
        connection?.to?.node ||
        connection?.toNode ||
        ""
      ),
    toPort:
      String(
        connection?.to?.port ||
        connection?.toPort ||
        ""
      ),
    kind:
      connection?.data?.kind ===
        "data" ||
      connection?.kind === "data"
        ? "data"
        : "flow"
  };
}

export function validateExecutionGroup(
  input,
  options = {}
) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new GeminiExecutionError(
      "Gemini execution group이 필요합니다.",
      {
        code:
          "INVALID_EXECUTION_GROUP"
      }
    );
  }

  const maxNodes =
    positiveInteger(
      options.maxNodes,
      DEFAULT_MAX_GROUP_NODES
    );

  const maxInputChars =
    positiveInteger(
      options.maxInputChars,
      DEFAULT_MAX_INPUT_CHARS
    );

  if (
    !Array.isArray(input.nodes) ||
    !input.nodes.length ||
    input.nodes.length > maxNodes
  ) {
    throw new GeminiExecutionError(
      `Gemini execution group node count must be 1..${maxNodes}.`,
      {
        code:
          "INVALID_EXECUTION_GROUP"
      }
    );
  }

  const ids =
    new Set();

  const nodes =
    input.nodes.map(
      rawNode => {
        const id =
          String(
            rawNode?.id || ""
          ).trim();

        const type =
          String(
            rawNode?.type || ""
          ).trim();

        if (
          !id ||
          ids.has(id)
        ) {
          throw new GeminiExecutionError(
            "Gemini execution group node ID가 올바르지 않습니다.",
            {
              code:
                "INVALID_EXECUTION_GROUP"
            }
          );
        }

        if (
          !GEMINI_NODE_TYPES.has(
            type
          )
        ) {
          throw new GeminiExecutionError(
            `Gemini에서 실행할 수 없는 node type입니다: ${type}`,
            {
              code:
                "UNSUPPORTED_GEMINI_NODE"
            }
          );
        }

        ids.add(id);

        return {
          id,
          type,
          params:
            isPlainObject(
              rawNode.params
            )
              ? compactExecutionValue(
                  rawNode.params
                )
              : {},
          inputs:
            isPlainObject(
              rawNode.inputs
            )
              ? compactExecutionValue(
                  rawNode.inputs
                )
              : {}
        };
      }
    );

  const connections =
    (
      Array.isArray(
        input.connections
      )
        ? input.connections
        : Array.isArray(
            input.internalConnections
          )
          ? input.internalConnections
          : []
    )
      .map(
        compactConnection
      );

  for (
    const connection
      of connections
  ) {
    if (
      !ids.has(
        connection.fromNode
      ) ||
      !ids.has(
        connection.toNode
      ) ||
      !connection.fromPort ||
      !connection.toPort
    ) {
      throw new GeminiExecutionError(
        "Gemini execution group connection이 올바르지 않습니다.",
        {
          code:
            "INVALID_EXECUTION_GROUP"
        }
      );
    }
  }

  const contextSource =
    isPlainObject(
      input.context
    )
      ? input.context
      : {};

  const memorySource =
    isPlainObject(
      contextSource.memory
    )
      ? contextSource.memory
      : null;

  const context = {
    userRequest:
      String(
        contextSource.userRequest ||
        ""
      ).slice(
        0,
        6000
      ),
    memory:
      memorySource
        ? {
            flow:
              String(
                memorySource.flow ||
                ""
              ).slice(0, 700),
            recent:
              String(
                memorySource.recent ||
                ""
              ).slice(0, 1400),
            detail:
              String(
                memorySource.detail ||
                ""
              ).slice(0, 1900)
          }
        : null
  };

  const normalized = {
    context,
    nodes,
    connections
  };

  if (
    JSON.stringify(
      normalized
    ).length >
    maxInputChars
  ) {
    throw new GeminiExecutionError(
      "Gemini execution group is too large.",
      {
        code:
          "GEMINI_GROUP_TOO_LARGE"
      }
    );
  }

  return normalized;
}

export function buildGroupResponseSchema(
  nodes
) {
  const count =
    nodes.length;

  const anyJson = {
    type: [
      "object",
      "array",
      "string",
      "number",
      "integer",
      "boolean",
      "null"
    ]
  };

  const resultSchema =
    node => {
      const outputProperties =
        node.type === "judge"
          ? {
              true: anyJson,
              false: anyJson
            }
          : {
              result: anyJson
            };

      return {
        type: "object",
        properties: {
          nodeId: {
            type: "string",
            enum: [
              node.id
            ]
          },
          outputs: {
            type: "object",
            properties:
              outputProperties,
            additionalProperties:
              true
          },
          decision: {
            type:
              node.type === "judge"
                ? "boolean"
                : ["null"]
          },
          report: {
            type: "string",
            maxLength: 900
          }
        },
        required: [
          "nodeId",
          "outputs",
          "decision",
          "report"
        ],
        additionalProperties:
          false
      };
    };

  return {
    type: "object",
    properties: {
      refusal: {
        type: [
          "object",
          "null"
        ],
        properties: {
          code: {
            type: "string"
          },
          message: {
            type: "string",
            maxLength: 320
          }
        },
        required: [
          "code",
          "message"
        ],
        additionalProperties:
          false
      },
      results: {
        type: "array",
        minItems: count,
        maxItems: count,
        prefixItems:
          nodes.map(
            resultSchema
          )
      }
    },
    required: [
      "refusal",
      "results"
    ],
    additionalProperties:
      false
  };
}

function compactExecutionValue(
  value,
  depth = 0
) {
  if (value == null) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    const max =
      depth <= 1
        ? 5200
        : 3200;

    if (
      value.length <= max
    ) {
      return value;
    }

    const tail =
      Math.max(
        400,
        Math.floor(
          max * .24
        )
      );

    return (
      value.slice(
        0,
        max - tail - 5
      ) +
      "\n…\n" +
      value.slice(-tail)
    );
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (depth >= 5) {
    return "[nested]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 18)
      .map(
        item =>
          compactExecutionValue(
            item,
            depth + 1
          )
      );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 24)
        .map(
          ([key, item]) => [
            String(key).slice(0, 120),
            compactExecutionValue(
              item,
              depth + 1
            )
          ]
        )
    );
  }

  return String(value)
    .slice(0, 1200);
}

function compactPromptGroup(
  group
) {
  return {
    context:
      group.context || {
        userRequest: "",
        memory: null
      },
    nodes:
      group.nodes.map(
        node => ({
          id:
            node.id,
          type:
            node.type,
          params:
            compactExecutionValue(
              node.params
            ),
          inputs:
            compactExecutionValue(
              node.inputs
            )
        })
      ),
    connections:
      group.connections
  };
}

export function buildInteractionRequest(
  group,
  options = {}
) {
  const model =
    String(
      options.model ||
      DEFAULT_GEMINI_MODEL
    ).trim();

  const thinkingLevel =
    normalizeThinkingLevel(
      options.thinkingLevel
    );

  let input =
    JSON.stringify(
      compactPromptGroup(
        group
      )
    );

  if (
    options.repairError
  ) {
    input +=
      "\n<REPAIR>Previous output failed semantic validation: " +
      String(
        options.repairError
      ).slice(
        0,
        600
      ) +
      ". Return a completely corrected result for the same nodes in exactly the requested order.</REPAIR>";
  }

  return {
    model,
    input,
    system_instruction:
      SYSTEM_INSTRUCTION,
    generation_config: {
      thinking_level:
        thinkingLevel,
      max_output_tokens:
        8192
    },
    response_format: {
      type: "text",
      mime_type:
        "application/json",
      schema:
        buildGroupResponseSchema(
          group.nodes
        )
    },
    store: false
  };
}

function compactFinalValue(
  value,
  depth = 0
) {
  if (value == null) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    return value.length > 8000
      ? value.slice(0, 8000) +
          "\n…"
      : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (depth >= 5) {
    return "[nested value]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 24)
      .map(item =>
        compactFinalValue(
          item,
          depth + 1
        )
      );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 32)
        .map(
          ([key, item]) => [
            key,
            compactFinalValue(
              item,
              depth + 1
            )
          ]
        )
    );
  }

  return String(value);
}

function compactFinalRun(input) {
  const run =
    isPlainObject(input?.run)
      ? input.run
      : {};

  const workflowNodes =
    Array.isArray(
      run?.workflow?.nodes
    )
      ? run.workflow.nodes
      : [];

  const paramsById =
    new Map(
      workflowNodes.map(node => [
        String(node?.id || ""),
        compactFinalValue(
          node?.params ||
          node?.data?.params ||
          {}
        )
      ])
    );

  const states =
    isPlainObject(run.nodes)
      ? Object.values(run.nodes)
      : [];

  const nodes =
    states
      .filter(
        state =>
          state &&
          state.status !== "IDLE"
      )
      .map(state => {
        const result =
          isPlainObject(state.result)
            ? state.result
            : {};

        return {
          id:
            String(state.id || ""),
          type:
            String(state.type || ""),
          status:
            String(state.status || ""),
          params:
            paramsById.get(
              String(state.id || "")
            ) || {},
          outputs:
            compactFinalValue(
              result.outputs || {}
            ),
          decision:
            typeof result.decision ===
              "boolean"
              ? result.decision
              : null,
          artifact:
            compactFinalValue(
              result.artifact ??
              result.file ??
              null
            ),
          report:
            typeof result.report ===
              "string"
              ? result.report
              : typeof state.report ===
                  "string"
                ? state.report
                : "",
          error:
            typeof state?.error
              ?.message === "string"
              ? state.error.message
              : ""
        };
      });

  const memory =
    isPlainObject(input?.memory)
      ? {
          flow:
            String(
              input.memory.flow ||
              ""
            ).slice(0, 3000),
          recent:
            String(
              input.memory.recent ||
              ""
            ).slice(0, 3000),
          detail:
            String(
              input.memory.detail ||
              ""
            ).slice(0, 5000)
        }
      : null;

  return {
    userRequest:
      String(
        input?.userRequest ||
        ""
      ).slice(0, 5000),
    memory,
    run: {
      mode:
        String(run.mode || ""),
      pivot:
        String(run.pivot || ""),
      status:
        String(run.status || ""),
      nodes
    }
  };
}

export function buildFinalResponseRequest(
  input,
  options = {}
) {
  let prompt =
    JSON.stringify(
      compactFinalRun(input)
    );

  if (options.repairError) {
    prompt +=
      "\n<REPAIR>Previous output failed validation: " +
      String(
        options.repairError
      ).slice(0, 500) +
      ". Return a corrected final response.</REPAIR>";
  }

  return {
    model:
      String(
        options.model ||
        DEFAULT_GEMINI_MODEL
      ).trim(),
    input:
      prompt,
    system_instruction:
      FINAL_RESPONSE_SYSTEM_INSTRUCTION,
    generation_config: {
      thinking_level:
        normalizeThinkingLevel(
          options.thinkingLevel
        )
    },
    response_format: {
      type: "text",
      mime_type:
        "application/json",
      schema:
        FINAL_RESPONSE_SCHEMA
    },
    store: false
  };
}

export function extractInteractionText(
  payload
) {
  if (
    typeof payload?.output_text ===
      "string" &&
    payload.output_text.trim()
  ) {
    return payload.output_text;
  }

  const chunks = [];

  for (
    const step
      of payload?.steps || []
  ) {
    if (
      step?.type !==
      "model_output"
    ) {
      continue;
    }

    for (
      const content
        of step.content || []
    ) {
      if (
        content?.type ===
          "text" &&
        typeof content.text ===
          "string"
      ) {
        chunks.push(
          content.text
        );
      }
    }
  }

  return chunks.join("");
}

export function normalizeUsage(
  usage
) {
  return {
    inputTokens:
      Number.isFinite(
        Number(
          usage?.total_input_tokens
        )
      )
        ? Number(
            usage
              .total_input_tokens
          )
        : null,
    outputTokens:
      Number.isFinite(
        Number(
          usage
            ?.total_output_tokens
        )
      )
        ? Number(
            usage
              .total_output_tokens
          )
        : null,
    totalTokens:
      Number.isFinite(
        Number(
          usage?.total_tokens
        )
      )
        ? Number(
            usage.total_tokens
          )
        : null,
    cachedTokens:
      Number.isFinite(
        Number(
          usage?.total_cached_tokens
        )
      )
        ? Number(
            usage.total_cached_tokens
          )
        : null,
    thoughtTokens:
      Number.isFinite(
        Number(
          usage?.total_thought_tokens
        )
      )
        ? Number(
            usage.total_thought_tokens
          )
        : null,
    toolUseTokens:
      Number.isFinite(
        Number(
          usage?.total_tool_use_tokens
        )
      )
        ? Number(
            usage.total_tool_use_tokens
          )
        : null
  };
}

export function validateGroupResults(
  payload,
  nodes
) {
  if (
    isPlainObject(
      payload?.refusal
    )
  ) {
    const message =
      String(
        payload.refusal.message ||
        ""
      )
        .replace(/[\u0000-\u001f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 320);

    throw new GeminiExecutionError(
      message ||
      "이 요청은 현재 실행 구조로 처리하기 어렵습니다.",
      {
        code:
          "GEMINI_REQUEST_REFUSED",
        semantic: false,
        retryable: false,
        fallbackEligible: false
      }
    );
  }

  if (
    !isPlainObject(payload) ||
    !Array.isArray(
      payload.results
    ) ||
    payload.results.length !==
      nodes.length
  ) {
    throw new GeminiExecutionError(
      "Gemini result count does not match requested nodes.",
      {
        code:
          "INVALID_GEMINI_RESULT",
        semantic: true
      }
    );
  }

  const seen =
    new Set();

  const results =
    payload.results.map(
      (item, index) => {
        const expected =
          nodes[index];

        const nodeId =
          String(
            item?.nodeId || ""
          );

        if (
          nodeId !==
            expected.id ||
          seen.has(nodeId)
        ) {
          throw new GeminiExecutionError(
            "Gemini result nodeId/order does not match requested nodes.",
            {
              code:
                "INVALID_GEMINI_RESULT",
              semantic: true
            }
          );
        }

        seen.add(nodeId);

        if (
          !isPlainObject(
            item.outputs
          )
        ) {
          throw new GeminiExecutionError(
            `Gemini result outputs must be an object: ${nodeId}`,
            {
              code:
                "INVALID_GEMINI_RESULT",
              semantic: true
            }
          );
        }

        if (
          expected.type ===
            "judge" &&
          typeof item.decision !==
            "boolean"
        ) {
          throw new GeminiExecutionError(
            `judge node requires boolean decision: ${nodeId}`,
            {
              code:
                "INVALID_GEMINI_RESULT",
              semantic: true
            }
          );
        }

        if (
          expected.type !==
            "judge" &&
          item.decision !== null
        ) {
          throw new GeminiExecutionError(
            `non-judge node decision must be null: ${nodeId}`,
            {
              code:
                "INVALID_GEMINI_RESULT",
              semantic: true
            }
          );
        }

        const requiredPort =
          expected.type ===
            "judge"
            ? (
                item.decision
                  ? "true"
                  : "false"
              )
            : "result";

        if (
          !Object.prototype
            .hasOwnProperty.call(
              item.outputs,
              requiredPort
            )
        ) {
          throw new GeminiExecutionError(
            `Gemini result missing required output port: ${requiredPort}`,
            {
              code:
                "INVALID_GEMINI_RESULT",
              semantic: true
            }
          );
        }

        if (
          typeof item.report !==
            "string"
        ) {
          throw new GeminiExecutionError(
            `Gemini result report must be a string: ${nodeId}`,
            {
              code:
                "INVALID_GEMINI_RESULT",
              semantic: true
            }
          );
        }

        return {
          nodeId,
          outputs:
            clone(
              item.outputs
            ),
          decision:
            expected.type ===
              "judge"
              ? item.decision
              : null,
          report:
            item.report
        };
      }
    );

  return results;
}

function retryAfterMs(
  response,
  now = Date.now()
) {
  const value =
    response?.headers?.get?.(
      "retry-after"
    );

  if (!value) {
    return null;
  }

  const seconds =
    Number(value);

  if (
    Number.isFinite(seconds) &&
    seconds >= 0
  ) {
    return Math.round(
      seconds * 1000
    );
  }

  const timestamp =
    Date.parse(value);

  if (
    Number.isFinite(timestamp)
  ) {
    return Math.max(
      0,
      timestamp - now
    );
  }

  return null;
}

function errorMessageFromBody(
  body,
  fallback
) {
  if (
    isPlainObject(body) &&
    typeof body?.error?.message ===
      "string"
  ) {
    return body.error.message;
  }

  return fallback;
}

function isModelUnavailable(
  status,
  message
) {
  if (status === 404) {
    return true;
  }

  if (status !== 400) {
    return false;
  }

  return /model|unsupported|not found|not available/i
    .test(
      String(message || "")
    );
}

async function readResponseJson(
  response
) {
  const text =
    await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiExecutionError(
      "Gemini returned invalid JSON.",
      {
        code:
          "INVALID_GEMINI_RESPONSE",
        retryable:
          response.status >= 500,
        fallbackEligible:
          false
      }
    );
  }
}

export function createGeminiExecution(
  options = {}
) {
  const apiKey =
    String(
      options.apiKey ??
      process.env.GEMINI_API_KEY ??
      ""
    ).trim();

  const model =
    String(
      options.model ??
      process.env.GEMINI_MODEL ??
      DEFAULT_GEMINI_MODEL
    ).trim() ||
    DEFAULT_GEMINI_MODEL;

  const fallbackModel =
    String(
      options.fallbackModel ??
      process.env
        .GEMINI_FALLBACK_MODEL ??
      DEFAULT_GEMINI_FALLBACK_MODEL
    ).trim();

  const forcedThinkingInput =
    options.thinkingLevel ??
    process.env
      .GEMINI_THINKING_LEVEL ??
    "";

  const forcedThinkingLevel =
    String(
      forcedThinkingInput || ""
    ).trim()
      ? normalizeThinkingLevel(
          forcedThinkingInput
        )
      : "";

  const maxNodes =
    positiveInteger(
      options.maxNodes ??
      process.env
        .GEMINI_MAX_GROUP_NODES,
      DEFAULT_MAX_GROUP_NODES
    );

  const maxInputChars =
    positiveInteger(
      options.maxInputChars ??
      process.env
        .GEMINI_MAX_GROUP_INPUT_CHARS,
      DEFAULT_MAX_INPUT_CHARS
    );

  const maxAttempts =
    positiveInteger(
      options.maxAttempts,
      DEFAULT_MAX_ATTEMPTS
    );

  const fetchImpl =
    options.fetchImpl ||
    globalThis.fetch;

  const sleepImpl =
    options.sleepImpl ||
    (
      ms =>
        new Promise(
          resolve =>
            setTimeout(
              resolve,
              ms
            )
        )
    );

  const random =
    typeof options.random ===
      "function"
      ? options.random
      : Math.random;

  if (
    typeof fetchImpl !==
      "function"
  ) {
    throw new GeminiExecutionError(
      "fetch implementation is unavailable.",
      {
        code:
          "GEMINI_FETCH_UNAVAILABLE"
      }
    );
  }

  let retryAfterHint =
    null;

  async function requestFetch(
    ...args
  ) {
    const response =
      await fetchImpl(
        ...args
      );

    retryAfterHint =
      retryAfterMs(
        response
      );

    return response;
  }

  function selectThinkingLevel(
    nodes,
    fallback = "minimal"
  ) {
    if (forcedThinkingLevel) {
      return forcedThinkingLevel;
    }

    const types =
      new Set(
        (
          Array.isArray(nodes)
            ? nodes
            : []
        )
          .map(
            node =>
              String(
                node?.type ||
                ""
              )
          )
      );

    if (
      types.has("research") ||
      types.has("write") ||
      types.has("judge")
    ) {
      return "low";
    }

    return fallback;
  }

  function abortError() {
    return new GeminiExecutionError(
      "Gemini request was aborted.",
      {
        code:
          "GEMINI_REQUEST_ABORTED",
        status: 499,
        retryable: false,
        fallbackEligible: false
      }
    );
  }

  function throwIfAborted(
    signal
  ) {
    if (signal?.aborted) {
      throw abortError();
    }
  }

  async function waitBeforeRetry(
    ms,
    signal
  ) {
    throwIfAborted(signal);

    await sleepImpl(
      ms
    );

    throwIfAborted(signal);
  }

  async function performRequest(
    request,
    signal
  ) {
    throwIfAborted(signal);
    retryAfterHint = null;

    let response;

    try {
      response =
        await requestFetch(
          INTERACTIONS_URL,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              "x-goog-api-key":
                apiKey
            },
            body:
              JSON.stringify(
                request
              ),
            signal
          }
        );
    } catch (error) {
      if (
        signal?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        throw abortError();
      }

      throw new GeminiExecutionError(
        error?.message ||
        "Gemini network request failed.",
        {
          code:
            "GEMINI_NETWORK_ERROR",
          retryable: true,
          fallbackEligible: false
        }
      );
    }

    const body =
      await readResponseJson(
        response
      );

    if (!response.ok) {
      const message =
        errorMessageFromBody(
          body,
          `Gemini API error: ${response.status}`
        );

      const unavailable =
        isModelUnavailable(
          response.status,
          message
        );

      throw new GeminiExecutionError(
        message,
        {
          code:
            unavailable
              ? "GEMINI_MODEL_UNAVAILABLE"
              : "GEMINI_API_ERROR",
          status:
            response.status,
          retryable:
            !unavailable &&
            (
              response.status ===
                429 ||
              response.status >=
                500
            ),
          fallbackEligible:
            unavailable
        }
      );
    }

    if (
      body?.status &&
      body.status !==
        "completed"
    ) {
      throw new GeminiExecutionError(
        `Gemini interaction did not complete: ${body.status}`,
        {
          code:
            "GEMINI_INCOMPLETE",
          retryable:
            body.status ===
              "failed" ||
            body.status ===
              "incomplete",
          fallbackEligible:
            false
        }
      );
    }

    return body;
  }

  async function executeStructuredModel(
    selectedModel,
    {
      buildRequest,
      parseText,
      invalidMessage,
      thinkingLevel,
      stage = "execution",
      signal,
      allowTransientRetry = true
    }
  ) {
    const startedAt =
      Date.now();

    const diagnostics = {
      stage,
      thinkingLevel,
      models: [
        selectedModel
      ],
      primaryAttempts: 0,
      transientRetries: 0,
      repairAttempts: 0,
      fallbackAttempts: 0,
      fallbackUsed: false,
      durationMs: 0
    };

    let body = null;
    let transientRetried = false;

    while (true) {
      throwIfAborted(signal);
      diagnostics.primaryAttempts++;

      try {
        body =
          await performRequest(
            buildRequest(""),
            signal
          );
        break;
      } catch (error) {
        if (
          error?.code ===
            "GEMINI_REQUEST_ABORTED" ||
          error?.code ===
            "GEMINI_MODEL_UNAVAILABLE" ||
          !error?.retryable ||
          transientRetried ||
          !allowTransientRetry
        ) {
          error.diagnostics =
            diagnostics;
          throw error;
        }

        transientRetried = true;
        diagnostics
          .transientRetries++;

        await waitBeforeRetry(
          retryAfterHint ??
          (
            750 +
            Math.floor(
              random() * 250
            )
          ),
          signal
        );
      }
    }

    const parseBody =
      currentBody => {
        const text =
          extractInteractionText(
            currentBody
          );

        if (!text.trim()) {
          throw new GeminiExecutionError(
            "Gemini returned an empty result.",
            {
              code:
                "INVALID_GEMINI_RESULT",
              semantic: true
            }
          );
        }

        return parseText(text);
      };

    let value;

    try {
      value =
        parseBody(body);
    } catch (error) {
      const semanticError =
        error instanceof
          GeminiExecutionError
          ? error
          : new GeminiExecutionError(
              invalidMessage ||
              "Gemini structured output was not valid.",
              {
                code:
                  "INVALID_GEMINI_RESULT",
                semantic: true
              }
            );

      if (!semanticError.semantic) {
        semanticError.diagnostics =
          diagnostics;
        throw semanticError;
      }

      throwIfAborted(signal);
      diagnostics.repairAttempts++;

      let repairBody;

      try {
        repairBody =
          await performRequest(
            buildRequest(
              semanticError.message
            ),
            signal
          );
      } catch (repairError) {
        repairError.diagnostics =
          diagnostics;
        throw repairError;
      }

      try {
        value =
          parseBody(
            repairBody
          );
        body =
          repairBody;
      } catch (repairParseError) {
        const normalized =
          repairParseError instanceof
            GeminiExecutionError
            ? repairParseError
            : new GeminiExecutionError(
                invalidMessage ||
                "Gemini structured output was not valid.",
                {
                  code:
                    "INVALID_GEMINI_RESULT",
                  semantic: true
                }
              );

        normalized.diagnostics =
          diagnostics;
        throw normalized;
      }
    }

    diagnostics.durationMs =
      Math.max(
        0,
        Date.now() -
        startedAt
      );

    return {
      model:
        String(
          body?.model ||
          selectedModel
        ),
      usage:
        normalizeUsage(
          body?.usage
        ),
      value,
      diagnostics
    };
  }

  async function executeModel(
    group,
    selectedModel,
    options = {}
  ) {
    const selectedThinking =
      selectThinkingLevel(
        group.nodes,
        "minimal"
      );

    const response =
      await executeStructuredModel(
        selectedModel,
        {
          buildRequest:
            repairError =>
              buildInteractionRequest(
                group,
                {
                  model:
                    selectedModel,
                  thinkingLevel:
                    selectedThinking,
                  repairError
                }
              ),
          parseText:
            text => {
              let parsed;

              try {
                parsed =
                  JSON.parse(text);
              } catch {
                throw new GeminiExecutionError(
                  "Gemini structured output was not valid JSON.",
                  {
                    code:
                      "INVALID_GEMINI_RESULT",
                    semantic: true
                  }
                );
              }

              return validateGroupResults(
                parsed,
                group.nodes
              );
            },
          invalidMessage:
            "Gemini structured output was not valid JSON.",
          thinkingLevel:
            selectedThinking,
          stage:
            "execution",
          signal:
            options.signal,
          allowTransientRetry:
            options
              .allowTransientRetry !==
              false
        }
      );

    return {
      model:
        response.model,
      usage:
        response.usage,
      results:
        response.value,
      diagnostics:
        response.diagnostics
    };
  }

  async function finalizeModel(
    input,
    selectedModel,
    options = {}
  ) {
    const selectedThinking =
      forcedThinkingLevel ||
      "minimal";

    const response =
      await executeStructuredModel(
        selectedModel,
        {
          buildRequest:
            repairError =>
              buildFinalResponseRequest(
                input,
                {
                  model:
                    selectedModel,
                  thinkingLevel:
                    selectedThinking,
                  repairError
                }
              ),
          parseText:
            text => {
              let parsed;

              try {
                parsed =
                  JSON.parse(text);
              } catch {
                throw new GeminiExecutionError(
                  "Gemini final response was not valid JSON.",
                  {
                    code:
                      "INVALID_GEMINI_RESULT",
                    semantic: true
                  }
                );
              }

              const message =
                typeof parsed?.message ===
                  "string"
                  ? parsed.message.trim()
                  : "";

              if (!message) {
                throw new GeminiExecutionError(
                  "Gemini final response message is empty.",
                  {
                    code:
                      "INVALID_GEMINI_RESULT",
                    semantic: true
                  }
                );
              }

              return message;
            },
          invalidMessage:
            "Gemini final response was not valid.",
          thinkingLevel:
            selectedThinking,
          stage:
            "finalizer",
          signal:
            options.signal,
          allowTransientRetry: true
        }
      );

    return {
      model:
        response.model,
      usage:
        response.usage,
      message:
        response.value,
      diagnostics:
        response.diagnostics
    };
  }

  async function executeGroup(
    input,
    options = {}
  ) {
    if (!apiKey) {
      throw new GeminiExecutionError(
        "GEMINI_API_KEY가 설정되지 않았습니다.",
        {
          code:
            "GEMINI_API_KEY_MISSING"
        }
      );
    }

    throwIfAborted(
      options.signal
    );

    const group =
      validateExecutionGroup(
        input,
        {
          maxNodes,
          maxInputChars
        }
      );

    try {
      return await executeModel(
        group,
        model,
        {
          signal:
            options.signal
        }
      );
    } catch (error) {
      if (
        error?.code !==
          "GEMINI_MODEL_UNAVAILABLE" ||
        !fallbackModel ||
        fallbackModel === model
      ) {
        throw error;
      }

      throwIfAborted(
        options.signal
      );

      const output =
        await executeModel(
          group,
          fallbackModel,
          {
            signal:
              options.signal,
            allowTransientRetry:
              false
          }
        );

      output.diagnostics = {
        ...output.diagnostics,
        models: [
          model,
          fallbackModel
        ],
        fallbackAttempts: 1,
        fallbackUsed: true
      };

      return output;
    }
  }

  async function finalizeRun(
    input,
    options = {}
  ) {
    if (!apiKey) {
      throw new GeminiExecutionError(
        "GEMINI_API_KEY가 설정되지 않았습니다.",
        {
          code:
            "GEMINI_API_KEY_MISSING"
        }
      );
    }

    throwIfAborted(
      options.signal
    );

    return finalizeModel(
      input,
      model,
      {
        signal:
          options.signal
      }
    );
  }

  return {
    executeGroup,
    finalizeRun,
    config: {
      model,
      fallbackModel,
      thinkingLevel:
        forcedThinkingLevel ||
        "auto",
      maxNodes,
      maxInputChars,
      maxAttempts
    }
  };
}
