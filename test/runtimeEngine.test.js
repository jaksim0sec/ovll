import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;
await import("../front/js/runtimeEngine.js");

const {
  RuntimeEngine,
  LocalNodeExecutor,
  normalizeWorkflow,
  validateExecutionReadiness,
  analyzeWorkflowExecutionDelta
} = globalThis.OvllExecutionEngine;

const CONTENT_REQUIRED_TYPES =
  new Set([
    "research",
    "organize",
    "judge",
    "write",
    "convert",
    "createFile"
  ]);

function node(id, type = "step") {
  return {
    id,
    type,
    data:
      CONTENT_REQUIRED_TYPES
        .has(type)
        ? {
            params: {
              request:
                `test request for ${id}`
            }
          }
        : {}
  };
}

function edge(id, from, to, options = {}) {
  return {
    id,
    from: {
      node: from,
      port: options.fromPort || "result"
    },
    to: {
      node: to,
      port: options.toPort || "in"
    },
    data: {
      kind: options.kind || "flow"
    }
  };
}

function workflow(nodes, connections) {
  return {
    revision: "test",
    nodes,
    connections
  };
}

function executor(log, decisions = {}, failures = new Set()) {
  return {
    async run(current, inputs) {
      log.push(current.id);

      if (failures.has(current.id)) {
        throw new Error(`failed:${current.id}`);
      }

      if (current.type === "judge") {
        const decision = decisions[current.id] ?? true;
        return {
          decision,
          outputs: {
            true: decision ? current.id : undefined,
            false: decision ? undefined : current.id
          }
        };
      }

      return {
        outputs: {
          out: current.id,
          result: current.id
        },
        inputs
      };
    }
  };
}

test("empty configured nodes are rejected before executor or API work", async () => {
  const calls = [];
  const graph = workflow(
    [
      {
        id: "empty",
        type: "research",
        data: {
          params: {
            request: "   "
          }
        }
      }
    ],
    []
  );

  const readiness =
    validateExecutionReadiness(
      graph,
      "empty",
      { mode: "spread" }
    );

  assert.equal(
    readiness.ok,
    false
  );
  assert.deepEqual(
    readiness.emptyNodes,
    [
      {
        id: "empty",
        type: "research"
      }
    ]
  );

  const engine =
    new RuntimeEngine({
      executor: {
        async run() {
          calls.push("run");
          return {
            outputs: {}
          };
        },
        async runGroup() {
          calls.push("group");
          return {
            results: []
          };
        }
      }
    });

  await assert.rejects(
    engine.run(
      graph,
      "empty",
      { mode: "spread" }
    ),
    error =>
      error?.code ===
        "NODE_INPUT_EMPTY"
  );

  assert.deepEqual(
    calls,
    []
  );
});

test("target executes only the pivot and every required ancestor", async () => {
  const log = [];
  const engine = new RuntimeEngine({ executor: executor(log) });
  const graph = workflow(
    [node("a"), node("b"), node("c"), node("d")],
    [
      edge("ab", "a", "b"),
      edge("bc", "b", "c"),
      edge("cd", "c", "d")
    ]
  );

  const result = await engine.run(graph, "c", { mode: "target" });

  assert.deepEqual(new Set(log), new Set(["a", "b", "c"]));
  assert.equal(result.nodes.a.status, "SUCCESS");
  assert.equal(result.nodes.b.status, "SUCCESS");
  assert.equal(result.nodes.c.status, "SUCCESS");
  assert.equal(result.nodes.d.status, "IDLE");
});

test("spread expands through parents and back out through their other children", async () => {
  const log = [];
  const engine = new RuntimeEngine({ executor: executor(log) });
  const graph = workflow(
    [node("root"), node("pivot"), node("sibling"), node("child")],
    [
      edge("root-pivot", "root", "pivot"),
      edge("root-sibling", "root", "sibling"),
      edge("pivot-child", "pivot", "child")
    ]
  );

  const result = await engine.run(graph, "pivot", { mode: "spread" });

  assert.deepEqual(
    new Set(log),
    new Set(["root", "pivot", "sibling", "child"])
  );
  assert.equal(result.nodes.sibling.status, "SUCCESS");
});

