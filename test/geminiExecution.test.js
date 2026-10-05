import test from "node:test";
import assert from "node:assert/strict";

import {
  createGeminiExecution,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FALLBACK_MODEL
} from "../geminiExecution.js";

function jsonResponse(
  status,
  payload,
  headers = {}
) {
  const normalized =
    Object.fromEntries(
      Object.entries(headers)
        .map(([key, value]) => [
          key.toLowerCase(),
          String(value)
        ])
    );

  return {
    ok:
      status >= 200 &&
      status < 300,
    status,
    headers: {
      get(name) {
        return (
          normalized[
            String(name)
              .toLowerCase()
          ] ?? null
        );
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(
        payload
      );
    }
  };
}

function interaction(
  results,
  model =
    DEFAULT_GEMINI_MODEL,
  refusal = null
) {
  return {
    model,
    status: "completed",
    steps: [
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text:
              JSON.stringify({
                refusal,
                results
              })
          }
        ]
      }
    ],
    usage: {
      total_input_tokens: 12,
      total_output_tokens: 8,
      total_tokens: 20
    }
  };
}

function result(
  nodeId,
  options = {}
) {
  return {
    nodeId,
    outputs:
      options.outputs ?? {
        result: nodeId
      },
    decision:
      options.decision ?? null,
    report:
      options.report ??
      nodeId
  };
}

function group(
  nodes = [
    {
      id: "research",
      type: "research",
      params: {
        topic: "test"
      },
      inputs: {}
    }
  ]
) {
  return {
    nodes,
    connections: []
  };
}

test("defaults target free-tier Flash-Lite models", () => {
  assert.equal(
    DEFAULT_GEMINI_MODEL,
    "gemini-3.5-flash-lite"
  );
  assert.equal(
    DEFAULT_GEMINI_FALLBACK_MODEL,
    "gemini-3.1-flash-lite"
  );
});

test("executeGroup sends a stateless structured Interactions request", async () => {
  const calls = [];

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async (url, options) => {
          calls.push({
            url,
            options
          });

          return jsonResponse(
            200,
            interaction([
              result("research")
            ])
          );
        },
      sleepImpl:
        async () => {}
    });

  const output =
    await execution.executeGroup(
      group()
    );

  assert.equal(
    calls.length,
    1
  );

  const request =
    JSON.parse(
      calls[0].options.body
    );

  assert.equal(
    calls[0].url,
    "https://generativelanguage.googleapis.com/v1beta/interactions"
  );

  assert.equal(
    calls[0].options.headers[
      "x-goog-api-key"
    ],
    "test-key"
  );

  assert.equal(
    request.model,
    "gemini-3.5-flash-lite"
  );
  assert.equal(
    request.store,
    false
  );
  assert.equal(
    request.generation_config
      .thinking_level,
    "minimal"
  );
  assert.equal(
    request.response_format.type,
    "text"
  );
  assert.equal(
    request.response_format
      .mime_type,
    "application/json"
  );
  assert.equal(
    request.response_format
      .schema.properties.results
      .minItems,
    1
  );

  assert.equal(
    output.model,
    "gemini-3.5-flash-lite"
  );
  assert.deepEqual(
    output.usage,
    {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      cachedTokens: null,
      thoughtTokens: null,
      toolUseTokens: null
    }
  );
  assert.equal(
    output.results[0].nodeId,
    "research"
  );
});

test("explicit feasibility refusal stops execution without repair", async () => {
  let count = 0;

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async () => {
          count++;

          return jsonResponse(
            200,
            interaction(
              [
                result("research")
              ],
              DEFAULT_GEMINI_MODEL,
              {
                code:
                  "UNEXECUTABLE_REQUEST",
                message:
                  "범위를 줄여서 다시 요청해줘."
              }
            )
          );
        },
      sleepImpl:
        async () => {}
    });

  await assert.rejects(
    execution.executeGroup(
      group()
    ),
    error => {
      assert.equal(
        error.code,
        "GEMINI_REQUEST_REFUSED"
      );
      assert.match(
        error.message,
        /범위를 줄여서/
      );
      return true;
    }
  );

  assert.equal(
    count,
    1
  );
});

test("semantic mismatch triggers one compact repair attempt", async () => {
  let count = 0;
  const requests = [];

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async (
          _url,
          options
        ) => {
          count++;
          requests.push(
            JSON.parse(
              options.body
            )
          );

          if (count === 1) {
            return jsonResponse(
              200,
              interaction([
                result("wrong")
              ])
            );
          }

          return jsonResponse(
            200,
            interaction([
              result("research")
            ])
          );
        },
      sleepImpl:
        async () => {}
    });

  const output =
    await execution.executeGroup(
      group()
    );

  assert.equal(count, 2);
  assert.match(
    requests[1].input,
    /REPAIR/
  );
  assert.equal(
    output.results[0].nodeId,
    "research"
  );
});

