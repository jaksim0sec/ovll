import {execFile} from "node:child_process";
import {Worker} from "node:worker_threads";
import {promisify} from "node:util";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {
  createArtifactDocument
} from "./artifactDocument.js";

const execFileAsync =
  promisify(execFile);

let cachedChromeExecutable;

let sharedPdfKitWorker = null;
let pdfKitRequestCounter = 0;
let pdfKitQueue =
  Promise.resolve();
let pdfKitWarmupPromise = null;

const DEFAULT_PDFKIT_TIMEOUT_MS =
  180000;
const MAX_PDFKIT_TIMEOUT_MS =
  300000;

function pdfKitDocumentStats(
  document
) {
  const blocks =
    Array.isArray(
      document?.blocks
    )
      ? document.blocks
      : [];

  let chars = 0;
  let tables = 0;
  let cells = 0;

  for (const block of blocks) {
    if (!block) {
      continue;
    }

    if (
      typeof block.text ===
        "string"
    ) {
      chars +=
        block.text.length;
    }

    if (
      Array.isArray(
        block.items
      )
    ) {
      for (const item of block.items) {
        chars +=
          String(
            item || ""
          ).length;
      }
    }

    if (
      block.type ===
        "table"
    ) {
      tables++;

      const headers =
        Array.isArray(
          block.headers
        )
          ? block.headers
          : [];
      const rows =
        Array.isArray(
          block.rows
        )
          ? block.rows
          : [];

      cells +=
        headers.length;

      for (const row of rows) {
        if (!Array.isArray(row)) {
          continue;
        }

        cells +=
          row.length;

        for (const cell of row) {
          chars +=
            String(
              cell || ""
            ).length;
        }
      }
    }
  }

  return {
    blocks:
      blocks.length,
    chars,
    tables,
    cells
  };
}

function pdfKitTimeoutMs(
  document
) {
  const explicit =
    Number(
      process.env
        .OVLL_PDFKIT_WORKER_TIMEOUT_MS
    );

  if (
    Number.isFinite(explicit) &&
    explicit >= 1000
  ) {
    return Math.min(
      MAX_PDFKIT_TIMEOUT_MS,
      Math.max(
        1000,
        explicit
      )
    );
  }

  const stats =
    pdfKitDocumentStats(
      document
    );

  const complexityBudget =
    Math.min(
      120000,
      Math.ceil(
        stats.chars /
        1000
      ) *
        850 +
      stats.cells *
        18
    );

  return Math.min(
    MAX_PDFKIT_TIMEOUT_MS,
    DEFAULT_PDFKIT_TIMEOUT_MS +
      complexityBudget
  );
}

function disposePdfKitWorker(
  worker
) {
  if (!worker) {
    return;
  }

  if (
    sharedPdfKitWorker ===
    worker
  ) {
    sharedPdfKitWorker =
      null;
  }

  try {
    const result =
      worker.terminate();

    result?.catch?.(() => {});
  } catch {}
}