test("spread executes a merge node once even when multiple branches reach it", async () => {
  const log = [];
  const engine = new RuntimeEngine({ executor: executor(log) });
  const graph = workflow(
    [node("root"), node("left"), node("right"), node("merge")],
    [
      edge("root-left", "root", "left"),
      edge("root-right", "root", "right"),
      edge("left-merge", "left", "merge"),
      edge("right-merge", "right", "merge")
    ]
  );

  await engine.run(graph, "root", { mode: "spread" });

  assert.equal(log.filter(id => id === "merge").length, 1);
});

test("judge activates only the selected flow branch", async () => {
  const log = [];
  const engine = new RuntimeEngine({
    executor: executor(log, { judge: true })
  });
  const graph = workflow(
    [node("judge", "judge"), node("yes"), node("no")],
    [
      edge("judge-yes", "judge", "yes", { fromPort: "true" }),
      edge("judge-no", "judge", "no", { fromPort: "false" })
    ]
  );

  const result = await engine.run(graph, "judge", { mode: "spread" });

  assert.equal(result.nodes.yes.status, "SUCCESS");
  assert.equal(result.nodes.no.status, "SKIPPED");
  assert.equal(log.includes("yes"), true);
  assert.equal(log.includes("no"), false);
});

test("workflow cycles are rejected before execution", () => {
  assert.throws(
    () =>
      normalizeWorkflow(
        workflow(
          [node("a"), node("b")],
          [
            edge("ab", "a", "b"),
            edge("ba", "b", "a")
          ]
        )
      ),
    /cycle/
  );
});

test("a parent failure skips its dependent target and returns a FAILED run", async () => {
  const log = [];
  const engine = new RuntimeEngine({
    executor: executor(log, {}, new Set(["parent"]))
  });
  const graph = workflow(
    [node("parent"), node("pivot")],
    [edge("parent-pivot", "parent", "pivot")]
  );

  const result =
    await engine.run(
      graph,
      "pivot",
      { mode: "target" }
    );

  assert.equal(result.status, "FAILED");
  assert.equal(result.nodes.parent.status, "FAILED");
  assert.equal(result.nodes.pivot.status, "SKIPPED");
  assert.equal(
    result.nodes.pivot.skipReason,
    "dependency_failed"
  );
  assert.deepEqual(
    result.nodes.pivot.blockedBy,
    ["parent"]
  );
  assert.equal(log.includes("pivot"), false);
});

test("spread continues independent branches after a node failure", async () => {
  const log = [];
  const engine = new RuntimeEngine({
    executor: executor(log, {}, new Set(["bad"]))
  });
  const graph = workflow(
    [
      node("root"),
      node("bad"),
      node("blocked"),
      node("good"),
      node("tail")
    ],
    [
      edge("root-bad", "root", "bad"),
      edge("bad-blocked", "bad", "blocked"),
      edge("root-good", "root", "good"),
      edge("good-tail", "good", "tail")
    ]
  );

  const result =
    await engine.run(
      graph,
      "root",
      { mode: "spread" }
    );

  assert.equal(result.status, "FAILED");
  assert.equal(result.nodes.bad.status, "FAILED");
  assert.equal(result.nodes.blocked.status, "SKIPPED");
  assert.equal(
    result.nodes.blocked.skipReason,
    "dependency_failed"
  );
  assert.equal(result.nodes.good.status, "SUCCESS");
  assert.equal(result.nodes.tail.status, "SUCCESS");
  assert.equal(log.includes("blocked"), false);
});

test("dependency edges emit balanced active and inactive events", async () => {
  const events = [];
  const engine = new RuntimeEngine({
    executor: executor([]),
    onEvent(event) {
      if (event.type === "edge:state") events.push(event);
    }
  });
  const graph = workflow(
    [node("a"), node("b")],
    [edge("ab", "a", "b")]
  );

  await engine.run(graph, "b", { mode: "target" });

  assert.deepEqual(
    events.map(event => [event.edgeId, event.active]),
    [["ab", true], ["ab", false]]
  );
});