test("429 honors Retry-After before retrying", async () => {
  let count = 0;
  const sleeps = [];

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async () => {
          count++;

          if (count === 1) {
            return jsonResponse(
              429,
              {
                error: {
                  message:
                    "rate limited"
                }
              },
              {
                "retry-after": "2"
              }
            );
          }

          return jsonResponse(
            200,
            interaction([
              result("research")
            ])
          );
        },
      sleepImpl:
        async ms => {
          sleeps.push(ms);
        },
      random:
        () => 0
    });

  await execution.executeGroup(
    group()
  );

  assert.equal(count, 2);
  assert.deepEqual(
    sleeps,
    [2000]
  );
});

test("unsupported primary model falls back to configured free-tier model", async () => {
  const models = [];

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async (
          _url,
          options
        ) => {
          const body =
            JSON.parse(
              options.body
            );

          models.push(
            body.model
          );

          if (
            body.model ===
            DEFAULT_GEMINI_MODEL
          ) {
            return jsonResponse(
              404,
              {
                error: {
                  message:
                    "model not found"
                }
              }
            );
          }

          return jsonResponse(
            200,
            interaction(
              [
                result("research")
              ],
              DEFAULT_GEMINI_FALLBACK_MODEL
            )
          );
        },
      sleepImpl:
        async () => {}
    });

  const output =
    await execution.executeGroup(
      group()
    );

  assert.deepEqual(
    models,
    [
      DEFAULT_GEMINI_MODEL,
      DEFAULT_GEMINI_FALLBACK_MODEL
    ]
  );

  assert.equal(
    output.model,
    DEFAULT_GEMINI_FALLBACK_MODEL
  );
});

test("oversized group is rejected before any Gemini request", async () => {
  let called = false;

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      maxInputChars: 80,
      fetchImpl:
        async () => {
          called = true;
          throw new Error(
            "should not fetch"
          );
        }
    });

  await assert.rejects(
    execution.executeGroup(
      group([
        {
          id: "write",
          type: "write",
          params: {
            about:
              "x".repeat(200)
          },
          inputs: {}
        }
      ])
    ),
    /too large/
  );

  assert.equal(
    called,
    false
  );
});

test("judge result requires a boolean decision", async () => {
  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      maxAttempts: 1,
      fetchImpl:
        async () =>
          jsonResponse(
            200,
            interaction([
              result("judge")
            ])
          ),
      sleepImpl:
        async () => {}
    });

  await assert.rejects(
    execution.executeGroup(
      group([
        {
          id: "judge",
          type: "judge",
          params: {
            condition:
              "is valid"
          },
          inputs: {}
        }
      ])
    ),
    /boolean decision/
  );
});


test("non-judge results must expose the runtime result port", async () => {
  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      maxAttempts: 1,
      fetchImpl:
        async () =>
          jsonResponse(
            200,
            interaction([
              result(
                "research",
                {
                  outputs: {
                    wrong: "value"
                  }
                }
              )
            ])
          ),
      sleepImpl:
        async () => {}
    });

  await assert.rejects(
    execution.executeGroup(
      group()
    ),
    /required output port: result/
  );
});

test("judge results must expose the selected branch output port", async () => {
  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      maxAttempts: 1,
      fetchImpl:
        async () =>
          jsonResponse(
            200,
            interaction([
              result(
                "judge",
                {
                  outputs: {},
                  decision: true
                }
              )
            ])
          ),
      sleepImpl:
        async () => {}
    });

  await assert.rejects(
    execution.executeGroup(
      group([
        {
          id: "judge",
          type: "judge",
          params: {
            condition:
              "is valid"
          },
          inputs: {}
        }
      ])
    ),
    /required output port: true/
  );
});


test("simple organize-only groups use minimal thinking", async () => {
  let request = null;

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async (_url, options) => {
          request =
            JSON.parse(
              options.body
            );

          return jsonResponse(
            200,
            interaction([
              result("organize")
            ])
          );
        },
      sleepImpl:
        async () => {}
    });

  await execution.executeGroup(
    group([
      {
        id: "organize",
        type: "organize",
        params: {
          request: "organize"
        },
        inputs: {}
      }
    ])
  );

  assert.equal(
    request.generation_config
      .thinking_level,
    "minimal"
  );
});

