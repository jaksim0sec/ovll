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
  let nodeDefinitionsFresh = false;

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
      requestError.origin =
        String(
          data?.origin || ""
        );
      requestError.diagnostics =
        data?.diagnostics &&
        typeof data.diagnostics ===
          "object"
          ? data.diagnostics
          : null;
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

  async function getNodeDefinitions(
    options = {}
  ) {
    if (
      nodeDefinitionsCache &&
      nodeDefinitionsFresh &&
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

        if(!global.OvllSvgLibrary?.setServerIcons?.(result.iconSvg)){
          throw new Error("서버 SVG 라이브러리를 불러오지 못했습니다.");
        }

        nodeDefinitionsCache =
          result.nodes;
        nodeDefinitionsFresh = true;
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
        ? 330000
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

  /* =======================================================
     Public API
     ======================================================= */
  const api = Object.freeze({request,getNodeDefinitions,createArtifact});
  global.AstraAPI = api;
})(window);