function ensurePdfKitWorker() {
  if (sharedPdfKitWorker) {
    return sharedPdfKitWorker;
  }

  const worker =
    new Worker(
      new URL(
        "./pdfKitWorker.js",
        import.meta.url
      ),
      {
        type: "module"
      }
    );

  worker.unref?.();

  worker.once(
    "exit",
    () => {
      if (
        sharedPdfKitWorker ===
        worker
      ) {
        sharedPdfKitWorker =
          null;
      }
    }
  );

  sharedPdfKitWorker =
    worker;

  return worker;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(value) {
  return escapeHtml(
    String(value ?? "")
  );
}

async function executableFile(value) {
  const candidate =
    String(value || "")
      .trim();

  if (!candidate) {
    return null;
  }

  try {
    await access(
      candidate,
      fsConstants.X_OK
    );
    return candidate;
  } catch {
    return null;
  }
}

async function resolveChromeExecutable() {
  if (
    String(
      process.env
        .OVLL_DISABLE_CHROME ||
      ""
    ) === "1"
  ) {
    return null;
  }

  if (
    cachedChromeExecutable !==
      undefined
  ) {
    return cachedChromeExecutable;
  }

  const explicit = [
    process.env.OVLL_CHROME_PATH,
    process.env.CHROME_PATH,
    process.env
      .PUPPETEER_EXECUTABLE_PATH,
    process.env
      .PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ];

  for (const candidate of explicit) {
    const file =
      await executableFile(
        candidate
      );

    if (file) {
      cachedChromeExecutable =
        file;
      return file;
    }
  }

  const commands =
    process.platform ===
      "win32"
      ? [
          "chrome.exe",
          "msedge.exe"
        ]
      : process.platform ===
          "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium"
          ]
        : [
            "google-chrome-stable",
            "google-chrome",
            "chromium",
            "chromium-browser",
            "chrome",
            "chrome-headless-shell"
          ];

  for (const candidate of commands) {
    const direct =
      candidate.includes("/") ||
      candidate.includes("\\")
        ? await executableFile(
            candidate
          )
        : candidate;

    if (!direct) {
      continue;
    }

    try {
      await execFileAsync(
        direct,
        [
          "--version"
        ],
        {
          timeout: 2500,
          windowsHide: true,
          maxBuffer:
            256 * 1024
        }
      );

      cachedChromeExecutable =
        direct;
      return direct;
    } catch {}
  }

  cachedChromeExecutable =
    null;
  return null;
}

function normalizedDocument(
  input = {}
) {
  if (
    input &&
    typeof input ===
      "object" &&
    Array.isArray(
      input.blocks
    )
  ) {
    return input;
  }

  if (
    input.document &&
    typeof input.document ===
      "object" &&
    Array.isArray(
      input.document.blocks
    )
  ) {
    return input.document;
  }

  return createArtifactDocument(
    [
      input.text || ""
    ],
    {
      title:
        input.title ||
        ""
    }
  );
}