test("linear Gemini nodes execute in one group call", async () => {
  const groupCalls = [];
  const runCalls = [];
  const engine = new RuntimeEngine({
    executor: {
      async run(current) {
        runCalls.push(current.id);
        return { outputs: { result: current.id } };
      },
      async runGroup(group) {
        groupCalls.push(group.nodes.map(item => item.id));
        return {
          results: group.nodes.map(item => ({
            nodeId: item.id,
            outputs: { result: item.id },
            decision: null,
            report: item.id
          }))
        };
      }
    }
  });
  const graph = workflow(
    [
      node("research", "research"),
      node("organize", "organize"),
      node("write", "write")
    ],
    [
      edge("ro", "research", "organize"),
      edge("ow", "organize", "write")
    ]
  );

  const result = await engine.run(graph, "research", { mode: "spread" });

  assert.deepEqual(groupCalls, [["research", "organize", "write"]]);
  assert.deepEqual(runCalls, []);
  assert.equal(result.nodes.research.status, "SUCCESS");
  assert.equal(result.nodes.organize.status, "SUCCESS");
  assert.equal(result.nodes.write.status, "SUCCESS");
});

test("judge is isolated from adjacent Gemini groups", async () => {
  const groupCalls = [];
  const engine = new RuntimeEngine({
    executor: {
      async run() {
        throw new Error("unexpected single run");
      },
      async runGroup(group) {
        const ids = group.nodes.map(item => item.id);
        groupCalls.push(ids);
        return {
          results: group.nodes.map(item => ({
            nodeId: item.id,
            outputs:
              item.type === "judge"
                ? { true: item.id }
                : { result: item.id },
            decision:
              item.type === "judge"
                ? true
                : null,
            report: item.id
          }))
        };
      }
    }
  });
  const graph = workflow(
    [
      node("research", "research"),
      node("judge", "judge"),
      node("write", "write")
    ],
    [
      edge("rj", "research", "judge"),
      edge("jw", "judge", "write", { fromPort: "true" })
    ]
  );

  await engine.run(graph, "research", { mode: "spread" });

  assert.deepEqual(
    groupCalls,
    [["research"], ["judge"], ["write"]]
  );
});

test("group transport failure blocks only its dependent chain", async () => {
  const groupCalls = [];
  const engine = new RuntimeEngine({
    executor: {
      async run(current) {
        return { outputs: { result: current.id } };
      },
      async runGroup(group) {
        const ids = group.nodes.map(item => item.id);
        groupCalls.push(ids);
        if (ids.includes("bad")) {
          throw new Error("group failed");
        }
        return {
          results: group.nodes.map(item => ({
            nodeId: item.id,
            outputs: { result: item.id },
            decision: null,
            report: item.id
          }))
        };
      }
    }
  });
  const graph = workflow(
    [
      node("root", "start"),
      node("bad", "research"),
      node("blocked", "write"),
      node("good", "organize")
    ],
    [
      edge("rb", "root", "bad", { fromPort: "out" }),
      edge("bb", "bad", "blocked"),
      edge("rg", "root", "good", { fromPort: "out" })
    ]
  );

  const result = await engine.run(graph, "root", { mode: "spread" });

  assert.equal(result.status, "FAILED");
  assert.equal(result.nodes.bad.status, "FAILED");
  assert.equal(result.nodes.blocked.status, "SKIPPED");
  assert.equal(result.nodes.good.status, "SUCCESS");
  assert.equal(result.nodes.blocked.skipReason, "dependency_failed");
});


test("fork and merge boundaries split Gemini groups safely", async () => {
  const calls = [];
  const engine = new RuntimeEngine({
    executor: {
      async run(current) {
        return {
          outputs: {
            result: current.id
          }
        };
      },
      async runGroup(group) {
        const ids =
          group.nodes.map(
            item => item.id
          );

        calls.push(ids);

        return {
          results:
            group.nodes.map(
              item => ({
                nodeId:
                  item.id,
                outputs: {
                  result:
                    item.id
                },
                decision:
                  null,
                report:
                  item.id
              })
            )
        };
      }
    }
  });

  const graph = workflow(
    [
      node("root", "research"),
      node("fork", "organize"),
      node("left", "write"),
      node("right", "write"),
      node("merge", "organize"),
      node("tail", "write")
    ],
    [
      edge("root-fork", "root", "fork"),
      edge("fork-left", "fork", "left"),
      edge("fork-right", "fork", "right"),
      edge("left-merge", "left", "merge"),
      edge("right-merge", "right", "merge"),
      edge("merge-tail", "merge", "tail")
    ]
  );

  const result =
    await engine.run(
      graph,
      "root",
      { mode: "spread" }
    );

  const callKeys =
    calls.map(
      ids => ids.join(",")
    );

  assert.equal(
    callKeys.includes(
      "root,fork"
    ),
    true
  );
  assert.equal(
    callKeys.includes(
      "merge,tail"
    ),
    true
  );
  assert.equal(
    callKeys.includes("left"),
    true
  );
  assert.equal(
    callKeys.includes("right"),
    true
  );
  assert.equal(
    result.nodes.tail.status,
    "SUCCESS"
  );
});

