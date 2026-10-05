/* =========================================================
   Astra
   API Layer
   ========================================================= */
(function (global) {
  "use strict";
  /* =======================================================
     Configuration
     ======================================================= */
  const runtime =
    global.OVLL_RUNTIME || {};
  const API_ORIGIN =
    typeof runtime.apiOrigin === "string"
      ? runtime.apiOrigin
          .trim()
          .replace(/\/+$/, "")
      : "";
  const API_PREFIX =
    `${API_ORIGIN}/api`;

  function resolveApiAssetUrl(
    value
  ) {
    const url =
      String(value || "");

    if (
      !url ||
      /^(?:https?:|blob:|data:)/i
        .test(url)
    ) {
      return url;
    }

    if (!API_ORIGIN) {
      return url;
    }

    return `${API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
  }
  /* =======================================================
     Internal State
     ======================================================= */
  const NODE_DEFINITIONS_KEY =
    "ovll:node-definitions";
  let nodeDefinitionsCache = null;
  let nodeDefinitionsPromise = null;

  function readStoredNodeDefinitions() {
    try {
      const parsed =
        JSON.parse(
          localStorage.getItem(
            NODE_DEFINITIONS_KEY
          ) || "null"
        );

      return (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      )
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  function storeNodeDefinitions(
    definitions
  ) {
    try {
      localStorage.setItem(
        NODE_DEFINITIONS_KEY,
        JSON.stringify(
          definitions
        )
      );
    } catch {}
  }

  nodeDefinitionsCache =
    readStoredNodeDefinitions();
  /* =======================================================
     Request
     ======================================================= */
  async function request(
    path,
    options = {}
  ) {
    const {
      method = "GET",
      headers = {},
      body = null,
      signal,
      cache
    } = options;
    const fetchOptions = {
      method,
      headers: {
        ...(body !== null
          ? {
              "Content-Type":
                "application/json"
            }
          : {}),
        ...headers
      },
      signal,
      ...(cache !== undefined
        ? {
            cache
          }
        : {})
    };
    if (body !== null) {
      const serialized =
        JSON.stringify(body);

      if (
        serialized.length >
        700000
      ) {
        const payloadError =
          new Error(
            "요청 데이터가 너무 큽니다."
          );

        payloadError.name =
          "OvllApiError";
        payloadError.code =
          "CLIENT_PAYLOAD_TOO_LARGE";
        payloadError.status =
          413;
        payloadError.retryable =
          false;

        throw payloadError;
      }

      fetchOptions.body =
        serialized;
    }
    let response;
    try {
      response = await fetch(
        `${API_PREFIX}/${path}`,
        fetchOptions
      );
    } catch (error) {
      if (
        signal?.aborted ||
        error?.name ===
          "AbortError"
      ) {
        const abortedError =
          new Error(
            "요청이 중단되었습니다."
          );

        abortedError.name =
          "OvllApiError";
        abortedError.code =
          "REQUEST_ABORTED";
        abortedError.status =
          499;
        abortedError.retryable =
          false;
        abortedError.cause =
          error;

        throw abortedError;
      }

      const networkError =
        new Error(
          "서버에 연결할 수 없습니다."
        );
      networkError.name =
        "OvllApiError";
      networkError.code =
        "NETWORK_ERROR";
      networkError.cause =
        error;
      throw networkError;
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      const parseError =
        new Error(
          "서버 응답을 읽지 못했습니다."
        );
      parseError.name =
        "OvllApiError";
      parseError.code =
        "INVALID_SERVER_RESPONSE";
      parseError.status =
        response.status;
      throw parseError;
    }
    if (
      !response.ok ||
      data?.ok === false
    ) {
      const requestError =
        new Error(
          String(
            data?.error ||
            "요청을 처리하지 못했습니다."
          )
        );
      requestError.name =
        "OvllApiError";
      requestError.code =
        String(
          data?.code ||
          "API_REQUEST_FAILED"
        );
      requestError.status =
        response.status;
      requestError.retryable =
        data?.retryable === true;
      throw requestError;
    }
    return data;
  }
  function clipPayloadText(
    value,
    max
  ) {
    const text =
      String(value ?? "")
        .replace(/\s+/g, " ")
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
        120,
        Math.floor(
          max * .25
        )
      );

    return (
      text.slice(
        0,
        max - tail - 3
      ) +
      " … " +
      text.slice(-tail)
    ).slice(0, max);
  }

  function compactPayloadValue(
    value,
    depth = 0
  ) {
    if (value == null) {
      return value;
    }

    if (
      typeof value ===
        "string"
    ) {
      return clipPayloadText(
        value,
        depth <= 1
          ? 5000
          : 3000
      );
    }

    if (
      typeof value ===
        "number" ||
      typeof value ===
        "boolean"
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
            compactPayloadValue(
              item,
              depth + 1
            )
        );
    }

    if (
      typeof value ===
        "object"
    ) {
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 24)
          .map(
            ([key, item]) => [
              String(key)
                .slice(0, 120),
              compactPayloadValue(
                item,
                depth + 1
              )
            ]
          )
      );
    }

    return String(value)
      .slice(0, 1000);
  }


  function clipStructuredText(
    value,
    max
  ) {
    const text =
      String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/\u0000/g, "")
        .trim();

    if (
      !Number.isFinite(max) ||
      max <= 0 ||
      text.length <= max
    ) {
      return text;
    }

    const marker =
      "\n… [omitted] …\n";
    const tail =
      Math.max(
        240,
        Math.floor(
          max * .28
        )
      );
    const head =
      Math.max(
        0,
        max -
        tail -
        marker.length
      );

    return (
      text.slice(0, head) +
      marker +
      text.slice(-tail)
    ).slice(0, max);
  }

  function compactExecutionValue(
    value,
    stringLimit = 12000,
    depth = 0
  ) {
    if (value == null) {
      return value;
    }

    if (
      typeof value ===
        "string"
    ) {
      return clipStructuredText(
        value,
        stringLimit
      );
    }

    if (
      typeof value ===
        "number" ||
      typeof value ===
        "boolean"
    ) {
      return value;
    }

    if (depth >= 7) {
      return "[nested]";
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, 24)
        .map(
          item =>
            compactExecutionValue(
              item,
              stringLimit,
              depth + 1
            )
        );
    }

    if (
      typeof value ===
        "object"
    ) {
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 32)
          .map(
            ([key, item]) => [
              String(key)
                .slice(0, 120),
              compactExecutionValue(
                item,
                stringLimit,
                depth + 1
              )
            ]
          )
      );
    }

    return clipStructuredText(
      value,
      Math.min(
        stringLimit,
        2000
      )
    );
  }

  function compactArtifactValue(
    value,
    depth = 0
  ) {
    if (value == null) {
      return value;
    }

    if (
      typeof value ===
        "string"
    ) {
      return clipPayloadText(
        value,
        depth <= 1
          ? 80000
          : 30000
      );
    }

    if (
      typeof value ===
        "number" ||
      typeof value ===
        "boolean"
    ) {
      return value;
    }

    if (depth >= 6) {
      return "[nested]";
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, 80)
        .map(
          item =>
            compactArtifactValue(
              item,
              depth + 1
            )
        );
    }

    if (
      typeof value ===
        "object"
    ) {
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 80)
          .map(
            ([key, item]) => [
              String(key)
                .slice(0, 160),
              compactArtifactValue(
                item,
                depth + 1
              )
            ]
          )
      );
    }

    return String(value)
      .slice(0, 4000);
  }

  function compactArtifactSources(
    sources,
    maxChars = 420000
  ) {
    const sourceList =
      Array.isArray(sources)
        ? sources.slice(0, 32)
        : [];

    const result = [];
    let remaining =
      Math.max(
        8000,
        Number(maxChars) ||
        420000
      );

    for (
      const source
      of sourceList
    ) {
      if (
        remaining < 1500
      ) {
        break;
      }

      let compact =
        compactArtifactValue(
          source
        );

      let serialized =
        JSON.stringify(
          compact
        );

      if (
        serialized.length >
        remaining
      ) {
        if (
          typeof compact ===
            "string"
        ) {
          compact =
            clipPayloadText(
              compact,
              Math.max(
                500,
                remaining - 128
              )
            );
        } else {
          compact =
            clipPayloadText(
              serialized,
              Math.max(
                500,
                Math.floor(
                  remaining * .55
                )
              )
            );
        }

        serialized =
          JSON.stringify(
            compact
          );
      }

      result.push(
        compact
      );

      remaining -=
        serialized.length +
        32;
    }

    return result;
  }

  function compactMemoryPayload(
    memory
  ) {
    if (
      !memory ||
      typeof memory !==
        "object" ||
      Array.isArray(memory)
    ) {
      return null;
    }

    return {
      flow:
        clipPayloadText(
          memory.flow,
          700
        ),
      recent:
        clipPayloadText(
          memory.recent,
          1400
        ),
      detail:
        clipPayloadText(
          memory.detail,
          1900
        )
    };
  }

  function compactWorkflowPayload(
    workflow
  ) {
    if (
      !workflow ||
      typeof workflow !==
        "object" ||
      Array.isArray(workflow)
    ) {
      return null;
    }

    return {
      nodes:
        Array.isArray(
          workflow.nodes
        )
          ? workflow.nodes
              .slice(0, 96)
              .map(node => {
                const item = {
                  id:
                    String(
                      node?.id ||
                      ""
                    )
                      .slice(0, 180),
                  type:
                    String(
                      node?.type ||
                      ""
                    )
                      .slice(0, 80),
                  params:
                    compactPayloadValue(
                      node?.params ||
                      {}
                    )
                };

                if (
                  item.type ===
                    "file" &&
                  node?.file &&
                  typeof node.file ===
                    "object"
                ) {
                  item.file =
                    compactPayloadValue(
                      node.file
                    );
                }

                return item;
              })
          : [],
      links:
        Array.isArray(
          workflow.links
        )
          ? workflow.links
              .slice(0, 192)
              .map(edge =>
                Array.isArray(edge)
                  ? edge
                      .slice(0, 2)
                      .map(value =>
                        String(value)
                          .slice(0, 280)
                      )
                  : edge
              )
          : [],
      data:
        Array.isArray(
          workflow.data
        )
          ? workflow.data
              .slice(0, 192)
              .map(edge =>
                Array.isArray(edge)
                  ? edge
                      .slice(0, 2)
                      .map(value =>
                        String(value)
                          .slice(0, 280)
                      )
                  : edge
              )
          : []
    };
  }

  /* =======================================================
     Workflow
     ======================================================= */
  async function planWorkflow(
    text,
    workflow = null,
    memory = null,
    options = {}
  ) {
    const normalizedText =
      clipPayloadText(
        text,
        6000
      );

    if (!normalizedText) {
      throw new TypeError(
        "작업 내용을 입력해주세요."
      );
    }

    return request(
      "workflow",
      {
        method: "POST",
        body: {
          text:
            normalizedText,
          workflow:
            compactWorkflowPayload(
              workflow
            ),
          memory:
            compactMemoryPayload(
              memory
            )
        },
        signal:
          options.signal
      }
    );
  }
  /* =======================================================
     Node Definitions
     ======================================================= */
  async function getNodeDefinitions(
    options = {}
  ) {
    if (
      nodeDefinitionsCache &&
      !options.force
    ) {
      return nodeDefinitionsCache;
    }
    if (
      nodeDefinitionsPromise &&
      !options.force
    ) {
      return nodeDefinitionsPromise;
    }
    const stale =
      nodeDefinitionsCache ||
      readStoredNodeDefinitions();

    nodeDefinitionsPromise =
      request(
        "node-definitions",
        {
          method: "GET",
          cache: "no-store",
          signal: options.signal
        }
      )
      .then(result => {
        if (
          !result ||
          typeof result.nodes !==
            "object" ||
          result.nodes === null ||
          Array.isArray(result.nodes)
        ) {
          throw new Error(
            "노드 정의 응답이 올바르지 않습니다."
          );
        }

        nodeDefinitionsCache =
          result.nodes;
        storeNodeDefinitions(
          nodeDefinitionsCache
        );

        /*
         * 기존 코드와의 호환성을 위해
         * 전역에도 노출한다.
         */
        global.nodeDefinitions =
          nodeDefinitionsCache;
        return nodeDefinitionsCache;
      })
      .catch(error => {
        if (stale) {
          console.warn(
            "Node definition refresh failed; using local cache.",
            error
          );

          nodeDefinitionsCache =
            stale;
          global.nodeDefinitions =
            stale;

          return stale;
        }

        throw error;
      })
      .finally(() => {
        nodeDefinitionsPromise =
          null;
      });
    return nodeDefinitionsPromise;
  }
  function getNodeDefinitionSync(
    definitions,
    type
  ) {
    if (
      !definitions ||
      typeof definitions !==
        "object" ||
      Array.isArray(definitions)
    ) {
      return null;
    }
    return (
      definitions[type] ||
      null
    );
  }
  function clearNodeDefinitionsCache() {
    nodeDefinitionsCache = null;
  }
  /* =======================================================
     Definition Helpers
     ======================================================= */
  function getPortDefinition(
    definition,
    direction,
    portId
  ) {
    if (!definition) {
      return null;
    }
    const ports =
      direction === "input"
        ? (
            Array.isArray(
              definition.inputs
            )
              ? definition.inputs
              : []
          )
        : (
            Array.isArray(
              definition.outputs
            )
              ? definition.outputs
              : []
          );
    return (
      ports.find(
        port =>
          String(port?.id) ===
          String(portId)
      ) || null
    );
  }
  function getParamDefinition(
    definition,
    paramId
  ) {
    if (!definition) {
      return null;
    }
    const params =
      Array.isArray(
        definition.params
      )
        ? definition.params
        : [];
    return (
      params.find(
        param =>
          String(param?.id) ===
          String(paramId)
      ) || null
    );
  }
  function normalizeParamsFromDefinition(
    definition,
    params
  ) {
    if (
      !params ||
      typeof params !==
        "object" ||
      Array.isArray(params)
    ) {
      return {};
    }
    if (!definition) {
      return {};
    }
    const result = {};
    for (
      const [key, value] of
      Object.entries(params)
    ) {
      const definitionParam =
        getParamDefinition(
          definition,
          key
        );
      if (!definitionParam) {
        continue;
      }
      if (
        typeof value ===
        "string"
      ) {
        const trimmed =
          value.trim();

        if (trimmed) {
          const maxLength =
            Math.max(
              1,
              Number(
                definitionParam
                  ?.maxLength ||
                1800
              ) || 1800
            );

          result[key] =
            clipPayloadText(
              trimmed,
              maxLength
            );
        }
        continue;
      }
      /*
       * 현재 Node Definition의
       * params는 문자열 기반이므로
       * 그 외 타입은 Canonical 값에서
       * 제외한다.
       */
    }
    if (
      typeof result.request ===
        "string" &&
      result.request.trim()
    ) {
      for (
        const param
        of definition.params || []
      ) {
        if (
          param?.legacy === true
        ) {
          delete result[
            String(param.id)
          ];
        }
      }
    }

    return result;
  }
  /* =======================================================
     Workflow Helpers
     ======================================================= */
  function parseWorkflowEndpoint(
    value
  ) {
    if (
      typeof value !==
      "string"
    ) {
      throw new Error(
        "연결 endpoint가 문자열이 아닙니다."
      );
    }
    const dot =
      value.lastIndexOf(".");
    if (dot === -1) {
      throw new Error(
        `포트가 지정되지 않았습니다: ${value}`
      );
    }
    const node =
      value.slice(0, dot);
    const port =
      value.slice(dot + 1);
    if (!node || !port) {
      throw new Error(
        `잘못된 endpoint입니다: ${value}`
      );
    }
    return {
      node,
      port
    };
  }
  function validateWorkflowShape(
    workflow
  ) {
    if (
      !workflow ||
      typeof workflow !==
      "object" ||
      Array.isArray(workflow)
    ) {
      throw new Error(
        "워크플로우가 없습니다."
      );
    }
    if (
      !Array.isArray(
        workflow.nodes
      )
    ) {
      throw new Error(
        "workflow nodes가 배열이 아닙니다."
      );
    }
    if (
      !Array.isArray(
        workflow.links
      )
    ) {
      throw new Error(
        "workflow links가 배열이 아닙니다."
      );
    }
    if (
      !Array.isArray(
        workflow.data
      )
    ) {
      throw new Error(
        "workflow data가 배열이 아닙니다."
      );
    }
    return workflow;
  }
  /*
   * 서버에서 반환된 Workflow를
   * UI에서 안전하게 사용할 수 있도록
   * 최소한의 구조만 검사한다.
   *
   * 실제 Canvas 연결 유효성 검사는
   * canvasNode.js가 담당한다.
   */
  function validateWorkflow(
    workflow
  ) {
    validateWorkflowShape(
      workflow
    );
    for (
      const node of
      workflow.nodes
    ) {
      if (
        !node ||
        typeof node !==
        "object" ||
        typeof node.id !==
        "string" ||
        typeof node.type !==
        "string"
      ) {
        throw new Error(
          "잘못된 workflow 노드입니다."
        );
      }
    }
    return workflow;
  }
  /* =======================================================
     Execution
     ======================================================= */
  function buildExecutionPayload(
    group,
    context = {}
  ) {
    if (
      !group ||
      typeof group !== "object" ||
      !Array.isArray(group.nodes) ||
      !group.nodes.length
    ) {
      throw new TypeError(
        "실행할 Gemini node group이 없습니다."
      );
    }

    const connections =
      Array.isArray(
        group.internalConnections
      )
        ? group.internalConnections
        : [];

    const base = {
      connections:
        connections
          .slice(0, 24)
          .map(
            item =>
              compactExecutionValue(
                item,
                3000
              )
          ),
      context: {
        userRequest:
          clipPayloadText(
            context.userRequest,
            6000
          ),
        memory:
          compactMemoryPayload(
            context.memory
          )
      }
    };

    const stringLimit =
      12000;

    const body = {
      nodes:
        group.nodes
          .slice(0, 6)
          .map(
            node => ({
              id:
                String(
                  node?.id ||
                  ""
                ).slice(0, 180),
              type:
                String(
                  node?.type ||
                  ""
                ).slice(0, 80),
              params:
                compactExecutionValue(
                  node?.params ||
                  {},
                  stringLimit
                ),
              inputs:
                compactExecutionValue(
                  node?.inputs ||
                  {},
                  stringLimit
                )
            })
          ),
      ...base
    };
    return body;
  }

  function measureExecutionPayloadChars(
    group,
    context = {}
  ) {
    return JSON.stringify(
      buildExecutionPayload(
        group,
        context
      )
    ).length;
  }

  async function executeGroup(
    group,
    context = {},
    options = {}
  ) {
    return request(
      "execute-group",
      {
        method: "POST",
        body:
          buildExecutionPayload(
            group,
            context
          ),
        signal:
          options.signal
      }
    );
  }

  async function createArtifact(
    input,
    options = {}
  ) {
    const timeoutController =
      new AbortController();
    const parentSignal =
      options.signal;
    const onParentAbort =
      () =>
        timeoutController.abort(
          parentSignal?.reason
        );

    if(parentSignal?.aborted){
      onParentAbort();
    }else{
      parentSignal?.addEventListener(
        "abort",
        onParentAbort,
        {once:true}
      );
    }

    const format =
      String(
        input?.format || ""
      )
        .trim()
        .toUpperCase();

    const timeoutMs =
      format === "PDF"
        ? 120000
        : 60000;

    const timeout =
      global.setTimeout(
        ()=>timeoutController.abort(
          new Error(
            "ARTIFACT_TIMEOUT"
          )
        ),
        timeoutMs
      );

    let result;

    try {
      result =
        await request(
          "create-artifact",
          {
            method: "POST",
            body: {
              format:
                input?.format,
              filename:
                input?.filename,
              targetPages:
                input?.targetPages,
              sources:
                compactArtifactSources(
                  input?.sources
                )
            },
            signal:
              timeoutController.signal
          }
        );
    } catch(error) {
      if(
        timeoutController.signal.aborted &&
        !parentSignal?.aborted
      ) {
        const timeoutError =
          new Error(
            "파일 생성 시간이 초과되었습니다. 다시 시도해 주세요."
          );

        timeoutError.name =
          "OvllApiError";
        timeoutError.code =
          "ARTIFACT_TIMEOUT";
        timeoutError.status =
          504;
        timeoutError.retryable =
          true;

        throw timeoutError;
      }

      throw error;
    } finally {
      global.clearTimeout(
        timeout
      );

      parentSignal
        ?.removeEventListener(
          "abort",
          onParentAbort
        );
    }

    if (
      result?.artifact
        ?.downloadUrl
    ) {
      result.artifact.downloadUrl =
        resolveApiAssetUrl(
          result.artifact
            .downloadUrl
        );
    }

    if (
      result?.artifact
        ?.previewUrl
    ) {
      result.artifact.previewUrl =
        resolveApiAssetUrl(
          result.artifact
            .previewUrl
        );
    }

    return result;
  }

  async function finalizeRun(
    run,
    context = {},
    options = {}
  ) {
    if (
      !run ||
      typeof run !== "object"
    ) {
      throw new TypeError(
        "정리할 실행 결과가 없습니다."
      );
    }

    return request(
      "finalize-run",
      {
        method: "POST",
        body: {
          run,
          userRequest:
            String(
              context.userRequest ||
              ""
            ),
          memory:
            context.memory || null
        },
        signal:
          options.signal
      }
    );
  }

  async function execute(
    workflow,
    options = {}
  ) {
    validateWorkflow(
      workflow
    );

    throw new Error(
      "전체 Workflow 실행 API 대신 RuntimeEngine group 실행을 사용합니다."
    );
  }

  /* =======================================================
     Public API
     ======================================================= */
  const api = Object.freeze({
    request,
    planWorkflow,
    executeGroup,
    buildExecutionPayload,
    measureExecutionPayloadChars,
    createArtifact,
    finalizeRun,
    execute,
    getNodeDefinitions,
    getNodeDefinitionSync,
    getPortDefinition,
    getParamDefinition,
    normalizeParamsFromDefinition,
    parseWorkflowEndpoint,
    validateWorkflowShape,
    validateWorkflow,
    clearNodeDefinitionsCache
  });
  global.AstraAPI = api;
})(window);