function fontFaceCss() {
  const url =
    String(
      process.env
        .OVLL_PDF_FONT_URL ||
      ""
    )
      .trim()
      .replace(
        /[\n\r"'()\\]/g,
        ""
      );

  if (!url) {
    return "";
  }

  return (
    "@font-face{" +
    "font-family:OvllKorean;" +
    "src:url(" +
    url +
    ") format(woff2);" +
    "font-style:normal;" +
    "font-weight:100 900;" +
    "font-display:block" +
    "}"
  );
}

function blockHtml(block) {
  if (
    !block ||
    typeof block !==
      "object"
  ) {
    return "";
  }

  if (
    block.type ===
      "heading"
  ) {
    const level =
      Math.max(
        1,
        Math.min(
          3,
          Number(
            block.level || 2
          )
        )
      );

    return (
      "<h" +
      level +
      ">" +
      inlineHtml(
        block.text
      ) +
      "</h" +
      level +
      ">"
    );
  }

  if (
    block.type ===
      "paragraph"
  ) {
    return (
      "<p>" +
      inlineHtml(
        block.text
      ) +
      "</p>"
    );
  }

  if (
    block.type ===
      "list"
  ) {
    const tag =
      block.ordered
        ? "ol"
        : "ul";

    return (
      "<" +
      tag +
      ">" +
      (
        Array.isArray(
          block.items
        )
          ? block.items
          : []
      )
        .map(
          item =>
            "<li>" +
            inlineHtml(item) +
            "</li>"
        )
        .join("") +
      "</" +
      tag +
      ">"
    );
  }

  if (
    block.type ===
      "quote"
  ) {
    return (
      "<blockquote>" +
      inlineHtml(
        block.text
      ) +
      "</blockquote>"
    );
  }

  if (
    block.type ===
      "code"
  ) {
    const language =
      String(
        block.language ||
        ""
      )
        .trim()
        .slice(0, 40);

    return (
      "<pre" +
      (
        language
          ? ' data-language="' +
            escapeHtml(
              language
            ) +
            '"'
          : ""
      ) +
      "><code>" +
      escapeHtml(
        block.text
      ) +
      "</code></pre>"
    );
  }

  if (
    block.type ===
      "table"
  ) {
    const headers =
      Array.isArray(
        block.headers
      )
        ? block.headers
        : [];

    const rows =
      Array.isArray(
        block.rows
      )
        ? block.rows
        : [];

    return (
      '<div class="table-wrap">' +
      "<table>" +
      "<thead><tr>" +
      headers
        .map(
          value =>
            "<th>" +
            inlineHtml(value) +
            "</th>"
        )
        .join("") +
      "</tr></thead>" +
      "<tbody>" +
      rows
        .map(
          row =>
            "<tr>" +
            headers
              .map(
                (
                  _,
                  index
                ) =>
                  "<td>" +
                  inlineHtml(
                    row?.[index] ??
                    ""
                  ) +
                  "</td>"
              )
              .join("") +
            "</tr>"
        )
        .join("") +
      "</tbody>" +
      "</table>" +
      "</div>"
    );
  }

  if (
    block.type ===
      "rule"
  ) {
    return "<hr>";
  }

  return "";
}

export function pdfDocumentHtml(
  document
) {
  const doc =
    normalizedDocument({
      document
    });

  const title =
    String(
      doc.title ||
      "문서"
    )
      .trim()
      .slice(0, 160);

  const body =
    (
      Array.isArray(
        doc.blocks
      )
        ? doc.blocks
        : []
    )
      .map(blockHtml)
      .join("");

  const css = [
    fontFaceCss(),
    "@page{size:A4;margin:18mm 18mm 20mm}",
    "*{box-sizing:border-box}",
    "html{print-color-adjust:exact;-webkit-print-color-adjust:exact}",
    "body{margin:0;color:#1c1d20;background:#fff;font-family:OvllKorean,\"Noto Sans KR\",\"Noto Sans CJK KR\",\"Apple SD Gothic Neo\",\"Malgun Gothic\",sans-serif;font-size:10.15pt;line-height:1.72;letter-spacing:-.014em;word-break:keep-all;overflow-wrap:anywhere}",
    "article{width:100%}",
    ".document-masthead{margin:0 0 9.5mm;padding:0 0 5.2mm;border-bottom:1px solid #d9dde3}",
    ".document-kicker{margin:0 0 2.2mm;color:#7d838c;font-size:7.6pt;font-weight:650;letter-spacing:.12em;text-transform:uppercase}",
    ".document-title{margin:0;max-width:46rem;color:#101114;font-size:26pt;line-height:1.16;font-weight:760;letter-spacing:-.042em;word-break:keep-all}",
    "h1,h2,h3{break-after:avoid;break-inside:avoid;margin-left:0;margin-right:0;color:#15161a;letter-spacing:-.032em}",
    "h1{margin:8mm 0 3.6mm;font-size:19pt;line-height:1.28;font-weight:750}",
    "h2{margin:8.5mm 0 3.2mm;padding-top:.5mm;font-size:15.2pt;line-height:1.35;font-weight:730}",
    "h3{margin:6.2mm 0 2.5mm;font-size:12.4pt;line-height:1.42;font-weight:700}",
    "p{margin:0 0 4.4mm;orphans:3;widows:3}",
    "ul,ol{margin:1.5mm 0 5mm;padding-left:6.4mm}",
    "li{margin:1.25mm 0;padding-left:.8mm;break-inside:avoid}",
    "blockquote{margin:4.2mm 0 5.2mm;padding:3.8mm 4.6mm;border-left:3px solid #9da6b2;border-radius:0 2.6mm 2.6mm 0;background:#f5f7f9;color:#41464d;break-inside:avoid}",
    "pre{margin:4.2mm 0 5.4mm;padding:4mm 4.5mm;border:1px solid #dfe3e8;border-radius:2.8mm;background:#f6f7f9;white-space:pre-wrap;word-break:break-word;break-inside:auto}",
    "pre code{font-family:\"SFMono-Regular\",\"Cascadia Mono\",\"Roboto Mono\",Consolas,monospace;font-size:8.75pt;line-height:1.6}",
    "hr{border:0;border-top:1px solid #dfe2e7;margin:7.5mm 0}",
    ".table-wrap{margin:4.5mm 0 6mm;break-inside:auto}",
    "table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #d9dde3;border-radius:2.4mm;overflow:hidden;font-size:9.15pt;line-height:1.5}",
    "thead{display:table-header-group}",
    "tr{break-inside:avoid}",
    "th,td{padding:2.65mm 3mm;text-align:left;vertical-align:top;border-right:1px solid #e5e8ec;border-bottom:1px solid #e3e6ea}",
    "th{background:#f2f4f7;color:#2d3137;font-weight:720}",
    "th:last-child,td:last-child{border-right:0}",
    "tbody tr:last-child td{border-bottom:0}",
    ".doc-footer{position:fixed;left:0;right:0;bottom:-13.1mm;padding-top:2.25mm;border-top:1px solid #e1e4e8;color:#9399a2;font-size:7.35pt;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
  ].join("");

  return (
    "<!doctype html>" +
    '<html lang="ko">' +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" +
    escapeHtml(title) +
    "</title>" +
    "<style>" +
    css +
    "</style>" +
    "</head>" +
    "<body>" +
    "<article>" +
    '<header class="document-masthead">' +
    '<div class="document-kicker">OVLL DOCUMENT</div>' +
    '<h1 class="document-title">' +
    escapeHtml(title) +
    "</h1>" +
    "</header>" +
    body +
    "</article>" +
    '<div class="doc-footer">' +
    escapeHtml(title) +
    "</div>" +
    "</body>" +
    "</html>"
  );
}

export async function renderPdfWithChrome(
  input = {}
) {
  const executable =
    await resolveChromeExecutable();

  if (!executable) {
    return null;
  }

  const document =
    normalizedDocument(
      input
    );

  const tempDir =
    await mkdtemp(
      path.join(
        os.tmpdir(),
        "ovll-pdf-"
      )
    );

  const htmlPath =
    path.join(
      tempDir,
      "document.html"
    );

  const pdfPath =
    path.join(
      tempDir,
      "document.pdf"
    );

  try {
    await writeFile(
      htmlPath,
      pdfDocumentHtml(
        document
      ),
      "utf8"
    );

    try {
      await execFileAsync(
        executable,
        [
          "--headless",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--disable-extensions",
          "--disable-sync",
          "--metrics-recording-only",
          "--mute-audio",
          "--no-first-run",
          "--no-sandbox",
          "--allow-file-access-from-files",
          "--no-pdf-header-footer",
          "--run-all-compositor-stages-before-draw",
          "--user-data-dir=" +
            path.join(
              tempDir,
              "profile"
            ),
          "--virtual-time-budget=1000",
          "--print-to-pdf=" +
            pdfPath,
          pathToFileURL(
            htmlPath
          ).href
        ],
        {
          timeout: 9000,
          windowsHide: true,
          maxBuffer:
            1024 * 1024
        }
      );
    } catch (error) {
      cachedChromeExecutable =
        null;
      throw error;
    }

    const buffer =
      await readFile(
        pdfPath
      );

    if (
      buffer.length < 8 ||
      buffer
        .subarray(0, 5)
        .toString(
          "ascii"
        ) !== "%PDF-"
    ) {
      throw new Error(
        "Headless Chrome did not produce a valid PDF."
      );
    }

    return buffer;
  } finally {
    await rm(
      tempDir,
      {
        recursive: true,
        force: true
      }
    ).catch(() => {});
  }
}

function renderPdfKitInWorker(
  document,
  metadata
) {
  const timeoutMs =
    pdfKitTimeoutMs(
      document
    );
  const stats =
    pdfKitDocumentStats(
      document
    );

  return new Promise(
    (resolve, reject) => {
      const worker =
        ensurePdfKitWorker();

      const id =
        "pdf_" +
        (++pdfKitRequestCounter);

      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);

        worker.removeListener(
          "message",
          onMessage
        );
        worker.removeListener(
          "error",
          onError
        );
        worker.removeListener(
          "exit",
          onExit
        );
      };

      const finish = (
        error,
        buffer,
        durationMs = null
      ) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        if (error) {
          reject(error);
          return;
        }

        console.info(
          "[artifact pdfkit]",
          {
            durationMs,
            reusedWorker:
              sharedPdfKitWorker ===
              worker
          }
        );

        resolve(
          Buffer.from(
            buffer
          )
        );
      };

      const onMessage =
        payload => {
          if (
            String(
              payload?.id || ""
            ) !== id
          ) {
            return;
          }

          if (payload?.ok) {
            finish(
              null,
              payload.buffer,
              Number(
                payload.durationMs
              ) || null
            );
            return;
          }

          const error =
            new Error(
              payload?.error
                ?.message ||
              "PDFKit worker failed."
            );

          error.code =
            payload?.error
              ?.code ||
            "PDFKIT_WORKER_ERROR";

          finish(error);
        };

      const onError =
        error => {
          disposePdfKitWorker(
            worker
          );
          finish(error);
        };

      const onExit =
        code => {
          if (settled) {
            return;
          }

          const error =
            new Error(
              "PDFKit worker exited unexpectedly."
            );

          error.code =
            "PDFKIT_WORKER_EXIT";
          error.exitCode =
            code;

          finish(error);
        };

      const timer =
        setTimeout(
          () => {
            const error =
              new Error(
                "PDFKit worker timed out."
              );

            error.code =
              "PDFKIT_WORKER_TIMEOUT";
            error.status =
              504;

            disposePdfKitWorker(
              worker
            );

            finish(error);
          },
          timeoutMs
        );

      worker.on(
        "message",
        onMessage
      );
      worker.once(
        "error",
        onError
      );
      worker.once(
        "exit",
        onExit
      );

      console.info(
        "[artifact pdfkit start]",
        {
          id,
          ...stats,
          timeoutMs
        }
      );

      worker.postMessage({
        id,
        document,
        metadata
      });
    }
  );
}

export async function warmPdfFallback() {
  if (pdfKitWarmupPromise) {
    return pdfKitWarmupPromise;
  }

  const startedAt =
    Date.now();

  pdfKitWarmupPromise =
    renderPdfFallback(
      {
        title:
          "ovll",
        blocks: [
          {
            type:
              "paragraph",
            text:
              "오블 PDF 준비"
          }
        ]
      },
      {
        title:
          "ovll"
      }
    )
      .then(
        buffer => {
          console.info(
            "[artifact pdfkit warmup]",
            {
              durationMs:
                Date.now() -
                startedAt,
              size:
                buffer.length
            }
          );

          return true;
        }
      )
      .catch(
        error => {
          pdfKitWarmupPromise =
            null;
          throw error;
        }
      );

  return pdfKitWarmupPromise;
}

export async function renderPdfFallback(
  inputDocument,
  metadata = {}
) {
  const document =
    normalizedDocument(
      inputDocument
    );

  const task =
    pdfKitQueue.then(
      () =>
        renderPdfKitInWorker(
          document,
          metadata
        ),
      () =>
        renderPdfKitInWorker(
          document,
          metadata
        )
    );

  pdfKitQueue =
    task.catch(() => {});

  return task;
}