test("local boundary nodes are never sent to Gemini groups", async () => {
  const groupCalls = [];
  const localCalls = [];

  const engine = new RuntimeEngine({
    executor: {
      async run(current) {
        localCalls.push(
          current.id
        );

        return {
          outputs: {
            out: true,
            result:
              current.id
          }
        };
      },
      async runGroup(group) {
        groupCalls.push(
          group.nodes.map(
            item => item.id
          )
        );

        return {
          results:
            group.nodes.map(
              item => ({
                nodeId:
                  item.id,
                outputs: {
                  result:
                    item.id
                },
                decision:
                  null,
                report:
                  item.id
              })
            )
        };
      }
    }
  });

  const graph = workflow(
    [
      node("start", "start"),
      node("research", "research"),
      node("write", "write"),
      node("file", "createFile")
    ],
    [
      edge("sr", "start", "research", {
        fromPort: "out"
      }),
      edge("rw", "research", "write"),
      edge("wf", "write", "file")
    ]
  );

  await engine.run(
    graph,
    "start",
    { mode: "spread" }
  );

  assert.deepEqual(
    groupCalls,
    [["research", "write"]]
  );
  assert.deepEqual(
    new Set(localCalls),
    new Set(["start", "file"])
  );
});

test("data-only linear dependencies can share one Gemini group", async () => {
  const calls = [];

  const engine = new RuntimeEngine({
    executor: {
      async run() {
        throw new Error(
          "unexpected local run"
        );
      },
      async runGroup(group) {
        calls.push(
          group.nodes.map(
            item => item.id
          )
        );

        return {
          results:
            group.nodes.map(
              item => ({
                nodeId:
                  item.id,
                outputs: {
                  result:
                    item.id
                },
                decision:
                  null,
                report:
                  item.id
              })
            )
        };
      }
    }
  });

  const graph = workflow(
    [
      node("research", "research"),
      node("organize", "organize")
    ],
    [
      edge(
        "data-edge",
        "research",
        "organize",
        { kind: "data" }
      )
    ]
  );

  await engine.run(
    graph,
    "research",
    { mode: "spread" }
  );

  assert.deepEqual(
    calls,
    [["research", "organize"]]
  );
});


test("local executor refuses Gemini-capable nodes", async () => {
  const executor =
    new LocalNodeExecutor();

  await assert.rejects(
    executor.run(
      node(
        "research",
        "research"
      )
    ),
    /server group/
  );
});


test("unchanged intermediate results are reused but param changes invalidate cache", async () => {
  const calls = [];

  const engine =
    new RuntimeEngine({
      executor: {
        async run() {
          throw new Error(
            "unexpected local run"
          );
        },
        async runGroup(
          group
        ) {
          const ids =
            group.nodes.map(
              item => item.id
            );

          calls.push(ids);

          return {
            results:
              group.nodes.map(
                item => ({
                  nodeId:
                    item.id,
                  outputs: {
                    result:
                      `${item.id}:${item.params.request}`
                  },
                  decision:
                    null,
                  report:
                    item.id
                })
              )
          };
        }
      }
    });

  const graph =
    workflow(
      [
        {
          id: "research",
          type: "research",
          data: {
            params: {
              request:
                "first"
            }
          }
        },
        {
          id: "write",
          type: "write",
          data: {
            params: {
              request:
                "write"
            }
          }
        }
      ],
      [
        edge(
          "rw",
          "research",
          "write"
        )
      ]
    );

  await engine.run(
    graph,
    "research",
    {
      mode: "spread",
      cacheContext: {
        conversationId: "one",
        userRequest: "same"
      }
    }
  );

  await engine.run(
    graph,
    "write",
    {
      mode: "target",
      cacheContext: {
        conversationId: "one",
        userRequest: "same"
      }
    }
  );

  assert.deepEqual(
    calls,
    [
      ["research", "write"],
      ["write"]
    ]
  );

  graph.nodes[0]
    .data.params.request =
    "changed";

  await engine.run(
    graph,
    "write",
    {
      mode: "target",
      cacheContext: {
        conversationId: "one",
        userRequest: "same"
      }
    }
  );

  assert.deepEqual(
    calls.at(-1),
    ["research", "write"]
  );
});

