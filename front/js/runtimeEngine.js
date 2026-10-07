/* =========================================================
   ovll
   Workflow execution engine
   ========================================================= */
(function (global) {
  "use strict";

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function runtimeErrorState(
    error
  ) {
    return {
      message:
        error?.message ||
        String(error),
      code:
        typeof error?.code ===
          "string"
          ? error.code
          : "",
      status:
        Number.isFinite(
          Number(
            error?.status
          )
        )
          ? Number(
              error.status
            )
          : null,
      retryable:
        error?.retryable ===
          true
    };
  }

  function connectionKind(connection) {
    return connection?.data?.kind === "data"
      ? "data"
      : "flow";
  }

  function normalizeWorkflow(input) {
    if (!input || typeof input !== "object") {
      throw new TypeError("workflow가 필요합니다.");
    }

    const nodes = Array.isArray(input.nodes)
      ? input.nodes.map(node => clone(node))
      : [];

    const ids = new Set();

    for (const node of nodes) {
      if (!node || typeof node.id !== "string" || !node.id) {
        throw new Error("올바르지 않은 node가 있습니다.");
      }

      if (ids.has(node.id)) {
        throw new Error(`중복 node ID입니다: ${node.id}`);
      }

      ids.add(node.id);
    }

    const connections = Array.isArray(input.connections)
      ? input.connections
          .map(connection => clone(connection))
          .filter(connection =>
            connection &&
            ids.has(String(connection.from?.node || "")) &&
            ids.has(String(connection.to?.node || ""))
          )
      : [];

    const graph = new Map(
      nodes.map(node => [node.id, []])
    );

    for (const connection of connections) {
      graph.get(connection.from.node)?.push(connection.to.node);
    }

    const visiting = new Set();
    const visited = new Set();

    function visit(nodeId) {
      if (visiting.has(nodeId)) {
        throw new Error("실행 workflow에 cycle이 있습니다.");
      }

      if (visited.has(nodeId)) return;

      visiting.add(nodeId);

      for (const childId of graph.get(nodeId) || []) {
        visit(childId);
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
    }

    for (const node of nodes) {
      visit(node.id);
    }

    return {
      revision: input.revision ?? null,
      nodes,
      connections
    };
  }

  function inputValues(inputs) {
    return Object.values(inputs || {})
      .flatMap(value =>
        Array.isArray(value)
          ? value
          : [value]
      )
      .map(item => item?.value)
      .filter(value => value !== undefined);
  }

  const EXECUTION_CACHE_POLICY_VERSION =
    "execution-quality-v1";

  const GEMINI_NODE_TYPES =
    new Set([
      "research",
      "organize",
      "judge",
      "write",
      "convert"
    ]);

  function isGeminiNode(node) {
    return (
      !!node &&
      GEMINI_NODE_TYPES.has(
        String(node.type || "")
      )
    );
  }

  function nodeParams(node) {
    if (
      node?.data?.params &&
      typeof node.data.params === "object" &&
      !Array.isArray(node.data.params)
    ) {
      return clone(node.data.params);
    }

    if (
      node?.params &&
      typeof node.params === "object" &&
      !Array.isArray(node.params)
    ) {
      return clone(node.params);
    }

    return {};
  }

  const CONTENT_REQUIRED_NODE_TYPES =
    new Set([
      "research",
      "organize",
      "judge",
      "write",
      "convert",
      "createFile"
    ]);

  function hasMeaningfulValue(value) {
    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    if (Array.isArray(value)) {
      return value.some(
        item =>
          hasMeaningfulValue(item)
      );
    }

    if (
      value &&
      typeof value === "object"
    ) {
      return Object.values(value)
        .some(
          item =>
            hasMeaningfulValue(item)
        );
    }

    return (
      value !== undefined &&
      value !== null &&
      value !== false
    );
  }

  function isNodeReadyForExecution(
    node,
    options = {}
  ) {
    if (
      !node ||
      typeof node !== "object"
    ) {
      return false;
    }

    const type =
      String(node.type || "");

    if (type === "start") {
      return true;
    }

    if (type === "file") {
      return !!(
        node.data?.generated ||
        node.data?.source === "upload" ||
        node.data?.fileId ||
        (
          typeof node.data?.name ===
            "string" &&
          node.data.name.trim() &&
          (
            Number(node.data?.size || 0) >
              0 ||
            typeof node.data?.textPreview ===
              "string"
          )
        )
      );
    }

    if (
      !CONTENT_REQUIRED_NODE_TYPES
        .has(type)
    ) {
      return true;
    }

    const hasParams =
      Object.values(
        nodeParams(node)
      ).some(
        value =>
          hasMeaningfulValue(value)
      );

    if (hasParams) {
      return true;
    }

    const userRequest =
      String(
        options.userRequest ||
        ""
      ).trim();

    if (
      userRequest &&
      (
        GEMINI_NODE_TYPES.has(
          type
        ) ||
        type === "createFile"
      )
    ) {
      return true;
    }

    return options.hasIncoming ===
      true;
  }

  function findUnreadyNodes(
    workflow,
    scope,
    options = {}
  ) {
    const ids =
      new Set(
        Array.isArray(scope)
          ? scope.map(String)
          : []
      );

    const incoming =
      new Set();

    for (
      const connection of
        Array.isArray(
          workflow?.connections
        )
          ? workflow.connections
          : []
    ) {
      const to =
        String(
          connection?.to?.node ||
          ""
        );

      if (
        to &&
        ids.has(to)
      ) {
        incoming.add(to);
      }
    }

    return workflow.nodes
      .filter(
        node =>
          ids.has(node.id) &&
          !isNodeReadyForExecution(
            node,
            {
              userRequest:
                options.userRequest,
              hasIncoming:
                incoming.has(
                  node.id
                )
            }
          )
      )
      .map(
        node => ({
          id: node.id,
          type: node.type
        })
      );
  }

  function validateExecutionReadiness(
    inputWorkflow,
    pivotId,
    options = {}
  ) {
    const workflow =
      normalizeWorkflow(
        inputWorkflow
      );

    const pivot =
      String(pivotId || "");

    const mode =
      options.mode === "target"
        ? "target"
        : "spread";

    const plan =
      planExecutionGroups(
        workflow,
        pivot,
        mode,
        options.maxGroupNodes ?? 6
      );

    const emptyNodes =
      findUnreadyNodes(
        workflow,
        plan.scope,
        {
          userRequest:
            options.userRequest
        }
      );

    return {
      ok:
        emptyNodes.length === 0,
      emptyNodes,
      scope:
        [...plan.scope]
    };
  }

  const AUTO_EXECUTION_NODE_COST =
    Object.freeze({
      start: 0,
      file: 0,
      convert: 1,
      organize: 2,
      write: 2,
      createFile: 2,
      research: 3,
      judge: 5
    });

  function irNodeParams(
    node
  ) {
    if (
      node?.params &&
      typeof node.params ===
        "object" &&
      !Array.isArray(
        node.params
      )
    ) {
      return node.params;
    }

    if (
      node?.data?.params &&
      typeof node.data.params ===
        "object" &&
      !Array.isArray(
        node.data.params
      )
    ) {
      return node.data.params;
    }

    return {};
  }

  function stableExecutionValue(
    value
  ) {
    if (
      value === null ||
      typeof value ===
        "string" ||
      typeof value ===
        "number" ||
      typeof value ===
        "boolean"
    ) {
      return value;
    }

    if (
      Array.isArray(value)
    ) {
      return value.map(
        stableExecutionValue
      );
    }

    if (
      value &&
      typeof value ===
        "object"
    ) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .filter(
            key =>
              value[key] !==
                undefined
          )
          .map(
            key => [
              key,
              stableExecutionValue(
                value[key]
              )
            ]
          )
      );
    }

    return String(
      value ?? ""
    );
  }

  function executionNodeSignature(
    node
  ) {
    const type =
      String(
        node?.type ||
        ""
      );

    const file =
      type === "file"
        ? (
            node?.file &&
            typeof node.file ===
              "object"
              ? node.file
              : {
                  source:
                    node?.data
                      ?.generated
                      ? "generated"
                      : node?.data
                          ?.source ||
                        "",
                  name:
                    node?.data?.name ||
                    "",
                  mime:
                    node?.data?.mime ||
                    "",
                  size:
                    Number(
                      node?.data?.size ||
                      0
                    ),
                  lastModified:
                    Number(
                      node?.data
                        ?.lastModified ||
                      0
                    ),
                  textPreview:
                    node?.data
                      ?.textPreview ||
                    ""
                }
          )
        : null;

    return JSON.stringify(
      stableExecutionValue({
        type,
        params:
          irNodeParams(
            node
          ),
        file
      })
    );
  }

  function executionIrEdges(
    workflow
  ) {
    if (
      Array.isArray(
        workflow?.connections
      )
    ) {
      return workflow
        .connections
        .map(
          connection => ({
            kind:
              connection?.data
                ?.kind === "data"
                ? "data"
                : "flow",
            from:
              String(
                connection?.from
                  ?.node ||
                ""
              ),
            to:
              String(
                connection?.to
                  ?.node ||
                ""
              )
          })
        )
        .filter(
          edge =>
            edge.from &&
            edge.to
        );
    }

    const result = [];

    for (
      const [
        kind,
        edges
      ] of [
        [
          "flow",
          workflow?.links
        ],
        [
          "data",
          workflow?.data
        ]
      ]
    ) {
      for (
        const edge of
          Array.isArray(edges)
            ? edges
            : []
      ) {
        if (
          !Array.isArray(edge) ||
          edge.length !== 2
        ) {
          continue;
        }

        const from =
          String(
            edge[0] ||
            ""
          ).split(".")[0];

        const to =
          String(
            edge[1] ||
            ""
          ).split(".")[0];

        if (
          from &&
          to
        ) {
          result.push({
            kind,
            from,
            to
          });
        }
      }
    }

    return result;
  }

  function executionEdgeKey(
    edge
  ) {
    return [
      edge.kind,
      edge.from,
      edge.to
    ].join(":");
  }

  function userExecutionIntent(
    value
  ) {
    const text =
      String(value || "")
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (!text) {
      return {
        expectsResult: false,
        explicitNoRun: false
      };
    }

    const explicitNoRun =
      /(?:실행|돌리|run|execute).{0,16}(?:하지\s*마|말고|안\s*해|no|not)|(?:추가|구성|연결|수정|변경|만들기)\s*만|without\s+(?:running|executing)|do\s+not\s+(?:run|execute)|don't\s+(?:run|execute)/i
        .test(text);

    const expectsResult =
      /(?:조사|검색|찾|확인|검사|검증|분석|요약|정리|작성|써\s*줘|변환|번역|비교|평가|판단|계산|추출|뽑|보고서|답해|알려|보여|준비|완성|해결|실행|돌려)\s*(?:해|하|해서|해봐|해줘|줘|봐|라|주세요)?|(?:pdf|docx|xlsx|pptx|파일).{0,18}(?:만들|생성|변환|내보내)|(?:research|search|find|check|verify|analy[sz]e|summari[sz]e|write|convert|translate|compare|evaluate|calculate|extract|generate|create|prepare|complete|solve|produce|run|execute)\b/i
        .test(text);

    const structuralEdit =
      /(?:노드|node|캔버스|canvas|워크플로우|workflow).{0,28}(?:추가|삭제|연결|수정|변경|바꿔|add|delete|remove|connect|modify|change)|(?:추가|삭제|연결|수정|변경|바꿔|add|delete|remove|connect|modify|change).{0,28}(?:노드|node|캔버스|canvas|워크플로우|workflow)/i
        .test(text);

    const directTask =
      /(?:조사해|검색해|찾아|확인해|검사해|검증해|분석해|요약해|정리해|작성해|써\s*줘|변환해|번역해|비교해|평가해|판단해|계산해|추출해|뽑아|준비해|완성해|해결해|보고서.{0,12}만들|알려\s*줘|보여\s*줘|실행해|돌려)|(?:research|search|find|check|verify|analy[sz]e|summari[sz]e|write|convert|translate|compare|evaluate|calculate|extract|generate|create|prepare|complete|solve|run|execute)\s+(?:it|this|that|the|my|these|those)/i
        .test(text);

    return {
      expectsResult:
        !explicitNoRun &&
        expectsResult &&
        (
          !structuralEdit ||
          directTask
        ),
      explicitNoRun
    };
  }

  function analyzeWorkflowExecutionDelta(
    beforeWorkflow,
    afterWorkflow,
    runtimeWorkflow,
    userText
  ) {
    const beforeNodes =
      new Map(
        (
          Array.isArray(
            beforeWorkflow
              ?.nodes
          )
            ? beforeWorkflow
                .nodes
            : []
        ).map(
          node => [
            String(
              node?.id ||
              ""
            ),
            node
          ]
        )
      );

    const afterNodes =
      new Map(
        (
          Array.isArray(
            afterWorkflow
              ?.nodes
          )
            ? afterWorkflow
                .nodes
            : []
        ).map(
          node => [
            String(
              node?.id ||
              ""
            ),
            node
          ]
        )
      );

    const added = [];
    const removed = [];
    const modified = [];

    for (
      const [
        id,
        node
      ] of afterNodes
    ) {
      if (!id) {
        continue;
      }

      const previous =
        beforeNodes.get(id);

      if (!previous) {
        added.push(id);
        continue;
      }

      if (
        executionNodeSignature(
          previous
        ) !==
        executionNodeSignature(
          node
        )
      ) {
        modified.push(id);
      }
    }

    for (
      const id of
        beforeNodes.keys()
    ) {
      if (
        id &&
        !afterNodes.has(id)
      ) {
        removed.push(id);
      }
    }

    const beforeEdges =
      new Map(
        executionIrEdges(
          beforeWorkflow
        ).map(
          edge => [
            executionEdgeKey(
              edge
            ),
            edge
          ]
        )
      );

    const afterEdges =
      new Map(
        executionIrEdges(
          afterWorkflow
        ).map(
          edge => [
            executionEdgeKey(
              edge
            ),
            edge
          ]
        )
      );

    const addedEdges =
      [...afterEdges]
        .filter(
          ([key]) =>
            !beforeEdges.has(
              key
            )
        )
        .map(
          ([, edge]) =>
            edge
        );

    const removedEdges =
      [...beforeEdges]
        .filter(
          ([key]) =>
            !afterEdges.has(
              key
            )
        )
        .map(
          ([, edge]) =>
            edge
        );

    const changedIds =
      new Set([
        ...added,
        ...modified
      ]);

    const deltaOutgoing =
      new Map(
        [...changedIds].map(
          id => [
            id,
            0
          ]
        )
      );

    for (
      const edge of
        afterEdges.values()
    ) {
      if (
        changedIds.has(
          edge.from
        ) &&
        changedIds.has(
          edge.to
        )
      ) {
        deltaOutgoing.set(
          edge.from,
          (
            deltaOutgoing.get(
              edge.from
            ) ||
            0
          ) + 1
        );
      }
    }

    let terminals =
      [...changedIds]
        .filter(
          id => {
            const node =
              afterNodes.get(id);

            return (
              node &&
              ![
                "start",
                "file"
              ].includes(
                String(
                  node.type ||
                  ""
                )
              ) &&
              (
                deltaOutgoing.get(
                  id
                ) ||
                0
              ) === 0
            );
          }
        );

    const intent =
      userExecutionIntent(
        userText
      );

    const base = {
      mode: "none",
      reason:
        "no-execution-needed",
      pivot: "",
      score: 0,
      scope: [],
      delta: {
        added,
        modified,
        removed,
        addedEdges:
          addedEdges.length,
        removedEdges:
          removedEdges.length,
        terminals
      }
    };

    const unchanged =
      !added.length &&
      !modified.length &&
      !removed.length &&
      !addedEdges.length &&
      !removedEdges.length;

    if (
      intent.explicitNoRun ||
      !intent.expectsResult
    ) {
      if (unchanged) {
        return {
          ...base,
          reason:
            intent.explicitNoRun
              ? "user-disabled-execution"
              : "no-execution-needed"
        };
      }

      return {
        ...base,
        reason:
          intent.explicitNoRun
            ? "user-disabled-execution"
            : "configuration-only"
      };
    }

    if (unchanged) {
      const outgoing =
        new Map(
          [...afterNodes.keys()]
            .map(
              id => [
                id,
                0
              ]
            )
        );

      for (
        const edge of
          afterEdges.values()
      ) {
        if (
          outgoing.has(
            edge.from
          )
        ) {
          outgoing.set(
            edge.from,
            (
              outgoing.get(
                edge.from
              ) ||
              0
            ) + 1
          );
        }
      }

      terminals =
        [...afterNodes]
          .filter(
            ([id, node]) =>
              id &&
              node &&
              ![
                "start",
                "file"
              ].includes(
                String(
                  node.type ||
                  ""
                )
              ) &&
              (
                outgoing.get(id) ||
                0
              ) === 0
          )
          .map(
            ([id]) =>
              id
          );

      base.delta.terminals =
        terminals;

      if (
        terminals.length !== 1
      ) {
        return {
          ...base,
          mode: "manual",
          reason:
            terminals.length
              ? "ambiguous-existing-terminal"
              : "no-executable-terminal"
        };
      }
    }

    if (
      removed.length ||
      terminals.length !== 1
    ) {
      return {
        ...base,
        mode: "manual",
        reason:
          removed.length
            ? "destructive-delta"
            : "ambiguous-terminal"
      };
    }

    const pivot =
      terminals[0];

    let readiness;

    try {
      readiness =
        validateExecutionReadiness(
          runtimeWorkflow,
          pivot,
          {
            mode: "target",
            userRequest:
              userText
          }
        );
    } catch {
      readiness = {
        ok: false,
        scope: [],
        emptyNodes: []
      };
    }

    if (!readiness.ok) {
      return {
        ...base,
        mode: "manual",
        reason:
          "not-ready",
        pivot,
        scope:
          readiness.scope ||
          []
      };
    }

    const runtimeNodes =
      new Map(
        (
          Array.isArray(
            runtimeWorkflow
              ?.nodes
          )
            ? runtimeWorkflow
                .nodes
            : []
        ).map(
          node => [
            String(
              node?.id ||
              ""
            ),
            node
          ]
        )
      );

    const oldIds =
      new Set(
        beforeNodes.keys()
      );

    let score = 0;
    let activeNodes = 0;
    let inheritedActiveNodes = 0;
    let hasJudge = false;

    for (
      const id of
        readiness.scope ||
        []
    ) {
      const type =
        String(
          runtimeNodes
            .get(id)
            ?.type ||
          ""
        );

      const cost =
        AUTO_EXECUTION_NODE_COST[
          type
        ] ?? 3;

      score += cost;

      if (cost > 0) {
        activeNodes++;

        if (
          !unchanged &&
          oldIds.has(id) &&
          !changedIds.has(id)
        ) {
          inheritedActiveNodes++;
        }
      }

      if (
        type === "judge"
      ) {
        hasJudge = true;
      }
    }

    const scopeSet =
      new Set(
        readiness.scope ||
        []
      );

    const degree =
      new Map(
        [...scopeSet].map(
          id => [
            id,
            {
              incoming: 0,
              outgoing: 0
            }
          ]
        )
      );

    for (
      const connection of
        Array.isArray(
          runtimeWorkflow
            ?.connections
        )
          ? runtimeWorkflow
              .connections
          : []
    ) {
      const from =
        String(
          connection?.from
            ?.node ||
          ""
        );

      const to =
        String(
          connection?.to
            ?.node ||
          ""
        );

      if (
        !scopeSet.has(from) ||
        !scopeSet.has(to)
      ) {
        continue;
      }

      degree.get(from)
        .outgoing++;
      degree.get(to)
        .incoming++;
    }

    const hasBranch =
      [...degree.values()]
        .some(
          item =>
            item.incoming > 1 ||
            item.outgoing > 1
        );

    const rewiresExisting =
      removedEdges.length > 0 ||
      addedEdges.some(
        edge =>
          oldIds.has(
            edge.from
          ) &&
          oldIds.has(
            edge.to
          )
      );

    const touchesExisting =
      modified.length > 0 ||
      rewiresExisting;

    const details = {
      ...base,
      pivot,
      score,
      scope:
        readiness.scope ||
        []
    };

    if (
      hasJudge ||
      inheritedActiveNodes > 0
    ) {
      return {
        ...details,
        mode: "manual",
        reason:
          hasJudge
            ? "decision-node"
            : "inherited-scope"
      };
    }

    if (
      score > 14 ||
      activeNodes > 7
    ) {
      return {
        ...details,
        mode: "manual",
        reason:
          "heavy-scope"
      };
    }

    if (
      !touchesExisting &&
      score <= 10 &&
      activeNodes <= 5
    ) {
      return {
        ...details,
        mode: "auto",
        reason:
          unchanged
            ? "small-existing-scope"
            : hasBranch
              ? "safe-branched-delta"
              : "small-isolated-delta"
      };
    }

    return {
      ...details,
      mode: "confirm",
      reason:
        touchesExisting
          ? "existing-workflow-touched"
          : hasBranch
            ? "branched-scope"
            : "moderate-scope"
    };
  }

  function stableCacheValue(value) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(
        item =>
          stableCacheValue(item)
      );
    }

    if (
      value &&
      typeof value === "object"
    ) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .filter(
            key =>
              value[key] !==
              undefined
          )
          .map(
            key => [
              key,
              stableCacheValue(
                value[key]
              )
            ]
          )
      );
    }

    return String(value ?? "");
  }

  function executionFingerprint(
    node,
    inputs,
    cacheContext
  ) {
    const type =
      String(node?.type || "");

    const nodeData =
      type === "file"
        ? clone(node?.data || {})
        : {
            params:
              nodeParams(node)
          };

    return JSON.stringify(
      stableCacheValue({
        type,
        nodeData,
        inputs:
          inputs || {},
        context:
          cacheContext || null,
        policy:
          EXECUTION_CACHE_POLICY_VERSION
      })
    );
  }

  function isRuntimeAbort(error) {
    return !!(
      error?.code ===
        "REQUEST_ABORTED" ||
      error?.code ===
        "RUN_CANCELLED" ||
      error?.name ===
        "AbortError"
    );
  }

  function runtimeAbortError() {
    const error =
      new Error(
        "실행이 중단되었습니다."
      );

    error.code =
      "RUN_CANCELLED";
    error.status =
      499;
    error.retryable =
      false;

    return error;
  }

  function planExecutionGroups(
    workflow,
    pivotId,
    mode = "spread",
    maxGroupNodes = 6
  ) {
    const nodes =
      new Map(
        workflow.nodes.map(
          node => [node.id, node]
        )
      );

    const incoming =
      new Map(
        workflow.nodes.map(
          node => [node.id, []]
        )
      );

    const outgoing =
      new Map(
        workflow.nodes.map(
          node => [node.id, []]
        )
      );

    for (
      const connection
        of workflow.connections
    ) {
      incoming
        .get(connection.to.node)
        ?.push(connection);

      outgoing
        .get(connection.from.node)
        ?.push(connection);
    }

    const pivot =
      String(pivotId || "");

    const scope =
      new Set();

    if (mode === "target") {
      const queue = [pivot];

      while (queue.length) {
        const current =
          queue.shift();

        if (
          !current ||
          scope.has(current)
        ) {
          continue;
        }

        scope.add(current);

        for (
          const connection
            of incoming.get(current) || []
        ) {
          queue.push(
            connection.from.node
          );
        }
      }
    } else {
      const queue = [pivot];

      while (queue.length) {
        const current =
          queue.shift();

        if (
          !current ||
          scope.has(current)
        ) {
          continue;
        }

        scope.add(current);

        for (
          const connection
            of incoming.get(current) || []
        ) {
          queue.push(
            connection.from.node
          );
        }

        for (
          const connection
            of outgoing.get(current) || []
        ) {
          queue.push(
            connection.to.node
          );
        }
      }
    }

    const scopedIncoming =
      new Map();

    const scopedOutgoing =
      new Map();

    for (const nodeId of scope) {
      scopedIncoming.set(
        nodeId,
        (incoming.get(nodeId) || [])
          .filter(connection =>
            scope.has(
              connection.from.node
            )
          )
      );

      scopedOutgoing.set(
        nodeId,
        (outgoing.get(nodeId) || [])
          .filter(connection =>
            scope.has(
              connection.to.node
            )
          )
      );
    }

    const indegree =
      new Map(
        [...scope].map(
          nodeId => [
            nodeId,
            (
              scopedIncoming.get(nodeId) ||
              []
            ).length
          ]
        )
      );

    const queue =
      workflow.nodes
        .map(node => node.id)
        .filter(nodeId =>
          scope.has(nodeId) &&
          indegree.get(nodeId) === 0
        );

    const topological = [];

    while (queue.length) {
      const current =
        queue.shift();

      topological.push(current);

      for (
        const connection
          of scopedOutgoing.get(current) ||
          []
      ) {
        const next =
          connection.to.node;

        const count =
          (indegree.get(next) || 0) - 1;

        indegree.set(
          next,
          count
        );

        if (count === 0) {
          queue.push(next);
        }
      }
    }

    for (
      const node
        of workflow.nodes
    ) {
      if (
        scope.has(node.id) &&
        !topological.includes(node.id)
      ) {
        topological.push(node.id);
      }
    }

    const groups = [];
    const assigned =
      new Set();
    const limit =
      Math.max(
        1,
        Number(maxGroupNodes) || 6
      );

    for (
      const startId
        of topological
    ) {
      if (assigned.has(startId)) {
        continue;
      }

      const startNode =
        nodes.get(startId);

      if (!isGeminiNode(startNode)) {
        continue;
      }

      const nodeIds =
        [startId];

      assigned.add(startId);

      if (startNode.type !== "judge") {
        let current =
          startId;

        while (
          nodeIds.length < limit
        ) {
          const outEdges =
            scopedOutgoing.get(current) ||
            [];

          if (outEdges.length !== 1) {
            break;
          }

          const next =
            outEdges[0].to.node;

          const inEdges =
            scopedIncoming.get(next) ||
            [];

          const currentNode =
            nodes.get(current);

          const nextNode =
            nodes.get(next);

          if (
            inEdges.length !== 1 ||
            assigned.has(next) ||
            !isGeminiNode(nextNode) ||
            currentNode?.type === "judge" ||
            nextNode?.type === "judge"
          ) {
            break;
          }

          nodeIds.push(next);
          assigned.add(next);
          current = next;
        }
      }

      groups.push({
        id:
          `gemini:${nodeIds.join(">")}`,
        nodeIds
      });
    }

    return {
      scope:
        topological,
      groups
    };
  }

  function resolveNaturalFileRequest(
    params
  ) {
    const source =
      params &&
      typeof params === "object"
        ? params
        : {};

    const request =
      String(
        source.request ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200);

    const formats = [
      ["PDF", /(?:\.pdf\b|\bpdf\b)/i],
      ["DOCX", /(?:\.docx\b|\bdocx\b|\bword\b|워드)/i],
      ["XLSX", /(?:\.xlsx\b|\bxlsx\b|\bexcel\b|엑셀)/i],
      ["CSV", /(?:\.csv\b|\bcsv\b)/i],
      ["JSON", /(?:\.json\b|\bjson\b)/i],
      ["HTML", /(?:\.html?\b|\bhtml\b)/i],
      ["RTF", /(?:\.rtf\b|\brtf\b)/i],
      ["MD", /(?:\.md\b|\bmarkdown\b|마크다운)/i],
      ["TXT", /(?:\.txt\b|\btxt\b|텍스트 파일)/i]
    ];

    let format =
      String(
        source.format ||
        ""
      )
        .trim()
        .toUpperCase();

    if (request) {
      const match =
        formats.find(
          ([, pattern]) =>
            pattern.test(
              request
            )
        );

      if (match) {
        format = match[0];
      }
    }

    if (
      !formats.some(
        ([value]) =>
          value === format
      )
    ) {
      format = "PDF";
    }

    let filename =
      String(
        source.filename ||
        ""
      ).trim();

    const namedFile =
      request.match(
        /([^\n"'“”\\/]{1,80})\.(pdf|docx|xlsx|csv|txt|md|json|html?|rtf)\b/i
      );

    if (namedFile) {
      filename =
        namedFile[1]
          .replace(
            /^(?:파일명|이름)\s*(?:은|는|:)?\s*/i,
            ""
          )
          .trim();

      const ext =
        namedFile[2]
          .toUpperCase();

      format =
        ext === "HTM"
          ? "HTML"
          : ext;
    }

    filename =
      (filename || "결과물")
        .replace(
          /\.(pdf|docx|xlsx|csv|txt|md|json|html?|rtf)$/i,
          ""
        )
        .replace(
          /[\\/:*?"<>|\u0000-\u001f]/g,
          "_"
        )
        .trim()
        .slice(0, 100) ||
      "결과물";

    return {
      filename,
      format
    };
  }

  class LocalNodeExecutor {
    async run(
      node,
      inputs = {},
      context = {}
    ) {
      if (
        !node ||
        typeof node !== "object"
      ) {
        throw new TypeError(
          "실행할 node가 없습니다."
        );
      }

      const params =
        nodeParams(node);

      const values =
        inputValues(inputs);

      switch (node.type) {
        case "start":
          return {
            outputs: {
              out: true
            },
            report: {
              title:
                "시작 준비 완료"
            }
          };

        case "file": {
          const file = {
            kind:
              "workflow-file",
            source:
              node.data?.generated
                ? "generated"
                : "upload",
            id:
              String(
                node.data?.fileId ||
                node.data?.id ||
                `file:${node.id}`
              ),
            name:
              node.data?.name ||
              params.name ||
              "파일",
            mime:
              node.data?.mime ||
              params.mime ||
              "application/octet-stream",
            size:
              Number(
                node.data?.size ||
                0
              ),
            lastModified:
              Number(
                node.data?.lastModified ||
                0
              )
          };

          if (
            typeof node.data?.textPreview ===
              "string" &&
            node.data.textPreview
          ) {
            file.text =
              node.data.textPreview;
            file.textTruncated =
              node.data?.textTruncated ===
                true;
          }

          return {
            outputs: {
              file
            },
            report: {
              title:
                `${file.name} 준비 완료`
            }
          };
        }

        case "createFile": {
          const {
            filename,
            format
          } =
            resolveNaturalFileRequest(
              params
            );

          return {
            outputs: {},
            artifact: {
              kind:
                "workflow-artifact",
              id:
                `artifact:${context.runId}:${node.id}`,
              name:
                `${filename}.${String(format).toLowerCase()}`,
              format,
              sources:
                clone(values)
            },
            report: {
              title:
                `${filename} 생성 준비 완료`
            }
          };
        }

        default:
          throw new Error(
            `node type requires server group execution: ${node.type}`
          );
      }
    }
  }

  class RuntimeEngine {
    constructor(options = {}) {
      this.executor =
        options.executor &&
        typeof options.executor.run === "function"
          ? options.executor
          : new LocalNodeExecutor();

      this.onEvent =
        typeof options.onEvent === "function"
          ? options.onEvent
          : null;

      this.running = false;
      this.runCounter = 0;
      this.lastRun = null;
      this.resultCache =
        new Map();
      this.abortController =
        null;
      this.activeRunId =
        null;
      this.cancelRequested =
        false;

      this.maxGroupNodes =
        Math.max(
          1,
          Number(
            options.maxGroupNodes ??
            6
          ) || 6
        );

      this.maxGroupInputChars =
        Math.max(
          1000,
          Number(
            options.maxGroupInputChars ??
            42000
          ) || 42000
        );

      this.measureGroupInputChars =
        typeof options
          .measureGroupInputChars ===
            "function"
          ? options
              .measureGroupInputChars
          : null;
    }

    isRunning() {
      return this.running;
    }

    cancel() {
      if (!this.running) {
        return false;
      }

      this.cancelRequested =
        true;

      try {
        this.abortController
          ?.abort();
      } catch {}

      this.emit(
        "run:cancel-requested",
        {
          runId:
            this.activeRunId
        }
      );

      return true;
    }

    clearResultCache(
      nodeId = null
    ) {
      if (
        nodeId === null ||
        nodeId === undefined ||
        nodeId === ""
      ) {
        this.resultCache.clear();
        return;
      }

      this.resultCache.delete(
        String(nodeId)
      );
    }

    emit(type, payload = {}) {
      const event = {
        type,
        at: Date.now(),
        ...clone(payload)
      };

      try {
        this.onEvent?.(event);
      } catch (error) {
        console.error(
          "ovll runtime event subscriber error:",
          error
        );
      }

      return event;
    }

    async run(inputWorkflow, pivotId, options = {}) {
      if (this.running) {
        throw new Error(
          "이미 run이 실행 중입니다."
        );
      }

      const workflow =
        normalizeWorkflow(inputWorkflow);

      const pivot =
        String(pivotId || "");

      const mode =
        options.mode === "target"
          ? "target"
          : "spread";

      const cacheContext =
        options.cacheContext ||
        null;

      const nodes =
        new Map(
          workflow.nodes.map(
            node => [node.id, node]
          )
        );

      if (!nodes.has(pivot)) {
        throw new Error(
          `실행 기준 node가 없습니다: ${pivot}`
        );
      }

      const incoming =
        new Map(
          workflow.nodes.map(
            node => [node.id, []]
          )
        );

      const outgoing =
        new Map(
          workflow.nodes.map(
            node => [node.id, []]
          )
        );

      for (const connection of workflow.connections) {
        incoming
          .get(connection.to.node)
          ?.push(connection);

        outgoing
          .get(connection.from.node)
          ?.push(connection);
      }


      const executionPlan =
        planExecutionGroups(
          workflow,
          pivot,
          mode,
          this.maxGroupNodes
        );

      const executionScope =
        new Set(
          executionPlan.scope
        );

        const emptyNodes =
        findUnreadyNodes(
          workflow,
          executionPlan.scope,
          {
            userRequest:
              cacheContext
                ?.userRequest
          }
        );

      if (emptyNodes.length) {
        const first =
          emptyNodes[0];

        const error =
          new Error(
            "실행할 내용이 비어 있는 노드가 있습니다."
          );

        error.code =
          "NODE_INPUT_EMPTY";
        error.nodeId =
          first.id;
        error.nodeType =
          first.type;
        error.emptyNodes =
          emptyNodes;

        throw error;
      }

      const groupByNode =
        new Map();

      for (
        const group
          of executionPlan.groups
      ) {
        for (
          const nodeId
            of group.nodeIds
        ) {
          groupByNode.set(
            nodeId,
            group
          );
        }
      }

      const runId =
        `demo-run-${Date.now().toString(36)}-${++this.runCounter}`;

      this.cancelRequested =
        false;
      this.abortController =
        new AbortController();
      this.activeRunId =
        runId;

      const signal =
        this.abortController
          .signal;

      const throwIfCancelled =
        () => {
          if (
            signal.aborted ||
            this.cancelRequested
          ) {
            throw runtimeAbortError();
          }
        };

      this.resultCache.delete(
        pivot
      );

      const states =
        new Map(
          workflow.nodes.map(
            node => [
              node.id,
              {
                id: node.id,
                type: node.type,
                status: "IDLE",
                inputs: {},
                result: null,
                error: null,
                startedAt: null,
                finishedAt: null
              }
            ]
          )
        );

      const nodeJobs = new Map();
      const groupJobs = new Map();
      const edgeRefs = new Map();

      const setState = (
        nodeId,
        status,
        extra = {}
      ) => {
        const state =
          states.get(nodeId);

        if (!state) return;

        Object.assign(
          state,
          extra,
          { status }
        );

        this.emit(
          "node:state",
          {
            runId,
            nodeId,
            status,
            state:
              clone(state),
            report:
              extra.report ||
              extra.result?.report ||
              null
          }
        );
      };

      const acquireEdge =
        connection => {
          const id =
            String(connection?.id || "");

          if (!id) {
            return () => {};
          }

          const count =
            edgeRefs.get(id) || 0;

          edgeRefs.set(
            id,
            count + 1
          );

          if (count === 0) {
            this.emit(
              "edge:state",
              {
                runId,
                edgeId: id,
                active: true
              }
            );
          }

          let released = false;

          return () => {
            if (released) return;
            released = true;

            const next =
              Math.max(
                0,
                (edgeRefs.get(id) || 1) - 1
              );

            if (next === 0) {
              edgeRefs.delete(id);

              this.emit(
                "edge:state",
                {
                  runId,
                  edgeId: id,
                  active: false
                }
              );
            } else {
              edgeRefs.set(id, next);
            }
          };
        };

      const edgeIsActive =
        connection => {
          const sourceState =
            states.get(connection.from.node);

          if (
            sourceState?.status ===
            "SKIPPED"
          ) {
            return false;
          }

          const sourceNode =
            nodes.get(connection.from.node);

          if (sourceNode?.type !== "judge") {
            return (
              sourceState?.status ===
              "SUCCESS"
            );
          }

          const decision =
            sourceState?.result?.decision;

          if (typeof decision !== "boolean") {
            return false;
          }

          if (connection.from.port === "true") {
            return decision;
          }

          if (connection.from.port === "false") {
            return !decision;
          }

          return (
            sourceState?.status ===
            "SUCCESS"
          );
        };

      const collectInputs =
        nodeId => {
          const inputs = {};

          for (
            const connection
              of incoming.get(nodeId) || []
          ) {
            if (!edgeIsActive(connection)) {
              continue;
            }

            const source =
              states.get(connection.from.node);

            const value =
              source?.result?.outputs?.[
                connection.from.port
              ];

            if (value === undefined) {
              continue;
            }

            const port =
              String(connection.to.port);

            const item = {
              edgeId:
                String(connection.id || ""),
              kind:
                connectionKind(connection),
              fromNode:
                connection.from.node,
              fromPort:
                connection.from.port,
              value:
                clone(value)
            };

            if (!inputs[port]) {
              inputs[port] = [];
            }

            inputs[port].push(item);
          }

          return inputs;
        };

      const cachedResultFor =
        (
          nodeId,
          inputs
        ) => {
          if (
            nodeId === pivot
          ) {
            return null;
          }

          const node =
            nodes.get(nodeId);

          const cached =
            this.resultCache.get(
              nodeId
            );

          if (
            !node ||
            !cached
          ) {
            return null;
          }

          const fingerprint =
            executionFingerprint(
              node,
              inputs,
              cacheContext
            );

          if (
            cached.fingerprint !==
              fingerprint
          ) {
            this.resultCache.delete(
              nodeId
            );
            return null;
          }

          return clone(
            cached.result
          );
        };

      const rememberResult =
        (
          nodeId,
          inputs,
          result
        ) => {
          const node =
            nodes.get(nodeId);

          if (
            !node ||
            !result
          ) {
            return;
          }

          this.resultCache.set(
            nodeId,
            {
              fingerprint:
                executionFingerprint(
                  node,
                  inputs,
                  cacheContext
                ),
              result:
                clone(result)
            }
          );
        };

      const resolveNode =
        nodeId => {
          const group =
            groupByNode.get(nodeId);

          if (
            group &&
            typeof this.executor.runGroup ===
              "function"
          ) {
            return resolveGroup(group);
          }

          if (nodeJobs.has(nodeId)) {
            return nodeJobs.get(nodeId);
          }

          const job =
            (async () => {
              const node =
                nodes.get(nodeId);

              if (!node) {
                throw new Error(
                  `node를 찾을 수 없습니다: ${nodeId}`
                );
              }

              const parentEdges =
                incoming.get(nodeId) || [];

              if (parentEdges.length) {
                setState(
                  nodeId,
                  "WAITING"
                );
              }

              const releaseParentEdges =
                parentEdges.map(
                  connection =>
                    acquireEdge(connection)
                );

              try {
                throwIfCancelled();

                await Promise.all(
                  parentEdges.map(
                    connection =>
                      resolveNode(
                        connection.from.node
                      )
                  )
                );

                throwIfCancelled();

                const failedDependencies =
                  parentEdges
                    .map(connection => {
                      const state =
                        states.get(
                          connection.from.node
                        );

                      if (
                        state?.status ===
                        "FAILED"
                      ) {
                        return {
                          nodeId:
                            connection.from.node,
                          blockedBy: [
                            connection.from.node
                          ]
                        };
                      }

                      if (
                        state?.status ===
                          "SKIPPED" &&
                        state?.skipReason ===
                          "dependency_failed"
                      ) {
                        return {
                          nodeId:
                            connection.from.node,
                          blockedBy:
                            Array.isArray(
                              state.blockedBy
                            ) &&
                            state.blockedBy.length
                              ? state.blockedBy
                              : [
                                  connection
                                    .from.node
                                ]
                        };
                      }

                      return null;
                    })
                    .filter(Boolean);

                if (
                  failedDependencies.length
                ) {
                  const blockedBy =
                    [
                      ...new Set(
                        failedDependencies
                          .flatMap(
                            item =>
                              item.blockedBy
                          )
                      )
                    ];

                  setState(
                    nodeId,
                    "SKIPPED",
                    {
                      skipReason:
                        "dependency_failed",
                      blockedBy,
                      finishedAt:
                        Date.now()
                    }
                  );

                  return null;
                }

                const flowIncoming =
                  parentEdges.filter(
                    connection =>
                      connectionKind(connection) ===
                      "flow"
                  );

                if (
                  flowIncoming.length &&
                  !flowIncoming.some(
                    edgeIsActive
                  )
                ) {
                  setState(
                    nodeId,
                    "SKIPPED",
                    {
                      finishedAt:
                        Date.now()
                    }
                  );

                  return null;
                }

                throwIfCancelled();

                const inputs =
                  collectInputs(nodeId);

                const cachedResult =
                  cachedResultFor(
                    nodeId,
                    inputs
                  );

                if (cachedResult) {
                  setState(
                    nodeId,
                    "SUCCESS",
                    {
                      inputs:
                        clone(inputs),
                      result:
                        clone(
                          cachedResult
                        ),
                      cached: true,
                      finishedAt:
                        Date.now(),
                      report:
                        cachedResult
                          ?.report ||
                        null
                    }
                  );

                  return cachedResult;
                }

                setState(
                  nodeId,
                  "RUNNING",
                  {
                    inputs: clone(inputs),
                    startedAt: Date.now()
                  }
                );

                try {
                  throwIfCancelled();

                  const result =
                    await this.executor.run(
                      clone(node),
                      clone(inputs),
                      {
                        runId,
                        nodeId,
                        pivot,
                        mode,
                        signal
                      }
                    );

                  throwIfCancelled();

                  rememberResult(
                    nodeId,
                    inputs,
                    result
                  );

                  setState(
                    nodeId,
                    "SUCCESS",
                    {
                      result:
                        clone(result),
                      finishedAt:
                        Date.now(),
                      report:
                        result?.report ||
                        null
                    }
                  );

                  return result;
                } catch (error) {
                  if (
                    isRuntimeAbort(
                      error
                    ) ||
                    signal.aborted
                  ) {
                    throw runtimeAbortError();
                  }

                  this.resultCache.delete(
                    nodeId
                  );

                  const failure =
                    runtimeErrorState(
                      error
                    );

                  setState(
                    nodeId,
                    "FAILED",
                    {
                      error: failure,
                      finishedAt:
                        Date.now()
                    }
                  );

                  return null;
                }
              } finally {
                releaseParentEdges
                  .forEach(
                    release =>
                      release()
                  );
              }
            })();

          nodeJobs.set(nodeId, job);

          return job;
        };

      const resolveGroup =
        group => {
          if (groupJobs.has(group.id)) {
            return groupJobs.get(group.id);
          }

          const job =
            (async () => {
              const nodeIds =
                group.nodeIds.slice();

              const groupSet =
                new Set(nodeIds);

              const allEdges =
                workflow.connections
                  .filter(connection =>
                    groupSet.has(
                      connection.to.node
                    ) ||
                    groupSet.has(
                      connection.from.node
                    )
                  );

              const externalParentEdges =
                allEdges.filter(
                  connection =>
                    groupSet.has(
                      connection.to.node
                    ) &&
                    !groupSet.has(
                      connection.from.node
                    )
                );

              const internalEdges =
                allEdges.filter(
                  connection =>
                    groupSet.has(
                      connection.from.node
                    ) &&
                    groupSet.has(
                      connection.to.node
                    )
                );

              for (
                const nodeId
                  of nodeIds
              ) {
                if (
                  (incoming.get(nodeId) || [])
                    .length
                ) {
                  setState(
                    nodeId,
                    "WAITING"
                  );
                }
              }

              const releases =
                [
                  ...externalParentEdges,
                  ...internalEdges
                ].map(
                  connection =>
                    acquireEdge(connection)
                );

              try {
                const externalParents =
                  [
                    ...new Set(
                      externalParentEdges
                        .map(
                          connection =>
                            connection.from.node
                        )
                    )
                  ];

                throwIfCancelled();

                await Promise.all(
                  externalParents.map(
                    parentId =>
                      resolveNode(parentId)
                  )
                );

                throwIfCancelled();

                const failedDependencies =
                  externalParentEdges
                    .map(connection => {
                      const state =
                        states.get(
                          connection.from.node
                        );

                      if (
                        state?.status ===
                        "FAILED"
                      ) {
                        return [
                          connection.from.node
                        ];
                      }

                      if (
                        state?.status ===
                          "SKIPPED" &&
                        state?.skipReason ===
                          "dependency_failed"
                      ) {
                        return (
                          Array.isArray(
                            state.blockedBy
                          ) &&
                          state.blockedBy.length
                            ? state.blockedBy
                            : [
                                connection
                                  .from.node
                              ]
                        );
                      }

                      return [];
                    })
                    .flat();

                if (
                  failedDependencies.length
                ) {
                  const blockedBy =
                    [
                      ...new Set(
                        failedDependencies
                      )
                    ];

                  for (
                    const nodeId
                      of nodeIds
                  ) {
                    setState(
                      nodeId,
                      "SKIPPED",
                      {
                        skipReason:
                          "dependency_failed",
                        blockedBy,
                        finishedAt:
                          Date.now()
                      }
                    );
                  }

                  return null;
                }

                const headId =
                  nodeIds[0];

                const headFlowEdges =
                  externalParentEdges
                    .filter(
                      connection =>
                        connection.to.node ===
                          headId &&
                        connectionKind(
                          connection
                        ) === "flow"
                    );

                if (
                  headFlowEdges.length &&
                  !headFlowEdges.some(
                    edgeIsActive
                  )
                ) {
                  for (
                    const nodeId
                      of nodeIds
                  ) {
                    setState(
                      nodeId,
                      "SKIPPED",
                      {
                        finishedAt:
                          Date.now()
                      }
                    );
                  }

                  return null;
                }

                const buildRequest =
                  ids => ({
                    nodes:
                      ids.map(
                        nodeId => {
                          const node =
                            nodes.get(nodeId);

                          return {
                            id: node.id,
                            type: node.type,
                            params:
                              nodeParams(node),
                            inputs:
                              collectInputs(
                                nodeId
                              )
                          };
                        }
                      ),
                    internalConnections:
                      internalEdges
                        .filter(
                          connection =>
                            ids.includes(
                              connection.from.node
                            ) &&
                            ids.includes(
                              connection.to.node
                            )
                        )
                        .map(
                          connection =>
                            clone(connection)
                        )
                  });

                const normalizeResults =
                  (ids, response) => {
                    const results =
                      Array.isArray(response)
                        ? response
                        : response?.results;

                    if (
                      !Array.isArray(results) ||
                      results.length !==
                        ids.length
                    ) {
                      throw new Error(
                        "그룹 실행 결과 개수가 올바르지 않습니다."
                      );
                    }

                    for (
                      let index = 0;
                      index < ids.length;
                      index++
                    ) {
                      if (
                        String(
                          results[index]
                            ?.nodeId || ""
                        ) !==
                        ids[index]
                      ) {
                        throw new Error(
                          "그룹 실행 결과 순서가 올바르지 않습니다."
                        );
                      }
                    }

                    return results;
                  };

                const commitResults =
                  (ids, results) => {
                    for (
                      let index = 0;
                      index < ids.length;
                      index++
                    ) {
                      const nodeId =
                        ids[index];

                      const item =
                        results[index];

                      const result = {
                        outputs:
                          item?.outputs &&
                          typeof item.outputs ===
                            "object"
                            ? clone(
                                item.outputs
                              )
                            : {},
                        decision:
                          typeof item?.decision ===
                            "boolean"
                            ? item.decision
                            : null,
                        report:
                          item?.report ??
                          null
                      };

                      const inputs =
                        collectInputs(
                          nodeId
                        );

                      rememberResult(
                        nodeId,
                        inputs,
                        result
                      );

                      setState(
                        nodeId,
                        "SUCCESS",
                        {
                          inputs:
                            clone(inputs),
                          result,
                          finishedAt:
                            Date.now(),
                          report:
                            result.report
                        }
                      );
                    }
                  };

                const executeIds =
                  async ids => {
                    throwIfCancelled();

                    for (
                      const nodeId
                        of ids
                    ) {
                      setState(
                        nodeId,
                        "RUNNING",
                        {
                          inputs:
                            clone(
                              collectInputs(
                                nodeId
                              )
                            ),
                          startedAt:
                            Date.now()
                        }
                      );
                    }

                    const request =
                      buildRequest(ids);

                    const response =
                      await this.executor
                        .runGroup(
                          clone(request),
                          {
                            runId,
                            pivot,
                            mode,
                            groupId:
                              group.id,
                            cacheContext:
                              clone(
                                cacheContext ||
                                {}
                              ),
                            signal
                          }
                        );

                    throwIfCancelled();

                    const results =
                      normalizeResults(
                        ids,
                        response
                      );

                    commitResults(
                      ids,
                      results
                    );
                  };

                const commitCachedResult =
                  nodeId => {
                    if (nodeId === pivot) {
                      return false;
                    }

                    const inputs =
                      collectInputs(
                        nodeId
                      );

                    const cachedResult =
                      cachedResultFor(
                        nodeId,
                        inputs
                      );

                    if (!cachedResult) {
                      return false;
                    }

                    setState(
                      nodeId,
                      "SUCCESS",
                      {
                        inputs:
                          clone(inputs),
                        result:
                          clone(
                            cachedResult
                          ),
                        cached: true,
                        finishedAt:
                          Date.now(),
                        report:
                          cachedResult
                            ?.report ||
                          null
                      }
                    );

                    return true;
                  };

                const executeSegment =
                  async ids => {
                    if (!ids.length) {
                      return true;
                    }

                    const request =
                      buildRequest(ids);

                    const measuredSize =
                      this
                        .measureGroupInputChars
                        ? this
                            .measureGroupInputChars(
                              clone(request),
                              {
                                userRequest:
                                  cacheContext
                                    ?.userRequest ||
                                  "",
                                memory:
                                  cacheContext
                                    ?.memory ||
                                  null
                              }
                            )
                        : JSON.stringify(
                            request
                          ).length;

                    if (
                      measuredSize >
                        this
                          .maxGroupInputChars &&
                      ids.length > 1
                    ) {
                      let cursor = 0;

                      while (
                        cursor <
                        ids.length
                      ) {
                        let bestEnd =
                          cursor + 1;

                        for (
                          let candidate =
                            cursor + 1;
                          candidate <=
                            ids.length;
                          candidate++
                        ) {
                          const candidateIds =
                            ids.slice(
                              cursor,
                              candidate
                            );
                          const candidateRequest =
                            buildRequest(
                              candidateIds
                            );
                          const candidateSize =
                            this
                              .measureGroupInputChars
                              ? this
                                  .measureGroupInputChars(
                                    clone(
                                      candidateRequest
                                    ),
                                    {
                                      userRequest:
                                        cacheContext
                                          ?.userRequest ||
                                        "",
                                      memory:
                                        cacheContext
                                          ?.memory ||
                                        null
                                    }
                                  )
                              : JSON.stringify(
                                  candidateRequest
                                ).length;

                          if (
                            candidateSize >
                              this
                                .maxGroupInputChars &&
                            candidateIds
                              .length >
                              1
                          ) {
                            break;
                          }

                          bestEnd =
                            candidate;
                        }

                        const segmentIds =
                          ids.slice(
                            cursor,
                            bestEnd
                          );

                        try {
                          await executeIds(
                            segmentIds
                          );
                        } catch (error) {
                          if (
                            error &&
                            typeof error ===
                              "object"
                          ) {
                            error
                              .executionFailedNodeId =
                              segmentIds[0] ||
                              "";
                          }

                          throw error;
                        }

                        cursor =
                          bestEnd;
                      }

                      return true;
                    }

                    await executeIds(ids);
                    return true;
                  };

                const hasCachedIntermediate =
                  nodeIds.some(
                    nodeId =>
                      nodeId !== pivot &&
                      this.resultCache.has(
                        nodeId
                      )
                  );

                if (hasCachedIntermediate) {
                  let pending = [];

                  const flushPending =
                    async () => {
                      if (!pending.length) {
                        return true;
                      }

                      const ids =
                        pending;
                      pending = [];

                      try {
                        await executeSegment(
                          ids
                        );
                        return true;
                      } catch (error) {
                        if (
                          isRuntimeAbort(
                            error
                          ) ||
                          signal.aborted
                        ) {
                          throw runtimeAbortError();
                        }

                        const failedId =
                          String(
                            error
                              ?.executionFailedNodeId ||
                            ids[0] ||
                            ""
                          );
                        const failure =
                          runtimeErrorState(
                            error
                          );

                        for (
                          const id of ids
                        ) {
                          this.resultCache
                            .delete(id);
                        }

                        setState(
                          failedId,
                          "FAILED",
                          {
                            error:
                              failure,
                            finishedAt:
                              Date.now()
                          }
                        );

                        for (
                          const laterId
                            of nodeIds.slice(
                              nodeIds
                                .indexOf(
                                  failedId
                                ) + 1
                            )
                        ) {
                          if (
                            states.get(
                              laterId
                            )?.status ===
                              "IDLE" ||
                            states.get(
                              laterId
                            )?.status ===
                              "WAITING"
                          ) {
                            setState(
                              laterId,
                              "SKIPPED",
                              {
                                skipReason:
                                  "dependency_failed",
                                blockedBy: [
                                  failedId
                                ],
                                finishedAt:
                                  Date.now()
                              }
                            );
                          }
                        }

                        return false;
                      }
                    };

                  for (
                    const nodeId
                      of nodeIds
                  ) {
                    throwIfCancelled();

                    const hasCacheCandidate =
                      nodeId !== pivot &&
                      this.resultCache.has(
                        nodeId
                      );

                    if (
                      hasCacheCandidate &&
                      pending.length
                    ) {
                      const ok =
                        await flushPending();

                      if (!ok) {
                        return null;
                      }
                    }

                    if (
                      hasCacheCandidate &&
                      commitCachedResult(
                        nodeId
                      )
                    ) {
                      continue;
                    }

                    pending.push(
                      nodeId
                    );
                  }

                  const ok =
                    await flushPending();

                  return ok
                    ? true
                    : null;
                }

                const fullRequest =
                  buildRequest(nodeIds);

                const serializedSize =
                  this
                    .measureGroupInputChars
                    ? this
                        .measureGroupInputChars(
                          clone(
                            fullRequest
                          ),
                          {
                            userRequest:
                              cacheContext
                                ?.userRequest ||
                              "",
                            memory:
                              cacheContext
                                ?.memory ||
                              null
                          }
                        )
                    : JSON.stringify(
                        fullRequest
                      ).length;

                if (
                  serializedSize >
                    this
                      .maxGroupInputChars &&
                  nodeIds.length > 1
                ) {
                  try {
                    await executeSegment(
                      nodeIds
                    );
                    return true;
                  } catch (error) {
                    if (
                      isRuntimeAbort(
                        error
                      ) ||
                      signal.aborted
                    ) {
                      throw runtimeAbortError();
                    }

                    const failedId =
                      String(
                        error
                          ?.executionFailedNodeId ||
                        nodeIds[0] ||
                        ""
                      );
                    const failure =
                      runtimeErrorState(
                        error
                      );

                    for (
                      const nodeId
                        of nodeIds
                    ) {
                      this.resultCache.delete(
                        nodeId
                      );
                    }

                    setState(
                      failedId,
                      "FAILED",
                      {
                        error: failure,
                        finishedAt:
                          Date.now()
                      }
                    );

                    const failedIndex =
                      Math.max(
                        0,
                        nodeIds.indexOf(
                          failedId
                        )
                      );

                    for (
                      const laterId
                        of nodeIds.slice(
                          failedIndex + 1
                        )
                    ) {
                      setState(
                        laterId,
                        "SKIPPED",
                        {
                          skipReason:
                            "dependency_failed",
                          blockedBy: [
                            failedId
                          ],
                          finishedAt:
                            Date.now()
                        }
                      );
                    }

                    return null;
                  }
                }

                try {
                  await executeIds(
                    nodeIds
                  );

                  return true;
                } catch (error) {
                  if (
                    isRuntimeAbort(
                      error
                    ) ||
                    signal.aborted
                  ) {
                    throw runtimeAbortError();
                  }

                  const failedId =
                    nodeIds[0];

                  for (
                    const nodeId
                      of nodeIds
                  ) {
                    this.resultCache.delete(
                      nodeId
                    );
                  }

                  const failure =
                    runtimeErrorState(
                      error
                    );

                  setState(
                    failedId,
                    "FAILED",
                    {
                      error: failure,
                      finishedAt:
                        Date.now()
                    }
                  );

                  for (
                    const nodeId
                      of nodeIds.slice(1)
                  ) {
                    setState(
                      nodeId,
                      "SKIPPED",
                      {
                        skipReason:
                          "dependency_failed",
                        blockedBy: [
                          failedId
                        ],
                        finishedAt:
                          Date.now()
                      }
                    );
                  }

                  return null;
                }
              } finally {
                releases.forEach(
                  release =>
                    release()
                );
              }
            })();

          groupJobs.set(
            group.id,
            job
          );

          return job;
        };

      this.running = true;

      this.emit(
        "run:start",
        {
          runId,
          pivot,
          mode
        }
      );

      try {
        if (mode === "target") {
          await resolveNode(pivot);
        } else {
          await Promise.all(
            executionPlan.scope.map(
              nodeId =>
                resolveNode(nodeId)
            )
          );
        }

        throwIfCancelled();

        const snapshot =
          Object.fromEntries(
            [...states.entries()].map(
              ([id, state]) => [
                id,
                clone(state)
              ]
            )
          );

        const touched =
          Object.values(snapshot)
            .filter(
              state =>
                state.status !== "IDLE"
            );

        const status =
          touched.some(
            state =>
              state.status === "FAILED"
          )
            ? "FAILED"
            : "SUCCESS";

        const result = {
          runId,
          pivot,
          mode,
          status,
          workflow:
            clone(workflow),
          nodes:
            snapshot
        };

        this.lastRun =
          clone(result);

        this.emit(
          "run:finish",
          {
            runId,
            pivot,
            mode,
            status,
            result
          }
        );

        return result;
      } catch (error) {
        const cancelled =
          isRuntimeAbort(
            error
          ) ||
          signal.aborted ||
          this.cancelRequested;

        if (cancelled) {
          for (
            const nodeId
              of executionPlan.scope
          ) {
            const nodeState =
              states.get(nodeId);

            if (
              nodeState?.status ===
                "RUNNING" ||
              nodeState?.status ===
                "WAITING"
            ) {
              setState(
                nodeId,
                "SKIPPED",
                {
                  skipReason:
                    "cancelled",
                  finishedAt:
                    Date.now()
                }
              );
            }
          }

          const result = {
            runId,
            pivot,
            mode,
            status:
              "CANCELLED",
            workflow:
              clone(workflow),
            nodes:
              Object.fromEntries(
                [...states.entries()].map(
                  ([id, state]) => [
                    id,
                    clone(state)
                  ]
                )
              ),
            error:
              runtimeErrorState(
                runtimeAbortError()
              )
          };

          this.lastRun =
            clone(result);

          this.emit(
            "run:finish",
            {
              runId,
              pivot,
              mode,
              status:
                "CANCELLED",
              result
            }
          );

          return result;
        }

        const result = {
          runId,
          pivot,
          mode,
          status: "FAILED",
          workflow:
            clone(workflow),
          nodes:
            Object.fromEntries(
              [...states.entries()].map(
                ([id, state]) => [
                  id,
                  clone(state)
                ]
              )
            ),
          error:
            runtimeErrorState(
              error
            )
        };

        this.lastRun =
          clone(result);

        this.emit(
          "run:finish",
          {
            runId,
            pivot,
            mode,
            status: "FAILED",
            result
          }
        );

        throw error;
      } finally {
        for (
          const edgeId
            of [...edgeRefs.keys()]
        ) {
          this.emit(
            "edge:state",
            {
              runId,
              edgeId,
              active: false
            }
          );
        }

        edgeRefs.clear();
        this.running = false;
        this.abortController =
          null;
        this.activeRunId =
          null;
        this.cancelRequested =
          false;
      }
    }

    getLastRun() {
      return this.lastRun
        ? clone(this.lastRun)
        : null;
    }
  }

  global.OvllExecutionEngine = {
    RuntimeEngine,
    LocalNodeExecutor,
    normalizeWorkflow,
    planExecutionGroups,
    validateExecutionReadiness,
    analyzeWorkflowExecutionDelta,
    isNodeReadyForExecution
  };
})(window);
