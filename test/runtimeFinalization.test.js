import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadPolicy() {
  const source =
    fs.readFileSync(
      new URL(
        "../front/js/runtimeFinalization.js",
        import.meta.url
      ),
      "utf8"
    );

  const window = {};

  vm.runInNewContext(
    source,
    {
      window
    },
    {
      filename:
        "front/js/runtimeFinalization.js"
    }
  );

  return window
    .OvllRuntimeFinalization;
}

function run({
  status = "SUCCESS",
  nodes = {},
  connections = []
} = {}) {
  return {
    status,
    nodes,
    workflow: {
      nodes:
        Object.values(nodes)
          .map(state => ({
            id: state.id,
            type: state.type
          })),
      connections
    }
  };
}

test("cancelled runs skip final response generation", () => {
  const policy = loadPolicy();

  assert.deepEqual(
    policy.decide(
      run({
        status: "CANCELLED"
      })
    ),
    {
      mode: "skip",
      reason: "cancelled",
      message: ""
    }
  );
});

test("failed runs use local fallback", () => {
  const policy = loadPolicy();

  const decision =
    policy.decide(
      run({
        status: "FAILED",
        nodes: {
          write: {
            id: "write",
            type: "write",
            status: "FAILED",
            error: {
              message: "fail"
            }
          }
        }
      })
    );

  assert.equal(
    decision.mode,
    "local"
  );
  assert.equal(
    decision.reason,
    "failed"
  );
});

test("artifact-only runs use a deterministic local response", () => {
  const policy = loadPolicy();

  const decision =
    policy.decide(
      run({
        nodes: {
          file: {
            id: "file",
            type: "createFile",
            status: "SUCCESS",
            result: {
              artifact: {
                id: "artifact:1",
                name: "result.pdf"
              }
            }
          }
        }
      })
    );

  assert.equal(
    decision.mode,
    "local"
  );
  assert.equal(
    decision.reason,
    "artifact-only"
  );
});

test("single terminal usable text bypasses model finalization", () => {
  const policy = loadPolicy();
  const text =
    "완성된 결과입니다.\n두 번째 문단입니다.";

  const decision =
    policy.decide(
      run({
        nodes: {
          write: {
            id: "write",
            type: "write",
            status: "SUCCESS",
            result: {
              outputs: {
                result: text
              }
            }
          }
        }
      })
    );

  assert.equal(
    decision.mode,
    "local"
  );
  assert.equal(
    decision.message,
    text
  );
});

test("structured terminal output still requests synthesis", () => {
  const policy = loadPolicy();

  const decision =
    policy.decide(
      run({
        nodes: {
          research: {
            id: "research",
            type: "research",
            status: "SUCCESS",
            result: {
              outputs: {
                result: {
                  findings: [
                    "a",
                    "b"
                  ]
                }
              }
            }
          }
        }
      })
    );

  assert.equal(
    decision.mode,
    "model"
  );
});

test("multiple successful terminal branches request synthesis", () => {
  const policy = loadPolicy();

  const decision =
    policy.decide(
      run({
        nodes: {
          a: {
            id: "a",
            type: "write",
            status: "SUCCESS",
            result: {
              outputs: {
                result: "a"
              }
            }
          },
          b: {
            id: "b",
            type: "write",
            status: "SUCCESS",
            result: {
              outputs: {
                result: "b"
              }
            }
          }
        }
      })
    );

  assert.equal(
    decision.mode,
    "model"
  );
});

test("judge terminal output remains model-synthesized", () => {
  const policy = loadPolicy();

  const decision =
    policy.decide(
      run({
        nodes: {
          judge: {
            id: "judge",
            type: "judge",
            status: "SUCCESS",
            result: {
              decision: true,
              outputs: {
                true: "ok"
              }
            }
          }
        }
      })
    );

  assert.equal(
    decision.mode,
    "model"
  );
});