test("cancel aborts an active group run cleanly", async () => {
  let aborted = false;
  let markStarted = null;

  const started =
    new Promise(resolve => {
      markStarted = resolve;
    });

  const engine =
    new RuntimeEngine({
      executor: {
        async run() {
          return {
            outputs: {}
          };
        },
        async runGroup(
          group,
          context
        ) {
          markStarted?.();

          await new Promise(
            (resolve, reject) => {
              const timer =
                setTimeout(
                  resolve,
                  200
                );

              context.signal
                .addEventListener(
                  "abort",
                  () => {
                    clearTimeout(
                      timer
                    );

                    aborted =
                      true;

                    const error =
                      new Error(
                        "aborted"
                      );

                    error.code =
                      "REQUEST_ABORTED";

                    reject(error);
                  },
                  {
                    once: true
                  }
                );
            }
          );

          return {
            results:
              group.nodes.map(
                item => ({
                  nodeId:
                    item.id,
                  outputs: {
                    result:
                      item.id
                  },
                  decision:
                    null,
                  report:
                    item.id
                })
              )
          };
        }
      }
    });

  const graph =
    workflow(
      [
        node(
          "research",
          "research"
        )
      ],
      []
    );

  const pending =
    engine.run(
      graph,
      "research",
      {
        mode: "spread"
      }
    );

  await started;

  assert.equal(
    engine.cancel(),
    true
  );

  const result =
    await pending;

  assert.equal(
    aborted,
    true
  );
  assert.equal(
    result.status,
    "CANCELLED"
  );
  assert.equal(
    engine.isRunning(),
    false
  );
});


test("partial cache hits preserve maximal Gemini miss segments", async () => {
  const calls = [];

  const engine =
    new RuntimeEngine({
      executor: {
        async run() {
          throw new Error("unexpected local run");
        },
        async runGroup(group) {
          const ids =
            group.nodes.map(
              item => item.id
            );

          calls.push(ids);

          return {
            results:
              group.nodes.map(
                item => ({
                  nodeId: item.id,
                  outputs: {
                    result:
                      item.id
                  },
                  decision: null,
                  report:
                    item.id
                })
              )
          };
        }
      }
    });

  const ids = ["A", "B", "C", "D", "E"];
  const graph =
    workflow(
      ids.map(
        id => ({
          id,
          type: "organize",
          data: {
            params: {
              request:
                "organize " + id
            }
          }
        })
      ),
      ids.slice(0, -1)
        .map(
          (id, index) =>
            edge(
              "e-" + id,
              id,
              ids[index + 1]
            )
        )
    );

  await engine.run(
    graph,
    "A",
    {
      mode: "spread",
      cacheContext: {
        conversationId: "one",
        userRequest: "same",
        memory: {
          recent: "same"
        }
      }
    }
  );

  engine.clearResultCache("A");
  engine.clearResultCache("B");
  engine.clearResultCache("D");
  engine.clearResultCache("E");

  calls.length = 0;

  await engine.run(
    graph,
    "A",
    {
      mode: "spread",
      cacheContext: {
        conversationId: "one",
        userRequest: "same",
        memory: {
          recent: "same"
        }
      }
    }
  );

  assert.deepEqual(
    calls,
    [
      ["A", "B"],
      ["D", "E"]
    ]
  );
});

