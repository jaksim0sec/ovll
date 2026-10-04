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

  function isNodeReadyForExecution(node) {
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

    return Object.values(
      nodeParams(node)
    ).some(
      value =>
        hasMeaningfulValue(value)
    );
  }

  function findUnreadyNodes(
    workflow,
    scope
  ) {
    const ids =
      new Set(
        Array.isArray(scope)
          ? scope.map(String)
          : []
      );

    return workflow.nodes
      .filter(
        node =>
          ids.has(node.id) &&
          !isNodeReadyForExecution(node)
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
        plan.scope
      );

    return {
      ok:
        emptyNodes.length === 0,
      emptyNodes,
      scope:
        [...plan.scope]
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
          cacheContext || null
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
          executionPlan.scope
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

                const hasCachedIntermediate =
                  nodeIds.some(
                    nodeId =>
                      nodeId !== pivot &&
                      this.resultCache.has(
                        nodeId
                      )
                  );

                if (hasCachedIntermediate) {
                  for (
                    let index = 0;
                    index < nodeIds.length;
                    index++
                  ) {
                    throwIfCancelled();

                    const nodeId =
                      nodeIds[index];

                    const inputs =
                      collectInputs(
                        nodeId
                      );

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

                      continue;
                    }

                    try {
                      await executeIds([
                        nodeId
                      ]);
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

                      for (
                        const laterId
                          of nodeIds.slice(
                            index + 1
                          )
                      ) {
                        setState(
                          laterId,
                          "SKIPPED",
                          {
                            skipReason:
                              "dependency_failed",
                            blockedBy: [
                              nodeId
                            ],
                            finishedAt:
                              Date.now()
                          }
                        );
                      }

                      return null;
                    }
                  }

                  return true;
                }

                const fullRequest =
                  buildRequest(nodeIds);

                const serializedSize =
                  JSON.stringify(
                    fullRequest
                  ).length;

                if (
                  serializedSize >
                    this
                      .maxGroupInputChars &&
                  nodeIds.length > 1
                ) {
                  for (
                    let index = 0;
                    index < nodeIds.length;
                    index++
                  ) {
                    const nodeId =
                      nodeIds[index];

                    try {
                      await executeIds([
                        nodeId
                      ]);
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

                      for (
                        const laterId
                          of nodeIds.slice(
                            index + 1
                          )
                      ) {
                        setState(
                          laterId,
                          "SKIPPED",
                          {
                            skipReason:
                              "dependency_failed",
                            blockedBy: [
                              nodeId
                            ],
                            finishedAt:
                              Date.now()
                          }
                        );
                      }

                      return null;
                    }
                  }

                  return true;
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
    isNodeReadyForExecution
  };
})(window);
