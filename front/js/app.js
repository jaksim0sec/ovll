/* =========================================================
   Astra
   Application Entry
   ========================================================= */
(function (global) {
  "use strict";

  /* =======================================================
     Dependencies
     ======================================================= */
  const UI = global.AstraUI;
  const Navigation = global.OvllNavigation;
  const API = global.AstraAPI;
  const Presence = global.OvllPresence;
  const WorkspaceStore = global.OvllWorkspaceStore;
  const FileStore = global.OvllFileStore;
  const ArtifactVisuals = global.OvllArtifactVisuals;
  const PreviewSandbox = global.OvllPreviewSandbox;
  const PreviewEngine = global.OvllPreviewEngine;
  const SvgLibrary = global.OvllSvgLibrary;
  const Execution = global.OvllExecutionEngine;
  const mountCanvasNode = global.mountCanvasNode;

  /* =======================================================
     DOM
     ======================================================= */
  const workspace = document.querySelector("#workspace");
  const chatPage = document.querySelector("#chat-page");
  const canvasPage = document.querySelector("#canvas-page");
  const chatContent = document.querySelector("#chat-content");
  const chatMessages = document.querySelector("#chat-messages");
  const composerForm = document.querySelector("#composer-form");
  const composerInput = document.querySelector("#composer-input");
  let composerAttach = document.querySelector("#composer-attach");
  let composerFileInput = document.querySelector("#composer-file-input");
  const composerSubmit = document.querySelector("#composer-submit");

  if (!workspace || !chatPage || !canvasPage || !chatContent || !chatMessages || !composerForm || !composerInput || !composerSubmit) {
    throw new Error("ovll Application DOM 구조가 올바르지 않습니다.");
  }

  if (
    !UI ||
    !Navigation ||
    !API ||
    !Presence ||
    !WorkspaceStore ||
    !FileStore ||
    !ArtifactVisuals ||
    !PreviewSandbox ||
    !PreviewEngine ||
    !SvgLibrary ||
    !Execution ||
    typeof Execution.RuntimeEngine !== "function" ||
    typeof mountCanvasNode !== "function"
  ) {
    throw new Error("ovll Application dependency가 준비되지 않았습니다.");
  }

  const composerSendIcon =
    SvgLibrary.get("composerSend");

  if (composerSendIcon) {
    composerSubmit.innerHTML =
      composerSendIcon;
  }

  /* =======================================================
     State
     ======================================================= */
  const memoryStore = {
    value: {
      flow: "",
      recent: "",
      detail: ""
    }
  };

  const state = {
    destroyed: false,
    ready: false,
    busy: false,
    canvas: null,
    workflow: null,
    workflowProposal: null,
    nodeDefinitions: null,
    conversationMemory: null,
    runtime: null,
    runtimeConnections: new Set(),
    runtimeActivity: null,
    runGate: {
      locked: false,
      pivot: null,
      releaseTimer: null
    },
    errorNotice: null,
    errorRetry: null,
    lastUserRequest: "",
    workflowUserRequest: "",
    activeConversationId: null,
    messages: [],
    restoringConversation: false,
    workspaceSaveTimer: null,
    nodeBuilder: {
      root: null,
      open: false,
      resetTimer: null
    },
    messageCount: 0
  };

  const listeners = [];

  let conversationSwitchQueue =
    Promise.resolve();


  /* =======================================================
     Utilities
     ======================================================= */
  function listen(element, type, handler, options) {
    element.addEventListener(type, handler, options);
    listeners.push(() => {
      element.removeEventListener(type, handler, options);
    });
  }

  function clone(value) {
    if (typeof global.AstraUtils?.clone === "function") {
      return global.AstraUtils.clone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function getCurrentWorkflow() {
    if (state.canvas && typeof state.canvas.getWorkflowIR === "function") {
      return clone(state.canvas.getWorkflowIR());
    }
    if (state.workflow) {
      return clone(state.workflow);
    }
    return null;
  }

  function clipMemoryField(
    value,
    max
  ) {
    const text =
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();

    if (
      text.length <= max
    ) {
      return text;
    }

    const tail =
      Math.max(
        100,
        Math.floor(
          max * .26
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

  function normalizeMemory(memory) {
    if (
      !memory ||
      typeof memory !== "object" ||
      Array.isArray(memory)
    ) {
      return null;
    }

    return {
      flow:
        clipMemoryField(
          memory.flow,
          700
        ),
      recent:
        clipMemoryField(
          memory.recent,
          1400
        ),
      detail:
        clipMemoryField(
          memory.detail,
          1900
        )
    };
  }

  function loadMemory() {
    return normalizeMemory(memoryStore.value);
  }

  function saveMemory(memory) {
    const normalized =
      normalizeMemory(memory);

    if (!normalized) {
      return;
    }

    state.conversationMemory =
      normalized;
    memoryStore.value = normalized;
    scheduleWorkspaceSave();
  }

  function clearMemory() {
    state.conversationMemory = null;
    memoryStore.value = null;
    scheduleWorkspaceSave();
  }

  function storageSafe(value) {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    if (typeof value === "string") {
      if (
        value.startsWith("blob:") ||
        (
          value.startsWith("data:") &&
          value.length > 2048
        )
      ) {
        return "";
      }

      return value;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map(storageSafe)
        .filter(item =>
          item !== undefined
        );
    }

    if (typeof value === "object") {
      const out = {};

      for (
        const [key, item]
        of Object.entries(value)
      ) {
        const safe =
          storageSafe(item);

        if (safe !== undefined) {
          out[key] = safe;
        }
      }

      return out;
    }

    return undefined;
  }

  function conversationTitleFromText(text) {
    const value =
      String(text || "")
        .replace(/\s+/g, " ")
        .trim();

    if (!value) {
      return "새 대화";
    }

    return value.length > 36
      ? value.slice(0, 35) + "…"
      : value;
  }

  function currentConversationId() {
    return (
      state.activeConversationId ||
      WorkspaceStore
        .getActiveConversation?.()
        ?.id ||
      null
    );
  }

  async function saveActiveConversation() {
    if (
      state.destroyed ||
      state.restoringConversation
    ) {
      return null;
    }

    const id =
      currentConversationId();

    if (!id) {
      return null;
    }

    if (state.workspaceSaveTimer) {
      clearTimeout(
        state.workspaceSaveTimer
      );
      state.workspaceSaveTimer =
        null;
    }

    const liveCanvasState =
      state.canvas
        ?.getState?.() ||
      {
        workflow:
          state.canvas
            ?.getWorkflow?.() ||
          {
            nodes: [],
            connections: []
          }
      };

    const canvasState =
      state.workflowProposal
        ?.beforeState
        ? clone(
            state.workflowProposal
              .beforeState
          )
        : liveCanvasState;

    const currentMode =
      UI.getMode?.() ||
      "chat";

    const conversationMode =
      currentMode ===
        "library"
        ? (
            WorkspaceStore
              .getConversation?.(
                id
              )
              ?.state
              ?.mode ||
            "chat"
          )
        : currentMode;

    return WorkspaceStore
      .updateConversationState(
        id,
        {
          mode:
            conversationMode,
          messages:
            storageSafe(
              state.messages
            ) || [],
          canvas:
            storageSafe(
              canvasState
            ),
          lastUserRequest:
            state.lastUserRequest,
          workflowUserRequest:
            state.workflowUserRequest
        },
        normalizeMemory(
          state.conversationMemory
        ) || {
          flow: "",
          recent: "",
          detail: ""
        }
      );
  }

  function scheduleWorkspaceSave(
    delay = 180
  ) {
    if (
      state.destroyed ||
      state.restoringConversation ||
      !state.ready
    ) {
      return;
    }

    clearTimeout(
      state.workspaceSaveTimer
    );

    state.workspaceSaveTimer =
      setTimeout(
        () => {
          state.workspaceSaveTimer =
            null;

          void saveActiveConversation();
        },
        delay
      );
  }

  function scrollChatToBottom(immediate = false) {
    if (immediate) {
      chatContent.scrollTop = chatContent.scrollHeight;
      return;
    }
    requestAnimationFrame(() => {
      chatContent.scrollTop = chatContent.scrollHeight;
    });
  }

  function syncPhysicalOrientation() {
    const orientationType =
      global.screen?.orientation?.type;

    const isLandscape =
      typeof orientationType === "string"
        ? orientationType.startsWith("landscape")
        : Number(global.screen?.width) > Number(global.screen?.height);

    document.documentElement.classList.toggle(
      "physical-landscape",
      !!isLandscape
    );
  }

  function syncAppViewport() {
    UI.syncViewport?.();
  }

  function cleanPublicMessage(
    value,
    fallback = ""
  ) {
    const text =
      String(value || "")
        .replace(/[\u0000-\u001f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 260);

    return text || fallback;
  }

  function errorPresentation(
    error,
    fallback =
      "작업을 완료하지 못했습니다."
  ) {
    const code =
      String(
        error?.code ||
        error?.cause?.code ||
        ""
      )
        .trim()
        .toUpperCase();

    const status =
      Number(
        error?.status ||
        error?.cause?.status ||
        0
      );

    const rawMessage =
      cleanPublicMessage(
        error?.message,
        ""
      );

    const noisy =
      /(?:Groq|Gemini) API (?:오류|error):?\s*\d+\s*[\[{]/i
        .test(
          rawMessage
        );

    let title =
      "작업 오류";

    if (
      status === 429 ||
      /rate limit|quota|too many requests/i
        .test(rawMessage)
    ) {
      title =
        "요청이 많아";
    } else if (
      status === 413 ||
      code ===
        "CLIENT_PAYLOAD_TOO_LARGE" ||
      code ===
        "GEMINI_GROUP_TOO_LARGE" ||
      /payload too large|too large/i
        .test(rawMessage)
    ) {
      title =
        "작업이 너무 커";
    } else if (
      code ===
        "GEMINI_UPSTREAM_TIMEOUT"
    ) {
      title =
        "AI 응답 지연";
    } else if (
      /NETWORK|FETCH/.test(
        code
      ) ||
      /network|fetch failed|connection/i
        .test(rawMessage)
    ) {
      title =
        "연결 오류";
    } else if (
      code.includes(
        "API_KEY"
      )
    ) {
      title =
        "API 설정 필요";
    } else if (
      code ===
        "GEMINI_REQUEST_REFUSED"
    ) {
      title =
        "실행할 수 없음";
    } else if (
      code.startsWith(
        "INVALID_"
      )
    ) {
      title =
        "응답 처리 오류";
    }

    const detail =
      !noisy &&
      rawMessage
        ? rawMessage
        : fallback;

    return {
      title,
      detail:
        cleanPublicMessage(
          detail,
          fallback
        ),
      code:
        code ||
        (
          status
            ? String(status)
            : ""
        ),
      retryable:
        error?.retryable ===
          true ||
        status === 429 ||
        status >= 500 ||
        /NETWORK|FETCH/.test(
          code
        )
    };
  }

  function userFacingError(
    error,
    fallback =
      "작업을 완료하지 못했습니다."
  ) {
    return errorPresentation(
      error,
      fallback
    ).detail;
  }

  function dismissErrorNotice() {
    const notice =
      state.errorNotice;

    state.errorNotice =
      null;
    state.errorRetry =
      null;

    if (!notice) {
      return;
    }

    notice.classList.add(
      "is-leaving"
    );

    setTimeout(
      () => {
        notice.remove();
      },
      180
    );
  }

  function showErrorNotice(
    error,
    options = {}
  ) {
    dismissErrorNotice();

    const presentation =
      errorPresentation(
        error,
        options.fallback ||
        "작업을 완료하지 못했습니다."
      );

    const notice =
      document.createElement(
        "section"
      );

    notice.className =
      "ovll-error-notice";

    notice.setAttribute(
      "role",
      "status"
    );

    notice.setAttribute(
      "aria-live",
      "polite"
    );

    const mark =
      document.createElement(
        "span"
      );

    mark.className =
      "ovll-error-mark";

    mark.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 3.4a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 0 1 0-13.2Z" stroke="currentColor" stroke-width="1.45"/>
        <path d="M10 6.4v4.2" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/>
        <circle cx="10" cy="13.4" r=".85" fill="currentColor"/>
      </svg>
    `;

    const copy =
      document.createElement(
        "div"
      );

    copy.className =
      "ovll-error-copy";

    const title =
      document.createElement(
        "strong"
      );

    title.textContent =
      String(
        options.scope ||
        presentation.title
      );

    const detail =
      document.createElement(
        "span"
      );

    detail.textContent =
      presentation.detail;

    copy.append(
      title,
      detail
    );

    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "ovll-error-actions";

    if (
      typeof options.onRetry ===
        "function"
    ) {
      const retry =
        document.createElement(
          "button"
        );

      retry.type =
        "button";

      retry.className =
        "ovll-error-retry";

      retry.textContent =
        options.retryLabel ||
        "재시도";

      retry.addEventListener(
        "click",
        () => {
          const handler =
            state.errorRetry;

          dismissErrorNotice();

          if (
            typeof handler ===
              "function"
          ) {
            handler();
          }
        }
      );

      actions.appendChild(
        retry
      );

      state.errorRetry =
        options.onRetry;
    }

    const close =
      document.createElement(
        "button"
      );

    close.type =
      "button";

    close.className =
      "ovll-error-close";

    close.setAttribute(
      "aria-label",
      "오류 닫기"
    );

    close.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="m6.4 6.4 7.2 7.2M13.6 6.4l-7.2 7.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    `;

    close.addEventListener(
      "click",
      dismissErrorNotice
    );

    actions.appendChild(
      close
    );

    notice.append(
      mark,
      copy,
      actions
    );

    const stage =
      document.querySelector(
        "#app-stage"
      );

    stage?.appendChild(
      notice
    );

    state.errorNotice =
      notice;

    requestAnimationFrame(
      () => {
        notice.classList.add(
          "is-visible"
        );
      }
    );

    return notice;
  }


  function escapeChatHtml(value) {
    return String(
      value ?? ""
    )
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInlineChatMarkup(
    value
  ) {
    let text =
      escapeChatHtml(
        value
      );

    const inlineCode = [];

    text = text.replace(
      /\`([^\`\n]+)\`/g,
      (_, code) => {
        const token =
          `@@OVLL_INLINE_${inlineCode.length}@@`;

        inlineCode.push(
          `<code>${code}</code>`
        );

        return token;
      }
    );

    text = text
      .replace(
        /\*\*([^*\n]+)\*\*/g,
        "<strong>$1</strong>"
      )
      .replace(
        /__([^_\n]+)__/g,
        "<strong>$1</strong>"
      )
      .replace(
        /~~([^~\n]+)~~/g,
        "<del>$1</del>"
      )
      .replace(
        /(^|[^*])\*([^*\n]+)\*/g,
        "$1<em>$2</em>"
      );

    inlineCode.forEach(
      (html, index) => {
        text = text.replaceAll(
          `@@OVLL_INLINE_${index}@@`,
          html
        );
      }
    );

    return text;
  }

  function normalizeChatTableLine(
    value
  ) {
    let line =
      String(value ?? "")
        .trim()
        .replace(
          /\\\s*$/,
          ""
        )
        .trim();

    const strongWrapped =
      (
        line.startsWith("**|") &&
        line.endsWith("|**")
      ) ||
      (
        line.startsWith("__|") &&
        line.endsWith("|__")
      );

    if (strongWrapped) {
      line =
        line
          .slice(
            2,
            -2
          )
          .trim();
    }

    return line;
  }

  function splitChatTableRow(
    value
  ) {
    let line =
      normalizeChatTableLine(
        value
      );

    if (
      !line ||
      !line.includes("|")
    ) {
      return null;
    }

    if (
      line.startsWith("|")
    ) {
      line =
        line.slice(1);
    }

    if (
      line.endsWith("|")
    ) {
      line =
        line.slice(
          0,
          -1
        );
    }

    const cells =
      line
        .split("|")
        .map(
          cell =>
            cell.trim()
        );

    return cells.length >= 2
      ? cells
      : null;
  }

  function chatTableAlignments(
    value
  ) {
    const cells =
      splitChatTableRow(
        value
      );

    if (
      !cells ||
      !cells.length
    ) {
      return null;
    }

    const compact =
      cells.map(
        cell =>
          cell.replace(
            /\s+/g,
            ""
          )
      );

    if (
      !compact.every(
        cell =>
          /^:?-{3,}:?$/
            .test(cell)
      )
    ) {
      return null;
    }

    return compact.map(
      cell => {
        const left =
          cell.startsWith(":");
        const right =
          cell.endsWith(":");

        if (
          left &&
          right
        ) {
          return "center";
        }

        if (right) {
          return "right";
        }

        return "left";
      }
    );
  }

  function renderChatTable(
    headers,
    alignments,
    rows
  ) {
    const alignClass =
      alignment =>
        alignment === "center"
          ? " is-center"
          : alignment === "right"
            ? " is-right"
            : "";

    const normalizedRows =
      rows.map(
        row =>
          headers.map(
            (_, index) =>
              row[index] ?? ""
          )
      );

    return [
      '<div class="astra-chat-table-wrap">',
      '<table class="astra-chat-table">',
      "<thead><tr>",
      headers
        .map(
          (cell, index) =>
            `<th class="${alignClass(
              alignments[index]
            ).trim()}">${renderInlineChatMarkup(cell)}</th>`
        )
        .join(""),
      "</tr></thead>",
      "<tbody>",
      normalizedRows
        .map(
          row =>
            "<tr>" +
            row
              .map(
                (cell, index) =>
                  `<td class="${alignClass(
                    alignments[index]
                  ).trim()}">${renderInlineChatMarkup(cell)}</td>`
              )
              .join("") +
            "</tr>"
        )
        .join(""),
      "</tbody>",
      "</table>",
      "</div>"
    ].join("");
  }

  function chatMarkupHtml(
    value
  ) {
    let source =
      String(value ?? "")
        .replace(/\r\n?/g, "\n");

    const codeBlocks = [];

    source = source.replace(
      /\`\`\`([^\n\`]*)\n([\s\S]*?)\`\`\`/g,
      (_, language, code) => {
        const index =
          codeBlocks.length;

        const safeLanguage =
          String(language || "")
            .trim()
            .replace(
              /[^a-z0-9_-]/gi,
              ""
            )
            .slice(0, 24);

        codeBlocks.push(
          `<pre><code${safeLanguage ? ` class="language-${safeLanguage}"` : ""}>${escapeChatHtml(code.replace(/\n$/, ""))}</code></pre>`
        );

        return `\n@@OVLL_BLOCK_${index}@@\n`;
      }
    );

    const lines =
      source.split("\n");

    const html = [];
    let paragraph = [];
    let listType = null;
    let listItems = [];

    const flushParagraph = () => {
      if (!paragraph.length) {
        return;
      }

      html.push(
        `<p>${paragraph.map(renderInlineChatMarkup).join("<br>")}</p>`
      );

      paragraph = [];
    };

    const flushList = () => {
      if (
        !listType ||
        !listItems.length
      ) {
        listType = null;
        listItems = [];
        return;
      }

      html.push(
        `<${listType}>${listItems.map(item => `<li>${renderInlineChatMarkup(item)}</li>`).join("")}</${listType}>`
      );

      listType = null;
      listItems = [];
    };

    for (
      let lineIndex = 0;
      lineIndex < lines.length;
      lineIndex++
    ) {
      const rawLine =
        lines[lineIndex];

      const blockMatch =
        rawLine.match(
          /^@@OVLL_BLOCK_(\d+)@@$/
        );

      if (blockMatch) {
        flushParagraph();
        flushList();

        const block =
          codeBlocks[
            Number(
              blockMatch[1]
            )
          ];

        if (block) {
          html.push(block);
        }

        continue;
      }

      if (!rawLine.trim()) {
        flushParagraph();
        flushList();
        continue;
      }

      const tableHeaders =
        splitChatTableRow(
          rawLine
        );

      const tableAlignments =
        lineIndex + 1 <
          lines.length
          ? chatTableAlignments(
              lines[
                lineIndex + 1
              ]
            )
          : null;

      if (
        tableHeaders &&
        tableAlignments &&
        tableHeaders.length ===
          tableAlignments.length
      ) {
        flushParagraph();
        flushList();

        const rows = [];
        lineIndex += 2;

        while (
          lineIndex <
          lines.length
        ) {
          const row =
            splitChatTableRow(
              lines[lineIndex]
            );

          if (
            !row ||
            row.length !==
              tableHeaders.length
          ) {
            lineIndex--;
            break;
          }

          rows.push(row);
          lineIndex++;
        }

        html.push(
          renderChatTable(
            tableHeaders,
            tableAlignments,
            rows
          )
        );

        continue;
      }

      const heading =
        rawLine.match(
          /^(#{1,3})\s+(.+)$/
        );

      if (heading) {
        flushParagraph();
        flushList();

        const level =
          heading[1].length;

        html.push(
          `<h${level}>${renderInlineChatMarkup(heading[2])}</h${level}>`
        );
        continue;
      }

      const bullet =
        rawLine.match(
          /^\s*[-*]\s+(.+)$/
        );

      if (bullet) {
        flushParagraph();

        if (
          listType &&
          listType !== "ul"
        ) {
          flushList();
        }

        listType = "ul";
        listItems.push(
          bullet[1]
        );
        continue;
      }

      const ordered =
        rawLine.match(
          /^\s*\d+[.)]\s+(.+)$/
        );

      if (ordered) {
        flushParagraph();

        if (
          listType &&
          listType !== "ol"
        ) {
          flushList();
        }

        listType = "ol";
        listItems.push(
          ordered[1]
        );
        continue;
      }

      const quote =
        rawLine.match(
          /^\s*>\s?(.+)$/
        );

      if (quote) {
        flushParagraph();
        flushList();

        html.push(
          `<blockquote>${renderInlineChatMarkup(quote[1])}</blockquote>`
        );
        continue;
      }

      if (listType) {
        flushList();
      }

      paragraph.push(
        rawLine
      );
    }

    flushParagraph();
    flushList();

    return html.join("");
  }

  function renderChatMarkup(
    element,
    value
  ) {
    if (!element) {
      return;
    }

    element.classList.add(
      "astra-message-markup"
    );

    element.innerHTML =
      chatMarkupHtml(
        value
      );
  }

  function generatedChatBlocks(
    value
  ) {
    const source =
      String(value ?? "")
        .replace(/\r\n?/g, "\n");

    const blocks = [];
    const pattern =
      /\`\`\`([^\n\`]*)\n([\s\S]*?)\`\`\`/g;

    let cursor = 0;
    let match;

    while (
      (
        match =
          pattern.exec(source)
      )
    ) {
      const before =
        source
          .slice(
            cursor,
            match.index
          )
          .trim();

      if (before) {
        blocks.push({
          type: "markup",
          value: before
        });
      }

      const language =
        String(
          match[1] || ""
        )
          .trim()
          .toLowerCase()
          .replace(
            /[^a-z0-9_-]/g,
            ""
          )
          .slice(0, 24);

      const code =
        String(
          match[2] || ""
        )
          .replace(
            /\n$/,
            ""
          );

      blocks.push({
        type:
          language === "html" ||
          language === "htm"
            ? "live-html"
            : "code",
        language,
        value: code
      });

      cursor =
        pattern.lastIndex;
    }

    const tail =
      source
        .slice(cursor)
        .trim();

    if (tail) {
      blocks.push({
        type: "markup",
        value: tail
      });
    }

    if (!blocks.length && source.trim()) {
      blocks.push({
        type: "markup",
        value: source.trim()
      });
    }

    return blocks;
  }

  function renderCodeBlock(
    block
  ) {
    const root =
      document.createElement(
        "section"
      );

    root.className =
      "astra-chat-block astra-chat-code-block";

    const header =
      document.createElement(
        "header"
      );

    header.className =
      "astra-chat-block-header";

    const label =
      document.createElement(
        "span"
      );

    label.textContent =
      block.language ||
      "code";

    header.appendChild(
      label
    );

    const pre =
      document.createElement(
        "pre"
      );

    const code =
      document.createElement(
        "code"
      );

    if (block.language) {
      code.className =
        `language-${block.language}`;
    }

    code.textContent =
      block.value;

    pre.appendChild(
      code
    );

    root.append(
      header,
      pre
    );

    return root;
  }

  function renderLiveHtmlBlock(
    block
  ) {
    const root =
      document.createElement(
        "section"
      );

    root.className =
      "astra-chat-block astra-chat-live-html";

    const header =
      document.createElement(
        "header"
      );

    header.className =
      "astra-chat-block-header";

    const label =
      document.createElement(
        "span"
      );

    label.textContent =
      "HTML 미리보기";

    const toggle =
      document.createElement(
        "button"
      );

    toggle.type =
      "button";

    toggle.className =
      "astra-chat-block-toggle";

    toggle.textContent =
      "코드";

    header.append(
      label,
      toggle
    );

    const preview =
      document.createElement(
        "div"
      );

    preview.className =
      "astra-chat-live-preview";

    const frame =
      PreviewSandbox.createFrame(
        block.value,
        {
          title:
            "HTML 실행 미리보기"
        }
      );

    preview.appendChild(
      frame
    );

    const source =
      renderCodeBlock({
        ...block,
        type: "code"
      });

    source.classList.add(
      "astra-chat-live-source"
    );

    source.hidden =
      true;

    toggle.addEventListener(
      "click",
      () => {
        const showingCode =
          source.hidden;

        source.hidden =
          !showingCode;

        preview.hidden =
          showingCode;

        toggle.textContent =
          showingCode
            ? "미리보기"
            : "코드";
      }
    );

    root.append(
      header,
      preview,
      source
    );

    return root;
  }

  function normalizeGeneratedBlocks(
    value,
    blocks
  ) {
    if (
      Array.isArray(blocks) &&
      blocks.length
    ) {
      const normalized =
        blocks
          .map(
            block => {
              if (
                !block ||
                typeof block !==
                  "object"
              ) {
                return null;
              }

              const type =
                String(
                  block.type || ""
                );

              if (
                ![
                  "markup",
                  "code",
                  "live-html"
                ].includes(type)
              ) {
                return null;
              }

              return {
                type,
                language:
                  String(
                    block.language || ""
                  )
                    .toLowerCase()
                    .slice(0,24),
                value:
                  String(
                    block.value ?? ""
                  )
              };
            }
          )
          .filter(Boolean);

      if (normalized.length) {
        return normalized;
      }
    }

    return generatedChatBlocks(
      value
    );
  }

  function renderGeneratedChat(
    element,
    value,
    artifacts=[],
    structuredBlocks=[]
  ) {
    if (!element) {
      return;
    }

    element.replaceChildren();

    element.classList.add(
      "astra-message-blocks"
    );

    const blocks =
      normalizeGeneratedBlocks(
        value,
        structuredBlocks
      );

    for (
      const block
      of blocks
    ) {
      if (
        block.type ===
          "live-html"
      ) {
        element.appendChild(
          renderLiveHtmlBlock(
            block
          )
        );

        continue;
      }

      if (
        block.type ===
          "code"
      ) {
        element.appendChild(
          renderCodeBlock(
            block
          )
        );

        continue;
      }

      const markup =
        document.createElement(
          "div"
        );

      markup.className =
        "astra-chat-block astra-chat-markup-block";

      renderChatMarkup(
        markup,
        block.value
      );

      element.appendChild(
        markup
      );
    }

    appendArtifactCards(
      element,
      artifacts
    );
  }

  /* =======================================================
     Chat
     ======================================================= */

  function formatArtifactSize(
    value
  ) {
    return ArtifactVisuals
      .formatSize(value);
  }

  async function hydrateArtifactReference(
    artifact
  ) {
    if (
      !artifact ||
      typeof artifact !==
        "object"
    ) {
      return artifact;
    }

    let localFileId =
      String(
        artifact.localFileId ||
        ""
      );

    try {
      if (
        !localFileId &&
        artifact.id
      ) {
        const matched =
          await FileStore
            .findByOriginId?.(
              artifact.id
            );

        localFileId =
          String(
            matched?.id ||
            matched?.localFileId ||
            ""
          );
      }

      if (!localFileId) {
        return artifact;
      }

      const local =
        await FileStore.hydrate(
          localFileId
        );

      if (!local) {
        return artifact;
      }

      return {
        ...artifact,
        localFileId,
        name:
          artifact.name ||
          local.name,
        mime:
          artifact.mime ||
          local.mime,
        size:
          Number(
            artifact.size ||
            local.size ||
            0
          ),
        downloadUrl:
          local.downloadUrl ||
          "",
        previewUrl:
          local.previewUrl ||
          "",
        format:
          artifact.format ||
          local.format ||
          "",
        renderer:
          artifact.renderer ||
          local.renderer ||
          "",
        targetPages:
          artifact.targetPages ??
          local.targetPages ??
          null,
        previewKind:
          artifact.previewKind ||
          local.previewKind ||
          "",
        previewText:
          artifact.previewText ||
          local.previewText ||
          ""
      };
    } catch (error) {
      console.warn(
        "ovll local file hydrate failed:",
        error
      );

      return artifact;
    }
  }

  async function persistArtifactLocally(
    artifact,
    source = "generated"
  ) {
    if (
      !artifact ||
      typeof artifact !==
        "object"
    ) {
      return artifact;
    }

    if (artifact.localFileId) {
      const hydrated =
        await hydrateArtifactReference(
          artifact
        );

      Object.assign(
        artifact,
        hydrated
      );

      return artifact;
    }

    const downloadUrl =
      String(
        artifact.downloadUrl ||
        ""
      );

    if (!downloadUrl) {
      return artifact;
    }

    try {
      const stored =
        await FileStore.putRemote(
          downloadUrl,
          {
            name:
              artifact.name ||
              "결과물",
            mime:
              artifact.mime ||
              "application/octet-stream",
            size:
              Number(
                artifact.size ||
                0
              ),
            source,
            originId:
              artifact.id ||
              "",
            conversationId:
              currentConversationId(),
            format:
              artifact.format ||
              "",
            renderer:
              artifact.renderer ||
              "",
            targetPages:
              artifact.targetPages ??
              null,
            previewKind:
              artifact.previewKind ||
              "",
            previewText:
              artifact.previewText ||
              ""
          }
        );

      const local =
        await FileStore.hydrate(
          stored.id
        );

      artifact.localFileId =
        stored.id;

      if (local) {
        artifact.downloadUrl =
          local.downloadUrl;
        artifact.previewUrl =
          local.previewUrl;

        if (
          !artifact.previewText &&
          local.previewText
        ) {
          artifact.previewText =
            local.previewText;
        }
      }
    } catch (error) {
      console.warn(
        "ovll generated file local save failed:",
        error
      );
    }

    return artifact;
  }

  async function hydrateCanvasFiles(
    canvasState
  ) {
    const next =
      canvasState
        ? clone(
            canvasState
          )
        : canvasState;

    const nodes =
      next?.workflow?.nodes ||
      next?.nodes;

    if (!Array.isArray(nodes)) {
      return next;
    }

    await Promise.all(
      nodes.map(
        async node => {
          if (
            node?.type !==
              "file" ||
            !node.data
          ) {
            return;
          }

          let localFileId =
            String(
              node.data
                .localFileId ||
              ""
            );

          try {
            if (
              !localFileId &&
              node.data.artifactId
            ) {
              const matched =
                await FileStore
                  .findByOriginId?.(
                    node.data
                      .artifactId
                  );

              localFileId =
                String(
                  matched?.id ||
                  matched
                    ?.localFileId ||
                  ""
                );

              if (localFileId) {
                node.data.localFileId =
                  localFileId;
              }
            }

            if (!localFileId) {
              return;
            }

            const local =
              await FileStore.hydrate(
                localFileId
              );

            if (!local) {
              return;
            }

            node.data.downloadUrl =
              local.downloadUrl;
            node.data.previewUrl =
              local.previewUrl;

            if (
              local.imagePreview
            ) {
              node.data.imagePreview =
                local.imagePreview;
            }

            if (
              !node.data.textPreview &&
              local.previewText
            ) {
              node.data.textPreview =
                local.previewText;
            }

            node.data.name =
              node.data.name ||
              local.name;
            node.data.mime =
              node.data.mime ||
              local.mime;
            node.data.size =
              Number(
                node.data.size ||
                local.size ||
                0
              );
          } catch (error) {
            console.warn(
              "ovll canvas file hydrate failed:",
              error
            );
          }
        }
      )
    );

    return next;
  }

  async function hydrateStoredMessages(
    messages
  ) {
    const list =
      Array.isArray(messages)
        ? clone(messages)
        : [];

    await Promise.all(
      list.map(
        async message => {
          if (
            !Array.isArray(
              message?.artifacts
            )
          ) {
            return;
          }

          message.artifacts =
            await Promise.all(
              message.artifacts.map(
                hydrateArtifactReference
              )
            );
        }
      )
    );

    return list;
  }

  function artifactFormat(
    artifact
  ) {
    return ArtifactVisuals
      .format(artifact);
  }

  function artifactVisual(
    artifact
  ) {
    return ArtifactVisuals
      .visual(artifact);
  }

  function artifactCanPreview(
    artifact
  ) {
    return PreviewEngine
      .canPreview(
        artifact
      );
  }

  async function openArtifactPreview(
    artifact
  ) {
    artifact =
      await hydrateArtifactReference(
        artifact
      );

    const remotePreviewUrl =
      String(
        artifact?.previewUrl ||
        ""
      );

    if (
      !artifact?.localFileId &&
      remotePreviewUrl &&
      /\/api\/artifacts\//i
        .test(
          remotePreviewUrl
        )
    ) {
      try {
        const response =
          await fetch(
            remotePreviewUrl,
            {
              method:
                "HEAD",
              cache:
                "no-store"
            }
          );

        if (!response.ok) {
          artifact = {
            ...artifact,
            previewUrl:
              "",
            downloadUrl:
              ""
          };
        }
      } catch {
        artifact = {
          ...artifact,
          previewUrl:
            "",
          downloadUrl:
            ""
        };
      }
    }

    if (
      !artifactCanPreview(
        artifact
      )
    ) {
      return false;
    }

    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    document
      .querySelector(
        ".astra-artifact-preview-root"
      )
      ?.remove();

    const visual =
      artifactVisual(
        artifact
      );

    const root =
      document.createElement(
        "div"
      );

    root.className =
      "astra-artifact-preview-root";

    const panel =
      document.createElement(
        "section"
      );

    panel.className =
      "astra-artifact-preview-panel";

    const resolvedPreviewKind =
      PreviewEngine
        .kind(
          artifact
        ) ||
      "file";

    root.dataset.previewKind =
      resolvedPreviewKind;

    panel.dataset.previewKind =
      resolvedPreviewKind;

    panel.setAttribute(
      "role",
      "dialog"
    );

    panel.setAttribute(
      "aria-modal",
      "true"
    );

    panel.setAttribute(
      "aria-label",
      `${artifact?.name || "결과물"} 미리보기`
    );

    panel.style.setProperty(
      "--artifact-accent",
      visual.color
    );

    const header =
      document.createElement(
        "header"
      );

    header.className =
      "astra-artifact-preview-header";

    const icon =
      document.createElement(
        "span"
      );

    icon.className =
      "astra-artifact-preview-icon";

    icon.innerHTML =
      visual.icon;

    const copy =
      document.createElement(
        "span"
      );

    copy.className =
      "astra-artifact-preview-copy";

    const title =
      document.createElement(
        "strong"
      );

    title.textContent =
      String(
        artifact?.name ||
        "결과물"
      );

    const meta =
      document.createElement(
        "small"
      );

    meta.textContent =
      `${artifactFormat(artifact)} · ${formatArtifactSize(artifact?.size)}`;

    copy.append(
      title,
      meta
    );

    const actions =
      document.createElement(
        "span"
      );

    actions.className =
      "astra-artifact-preview-actions";

    const download =
      document.createElement(
        "a"
      );

    download.className =
      "astra-artifact-preview-download";

    download.href =
      String(
        artifact?.downloadUrl ||
        "#"
      );

    download.hidden =
      !artifact?.downloadUrl;

    download.download =
      String(
        artifact?.name ||
        "result"
      );

    download.setAttribute(
      "aria-label",
      "다운로드"
    );

    download.innerHTML = `
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M9 3.1v7m0 0 2.45-2.45M9 10.1 6.55 7.65M4.2 13.55h9.6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;

    const close =
      document.createElement(
        "button"
      );

    close.type =
      "button";

    close.className =
      "astra-artifact-preview-close";

    close.setAttribute(
      "aria-label",
      "미리보기 닫기"
    );

    close.innerHTML = `
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="m5.3 5.3 7.4 7.4M12.7 5.3l-7.4 7.4" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/>
      </svg>
    `;

    actions.append(
      download,
      close
    );

    header.append(
      icon,
      copy,
      actions
    );

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "astra-artifact-preview-body";

    const shown =
      await PreviewEngine
        .render(
          body,
          artifact,
          {
            fileStore:
              FileStore,
            textClassName:
              "astra-artifact-preview-text",
            renderDocument:
              (
                preview,
                text
              ) => {
                preview.className =
                  "astra-artifact-preview-document";

                renderChatMarkup(
                  preview,
                  text
                );
              }
          }
        );

    if (!shown) {
      return false;
    }

    Navigation.open(
      "artifact-preview"
    );

    panel.append(
      header,
      body
    );

    root.appendChild(
      panel
    );

    let closed = false;

    const closePreviewNow =
      () => {
        if (closed) return;
        closed = true;

        root.classList.remove(
          "is-open"
        );

        document.removeEventListener(
          "keydown",
          keyHandler
        );

        global.removeEventListener(
          "ovll:navigation-back",
          navigationHandler
        );

        setTimeout(
          () => {
            root.remove();

            if(
              returnFocus?.isConnected &&
              typeof returnFocus.focus === "function"
            ){
              try{
                returnFocus.focus({
                  preventScroll:true
                });
              }catch{
                returnFocus.focus();
              }
            }
          },
          180
        );
      };

    const closePreview =
      (options = {}) => {
        if (closed) return;

        if (
          options.history !==
            false &&
          Navigation.isCurrent(
            "artifact-preview"
          )
        ) {
          Navigation.close(
            "artifact-preview",
            closePreviewNow
          );
          return;
        }

        closePreviewNow();
      };

    const keyHandler =
      event => {
        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();
          closePreview();
        }
      };

    const navigationHandler =
      event => {
        if (
          event.detail?.layer ===
            "artifact-preview"
        ) {
          closePreview({
            history:false
          });
        }
      };

    close.addEventListener(
      "click",
      closePreview
    );

    root.addEventListener(
      "click",
      event => {
        if (
          event.target ===
          root
        ) {
          closePreview();
        }
      }
    );

    document.addEventListener(
      "keydown",
      keyHandler
    );

    global.addEventListener(
      "ovll:navigation-back",
      navigationHandler
    );

    document.body.appendChild(
      root
    );

    requestAnimationFrame(
      () => {
        root.classList.add(
          "is-open"
        );

        close.focus({
          preventScroll: true
        });
      }
    );

    return true;
  }

  function appendArtifactCards(
    message,
    artifacts
  ) {
    const list =
      Array.isArray(artifacts)
        ? artifacts.filter(Boolean)
        : [];

    if (!list.length) return;

    const group =
      document.createElement(
        "div"
      );

    group.className =
      "astra-message-artifacts";

    for (
      const artifact of list
    ) {
      const {
        element:link
      } =
        ArtifactVisuals
          .createCard(
            artifact,
            {
              tagName:"a",
              action:"download",
              inlinePreview:true
            }
          );

      const canPreview =
        artifactCanPreview(
          artifact
        );

      link.setAttribute(
        "aria-label",
        canPreview
          ? (artifact.name || "결과물") + " 미리보기. 오른쪽 아이콘으로 다운로드"
          : (artifact.name || "결과물") + " 다운로드"
      );

      if (canPreview) {
        link.classList.add(
          "is-previewable"
        );

        link.addEventListener(
          "click",
          event => {
            if (
              event.target.closest(
                ".astra-artifact-download"
              )
            ) {
              return;
            }

            event.preventDefault();

            void openArtifactPreview(
              artifact
            );
          }
        );
      }

      group.appendChild(
        link
      );
    }

    message.appendChild(
      group
    );
  }

  function showWorkflowProposalDock(
    proposalId
  ) {
    const id =
      String(
        proposalId || ""
      );

    if (!id) {
      return;
    }

    canvasPage
      .querySelector(
        ".astra-canvas-workflow-proposal"
      )
      ?.remove();

    const dock =
      document.createElement(
        "div"
      );

    dock.className =
      "astra-canvas-workflow-proposal";

    dock.dataset
      .workflowProposalId =
      id;

    const copy =
      document.createElement(
        "div"
      );

    copy.className =
      "astra-canvas-workflow-proposal-copy";

    const label =
      document.createElement(
        "strong"
      );

    label.className =
      "astra-canvas-workflow-proposal-label";

    label.textContent =
      "노드 변경 미리보기";

    const hint =
      document.createElement(
        "span"
      );

    hint.textContent =
      "바뀐 구성을 확인하고 결정해";

    copy.append(
      label,
      hint
    );

    const actions =
      document.createElement(
        "div"
      );

    actions.className =
      "astra-canvas-workflow-proposal-actions";

    const revert =
      document.createElement(
        "button"
      );

    revert.type =
      "button";
    revert.className =
      "astra-workflow-proposal-action";
    revert.dataset
      .workflowProposalAction =
      "revert";
    revert.textContent =
      "되돌리기";
    revert.disabled =
      state.busy;

    const accept =
      document.createElement(
        "button"
      );

    accept.type =
      "button";
    accept.className =
      "astra-workflow-proposal-action is-accept";
    accept.dataset
      .workflowProposalAction =
      "accept";
    accept.textContent =
      "적용";
    accept.disabled =
      state.busy;

    actions.append(
      revert,
      accept
    );

    dock.append(
      copy,
      actions
    );

    dock.addEventListener(
      "click",
      event => {
        const button =
          event.target.closest(
            "[data-workflow-proposal-action]"
          );

        if (!button) return;

        event.preventDefault();
        event.stopPropagation();

        if (
          button.dataset
            .workflowProposalAction ===
            "accept"
        ) {
          acceptWorkflowProposal(
            id
          );
        } else {
          rejectWorkflowProposal(
            id
          );
        }
      }
    );

    canvasPage.appendChild(
      dock
    );

    requestAnimationFrame(
      () =>
        dock.classList.add(
          "is-visible"
        )
    );
  }

  function settleWorkflowProposalUi(
    proposalId,
    status,
    silent = false
  ) {
    const id =
      String(
        proposalId || ""
      );

    if (!id) {
      return;
    }

    canvasPage
      .querySelectorAll(
        ".astra-canvas-workflow-proposal"
      )
      .forEach(
        row => {
          if (
            row.dataset
              .workflowProposalId !==
              id
          ) {
            return;
          }

          if (silent) {
            row.remove();
            return;
          }

          row.classList.add(
            "is-settled"
          );

          const label =
            row.querySelector(
              ".astra-canvas-workflow-proposal-label"
            );

          if (label) {
            label.textContent =
              status ===
                "accepted"
                ? "변경 적용됨"
                : "원래 노드로 복구됨";
          }

          row.querySelectorAll(
            "button"
          )
            .forEach(
              button =>
                button.remove()
            );

          setTimeout(
            () => {
              row.classList.add(
                "is-leaving"
              );

              setTimeout(
                () =>
                  row.remove(),
                180
              );
            },
            700
          );
        }
      );
  }

  function createMessage(
    role,
    text,
    options = {}
  ) {
    const message =
      document.createElement("div");

    const id =
      String(
        options.id ||
        `message-${Date.now().toString(36)}-${++state.messageCount}`
      );

    const value =
      String(text ?? "");

    const artifactList =
      Array.isArray(
        options.artifacts
      )
        ? options.artifacts
            .filter(Boolean)
        : [];

    message.id = id;

    message.className =
      `astra-message astra-message-${role}`;

    message.dataset.role =
      role;

    const body =
      document.createElement("div");

    body.className =
      "astra-message-body";

    if (
      role === "assistant"
    ) {
      renderGeneratedChat(
        body,
        value,
        artifactList,
        options.blocks
      );
    } else {
      body.textContent =
        value;
    }

    message.appendChild(body);

    const question =
      String(
        options.question ?? ""
      ).trim();

    if (
      role === "assistant" &&
      question
    ) {
      const questionBox =
        document.createElement("div");

      questionBox.className =
        "astra-message-question";

      const questionLabel =
        document.createElement("div");

      questionLabel.className =
        "astra-message-question-label";

      questionLabel.textContent =
        "질문";

      const questionBody =
        document.createElement("div");

      questionBody.className =
        "astra-message-question-body";

      questionBody.textContent =
        question;

      questionBox.appendChild(
        questionLabel
      );

      questionBox.appendChild(
        questionBody
      );

      message.appendChild(
        questionBox
      );
    }

    if (
      role === "assistant" &&
      options.showCanvasView &&
      artifactList.length === 0
    ) {
      const canvasButton =
        document.createElement("button");

      canvasButton.type = "button";
      canvasButton.className =
        "astra-message-canvas-link";
      canvasButton.setAttribute(
        "aria-label",
        "캔버스에서 보기"
      );
      canvasButton.innerHTML = `
        <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect x="3.75" y="4.25" width="5" height="5" rx="1.5"></rect>
          <rect x="11.25" y="10.75" width="5" height="5" rx="1.5"></rect>
          <path d="M8.75 6.75h1.4a3.1 3.1 0 0 1 3.1 3.1v.9"></path>
        </svg>
        <span>캔버스에서 보기</span>
      `;

      listen(canvasButton, "click", event => {
        event.preventDefault();
        event.stopPropagation();

        const modeButton =
          document.querySelector("#mode-canvas");

        if (modeButton) {
          modeButton.click();
          return;
        }

        if (
          typeof UI.setMode ===
          "function"
        ) {
          UI.setMode("canvas");
        }
      });

      message.appendChild(canvasButton);
    }

    if (
      role === "assistant" &&
      options.workflowProposalId
    ) {
      showWorkflowProposalDock(
        options.workflowProposalId
      );
    }

    if (
      role === "user" ||
      role === "assistant"
    ) {
      const actions =
        document.createElement("div");

      actions.className =
        "astra-message-actions";

      const copyButton =
        document.createElement("button");

      copyButton.type =
        "button";

      copyButton.className =
        "astra-message-action";

      copyButton.dataset.action =
        "copy";

      copyButton.setAttribute(
        "aria-label",
        "복사"
      );

      copyButton.title =
        "복사";

      copyButton.innerHTML = `
        <svg viewBox="0 0 16 16" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect x="5" y="5" width="7" height="7" rx="1.35"></rect>
          <path d="M3.5 9V4.75c0-.7.55-1.25 1.25-1.25H9"></path>
        </svg>
        <span>복사</span>
      `;

      actions.appendChild(
        copyButton
      );

      if (
        role === "assistant"
      ) {
        const retryButton =
          document.createElement(
            "button"
          );

        retryButton.type =
          "button";

        retryButton.className =
          "astra-message-action";

        retryButton.dataset.action =
          "retry";

        retryButton.setAttribute(
          "aria-label",
          "재시도"
        );

        retryButton.title =
          "재시도";

        retryButton.innerHTML = `
            <svg viewBox="0 0 16 16" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <path d="M12.4 5.4A4.6 4.6 0 1 0 12.8 9.4"></path>
            <path d="M12.4 2.6v2.8H9.6"></path>
          </svg>
          <span>재시도</span>
        `;

        actions.appendChild(
          retryButton
        );
      }

      message.appendChild(
        actions
      );
    }

    chatMessages.appendChild(
      message
    );

    if (
      options.persist !== false
    ) {
      const record = {
        id,
        role,
        text: value,
        blocks:
          role === "assistant"
            ? (
                () => {
                  const blocks =
                    normalizeGeneratedBlocks(
                      value,
                      options.blocks
                    );

                  const structured =
                    Array.isArray(
                      options.blocks
                    ) &&
                    options.blocks.length;

                  const needsBlocks =
                    structured ||
                    blocks.some(
                      block =>
                        block.type !==
                        "markup"
                    );

                  return needsBlocks
                    ? storageSafe(
                        blocks
                      ) || []
                    : [];
                }
              )()
            : [],
        question,
        showCanvasView:
          options.showCanvasView === true,
        artifacts:
          storageSafe(
            artifactList
          ) || [],
        createdAt:
          Number(
            options.createdAt
          ) ||
          Date.now()
      };

      state.messages.push(
        record
      );

      const activeId =
        currentConversationId();

      if (
        role === "user" &&
        activeId
      ) {
        const conversation =
          WorkspaceStore
            .getConversation?.(
              activeId
            );

        if (
          conversation &&
          (
            !conversation.title ||
            conversation.title ===
              "새 대화"
          )
        ) {
          WorkspaceStore
            .updateConversationTitle(
              activeId,
              conversationTitleFromText(
                value
              )
            );
        }
      }

      scheduleWorkspaceSave();
    }

    if (
      role === "assistant" &&
      options.silent !== true
    ) {
      Presence.moveToEnd();
      Presence.settle();

      const shortSpeech =
        String(
          options.presenceSpeech ||
          ""
        ).trim();

      if (shortSpeech) {
        Presence.speak(
          shortSpeech,
          {
            hold: 2600
          }
        );
      }
    }

    scrollChatToBottom();

    return message;
  }

  function addUserMessage(text) {
    const value =
      String(text ?? "").trim();

    if (!value) return null;

    Presence.beginConversation();

    const message =
      createMessage(
        "user",
        value
      );

    return message;
  }

  function addAssistantMessage(
    text,
    options = {}
  ) {
    const value =
      String(text ?? "").trim();

    if (
      !value &&
      !(
        Array.isArray(
          options.blocks
        ) &&
        options.blocks.length
      )
    ) {
      return null;
    }

    const message =
      createMessage(
        "assistant",
        value,
        options
      );

    return message;
  }

  function revealAssistantMessage(
    message,
    text
  ) {
    const body =
      message?.querySelector(
        ".astra-message-body"
      );

    if (!body) return 0;

    body.classList.remove(
      "is-revealing"
    );

    void body.offsetWidth;

    body.classList.add(
      "is-revealing"
    );

    setTimeout(
      () => {
        body.classList.remove(
          "is-revealing"
        );
      },
      420
    );

    return 420;
  }

  function runtimeActivityMarkup() {
    return `
      <button
        type="button"
        class="astra-runtime-activity-summary"
        aria-expanded="true"
      >
        <span class="astra-runtime-activity-meta">준비 중</span>
        <svg class="astra-runtime-activity-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M6.5 8 10 11.5 13.5 8" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="astra-runtime-activity-steps"></div>
    `;
  }

  function runtimeStepPresentation(
    id
  ) {
    const key =
      String(id || "");

    const node =
      state.canvas?.getNode?.(
        key
      );

    const type =
      String(
        node?.type ||
        ""
      );

    const definition =
      state.nodeDefinitions?.[
        type
      ];

    return {
      type:
        type || "node",
      icon:
        typeof definition?.icon ===
          "string" &&
        definition.icon.trim()
          ? definition.icon
          : "",
      color:
        String(
          definition?.color ||
          ""
        )
    };
  }

  function runtimeStepMarkup() {
    return `
      <span class="astra-runtime-step-icon" aria-hidden="true"></span>
      <span class="astra-runtime-step-content">
        <span class="astra-runtime-step-label"></span>
        <span class="astra-runtime-step-detail"></span>
      </span>
    `;
  }

  function runtimeActivityRecord(
    activity
  ) {
    if (!activity) return null;

    const steps =
      activity.order
        .map(id => {
          const step =
            activity.steps.get(id);

          if (!step) return null;

          return {
            id,
            nodeType:
              String(
                step.dataset
                  ?.nodeType || ""
              ),
            label:
              String(
                step.querySelector(
                  ".astra-runtime-step-label"
                )?.textContent || ""
              ),
            detail:
              String(
                step.querySelector(
                  ".astra-runtime-step-detail"
                )?.textContent || ""
              ),
            status:
              String(
                step.dataset
                  ?.status || "done"
              )
          };
        })
        .filter(Boolean);

    return {
      id:
        "runtime_" +
        Date.now().toString(36) +
        "_" +
        Math.random()
          .toString(36)
          .slice(2,8),
      kind: "runtime",
      role: "assistant",
      text: "",
      runtime: {
        meta:
          String(
            activity.meta
              ?.textContent || ""
          ),
        collapsed:
          activity.row
            ?.classList
            .contains(
              "is-collapsed"
            ) === true,
        steps
      },
      blocks: [],
      question: "",
      showCanvasView: false,
      artifacts: [],
      createdAt: Date.now()
    };
  }

  function renderStoredRuntimeActivity(
    record
  ) {
    const runtime =
      record?.runtime;

    if (
      !runtime ||
      !Array.isArray(
        runtime.steps
      )
    ) {
      return null;
    }

    const row =
      document.createElement(
        "div"
      );

    row.className =
      "astra-message astra-message-assistant astra-runtime-activity is-complete";
    row.dataset.runtimeActivity =
      "stored";

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "astra-runtime-activity-body";
    body.innerHTML =
      runtimeActivityMarkup();

    row.appendChild(body);

    const summary =
      body.querySelector(
        ".astra-runtime-activity-summary"
      );
    const meta =
      body.querySelector(
        ".astra-runtime-activity-meta"
      );
    const stepsRoot =
      body.querySelector(
        ".astra-runtime-activity-steps"
      );

    const compact =
      runtime.steps.length <= 4;

    row.classList.toggle(
      "is-compact",
      compact
    );

    if (meta) {
      meta.textContent =
        String(
          runtime.meta || ""
        );
    }

    for (
      const item
      of runtime.steps
    ) {
      const step =
        document.createElement(
          "div"
        );

      step.className =
        "astra-runtime-step is-visible";
      step.dataset.stepId =
        String(item.id || "");
      step.dataset.nodeType =
        String(
          item.nodeType || "node"
        );
      step.dataset.status =
        String(
          item.status || "done"
        );
      step.innerHTML =
        runtimeStepMarkup();

      const presentation =
        runtimeStepPresentation(
          item.id
        );
      const icon =
        step.querySelector(
          ".astra-runtime-step-icon"
        );

      if (icon) {
        icon.innerHTML =
          presentation.icon;
        icon.hidden =
          !presentation.icon;
      }

      if (
        presentation.color
      ) {
        step.style.setProperty(
          "--runtime-node-color",
          presentation.color
        );
      }

      const label =
        step.querySelector(
          ".astra-runtime-step-label"
        );
      const detail =
        step.querySelector(
          ".astra-runtime-step-detail"
        );

      if (label) {
        label.textContent =
          String(
            item.label || ""
          );
      }

      if (detail) {
        detail.textContent =
          String(
            item.detail || ""
          );
        detail.hidden =
          !item.detail;
      }

      stepsRoot?.appendChild(
        step
      );
    }

    if (
      runtime.collapsed === true &&
      !compact
    ) {
      row.classList.add(
        "is-collapsed"
      );
      summary?.setAttribute(
        "aria-expanded",
        "false"
      );
    }

    summary?.addEventListener(
      "click",
      () => {
        const collapsed =
          row.classList.toggle(
            "is-collapsed"
          );

        summary.setAttribute(
          "aria-expanded",
          String(!collapsed)
        );
      }
    );

    chatMessages.appendChild(
      row
    );

    return row;
  }

  function beginRuntimeActivity(
    text = "실행 준비 중"
  ) {
    if (state.runtimeActivity) {
      finishRuntimeActivity(
        { removeImmediately: true }
      );
    }

    const row =
      document.createElement(
        "div"
      );

    row.className =
      "astra-message astra-message-assistant astra-runtime-activity";
    row.dataset.runtimeActivity =
      "true";

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "astra-runtime-activity-body";
    body.innerHTML =
      runtimeActivityMarkup();

    row.appendChild(body);
    chatMessages.appendChild(row);

    const summary =
      body.querySelector(
        ".astra-runtime-activity-summary"
      );

    const activity = {
      row,
      summary,
      meta:
        body.querySelector(
          ".astra-runtime-activity-meta"
        ),
      stepsRoot:
        body.querySelector(
          ".astra-runtime-activity-steps"
        ),
      steps:
        new Map(),
      order: [],
      text: "",
      finished: false,
      userToggled: false
    };

    state.runtimeActivity =
      activity;

    summary?.addEventListener(
      "click",
      () => {
        activity.userToggled =
          true;

        const collapsed =
          row.classList.toggle(
            "is-collapsed"
          );

        summary.setAttribute(
          "aria-expanded",
          String(!collapsed)
        );
      }
    );

    if (activity.meta) {
      activity.meta.textContent =
        /준비/i.test(
          String(text || "")
        )
          ? "준비 중"
          : String(text || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 42) ||
            "준비 중";
    }

    scrollChatToBottom();
    return row;
  }

  function normalizeCompletedStepText(
    text
  ) {
    return String(text || "")
      .replace(
        /\s+(중|확인 중|판단 중|준비 중)$/,
        match =>
          match.includes("확인")
            ? " 확인"
            : match.includes("판단")
              ? " 판단"
              : match.includes("준비")
                ? " 준비"
                : ""
      )
      .trim();
  }

  function runtimeActivityCount(
    activity
  ) {
    return activity.order
      .filter(
        id =>
          id !== "__prepare__" &&
          id !== "__finalize__"
      )
      .length;
  }

  function syncRuntimeActivityMeta() {
    const activity =
      state.runtimeActivity;

    if (!activity) return;

    const count =
      runtimeActivityCount(
        activity
      );

    const failed =
      activity.order.some(
        id =>
          activity.steps
            .get(id)
            ?.dataset
            ?.status ===
            "failed"
      );

    const compact =
      count <= 4;

    activity.row
      ?.classList
      .toggle(
        "is-compact",
        compact && count > 0
      );

    if (activity.finished) {
      activity.meta.textContent =
        failed
          ? `${count}단계 · 일부 실패`
          : `${count}단계 완료`;
      return;
    }

    const running =
      activity.order.filter(
        id =>
          activity.steps
            .get(id)
            ?.dataset
            ?.status ===
            "running"
      ).length;

    activity.meta.textContent =
      running
        ? count
          ? `${count}단계 진행 중`
          : "진행 중"
        : count
          ? `${count}단계`
          : "준비 중";
  }

  function upsertRuntimeStep(
    id,
    text,
    status = "running",
    detail = ""
  ) {
    const activity =
      state.runtimeActivity ||
      (
        beginRuntimeActivity(),
        state.runtimeActivity
      );

    if (!activity) return null;

    const key =
      String(id || "");

    if (!key) return null;

    let step =
      activity.steps.get(
        key
      );

    if (!step) {
      step =
        document.createElement(
          "div"
        );

      step.className =
        "astra-runtime-step";
      step.innerHTML =
        runtimeStepMarkup();
      step.dataset.stepId =
        key;

      const presentation =
        runtimeStepPresentation(
          key
        );

      step.dataset.nodeType =
        presentation.type;

      const icon =
        step.querySelector(
          ".astra-runtime-step-icon"
        );

      if (icon) {
        icon.innerHTML =
          presentation.icon;

        icon.hidden =
          !presentation.icon;
      }

      if (
        presentation.color
      ) {
        step.style.setProperty(
          "--runtime-node-color",
          presentation.color
        );
      }

      activity.steps.set(
        key,
        step
      );
      activity.order.push(
        key
      );
      activity.stepsRoot
        ?.appendChild(
          step
        );

      requestAnimationFrame(
        () =>
          step.classList.add(
            "is-visible"
          )
      );
    }

    const label =
      step.querySelector(
        ".astra-runtime-step-label"
      );

    const detailElement =
      step.querySelector(
        ".astra-runtime-step-detail"
      );

    const nextText =
      status === "done"
        ? normalizeCompletedStepText(
            text
          )
        : String(text || "").trim();

    if (label && nextText) {
      label.textContent =
        nextText;
    }

    const detailText =
      String(detail || "")
        .replace(
          /\s+/g,
          " "
        )
        .trim()
        .slice(
          0,
          180
        );

    if (detailElement) {
      detailElement.textContent =
        detailText;
      detailElement.hidden =
        !detailText;
    }

    step.dataset.status =
      status;

    syncRuntimeActivityMeta();
    scrollChatToBottom();
    return step;
  }

  function setRuntimeActivity(
    text,
    options = {}
  ) {
    const value =
      String(text || "").trim();

    if (!value) return;

    const id =
      String(
        options.id ||
        "__status__"
      );

    if (
      id === "__prepare__" ||
      id === "__finalize__"
    ) {
      const activity =
        state.runtimeActivity ||
        (
          beginRuntimeActivity(
            value
          ),
          state.runtimeActivity
        );

      if (
        activity?.meta
      ) {
        activity.meta.textContent =
          id === "__prepare__"
            ? "준비 중"
            : value
                .replace(
                  /^실행\s*/,
                  ""
                )
                .replace(
                  /\s+/g,
                  " "
                )
                .trim()
                .slice(0, 42) ||
              "결과 정리 중";
      }

      scrollChatToBottom();
      return;
    }

    upsertRuntimeStep(
      id,
      value,
      options.status ||
        "running",
      options.detail ||
        ""
    );
  }

  function completeRuntimeStep(
    id,
    options = {}
  ) {
    const activity =
      state.runtimeActivity;

    if (!activity) return;

    const key =
      String(id || "");

    if (
      key === "__prepare__" ||
      key === "__finalize__"
    ) {
      return;
    }

    const step =
      activity.steps.get(
        key
      );

    if (!step) return;

    const label =
      step.querySelector(
        ".astra-runtime-step-label"
      );

    upsertRuntimeStep(
      key,
      options.text ||
        label?.textContent ||
        "",
      options.failed
        ? "failed"
        : options.skipped
          ? "skipped"
          : "done",
      options.detail ||
        ""
    );
  }

  function finishRuntimeActivity(
    options = {}
  ) {
    const activity =
      state.runtimeActivity;

    if (!activity) return;

    if (
      options.removeImmediately
    ) {
      activity.row?.remove();
      state.runtimeActivity =
        null;
      return;
    }

    activity.finished =
      true;

    for (
      const id of
      activity.order
    ) {
      const step =
        activity.steps.get(
          id
        );

      if (
        step?.dataset
          ?.status ===
          "running"
      ) {
        completeRuntimeStep(
          id,
          {
            failed:
              options.failed === true &&
              id === "__finalize__"
          }
        );
      }
    }

    activity.row
      ?.classList
      .add(
        "is-complete"
      );

    syncRuntimeActivityMeta();

    const shouldCollapse =
      runtimeActivityCount(
        activity
      ) > 4;

    if (
      !activity.userToggled &&
      shouldCollapse
    ) {
      setTimeout(
        () => {
          activity.row
            ?.classList
            .add(
              "is-collapsed"
            );

          activity.summary
            ?.setAttribute(
              "aria-expanded",
              "false"
            );
        },
        520
      );
    } else if (
      !activity.userToggled
    ) {
      activity.row
        ?.classList
        .remove(
          "is-collapsed"
        );

      activity.summary
        ?.setAttribute(
          "aria-expanded",
          "true"
        );
    }

    const record =
      runtimeActivityRecord(
        activity
      );

    if (
      record &&
      options.persist !== false
    ) {
      state.messages.push(
        record
      );
      scheduleWorkspaceSave();
    }

    state.runtimeActivity =
      null;
  }

  function compactRuntimeSubject(
    value,
    fallback
  ) {
    const text =
      String(
        value || fallback || ""
      )
        .replace(/\s+/g, " ")
        .trim();

    if (text.length <= 34) {
      return text;
    }

    return text.slice(0, 33) + "…";
  }

  function presenceSpeechText(
    value,
    max = 74
  ) {
    const text =
      String(value || "")
        .replace(/[`*_#>~\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!text) return "";

    return text.length > max
      ? text.slice(0, max - 1) + "…"
      : text;
  }

  function runtimeActivityText(
    event
  ) {
    const node =
      state.canvas?.getNode?.(
        String(
          event?.nodeId ||
          ""
        )
      );

    const type =
      String(
        event?.state?.type ||
        node?.type ||
        ""
      );

    const params =
      node?.data?.params ||
      {};

    const request =
      params.request;

    switch (type) {
      case "research":
        return `${compactRuntimeSubject(
          request ||
          params.topic,
          "자료"
        )} 탐색 중`;

      case "organize":
        return `${compactRuntimeSubject(
          request ||
          params.format ||
          params.criteria,
          "자료"
        )} 정리 중`;

      case "write":
        return `${compactRuntimeSubject(
          request ||
          params.title ||
          params.about,
          "결과"
        )} 작성 중`;

      case "convert":
        return `${compactRuntimeSubject(
          request ||
          params.instruction,
          "결과"
        )} 변환 중`;

      case "judge":
        return `${compactRuntimeSubject(
          request ||
          params.condition,
          "조건"
        )} 판단 중`;

      case "createFile":
        return `${compactRuntimeSubject(
          request ||
          params.filename,
          "결과물"
        )} 생성 중`;

      case "file":
        return "입력 파일 확인 중";

      case "start":
        return "실행 흐름 준비 중";

      default:
        return "작업 실행 중";
    }
  }

  function fallbackRuntimeMessage(
    run
  ) {
    const states =
      Object.values(
        run?.nodes || {}
      );

    const failed =
      states.find(
        node =>
          node?.status ===
            "FAILED"
      );

    if (failed) {
      return userFacingError(
        failed.error,
        "실행 중 문제가 발생했습니다. 다시 시도해 주세요."
      );
    }

    const artifacts =
      collectRunArtifacts(
        run
      );

    if (artifacts.length) {
      return artifacts.length === 1
        ? "결과물 파일을 만들었습니다."
        : `결과물 파일 ${artifacts.length}개를 만들었습니다.`;
    }

    return "실행이 완료되었습니다. 결과를 캔버스에 반영했습니다.";
  }

  function collectRunArtifacts(
    run
  ) {
    const seen =
      new Set();

    return Object.values(
      run?.nodes || {}
    )
      .map(
        state =>
          state?.result
            ?.artifact ||
          state?.result
            ?.file ||
          null
      )
      .filter(
        artifact => {
          if (
            !artifact ||
            typeof artifact !==
              "object"
          ) {
            return false;
          }

          const key =
            String(
              artifact.id ||
              artifact.downloadUrl ||
              artifact.name ||
              ""
            );

          if (
            !key ||
            seen.has(key)
          ) {
            return false;
          }

          seen.add(key);
          return true;
        }
      );
  }

  function ensureArtifactFileNode(
    sourceNodeId,
    artifact
  ) {
    if (
      !artifact ||
      !state.canvas ||
      typeof state.canvas.addNode !==
        "function"
    ) {
      return null;
    }

    const artifactId =
      String(
        artifact.id || ""
      );

    if (!artifactId) {
      return null;
    }

    const existing =
      state.canvas
        .getWorkflow?.()
        ?.nodes
        ?.find(
          node =>
            node?.data
              ?.artifactId ===
            artifactId
        );

    if (existing) {
      return existing;
    }

    const source =
      state.canvas
        .getNode?.(
          String(
            sourceNodeId ||
            ""
          )
        );

    const generatedCount =
      state.canvas
        .getWorkflow?.()
        ?.nodes
        ?.filter(
          node =>
            node?.data
              ?.generated ===
              true
        )
        .length || 0;

    return state.canvas.addNode(
      "file",
      {
        expanded: false,
        ...(source
          ? {
              x:
                Number(
                  source.x || 0
                ) +
                220,
              y:
                Number(
                  source.y || 0
                ) +
                (
                  generatedCount %
                  3
                ) *
                54
            }
          : {}),
        data: {
          generated: true,
          artifactId,
          localFileId:
            artifact.localFileId ||
            "",
          name:
            artifact.name ||
            "결과물",
          mime:
            artifact.mime ||
            "application/octet-stream",
          size:
            Number(
              artifact.size ||
              0
            ),
          format:
            artifact.format ||
            "",
          renderer:
            artifact.renderer ||
            "",
          targetPages:
            artifact.targetPages ??
            null,
          previewKind:
            artifact.previewKind ||
            "",
          downloadUrl:
            artifact.downloadUrl ||
            "",
          previewUrl:
            artifact.previewUrl ||
            "",
          previewText:
            artifact.previewText ||
            ""
        }
      }
    );
  }

  async function finalizeRuntimeRun(
    run
  ) {
    const decision =
      global
        .OvllRuntimeFinalization
        ?.decide?.(
          run
        ) || {
          mode: "model",
          reason:
            "policy-unavailable",
          message: ""
        };

    if (
      decision.mode ===
        "skip"
    ) {
      finishRuntimeActivity({
        failed: false
      });
      Presence.settle();
      return;
    }

    setRuntimeActivity(
      run?.status === "FAILED"
        ? "실행 결과 확인 중"
        : decision.mode ===
            "model"
          ? "결과를 정리 중"
          : "결과 확인 중",
      {
        id:
          "__finalize__"
      }
    );

    let message =
      String(
        decision.message ||
        ""
      ).trim();

    if (
      decision.mode ===
        "model"
    ) {
      try {
        const response =
          await API.finalizeRun(
            run,
            {
              userRequest:
                state.workflowUserRequest ||
                state.lastUserRequest,
              memory:
                state.conversationMemory
            }
          );

        message =
          String(
            response?.message ||
            ""
          ).trim();
      } catch (error) {
        console.warn(
          "ovll runtime finalizer failed:",
          error
        );

        message =
          fallbackRuntimeMessage(
            run
          );
      }
    } else if (!message) {
      message =
        fallbackRuntimeMessage(
          run
        );
    }

    completeRuntimeStep(
      "__finalize__",
      {
        failed:
          run?.status ===
            "FAILED"
      }
    );

    finishRuntimeActivity({
      failed:
        run?.status ===
          "FAILED"
    });

    Presence.settle();

    if (!message) {
      return;
    }

    const finalMessage =
      addAssistantMessage(
        message,
        {
          showCanvasView:
            true,
          artifacts:
            collectRunArtifacts(
              run
            ),
          presenceSpeech:
            presenceSpeechText(
              message
            )
        }
      );

    if (finalMessage) {
      await new Promise(resolve =>
        setTimeout(
          resolve,
          revealAssistantMessage(
            finalMessage,
            message
          )
        )
      );
    }
  }

  function addSystemMessage(text) {
    const value =
      String(text ?? "").trim();

    if (!value) return null;

    return createMessage(
      "system",
      value
    );
  }

  function copyTextForMessage(
    message
  ) {
    const record =
      state.messages.find(
        item =>
          item.id ===
          message?.id
      );

    if (
      record?.role ===
        "assistant"
    ) {
      const blocks =
        normalizeGeneratedBlocks(
          record.text,
          record.blocks
        );

      if (blocks.length) {
        return blocks
          .map(
            block => {
              if (
                block.type ===
                  "markup"
              ) {
                return block.value;
              }

              const language =
                block.language ||
                (
                  block.type ===
                    "live-html"
                    ? "html"
                    : ""
                );

              return [
                `\`\`\`${language}`,
                block.value,
                "\`\`\`"
              ].join("\n");
            }
          )
          .join("\n\n")
          .trim();
      }

      return String(
        record.text || ""
      ).trim();
    }

    return message
      ?.querySelector(
        ".astra-message-body"
      )
      ?.textContent
      ?.trim() ||
      "";
  }

  async function copyMessage(
    message,
    button
  ) {
    const value =
      copyTextForMessage(
        message
      );

    if (!value) return;

    try {
      await navigator.clipboard.writeText(
        value
      );
    } catch {
      const textarea =
        document.createElement(
          "textarea"
        );

      textarea.value =
        value;

      textarea.style.position =
        "fixed";

      textarea.style.opacity =
        "0";

      document.body.appendChild(
        textarea
      );

      textarea.select();

      try {
        document.execCommand(
          "copy"
        );
      } catch {
        textarea.remove();
        return;
      }

      textarea.remove();
    }

    const label =
      button.querySelector(
        "span"
      );

    button.classList.add(
      "is-done"
    );

    if (label) {
      label.textContent =
        "복사됨";
    }

    setTimeout(() => {
      button.classList.remove(
        "is-done"
      );

      if (label) {
        label.textContent =
          "복사";
      }
    }, 1200);
  }

  async function retryMessage(
    message
  ) {
    if (
      state.destroyed ||
      state.busy
    ) {
      return;
    }

    let previous =
      message.previousElementSibling;

    while (previous) {
      if (
        previous.dataset.role ===
        "user"
      ) {
        break;
      }

      previous =
        previous.previousElementSibling;
    }

    const body =
      previous?.querySelector(
        ".astra-message-body"
      );

    const value =
      body?.textContent?.trim();

    if (!value) return;

    const proposalId =
      state.workflowProposal
        ?.id ||
      "";

    if (
      proposalId &&
      state.workflowProposal
        ?.id ===
        proposalId
    ) {
      rejectWorkflowProposal(
        proposalId,
        {
          silent: true
        }
      );
    }

    message.classList.add(
      "is-retrying"
    );

    try {
      await runPrompt(
        value,
        {
          addUserMessage:
            false
        }
      );
    } finally {
      message.classList.remove(
        "is-retrying"
      );
    }
  }

  function handleMessageClick(
    event
  ) {
    const action =
      event.target.closest(
        ".astra-message-action"
      );

    if (action) {
      const message =
        action.closest(
          ".astra-message"
        );

      if (!message) return;

      event.preventDefault();

      if (
        action.dataset.action ===
        "copy"
      ) {
        copyMessage(
          message,
          action
        );
      }

      if (
        action.dataset.action ===
        "retry"
      ) {
        retryMessage(
          message
        );
      }

      return;
    }

    const userMessage =
      event.target.closest(
        ".astra-message-user"
      );

    chatMessages
      .querySelectorAll(
        ".astra-message-user.is-actions-visible"
      )
      .forEach(item => {
        if (
          item !== userMessage
        ) {
          item.classList.remove(
            "is-actions-visible"
          );
        }
      });

    if (
      userMessage &&
      chatMessages.contains(
        userMessage
      )
    ) {
      userMessage.classList.add(
        "is-actions-visible"
      );
    }
  }
  /* =======================================================
     Composer
     ======================================================= */
  function resizeComposer() {
    composerForm.classList.remove(
      "is-expanded"
    );

    composerInput.style.height =
      "auto";

    const inputStyle =
      getComputedStyle(
        composerInput
      );

    const inputMinHeight =
      parseFloat(
        inputStyle.minHeight
      ) || 34;

    const collapsedHeight =
      Math.min(
        composerInput.scrollHeight,
        136
      );

    const expanded =
      collapsedHeight >
      inputMinHeight + 1;

    composerForm.classList.toggle(
      "is-expanded",
      expanded
    );

    composerInput.style.height =
      "auto";

    const height =
      Math.min(
        composerInput.scrollHeight,
        136
      );

    composerInput.style.height =
      `${height}px`;

    const rootStyle =
      document.documentElement.style;

    const rootComputed =
      getComputedStyle(
        document.documentElement
      );

    const composerHeightValue =
      rootComputed
        .getPropertyValue(
          "--composer-height"
        )
        .trim();

    const composerHeightNumber =
      parseFloat(
        composerHeightValue
      );

    const rootFontSize =
      parseFloat(
        rootComputed.fontSize
      ) || 16;

    const baseComposerHeight =
      Number.isFinite(
        composerHeightNumber
      )
        ? composerHeightValue.endsWith(
            "rem"
          )
          ? composerHeightNumber *
            rootFontSize
          : composerHeightNumber
        : 88;

    const formHeight =
      composerForm
        .getBoundingClientRect()
        .height;

    rootStyle.setProperty(
      "--composer-input-height",
      `${height}px`
    );

    rootStyle.setProperty(
      "--composer-form-height",
      `${formHeight}px`
    );

    rootStyle.setProperty(
      "--composer-live-height",
      `${Math.max(
        baseComposerHeight,
        formHeight
      )}px`
    );
  }
  function setBusy(busy) {
    const previous =
      state.busy;

    state.busy = !!busy;
    composerInput.disabled = false;
    composerSubmit.disabled = state.busy;
    composerForm.classList.toggle("is-busy", state.busy);
    composerForm.setAttribute(
      "aria-busy",
      state.busy ? "true" : "false"
    );

    document
      .querySelectorAll(
        ".astra-workflow-proposal-action"
      )
      .forEach(
        button => {
          button.disabled =
            state.busy;
        }
      );

    if (
      previous !==
      state.busy
    ) {
      global.dispatchEvent(
        new CustomEvent(
          "ovll:busychange",
          {
            detail: {
              busy:
                state.busy
            }
          }
        )
      );
    }
  }

  /* =======================================================
     Workflow
     ======================================================= */
  function syncWorkflow() {
    const workflow = getCurrentWorkflow();
    state.workflow = workflow;
    return workflow;
  }

  function acceptWorkflowProposal(
    proposalId,
    options = {}
  ) {
    const proposal =
      state.workflowProposal;

    if (
      !proposal ||
      proposal.id !==
        String(
          proposalId || ""
        )
    ) {
      return false;
    }

    state.workflowProposal =
      null;

    state.workflow =
      getCurrentWorkflow();

    settleWorkflowProposalUi(
      proposal.id,
      "accepted",
      options.silent === true
    );

    scheduleWorkspaceSave(
      options.immediate === false
        ? 180
        : 0
    );

    return true;
  }

  function rejectWorkflowProposal(
    proposalId,
    options = {}
  ) {
    const proposal =
      state.workflowProposal;

    if (
      !proposal ||
      proposal.id !==
        String(
          proposalId || ""
        )
    ) {
      return false;
    }

    proposal.applying =
      true;

    try {
      if (
        proposal.beforeState &&
        state.canvas?.setState
      ) {
        state.canvas.setState(
          clone(
            proposal.beforeState
          )
        );
      }
    } finally {
      proposal.applying =
        false;
    }

    state.workflowProposal =
      null;

    state.workflow =
      getCurrentWorkflow();

    settleWorkflowProposalUi(
      proposal.id,
      "reverted",
      options.silent === true
    );

    scheduleWorkspaceSave(0);

    return true;
  }

  function handleCanvasChange(workflow) {
    if (!workflow) return;

    state.workflow =
      clone(workflow);

    scheduleWorkspaceSave();
  }

  function handleCanvasWorkflowApplied(workflow) {
    if (!workflow) return;

    state.workflow =
      clone(workflow);

    if (
      !state.workflowProposal
        ?.applying
    ) {
      scheduleWorkspaceSave();
    }
  }

  /* =======================================================
     Planner
     ======================================================= */
  async function plan(text) {
    const existingProposal =
      state.workflowProposal;

    const workflow =
      syncWorkflow();

    const attemptState =
      state.canvas
        ?.getState?.() ||
      null;

    const beforeWorkflow =
      state.canvas
        ?.getWorkflowIR?.() ||
      workflow;

    const result =
      await API.planWorkflow(
        text,
        workflow,
        state.conversationMemory
      );

    if (!result || !result.workflow) {
      throw new Error(
        "Planner가 올바른 workflow를 반환하지 않았습니다."
      );
    }

    if (
      result.mode === "workflow" &&
      state.canvas &&
      typeof state.canvas.applyWorkflowIR === "function"
    ) {
      const changed =
        JSON.stringify(
          beforeWorkflow
        ) !==
        JSON.stringify(
          result.workflow
        );

      if (changed) {
        const isNewProposal =
          !existingProposal;

        const proposal =
          existingProposal ||
          {
            id:
              `workflow-proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            beforeState:
              attemptState
                ? clone(
                    attemptState
                  )
                : null,
            applying:
              false
          };

        state.workflowProposal =
          proposal;

        proposal.applying =
          true;

        try {
          state.canvas
            .applyWorkflowIR(
              result.workflow,
              {
                center: true
              }
            );

          result.workflowProposalId =
            proposal.id;
        } catch (error) {
          if (
            attemptState &&
            state.canvas?.setState
          ) {
            try {
              state.canvas.setState(
                clone(
                  attemptState
                )
              );
            } catch {}
          }

          if (isNewProposal) {
            state.workflowProposal =
              null;
          }

          throw error;
        } finally {
          proposal.applying =
            false;
        }

        state.workflow =
          getCurrentWorkflow();
      } else {
        state.workflow =
          clone(
            result.workflow
          );
      }
    } else {
      state.workflow =
        clone(
          result.workflow
        );
    }

    if (
      result.mode === "workflow"
    ) {
      state.workflowUserRequest =
        String(text || "").trim();
    }

    if (result.memory) {
      saveMemory(result.memory);
    }

    return result;
  }

  async function runPrompt(text, options = {}) {
    if (state.destroyed || state.busy) return;

    const value =
      String(text ?? "").trim();

    if (!value) return;

    state.lastUserRequest =
      value;

    if (
      options.addUserMessage !== false
    ) {
      addUserMessage(value);

      composerInput.value = "";
      resizeComposer();
    }

    setBusy(true);

    Presence.thinking();

    const thinkingStartedAt =
      performance.now();

    try {
      const result =
        await plan(value);

      const elapsed =
        performance.now() -
        thinkingStartedAt;

      const remaining =
        Math.max(
          0,
          650 - elapsed
        );

      if (remaining > 0) {
        await new Promise(resolve =>
          setTimeout(
            resolve,
            remaining
          )
        );
      }

      Presence.settle();

      if (
        result.message ||
        result.question ||
        result.workflowProposalId
      ) {
        const assistantText =
          result.message ||
          (
            result.workflowProposalId
              ? "노드 구성을 바꿔봤어."
              : ""
          );

        const message =
          addAssistantMessage(
            assistantText,
            {
              question:
                result.question,
              showCanvasView:
                result.mode ===
                "workflow",
              workflowProposalId:
                result.workflowProposalId,
              blocks:
                result.blocks,
              presenceSpeech:
                presenceSpeechText(
                  result.question ||
                  assistantText
                )
            }
          );

        if (message) {
          await new Promise(resolve =>
            setTimeout(
              resolve,
              revealAssistantMessage(
                message,
                assistantText
              )
            )
          );
        }
      }

      syncWorkflow();
    } catch (error) {
      Presence.settle();

      console.error(
        "ovll Planner Error:",
        error
      );

      showErrorNotice(
        error,
        {
          scope:
            "요청 처리 오류",
          fallback:
            "요청을 처리하지 못했습니다.",
          onRetry:
            () => {
              void runPrompt(
                value,
                {
                  addUserMessage:
                    false
                }
              );
            }
        }
      );
    } finally {
      setBusy(false);
      resizeComposer();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const text = composerInput.value.trim();
    if (!text) return;

    if (document.activeElement === composerInput) {
      composerInput.blur();
    }

    await runPrompt(text);
  }

  function handleComposerInput() {
    resizeComposer();
  }

  function isTextLikeUpload(
    file
  ) {
    const mime =
      String(
        file?.type ||
        ""
      )
        .toLowerCase();

    const name =
      String(
        file?.name ||
        ""
      )
        .toLowerCase();

    return (
      mime.startsWith(
        "text/"
      ) ||
      /(?:json|xml|javascript|typescript|csv|yaml|toml|markdown)/i
        .test(mime) ||
      /\.(?:txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|java|c|cc|cpp|h|hpp|go|rs|rb|php|sql|sh|bash|zsh|yaml|yml|toml|ini|log)$/i
        .test(name)
    );
  }

  async function readUploadTextPreview(
    file
  ) {
    if (
      !isTextLikeUpload(
        file
      )
    ) {
      return null;
    }

    const previewLimit =
      12000;

    const readLimit =
      48000;

    const text =
      await file
        .slice(
          0,
          readLimit
        )
        .text();

    const normalized =
      String(text || "")
        .replace(
          /\u0000/g,
          ""
        )
        .trim();

    if (!normalized) {
      return null;
    }

    return {
      textPreview:
        normalized.slice(
          0,
          previewLimit
        ),
      textTruncated:
        file.size >
          readLimit ||
        normalized.length >
          previewLimit
    };
  }

  async function handleComposerFileChange(
    event
  ) {
    const file =
      event.target.files?.[0];

    event.target.value = "";

    if (
      !file ||
      !state.canvas ||
      typeof state.canvas.addNode !==
        "function"
    ) {
      return;
    }

    try {
      const preview =
        await readUploadTextPreview(
          file
        );

      let localFileId =
        "";
      let localUrl =
        "";

      try {
        const stored =
          await FileStore.putFile(
            file,
            {
              name:
                file.name,
              mime:
                file.type ||
                "application/octet-stream",
              size:
                file.size || 0,
              source:
                "upload",
              conversationId:
                currentConversationId(),
              previewText:
                preview
                  ?.textPreview ||
                ""
            }
          );

        localFileId =
          stored.id;

        localUrl =
          await FileStore.getUrl(
            stored.id
          );
      } catch (error) {
        console.warn(
          "ovll upload local save failed:",
          error
        );
      }

      const mime =
        file.type ||
        "application/octet-stream";

      state.canvas.addNode(
        "file",
        {
          expanded: false,
          data: {
            source:
              "upload",
            localFileId,
            name:
              file.name,
            mime,
            size:
              file.size || 0,
            lastModified:
              file.lastModified || 0,
            downloadUrl:
              localUrl,
            previewUrl:
              localUrl,
            imagePreview:
              mime.startsWith(
                "image/"
              )
                ? localUrl
                : "",
            ...(preview || {})
          }
        }
      );

      dismissErrorNotice();

      if (
        typeof UI.setMode ===
          "function"
      ) {
        UI.setMode(
          "canvas"
        );
      }
    } catch (error) {
      console.error(
        "File Node Error:",
        error
      );

      showErrorNotice(
        error,
        {
          scope:
            "파일 추가 오류",
          fallback:
            "파일을 캔버스에 추가하지 못했습니다."
        }
      );
    }
  }

  function handleComposerKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();

    if (state.busy) return;

    composerForm.requestSubmit();
  }

  /* =======================================================
     Demo runtime
     ======================================================= */
  function syncRuntimeConnections() {
    state.canvas
      ?.setRuntimeConnections?.(
        [...state.runtimeConnections]
      );
  }

  function clearRuntimeConnections() {
    state.runtimeConnections.clear();
    syncRuntimeConnections();
  }

  function handleRuntimeEvent(event) {
    if (
      !event ||
      typeof event !== "object"
    ) {
      return;
    }

    if (event.type === "run:start") {
      clearRuntimeConnections();

      state.canvas
        ?.clearRuntimeNodeStates?.();

      beginRuntimeActivity(
        "실행 준비 중"
      );

      Presence.canvasStatus?.(
        "실행 준비 중",
        {
          hold: 1400
        }
      );

      return;
    }

    if (event.type === "edge:state") {
      const edgeId =
        String(
          event.edgeId || ""
        );

      if (!edgeId) return;

      if (event.active) {
        state.runtimeConnections.add(
          edgeId
        );
      } else {
        state.runtimeConnections.delete(
          edgeId
        );
      }

      syncRuntimeConnections();
      return;
    }

    if (event.type === "node:state") {
      state.canvas
        ?.setRuntimeNodeState?.(
          event.nodeId,
          event.state || {
            status:
              event.status,
            report:
              event.report || null
          }
        );

      const text =
        runtimeActivityText(
          event
        );

      if (
        event.status ===
          "RUNNING"
      ) {
        setRuntimeActivity(
          text,
          {
            id:
              event.nodeId
          }
        );

        Presence.canvasStatus?.(
          text,
          {
            hold: 0
          }
        );
      } else if (
        event.status ===
          "SUCCESS"
      ) {
        const artifact =
          event.state
            ?.result
            ?.artifact ||
          event.state
            ?.result
            ?.file;

        if (
          artifact &&
          typeof artifact ===
            "object" &&
          artifact.downloadUrl
        ) {
          ensureArtifactFileNode(
            event.nodeId,
            artifact
          );
        }

        completeRuntimeStep(
          event.nodeId
        );
      } else if (
        event.status ===
          "FAILED"
      ) {
        const errorText =
          userFacingError(
            event.state?.error,
            "이 단계에서 문제가 발생했습니다."
          );

        completeRuntimeStep(
          event.nodeId,
          {
            failed: true,
            detail:
              errorText
          }
        );

        Presence.canvasStatus?.(
          errorText,
          {
            hold: 2600
          }
        );

        showErrorNotice(
          event.state?.error,
          {
            scope:
              "노드 실행 오류",
            fallback:
              errorText
          }
        );
      } else if (
        event.status ===
          "SKIPPED"
      ) {
        completeRuntimeStep(
          event.nodeId,
          {
            skipped: true
          }
        );
      }

      return;
    }

    if (event.type === "run:finish") {
      clearRuntimeConnections();

      state.canvas
        ?.selectNode?.(
          event.pivot
        );

      if (
        event.status ===
          "CANCELLED"
      ) {
        if (
          state.runtimeActivity
            ?.meta
        ) {
          state.runtimeActivity
            .meta
            .textContent =
            "중단됨";
        }

        finishRuntimeActivity();

        Presence.canvasStatus?.(
          "실행 중단됨",
          {
            hold: 1800
          }
        );

        Presence.mascotState?.(
          "cancelled",
          {
            nodeId:
              event.pivot
          }
        );

        return;
      }

      Presence.mascotState?.(
        event.status === "FAILED"
          ? "error"
          : "success",
        {
          nodeId:
            event.pivot
        }
      );

      const text =
        event.status === "FAILED"
          ? "실행 결과 확인 중"
          : "결과를 정리 중";

      setRuntimeActivity(
        text,
        {
          id:
            "__finalize__"
        }
      );

      Presence.canvasStatus?.(
        text,
        {
          hold: 0
        }
      );
    }
  }

  function setRunGate(
    locked,
    delay = 0,
    pivotId = null
  ) {
    clearTimeout(
      state.runGate.releaseTimer
    );
    state.runGate.releaseTimer =
      null;

    const nextPivot =
      locked
        ? String(
            pivotId ||
            state.runGate.pivot ||
            ""
          )
        : null;

    const apply = () => {
      state.runGate.locked =
        !!locked;
      state.runGate.pivot =
        nextPivot;

      state.canvas
        ?.setRunLocked?.(
          !!locked,
          nextPivot
        );
    };

    if (
      !locked &&
      delay > 0
    ) {
      state.runGate.releaseTimer =
        setTimeout(
          () => {
            state.runGate.releaseTimer =
              null;
            apply();
          },
          delay
        );

      return;
    }

    apply();
  }

  function canvasRunUserText(
    nodeId,
    workflow
  ) {
    const node =
      workflow?.nodes?.find(
        item =>
          item?.id === nodeId
      ) ||
      state.canvas?.getNode?.(
        nodeId
      );

    if(!node){
      return "워크플로우 실행해줘";
    }

    const params =
      node?.data?.params ||
      node?.params ||
      {};

    const request =
      String(
        params.request ||
        ""
      )
        .replace(/\s+/g," ")
        .trim();

    if(request){
      return /실행해\s*줘[.!?]?$/i
        .test(request)
          ? request
          : request + " 실행해줘";
    }

    const definition =
      state.nodeDefinitions?.[
        node.type
      ];

    const subject =
      String(
        definition?.name ||
        node?.data?.title ||
        node?.type ||
        "워크플로우"
      )
        .replace(/\s+/g," ")
        .trim();

    if(
      node.type === "start" ||
      !subject
    ){
      return "워크플로우 실행해줘";
    }

    return subject + " 실행해줘";
  }

  async function runCanvasNode(
    nodeId,
    mode = "spread"
  ) {
    if (
      !state.canvas ||
      !state.runtime ||
      state.runGate.locked ||
      state.runtime.isRunning()
    ) {
      return null;
    }

    setRunGate(
      true,
      0,
      nodeId
    );

    let started = false;

    try {
      const workflow =
        state.canvas.getWorkflow();

      const runMode =
        mode === "target"
          ? "target"
          : "spread";

      const readiness =
        typeof Execution
          .validateExecutionReadiness ===
          "function"
          ? Execution
              .validateExecutionReadiness(
                workflow,
                nodeId,
                {
                  mode:
                    runMode
                }
              )
          : {
              ok: true,
              emptyNodes: []
            };

      if (!readiness.ok) {
        const invalid =
          readiness.emptyNodes?.[0];

        const invalidNode =
          workflow.nodes.find(
            node =>
              node.id ===
              invalid?.id
          );

        if (invalidNode) {
          state.canvas
            ?.selectNode?.(
              invalidNode.id
            );

          if (
            !invalidNode.expanded
          ) {
            state.canvas
              ?.toggleNodeExpanded?.(
                invalidNode.id
              );
          }
        }

        return null;
      }

      dismissErrorNotice();

      const runUserText =
        canvasRunUserText(
          nodeId,
          workflow
        );

      addUserMessage(
        runUserText
      );

      scheduleWorkspaceSave();

      started = true;

      const result =
        await state.runtime.run(
          workflow,
          nodeId,
          {
            mode:
              runMode,
            cacheContext: {
              conversationId:
                currentConversationId(),
              userRequest:
                state.workflowUserRequest ||
                state.lastUserRequest,
              memory:
                state.conversationMemory
                  ? clone(
                      state.conversationMemory
                    )
                  : null
            }
          }
        );

      if (
        result?.status ===
          "CANCELLED"
      ) {
        Presence.settle();
        return result;
      }

      await finalizeRuntimeRun(
        result
      );

      return result;
    } catch (error) {
      clearRuntimeConnections();

      console.error(
        "ovll runtime failed:",
        error
      );

      finishRuntimeActivity({
        failed: true
      });

      Presence.settle();

      const presentation =
        errorPresentation(
          error,
          "실행을 완료하지 못했습니다."
        );

      Presence.canvasStatus?.(
        presentation.title,
        {
          hold: 2200
        }
      );

      showErrorNotice(
        error,
        {
          scope:
            "실행 오류",
          fallback:
            "실행을 완료하지 못했습니다.",
          onRetry:
            () => {
              void runCanvasNode(
                nodeId,
                mode
              );
            }
        }
      );

      return null;
    } finally {
      setRunGate(
        false,
        started
          ? 650
          : 0
      );
    }
  }

  function handleCanvasNodeRun(payload) {
    const nodeId =
      String(
        payload?.id || ""
      );

    if (!nodeId) {
      return;
    }

    void runCanvasNode(
      nodeId,
      "spread"
    );
  }

  function handleCanvasNodeRunCancel(
    payload
  ) {
    const nodeId =
      String(
        payload?.id || ""
      );

    if (
      !nodeId ||
      !state.runtime
        ?.isRunning?.()
    ) {
      return;
    }

    const cancelled =
      state.runtime.cancel?.();

    if (cancelled) {
      Presence.canvasStatus?.(
        "실행 중단 중",
        {
          hold: 0
        }
      );
    }
  }

  function openConversation(
    conversationId,
    options = {}
  ) {
    const id =
      String(
        conversationId ||
        ""
      );

    if (!id) {
      return Promise.resolve(
        null
      );
    }

    const restore =
      async () => {
        if (
          state.destroyed ||
          state.busy
        ) {
          return null;
        }

        const conversation =
          WorkspaceStore
            .getConversation?.(
              id
            );

        if (!conversation) {
          return null;
        }

        const previousId =
          currentConversationId();

        if (
          state.workspaceSaveTimer
        ) {
          clearTimeout(
            state.workspaceSaveTimer
          );
          state.workspaceSaveTimer =
            null;
        }

        if (
          previousId &&
          previousId !== id &&
          options.skipSave !== true
        ) {
          await saveActiveConversation();
        }

        if (
          WorkspaceStore
            .getActiveConversation?.()
            ?.id !== id
        ) {
          WorkspaceStore
            .activateConversation(
              id
            );
        }

        state.workflowProposal =
          null;

        state.restoringConversation =
          true;

        try {
          clearRuntimeConnections();

          finishRuntimeActivity({
            removeImmediately:
              true
          });

          Presence.hideCanvasSpeech?.();
          dismissErrorNotice();

          state.canvas
            ?.clearRuntimeNodeStates?.();

          chatMessages
            .replaceChildren();

          state.messages = [];
          state.messageCount = 0;
          state.activeConversationId =
            id;
          state.lastUserRequest =
            String(
              conversation
                .state
                ?.lastUserRequest ||
              ""
            );
          state.workflowUserRequest =
            String(
              conversation
                .state
                ?.workflowUserRequest ||
              ""
            );

          const memory =
            WorkspaceStore
              .getConversationMemory(
                id
              );

          state.conversationMemory =
            normalizeMemory(
              memory
            ) || {
              flow: "",
              recent: "",
              detail: ""
            };

          memoryStore.value =
            clone(
              state.conversationMemory
            );

          const canvasState =
            await hydrateCanvasFiles(
              conversation
                .state
                ?.canvas
            );

          if (
            canvasState &&
            state.canvas
              ?.setState
          ) {
            state.canvas.setState(
              clone(
                canvasState
              )
            );
          } else {
            state.canvas
              ?.setState?.({
                workflow: {
                  nodes: [],
                  connections: []
                },
                viewport: {
                  scale: 1,
                  offset: {
                    x: 0,
                    y: 0
                  }
                }
              });
          }

          const messages =
            await hydrateStoredMessages(
              conversation
                .state
                ?.messages
            );

          for (
            const item
            of messages
          ) {
            if (
              item.kind ===
                "runtime"
            ) {
              renderStoredRuntimeActivity(
                item
              );
            } else {
              createMessage(
                item.role,
                item.text,
                {
                  id:
                    item.id,
                  question:
                    item.question,
                  showCanvasView:
                    item.showCanvasView,
                  artifacts:
                    item.artifacts,
                  blocks:
                    item.blocks,
                  createdAt:
                    item.createdAt,
                  persist:
                    false,
                  silent:
                    true
                }
              );
            }

            state.messages.push(
              clone(item)
            );
          }

          Presence
            .resetConversation?.({
              started:
                messages.length > 0
            });

          UI.setMode?.(
            conversation
              .state
              ?.mode ||
            "chat",
            {
              immediate: true,
              history:
                Navigation
                  .current()
                  .layer ===
                "base"
            }
          );

          state.workflow =
            getCurrentWorkflow();

          requestAnimationFrame(
            () => {
              state.canvas
                ?.render?.();

              scrollChatToBottom(
                true
              );
            }
          );
        } finally {
          state.restoringConversation =
            false;
        }

        global.OvllShellMenu
          ?.refresh?.();

        return clone(
          conversation
        );
      };

    const queued =
      conversationSwitchQueue
        .then(
          restore,
          restore
        );

    conversationSwitchQueue =
      queued.catch(
        () => null
      );

    return queued;
  }

  function refreshConversationContext() {
    const id =
      currentConversationId();

    if (!id) {
      return null;
    }

    const memory =
      WorkspaceStore
        .getConversationMemory(
          id
        );

    state.conversationMemory =
      normalizeMemory(
        memory
      ) || {
        flow: "",
        recent: "",
        detail: ""
      };

    memoryStore.value =
      clone(
        state.conversationMemory
      );

    return clone(
      state.conversationMemory
    );
  }

  /* =======================================================
     Canvas
     ======================================================= */
  async function initializeCanvas() {
    const canvas = await mountCanvasNode("#canvas-viewport", {
      nodeDefinitions:
        state.nodeDefinitions ||
        global.nodeDefinitions ||
        undefined,
      interactionEnabled: false
    });

    state.canvas = canvas;

    const localExecutor =
      new Execution.LocalNodeExecutor();

    function runtimeInputValues(
      inputs
    ) {
      return Object.values(
        inputs || {}
      )
        .flatMap(
          value =>
            Array.isArray(value)
              ? value
              : [value]
        )
        .map(
          item =>
            item?.value
        )
        .filter(
          value =>
            value !==
              undefined
        );
    }

    function beginMascotWorkSequence(
      ids
    ) {
      const nodeIds =
        Array.isArray(ids)
          ? ids
              .map(String)
              .filter(Boolean)
          : [];

      let index = 0;
      let timer = null;
      let stopped = false;

      const visit = () => {
        if (
          stopped ||
          index >=
            nodeIds.length
        ) {
          return;
        }

        Presence.workAtNode?.(
          nodeIds[index],
          true
        );

        index++;

        if (
          index <
            nodeIds.length
        ) {
          timer =
            setTimeout(
              visit,
              900
            );
        }
      };

      visit();

      return () => {
        stopped = true;
        clearTimeout(
          timer
        );

        Presence.workAtNode?.(
          nodeIds[
            Math.max(
              0,
              index - 1
            )
          ] || null,
          false
        );
      };
    }

    function resolveArtifactRequest(
      params
    ) {
      const resolver =
        global
          .OvllArtifactRequest
          ?.resolve;

      if (
        typeof resolver !==
          "function"
      ) {
        throw new Error(
          "파일 요청 해석기를 불러오지 못했습니다."
        );
      }

      return resolver(
        params
      );
    }

    const runtimeExecutor = {
      async run(
        node,
        inputs,
        context
      ) {
        Presence.workAtNode?.(
          node?.id,
          true
        );

        try {
          if (
            node?.type ===
              "createFile"
          ) {
            const params =
              node?.data?.params ||
              node?.params ||
              {};

            const artifactRequest =
              resolveArtifactRequest(
                params
              );

            const response =
              await API
                .createArtifact(
                  {
                    format:
                      artifactRequest
                        .format,
                    filename:
                      artifactRequest
                        .filename,
                    targetPages:
                      artifactRequest
                        .targetPages,
                    sources:
                      runtimeInputValues(
                        inputs
                      )
                  },
                  {
                    signal:
                      context?.signal
                  }
                );

            const artifact =
              response?.artifact;

            if (!artifact) {
              throw new Error(
                "파일 생성 결과가 없습니다."
              );
            }

            await persistArtifactLocally(
              artifact,
              "generated"
            );

            return {
              outputs: {},
              artifact,
              report:
                `${artifact.name} 생성 완료`
            };
          }

          return await localExecutor.run(
            node,
            inputs,
            context
          );
        } finally {
          Presence.workAtNode?.(
            node?.id,
            false
          );
        }
      },

      async runGroup(
        group,
        context = {}
      ) {
        const stopMascot =
          beginMascotWorkSequence(
            group?.nodes?.map(
              node => node.id
            ) || []
          );

        try {
          const response =
            await API.executeGroup(
              group,
              {
                userRequest:
                  context?.cacheContext
                    ?.userRequest ||
                  state.workflowUserRequest ||
                  state.lastUserRequest,
                memory:
                  state.conversationMemory
              },
              {
                signal:
                  context?.signal
              }
            );

          return {
            results:
              response.results
          };
        } finally {
          stopMascot();
        }
      }
    };

    state.runtime =
      new Execution.RuntimeEngine({
        executor:
          runtimeExecutor,
        onEvent:
          handleRuntimeEvent,
        measureGroupInputChars:
          (
            group,
            context
          ) =>
            API
              .measureExecutionPayloadChars(
                group,
                context
              )
      });

    initializeNodeBuilder();
    UI.bindCanvas(canvas);

    canvas.on("change", handleCanvasChange);
    canvas.on("workflowApplied", handleCanvasWorkflowApplied);
    canvas.on("nodeRun", handleCanvasNodeRun);
    canvas.on(
      "nodeRunCancel",
      handleCanvasNodeRunCancel
    );

    syncWorkflow();

    return canvas;
  }

  /* =======================================================
     Canvas Node Builder
     ======================================================= */
  function getNodeDefinitionsForBuilder() {
    if (state.nodeDefinitions && typeof state.nodeDefinitions === "object") {
      return state.nodeDefinitions;
    }

    if (state.canvas && typeof state.canvas.getNodeDefinitions === "function") {
      return state.canvas.getNodeDefinitions();
    }

    return {};
  }

  function renderNodeBuilderOptions() {
    const root = state.nodeBuilder.root;
    if (!root) return;

    const list = root.querySelector("#canvas-node-builder-list");
    if (!list) return;

    list.textContent = "";

    const definitions = getNodeDefinitionsForBuilder();

    for (const [type, definition] of Object.entries(definitions)) {
      if (type === "start" || !definition) continue;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "canvas-node-builder-option";
      button.dataset.nodeType = type;
      button.style.setProperty("--builder-node-color", definition.color || "var(--text)");

      const icon = document.createElement("span");
      icon.className = "canvas-node-builder-icon";
      icon.innerHTML = definition.icon || "";

      const name = document.createElement("span");
      name.className = "canvas-node-builder-name";
      name.textContent = definition.name || type;

      button.appendChild(icon);
      button.appendChild(name);
      list.appendChild(button);
    }

    root.classList.toggle("is-empty", list.children.length === 0);
  }

  function setNodeBuilderOpen(
    open,
    options = {}
  ) {
    if (!state.nodeBuilder.root) return;

    const next =
      !!open;

    if (
      next ===
      state.nodeBuilder.open
    ) {
      return;
    }

    if (
      next &&
      options.history !==
        false
    ) {
      Navigation.open(
        "node-builder"
      );
    }

    if (
      !next &&
      options.history !==
        false &&
      Navigation.isCurrent(
        "node-builder"
      )
    ) {
      Navigation.close(
        "node-builder",
        () => setNodeBuilderOpen(
          false,
          {
            history:false
          }
        )
      );
      return;
    }

    state.nodeBuilder.open =
      next;

    state.nodeBuilder.root.classList.toggle(
      "is-open",
      state.nodeBuilder.open
    );

    const toggle =
      state.nodeBuilder.root.querySelector(
        "#canvas-node-builder-toggle"
      );

    toggle?.setAttribute(
      "aria-expanded",
      String(
        state.nodeBuilder.open
      )
    );
  }

  function initializeNodeBuilder() {
    if (state.nodeBuilder.root) {
      renderNodeBuilderOptions();
      return;
    }

    const root = document.createElement("div");
    root.id = "canvas-node-builder";

    root.innerHTML = `
      <div id="canvas-node-builder-panel" role="dialog" aria-label="노드 추가">
        <div class="canvas-node-builder-header">
          <span>노드 추가</span>
          <span class="canvas-node-builder-hint">워크플로우를 직접 조립해봐요</span>
        </div>
        <div id="canvas-node-builder-list" class="canvas-node-builder-list"></div>
      </div>
      <div class="canvas-node-builder-actions">
        <button id="canvas-node-builder-toggle" type="button" aria-expanded="false" aria-controls="canvas-node-builder-panel">
          <span class="canvas-node-builder-action-icon" aria-hidden="true">${SvgLibrary.get("nodeAdd")}</span>
          <span>노드</span>
        </button>
        <button id="canvas-node-builder-reset" type="button" aria-label="캔버스 초기화" title="캔버스 초기화">
          <span class="canvas-node-builder-action-icon" aria-hidden="true">${SvgLibrary.get("canvasReset")}</span>
          <span class="canvas-node-builder-reset-label">초기화</span>
        </button>
        <button id="canvas-node-builder-layout" type="button" aria-label="노드 정리하기" title="노드 정리하기">
          <span class="canvas-node-builder-action-icon" aria-hidden="true">${SvgLibrary.get("canvasLayout")}</span>
          <span>정리하기</span>
        </button>
      </div>
    `;

    document.querySelector("#canvas-page")?.appendChild(root);
    state.nodeBuilder.root = root;

    listen(root, "click", event => {
      const layout = event.target.closest("#canvas-node-builder-layout");

      if (layout) {
        event.preventDefault();

        if (
          state.canvas &&
          typeof state.canvas.layout === "function"
        ) {
          state.canvas.layout();
        }

        return;
      }

      const reset = event.target.closest("#canvas-node-builder-reset");

      if (reset) {
        event.preventDefault();

        if (
          !state.canvas ||
          typeof state.canvas.setState !== "function"
        ) {
          return;
        }

        const workflow =
          state.canvas.getWorkflow?.() || {
            nodes: [],
            connections: []
          };

        const hasContent =
          (workflow.nodes?.length || 0) > 0 ||
          (workflow.connections?.length || 0) > 0;

        if (
          hasContent &&
          !reset.classList.contains("is-confirming")
        ) {
          reset.classList.add("is-confirming");
          reset.querySelector(
            ".canvas-node-builder-reset-label"
          ).textContent = "한번 더";

          clearTimeout(
            state.nodeBuilder.resetTimer
          );

          state.nodeBuilder.resetTimer =
            setTimeout(() => {
              reset.classList.remove("is-confirming");
              reset.querySelector(
                ".canvas-node-builder-reset-label"
              ).textContent = "초기화";
              state.nodeBuilder.resetTimer = null;
            }, 1800);

          return;
        }

        clearTimeout(
          state.nodeBuilder.resetTimer
        );
        state.nodeBuilder.resetTimer = null;
        reset.classList.remove("is-confirming");
        reset.querySelector(
          ".canvas-node-builder-reset-label"
        ).textContent = "초기화";

        clearRuntimeConnections();
        state.canvas.clearRuntimeNodeStates?.();
        finishRuntimeActivity({
          removeImmediately: true
        });
        Presence.hideCanvasSpeech?.();

        state.canvas.setState({
          workflow: {
            nodes: [],
            connections: []
          },
          viewport: {
            scale: 1,
            offset: {
              x: 0,
              y: 0
            }
          }
        });

        setNodeBuilderOpen(false);
        return;
      }

      const toggle = event.target.closest("#canvas-node-builder-toggle");

      if (toggle) {
        event.preventDefault();
        setNodeBuilderOpen(!state.nodeBuilder.open);
        return;
      }

      const option = event.target.closest(".canvas-node-builder-option");

      if (!option || !root.contains(option)) return;

      const type = option.dataset.nodeType;

      if (!type || !state.canvas || typeof state.canvas.addNode !== "function") return;

      state.canvas.addNode(type);
      setNodeBuilderOpen(false);
    });

    listen(document, "pointerdown", event => {
      if (state.nodeBuilder.open && !root.contains(event.target)) {
        setNodeBuilderOpen(false);
      }
    });

    listen(document, "keydown", event => {
      if (event.key === "Escape" && state.nodeBuilder.open) {
        setNodeBuilderOpen(false);
      }
    });

    renderNodeBuilderOptions();
  }

  /* =======================================================
     Initialization
     ======================================================= */
  async function initialize() {
    if (state.destroyed) return;

    const initialConversation =
      WorkspaceStore
        .getActiveConversation?.();

    state.activeConversationId =
      initialConversation?.id ||
      null;

    state.conversationMemory =
      initialConversation
        ? WorkspaceStore
            .getConversationMemory(
              initialConversation.id
            )
        : loadMemory();

    memoryStore.value =
      clone(
        state.conversationMemory ||
        {
          flow: "",
          recent: "",
          detail: ""
        }
      );

    syncPhysicalOrientation();
    syncAppViewport();
    setBusy(false);
    resizeComposer();

    listen(composerAttach, "click", event => {
      event.preventDefault();
      composerFileInput.click();
    });

    listen(
      composerFileInput,
      "change",
      handleComposerFileChange
    );

    listen(composerForm, "submit", handleSubmit);
    listen(chatMessages, "click", handleMessageClick);
listen(composerInput, "input", handleComposerInput);
listen(composerInput, "keydown", handleComposerKeydown);
    listen(global, "resize", resizeComposer);

    listen(global, "orientationchange", () => {
      syncPhysicalOrientation();
      resizeComposer();
    });

    if (global.screen?.orientation) {
      listen(global.screen.orientation, "change", () => {
        syncPhysicalOrientation();
        resizeComposer();
      });
    }

    listen(
      global,
      "ovll:navigation-back",
      event => {
        if (
          event.detail?.layer ===
            "node-builder" &&
          state.nodeBuilder.open
        ) {
          setNodeBuilderOpen(
            false,
            {
              history:false
            }
          );
        }
      }
    );

    UI.on("modechange", ({ mode }) => {
      if (mode === "canvas") {
        requestAnimationFrame(() => {
          state.canvas?.render?.();
        });
      }

      scheduleWorkspaceSave();
    });

    try {
      state.nodeDefinitions =
        await API.getNodeDefinitions();
    } catch (error) {
      console.error(
        "Node Definition Load Error:",
        error
      );
      state.nodeDefinitions = null;
    }

    await initializeCanvas();

    renderNodeBuilderOptions();

    state.ready = true;

    const active =
      WorkspaceStore
        .getActiveConversation?.();

    if (active) {
      await openConversation(
        active.id,
        {
          skipSave: true
        }
      );
    } else {
      Presence.showStart();
    }

    resizeComposer();
    scrollChatToBottom(true);

    global.dispatchEvent(
      new CustomEvent(
        "ovll:app-ready"
      )
    );
  }

  /* =======================================================
     Public API
     ======================================================= */
  const app = {
    isReady() {
      return state.ready;
    },

    isBusy() {
      return state.busy;
    },

    getCanvas() {
      return state.canvas;
    },

    getWorkflow() {
      return getCurrentWorkflow();
    },

    runNode(
      nodeId,
      mode = "spread"
    ) {
      return runCanvasNode(
        String(nodeId || ""),
        mode
      );
    },

    runTarget(nodeId) {
      return runCanvasNode(
        String(nodeId || ""),
        "target"
      );
    },

    runSpread(nodeId) {
      return runCanvasNode(
        String(nodeId || ""),
        "spread"
      );
    },

    getLastRun() {
      return state.runtime?.getLastRun?.() || null;
    },

    getNodeDefinitions() {
      return state.nodeDefinitions ? clone(state.nodeDefinitions) : null;
    },

    getConversationMemory() {
      return state.conversationMemory
        ? clone(state.conversationMemory)
        : null;
    },

    getActiveConversationId() {
      return currentConversationId();
    },

    saveActiveConversation,

    openConversation,

    previewArtifact:
      openArtifactPreview,

    async openLocalFile(
      fileId
    ) {
      const id =
        String(
          fileId || ""
        );

      if (!id) {
        return false;
      }

      const artifact =
        await FileStore.hydrate(
          id
        );

      if (!artifact) {
        return false;
      }

      return await openArtifactPreview(
        artifact
      );
    },

    refreshConversationContext,

    clearConversationMemory() {
      clearMemory();
    },

    addUserMessage,
    addAssistantMessage,
    addSystemMessage,

    async plan(text) {
      if (state.busy) return null;

      setBusy(true);

      try {
        return await plan(text);
      } finally {
        setBusy(false);
        resizeComposer();
      }
    },

    destroy() {
      if (state.destroyed) return;

      state.destroyed = true;

      clearTimeout(
        state.workspaceSaveTimer
      );
      state.workspaceSaveTimer =
        null;

      clearTimeout(
        state.nodeBuilder.resetTimer
      );
      state.nodeBuilder.resetTimer =
        null;

      clearTimeout(
        state.runGate.releaseTimer
      );
      state.runGate.releaseTimer =
        null;
      state.runGate.locked =
        false;

      listeners.splice(0).forEach(cleanup => {
        try {
          cleanup();
        } catch {}
      });

      state.canvas?.destroy?.();
      state.nodeBuilder.root?.remove();
      global.OvllLibraryPage
        ?.destroy?.();

      dismissErrorNotice();
      Presence.destroy?.();

      clearRuntimeConnections();

      state.canvas = null;
      state.runtime = null;
      state.nodeBuilder.root = null;
      state.nodeBuilder.open = false;
      state.workflow = null;
      state.workflowProposal = null;
      state.nodeDefinitions = null;
      state.conversationMemory = null;
      state.ready = false;
    }
  };

  global.AstraApp = Object.freeze(app);

  /* =======================================================
     Start
     ======================================================= */
  initialize().catch(error => {
    console.error(
      "ovll Initialization Error:",
      error
    );

    global.dispatchEvent(
      new CustomEvent(
        "ovll:app-error",
        {
          detail: {
            message:
              userFacingError(
                error,
                "오블을 초기화하지 못했습니다. 새로고침 후 다시 시도해 주세요."
              )
          }
        }
      )
    );

    addSystemMessage(
      userFacingError(
        error,
        "오블을 초기화하지 못했습니다. 새로고침 후 다시 시도해 주세요."
      )
    );
  });
})(window);