test("cache identity changes when continuity memory changes", async () => {
  const calls = [];

  const engine =
    new RuntimeEngine({
      executor: {
        async run() {
          throw new Error("unexpected local run");
        },
        async runGroup(group) {
          calls.push(
            group.nodes.map(
              item => item.id
            )
          );

          return {
            results:
              group.nodes.map(
                item => ({
                  nodeId: item.id,
                  outputs: {
                    result:
                      item.id
                  },
                  decision: null,
                  report:
                    item.id
                })
              )
          };
        }
      }
    });

  const graph =
    workflow(
      [
        {
          id: "research",
          type: "research",
          data: {
            params: {
              request: "research"
            }
          }
        },
        {
          id: "write",
          type: "write",
          data: {
            params: {
              request: "write"
            }
          }
        }
      ],
      [
        edge(
          "rw-memory",
          "research",
          "write"
        )
      ]
    );

  await engine.run(
    graph,
    "research",
    {
      mode: "spread",
      cacheContext: {
        conversationId: "one",
        userRequest: "continue",
        memory: {
          recent: "version one"
        }
      }
    }
  );

  calls.length = 0;

  await engine.run(
    graph,
    "write",
    {
      mode: "target",
      cacheContext: {
        conversationId: "one",
        userRequest: "continue",
        memory: {
          recent: "version two"
        }
      }
    }
  );

  assert.deepEqual(
    calls,
    [
      ["research", "write"]
    ]
  );
});


test("oversized subgroup failure is attributed to the subgroup that actually failed", async () => {
  const calls = [];

  const engine =
    new RuntimeEngine({
      maxGroupInputChars: 1000,
      measureGroupInputChars(
        group
      ) {
        return group.nodes.length * 600;
      },
      executor: {
        async run() {
          throw new Error(
            "unexpected local run"
          );
        },
        async runGroup(
          group
        ) {
          const ids =
            group.nodes.map(
              item => item.id
            );

          calls.push(ids);

          if (
            ids.includes("C")
          ) {
            throw new Error(
              "C failed"
            );
          }

          return {
            results:
              group.nodes.map(
                item => ({
                  nodeId:
                    item.id,
                  outputs: {
                    result:
                      item.id
                  },
                  decision:
                    null,
                  report:
                    item.id
                })
              )
          };
        }
      }
    });

  const graph =
    workflow(
      ["A", "B", "C"]
        .map(
          id => ({
            id,
            type: "organize",
            data: {
              params: {
                request:
                  "organize " + id
              }
            }
          })
        ),
      [
        edge("ab", "A", "B"),
        edge("bc", "B", "C")
      ]
    );

  const output =
    await engine.run(
      graph,
      "A",
      {
        mode: "spread"
      }
    );

  assert.deepEqual(
    calls,
    [
      ["A"],
      ["B"],
      ["C"]
    ]
  );
  assert.equal(
    output.nodes.A.status,
    "SUCCESS"
  );
  assert.equal(
    output.nodes.B.status,
    "SUCCESS"
  );
  assert.equal(
    output.nodes.C.status,
    "FAILED"
  );
});


test("execution gate auto-runs a small added research node even beside a large unrelated workflow", () => {
  const before = {
    nodes: [
      {
        id: "file",
        type: "file",
        params: {},
        file: {
          source: "upload",
          name: "source.txt",
          mime: "text/plain",
          size: 12
        }
      },
      {
        id: "old-a",
        type: "research",
        params: {
          request: "old a"
        }
      },
      {
        id: "old-b",
        type: "organize",
        params: {
          request: "old b"
        }
      },
      {
        id: "old-c",
        type: "write",
        params: {
          request: "old c"
        }
      }
    ],
    links: [
      ["old-a.result", "old-b.in"],
      ["old-b.result", "old-c.in"]
    ],
    data: []
  };

  const after = {
    nodes: [
      ...before.nodes,
      {
        id: "check",
        type: "research",
        params: {
          request:
            "자료에 해당 항목이 있는지 조사"
        }
      }
    ],
    links: [
      ...before.links,
      ["file.out", "check.in"]
    ],
    data: []
  };

  const runtime =
    workflow(
      [
        {
          id: "file",
          type: "file",
          data: {
            source: "upload",
            name: "source.txt",
            size: 12
          }
        },
        node(
          "old-a",
          "research"
        ),
        node(
          "old-b",
          "organize"
        ),
        node(
          "old-c",
          "write"
        ),
        node(
          "check",
          "research"
        )
      ],
      [
        edge(
          "old-a-old-b",
          "old-a",
          "old-b"
        ),
        edge(
          "old-b-old-c",
          "old-b",
          "old-c"
        ),
        edge(
          "file-check",
          "file",
          "check"
        )
      ]
    );

  const result =
    analyzeWorkflowExecutionDelta(
      before,
      after,
      runtime,
      "이 자료에 그 내용이 있는지 조사해봐"
    );

  assert.equal(
    result.mode,
    "auto"
  );
  assert.equal(
    result.pivot,
    "check"
  );
  assert.deepEqual(
    new Set(result.scope),
    new Set([
      "file",
      "check"
    ])
  );
});