test("hung Gemini upstream requests fail with an explicit timeout", async () => {
  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      requestTimeoutMs: 5,
      fetchImpl:
        async (_url, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => {
                const error =
                  new Error("aborted");

                error.name =
                  "AbortError";
                reject(error);
              },
              {once:true}
            );
          }),
      sleepImpl:
        async () => {}
    });

  await assert.rejects(
    execution.executeGroup(
      group()
    ),
    error =>
      error?.code ===
        "GEMINI_UPSTREAM_TIMEOUT" &&
      error?.retryable ===
        false
  );
});

test("429 retries once on the primary model and never falls back", async () => {
  const models = [];

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async (_url, options) => {
          const request =
            JSON.parse(
              options.body
            );

          models.push(
            request.model
          );

          return jsonResponse(
            429,
            {
              error: {
                message:
                  "rate limited"
              }
            },
            {
              "retry-after": "0"
            }
          );
        },
      sleepImpl:
        async () => {},
      random:
        () => 0
    });

  await assert.rejects(
    execution.executeGroup(
      group()
    ),
    error =>
      error?.status === 429
  );

  assert.deepEqual(
    models,
    [
      DEFAULT_GEMINI_MODEL,
      DEFAULT_GEMINI_MODEL
    ]
  );
});

test("abort during retry wait prevents another Gemini request", async () => {
  const controller =
    new AbortController();
  let count = 0;

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async () => {
          count++;

          return jsonResponse(
            500,
            {
              error: {
                message:
                  "temporary failure"
              }
            }
          );
        },
      sleepImpl:
        async () => {
          controller.abort();
        },
      random:
        () => 0
    });

  await assert.rejects(
    execution.executeGroup(
      group(),
      {
        signal:
          controller.signal
      }
    ),
    error =>
      error?.code ===
        "GEMINI_REQUEST_ABORTED"
  );

  assert.equal(
    count,
    1
  );
});

test("usage includes cached thought and tool-use token counters", async () => {
  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async () => {
          const payload =
            interaction([
              result("research")
            ]);

          payload.usage = {
            total_input_tokens: 100,
            total_output_tokens: 40,
            total_tokens: 160,
            total_cached_tokens: 30,
            total_thought_tokens: 15,
            total_tool_use_tokens: 5
          };

          return jsonResponse(
            200,
            payload
          );
        },
      sleepImpl:
        async () => {}
    });

  const output =
    await execution.executeGroup(
      group()
    );

  assert.deepEqual(
    output.usage,
    {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 160,
      cachedTokens: 30,
      thoughtTokens: 15,
      toolUseTokens: 5
    }
  );
});

test("execution diagnostics report bounded attempts", async () => {
  let count = 0;

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async () => {
          count++;

          if (count === 1) {
            return jsonResponse(
              500,
              {
                error: {
                  message:
                    "temporary"
                }
              }
            );
          }

          return jsonResponse(
            200,
            interaction([
              result("research")
            ])
          );
        },
      sleepImpl:
        async () => {},
      random:
        () => 0
    });

  const output =
    await execution.executeGroup(
      group()
    );

  assert.equal(
    output.diagnostics
      .thinkingLevel,
    "minimal"
  );
  assert.equal(
    output.diagnostics
      .primaryAttempts,
    2
  );
  assert.equal(
    output.diagnostics
      .transientRetries,
    1
  );
  assert.equal(
    output.diagnostics
      .fallbackAttempts,
    0
  );
});


test("write execution treats page count as substantive content length, not padding", async () => {
  let request = null;

  const execution =
    createGeminiExecution({
      apiKey: "test-key",
      fetchImpl:
        async (_url, options) => {
          request =
            JSON.parse(
              options.body
            );

          return jsonResponse(
            200,
            interaction([
              result(
                "write",
                {
                  outputs: {
                    result:
                      "본문"
                  }
                }
              )
            ])
          );
        },
      sleepImpl:
        async () => {}
    });

  await execution.executeGroup(
    group([
      {
        id: "write",
        type: "write",
        params: {
          request:
            "A4 3페이지 분량의 보고서로 작성해줘"
        },
        inputs: {}
      }
    ])
  );

  assert.match(
    request.system_instruction,
    /page|페이지|분량/i
  );
  assert.match(
    request.system_instruction,
    /substantive|실질|내용/i
  );
  assert.match(
    request.system_instruction,
    /padding|whitespace|여백|반복/i
  );
});