test("execution gate keeps a heavier inherited chain manual", () => {
  const before = {
    nodes: [
      {
        id: "research",
        type: "research",
        params: {
          request: "기존 조사"
        }
      },
      {
        id: "organize",
        type: "organize",
        params: {
          request: "기존 정리"
        }
      },
      {
        id: "write",
        type: "write",
        params: {
          request: "기존 작성"
        }
      }
    ],
    links: [
      ["research.result", "organize.in"],
      ["organize.result", "write.in"]
    ],
    data: []
  };

  const after = {
    nodes: [
      ...before.nodes,
      {
        id: "check",
        type: "research",
        params: {
          request: "추가 검증"
        }
      }
    ],
    links: [
      ...before.links,
      ["write.result", "check.in"]
    ],
    data: []
  };

  const runtime =
    workflow(
      [
        node(
          "research",
          "research"
        ),
        node(
          "organize",
          "organize"
        ),
        node(
          "write",
          "write"
        ),
        node(
          "check",
          "research"
        )
      ],
      [
        edge(
          "research-organize",
          "research",
          "organize"
        ),
        edge(
          "organize-write",
          "organize",
          "write"
        ),
        edge(
          "write-check",
          "write",
          "check"
        )
      ]
    );

  const result =
    analyzeWorkflowExecutionDelta(
      before,
      after,
      runtime,
      "이 결과까지 다시 검증해봐"
    );

  assert.equal(
    result.mode,
    "manual"
  );
  assert.equal(
    result.pivot,
    "check"
  );
  assert.equal(
    result.score,
    10
  );
});

test("execution gate asks for confirmation when an existing node meaningfully changes", () => {
  const before = {
    nodes: [
      {
        id: "write",
        type: "write",
        params: {
          request: "짧게 작성"
        }
      }
    ],
    links: [],
    data: []
  };

  const after = {
    nodes: [
      {
        id: "write",
        type: "write",
        params: {
          request: "근거를 추가해서 다시 작성"
        }
      }
    ],
    links: [],
    data: []
  };

  const runtime =
    workflow(
      [
        node(
          "write",
          "write"
        )
      ],
      []
    );

  const result =
    analyzeWorkflowExecutionDelta(
      before,
      after,
      runtime,
      "근거를 추가해서 다시 작성해줘"
    );

  assert.equal(
    result.mode,
    "confirm"
  );
  assert.equal(
    result.pivot,
    "write"
  );
});

test("execution gate never auto-runs decision nodes or ambiguous multiple terminals", () => {
  const before = {
    nodes: [],
    links: [],
    data: []
  };

  const judgeAfter = {
    nodes: [
      {
        id: "judge",
        type: "judge",
        params: {
          request: "판단"
        }
      }
    ],
    links: [],
    data: []
  };

  const judgeRuntime =
    workflow(
      [
        node(
          "judge",
          "judge"
        )
      ],
      []
    );

  const judgeResult =
    analyzeWorkflowExecutionDelta(
      before,
      judgeAfter,
      judgeRuntime,
      "판단해봐"
    );

  assert.equal(
    judgeResult.mode,
    "manual"
  );

  const multiAfter = {
    nodes: [
      {
        id: "left",
        type: "research",
        params: {
          request: "왼쪽 조사"
        }
      },
      {
        id: "right",
        type: "research",
        params: {
          request: "오른쪽 조사"
        }
      }
    ],
    links: [],
    data: []
  };

  const multiRuntime =
    workflow(
      [
        node(
          "left",
          "research"
        ),
        node(
          "right",
          "research"
        )
      ],
      []
    );

  const multiResult =
    analyzeWorkflowExecutionDelta(
      before,
      multiAfter,
      multiRuntime,
      "둘 다 조사해봐"
    );

  assert.equal(
    multiResult.mode,
    "manual"
  );
  assert.equal(
    multiResult.reason,
    "ambiguous-terminal"
  );
});

test("execution gate respects configuration-only and explicit no-run requests", () => {
  const before = {
    nodes: [],
    links: [],
    data: []
  };

  const after = {
    nodes: [
      {
        id: "research",
        type: "research",
        params: {
          request: "조사"
        }
      }
    ],
    links: [],
    data: []
  };

  const runtime =
    workflow(
      [
        node(
          "research",
          "research"
        )
      ],
      []
    );

  const configOnly =
    analyzeWorkflowExecutionDelta(
      before,
      after,
      runtime,
      "검색 노드 하나 추가해줘"
    );

  assert.equal(
    configOnly.mode,
    "none"
  );
  assert.equal(
    configOnly.reason,
    "configuration-only"
  );

  const noRun =
    analyzeWorkflowExecutionDelta(
      before,
      after,
      runtime,
      "조사 노드는 추가하되 실행하지 마"
    );

  assert.equal(
    noRun.mode,
    "none"
  );
  assert.equal(
    noRun.reason,
    "user-disabled-execution"
  );
});


test("execution gate auto-runs a safe unchanged single-terminal workflow", () => {
  const ir = {
    nodes: [
      {
        id: "file",
        type: "file",
        params: {},
        file: {
          source: "upload",
          name: "source.txt",
          mime: "text/plain",
          size: 12
        }
      },
      {
        id: "research",
        type: "research",
        params: {
          request: "사실 여부 검증"
        }
      }
    ],
    links: [
      [
        "file.out",
        "research.in"
      ]
    ],
    data: []
  };

  const runtime =
    workflow(
      [
        {
          id: "file",
          type: "file",
          data: {
            source: "upload",
            name: "source.txt",
            size: 12
          }
        },
        node(
          "research",
          "research"
        )
      ],
      [
        edge(
          "file-research",
          "file",
          "research"
        )
      ]
    );

  const result =
    analyzeWorkflowExecutionDelta(
      ir,
      ir,
      runtime,
      "이거 검증해줘"
    );

  assert.equal(
    result.mode,
    "auto"
  );
  assert.equal(
    result.reason,
    "small-existing-scope"
  );
  assert.equal(
    result.pivot,
    "research"
  );
  assert.deepEqual(
    new Set(result.scope),
    new Set([
      "file",
      "research"
    ])
  );
});

test("execution gate keeps an unchanged ambiguous workflow manual", () => {
  const ir = {
    nodes: [
      {
        id: "left",
        type: "research",
        params: {
          request: "왼쪽 조사"
        }
      },
      {
        id: "right",
        type: "research",
        params: {
          request: "오른쪽 조사"
        }
      }
    ],
    links: [],
    data: []
  };

  const runtime =
    workflow(
      [
        node(
          "left",
          "research"
        ),
        node(
          "right",
          "research"
        )
      ],
      []
    );

  const result =
    analyzeWorkflowExecutionDelta(
      ir,
      ir,
      runtime,
      "검증해줘"
    );

  assert.equal(
    result.mode,
    "manual"
  );
  assert.equal(
    result.reason,
    "ambiguous-existing-terminal"
  );
});

test("execution gate does not run an unchanged workflow without execution intent", () => {
  const ir = {
    nodes: [
      {
        id: "research",
        type: "research",
        params: {
          request: "조사"
        }
      }
    ],
    links: [],
    data: []
  };

  const runtime =
    workflow(
      [
        node(
          "research",
          "research"
        )
      ],
      []
    );

  const result =
    analyzeWorkflowExecutionDelta(
      ir,
      ir,
      runtime,
      "이 노드 구성이 괜찮아?"
    );

  assert.equal(
    result.mode,
    "none"
  );
  assert.equal(
    result.reason,
    "no-execution-needed"
  );
});
