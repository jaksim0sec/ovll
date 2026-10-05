import {execFile} from "node:child_process";
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

function pdfGlyphUnits(char) {
  if (!char) return 0;

  if (/\s/.test(char)) {
    return .34;
  }

  const code =
    char.codePointAt(0);

  if (
    code >= 0x2e80 ||
    code > 0xffff
  ) {
    return 1;
  }

  if (
    /[A-Z0-9]/.test(char)
  ) {
    return .6;
  }

  if (
    /[a-z]/.test(char)
  ) {
    return .52;
  }

  if (
    /[.,:;!?'"()[\]{}]/.test(char)
  ) {
    return .32;
  }

  return .56;
}

function pdfTextUnits(value) {
  return Array
    .from(
      String(value ?? "")
    )
    .reduce(
      (sum, char) =>
        sum +
        pdfGlyphUnits(char),
      0
    );
}

function wrapPdfText(
  value,
  maxUnits
) {
  const text =
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();

  if (!text) {
    return [""];
  }

  const limit =
    Math.max(
      3,
      Number(maxUnits) ||
      3
    );

  const lines = [];
  let line = "";
  let units = 0;

  for (
    const char
    of Array.from(text)
  ) {
    const nextUnits =
      pdfGlyphUnits(char);

    if (
      line &&
      units +
        nextUnits >
        limit
    ) {
      lines.push(
        line.trimEnd()
      );

      line =
        /^\s$/.test(char)
          ? ""
          : char;

      units =
        /^\s$/.test(char)
          ? 0
          : nextUnits;

      continue;
    }

    line += char;
    units += nextUnits;
  }

  if (
    line.trim() ||
    !lines.length
  ) {
    lines.push(
      line.trimEnd()
    );
  }

  return lines;
}

function utf16Hex(value) {
  const source =
    Buffer.from(
      String(value ?? ""),
      "utf16le"
    );

  for (
    let index = 0;
    index + 1 <
      source.length;
    index += 2
  ) {
    const first =
      source[index];

    source[index] =
      source[index + 1];

    source[index + 1] =
      first;
  }

  return (
    "FEFF" +
    source
      .toString("hex")
      .toUpperCase()
  );
}

function utf16PdfTextHex(
  value
) {
  const buffer =
    Buffer.from(
      String(value ?? ""),
      "utf16le"
    );

  for (
    let index = 0;
    index + 1 <
      buffer.length;
    index += 2
  ) {
    const first =
      buffer[index];

    buffer[index] =
      buffer[index + 1];

    buffer[index + 1] =
      first;
  }

  return buffer
    .toString("hex")
    .toUpperCase();
}

function pdfNumber(value) {
  return Number(value)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(
      /(\.\d)0$/,
      "$1"
    );
}

function pdfPositionedTextCommand(
  text,
  x,
  y,
  size,
  {
    font = "F1",
    gray = .15,
    bold = false
  } = {}
) {
  const commands = [
    "BT",
    "/" +
      font +
      " " +
      pdfNumber(size) +
      " Tf",
    pdfNumber(gray) +
      " g"
  ];

  if (bold) {
    commands.push(
      ".22 w",
      "2 Tr"
    );
  }

  let cursor =
    Number(x) || 0;

  for (
    const char
    of Array.from(
      String(text ?? "")
    )
  ) {
    const advance =
      pdfGlyphUnits(char) *
      size;

    if (!/\s/.test(char)) {
      commands.push(
        "1 0 0 1 " +
        pdfNumber(cursor) +
        " " +
        pdfNumber(y) +
        " Tm"
      );

      commands.push(
        "<" +
        utf16PdfTextHex(char) +
        "> Tj"
      );
    }

    cursor += advance;
  }

  if (bold) {
    commands.push(
      "0 Tr"
    );
  }

  commands.push("ET");

  return commands.join("\n");
}

function pdfLine(
  x1,
  y1,
  x2,
  y2,
  gray = .85,
  width = .55
) {
  return (
    pdfNumber(gray) +
    " G\n" +
    pdfNumber(width) +
    " w\n" +
    pdfNumber(x1) +
    " " +
    pdfNumber(y1) +
    " m\n" +
    pdfNumber(x2) +
    " " +
    pdfNumber(y2) +
    " l\nS"
  );
}

function pdfFillRect(
  x,
  y,
  width,
  height,
  gray = .97
) {
  return (
    pdfNumber(gray) +
    " g\n" +
    pdfNumber(x) +
    " " +
    pdfNumber(y) +
    " " +
    pdfNumber(width) +
    " " +
    pdfNumber(height) +
    " re f"
  );
}

export function renderPdfFallback(
  inputDocument,
  metadata = {}
) {
  const document =
    normalizedDocument({
      document:
        inputDocument,
      title:
        metadata.title ||
        ""
    });

  const pageWidth = 595;
  const pageHeight = 842;
  const left = 54;
  const right = 54;
  const top = 56;
  const bottom = 58;
  const contentWidth =
    pageWidth -
    left -
    right;

  const pages = [];
  let commands = [];
  let y =
    pageHeight -
    top;

  const pushPage = () => {
    if (commands.length) {
      pages.push(commands);
    }

    commands = [];
    y =
      pageHeight -
      top;
  };

  const ensure =
    (
      height,
      {
        minimumRemaining =
          0
      } = {}
    ) => {
      if (
        y -
          Math.max(
            height,
            minimumRemaining
          ) <
        bottom
      ) {
        pushPage();
      }
    };

  const drawWrappedText =
    ({
      text,
      x = left,
      width =
        contentWidth,
      size = 10.2,
      lineHeight = 17.2,
      font = "F1",
      gray = .16,
      bold = false,
      before = 0,
      after = 8,
      keepFirstLines = 2
    }) => {
      const lines =
        wrapPdfText(
          text,
          Math.max(
            4,
            width /
              size
          )
        );

      const minimum =
        before +
        Math.min(
          keepFirstLines,
          lines.length
        ) *
          lineHeight;

      ensure(
        minimum
      );

      y -= before;

      for (
        let index = 0;
        index <
          lines.length;
        index++
      ) {
        if (
          y -
            lineHeight <
          bottom
        ) {
          pushPage();
        }

        commands.push(
          pdfPositionedTextCommand(
            lines[index],
            x,
            y,
            size,
            {
              font,
              gray,
              bold
            }
          )
        );

        y -= lineHeight;
      }

      y -= after;
    };

  const title =
    String(
      document.title ||
      metadata.title ||
      "문서"
    )
      .trim()
      .slice(0, 120);

  drawWrappedText({
    text:
      title,
    size: 24,
    lineHeight: 31,
    font: "F2",
    gray: .07,
    bold: true,
    after: 12,
    keepFirstLines: 1
  });

  commands.push(
    pdfLine(
      left,
      y + 3,
      pageWidth -
        right,
      y + 3,
      .82,
      .75
    )
  );

  y -= 16;

  for (
    const block
    of document.blocks || []
  ) {
    if (!block) {
      continue;
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

      const style =
        level === 1
          ? {
              size: 18.5,
              lineHeight: 25,
              before: 15,
              after: 9
            }
          : level === 2
            ? {
                size: 15.5,
                lineHeight: 22,
                before: 18,
                after: 8
              }
            : {
                size: 12.4,
                lineHeight: 18.7,
                before: 12,
                after: 6
              };

      drawWrappedText({
        text:
          block.text,
        size:
          style.size,
        lineHeight:
          style.lineHeight,
        font: "F2",
        gray: .1,
        bold: true,
        before:
          style.before,
        after:
          style.after,
        keepFirstLines: 1
      });

      continue;
    }

    if (
      block.type ===
        "paragraph"
    ) {
      drawWrappedText({
        text:
          block.text,
        size: 10.35,
        lineHeight: 17.35,
        gray: .17,
        after: 10
      });

      continue;
    }

    if (
      block.type ===
        "list"
    ) {
      const items =
        Array.isArray(
          block.items
        )
          ? block.items
          : [];

      for (
        let index = 0;
        index <
          items.length;
        index++
      ) {
        const marker =
          block.ordered
            ? String(
                index + 1
              ) + "."
            : "•";

        const markerWidth =
          21;

        const lines =
          wrapPdfText(
            items[index],
            Math.max(
              4,
              (
                contentWidth -
                markerWidth
              ) /
                10.25
            )
          );

        const lineHeight =
          16.7;

        ensure(
          Math.min(
            2,
            lines.length
          ) *
            lineHeight +
            4
        );

        commands.push(
          pdfPositionedTextCommand(
            marker,
            left + 2,
            y,
            9.8,
            {
              font: "F2",
              gray: .24,
              bold: true
            }
          )
        );

        for (
          const line
          of lines
        ) {
          if (
            y -
              lineHeight <
            bottom
          ) {
            pushPage();
          }

          commands.push(
            pdfPositionedTextCommand(
              line,
              left +
                markerWidth,
              y,
              10.25,
              {
                gray: .17
              }
            )
          );

          y -= lineHeight;
        }

        y -= 5;
      }

      y -= 2;
      continue;
    }

    if (
      block.type ===
        "quote"
    ) {
      const pad = 13;
      const lines =
        wrapPdfText(
          block.text,
          Math.max(
            4,
            (
              contentWidth -
              pad * 2
            ) /
              10.1
          )
        );

      const lineHeight =
        16.4;
      const height =
        lines.length *
          lineHeight +
        19;

      ensure(
        height + 6
      );

      const bottomY =
        y -
        height +
        6;

      commands.push(
        pdfFillRect(
          left,
          bottomY,
          contentWidth,
          height,
          .965
        )
      );

      commands.push(
        pdfFillRect(
          left,
          bottomY,
          3,
          height,
          .72
        )
      );

      y -= 9;

      for (
        const line
        of lines
      ) {
        commands.push(
          pdfPositionedTextCommand(
            line,
            left +
              pad +
              2,
            y,
            10.1,
            {
              gray: .3
            }
          )
        );

        y -= lineHeight;
      }

      y =
        bottomY -
        9;

      continue;
    }

    if (
      block.type ===
        "code"
    ) {
      const pad = 12;
      const sourceLines =
        String(
          block.text ||
          ""
        ).split("\n");

      const lines =
        sourceLines
          .flatMap(
            line =>
              wrapPdfText(
                line || " ",
                Math.max(
                  4,
                  (
                    contentWidth -
                    pad * 2
                  ) /
                    9
                )
              )
          );

      const lineHeight =
        14.2;

      for (
        let start = 0;
        start <
          Math.max(
            1,
            lines.length
          );
      ) {
        const availableLines =
          Math.max(
            1,
            Math.floor(
              (
                y -
                bottom -
                24
              ) /
                lineHeight
            )
          );

        if (
          availableLines < 3
        ) {
          pushPage();
          continue;
        }

        const chunk =
          lines.slice(
            start,
            start +
              availableLines
          );

        const height =
          chunk.length *
            lineHeight +
          18;

        const bottomY =
          y -
          height +
          5;

        commands.push(
          pdfFillRect(
            left,
            bottomY,
            contentWidth,
            height,
            .95
          )
        );

        y -= 8;

        for (
          const line
          of chunk
        ) {
          commands.push(
            pdfPositionedTextCommand(
              line,
              left +
                pad,
              y,
              9,
              {
                font: "F1",
                gray: .24
              }
            )
          );

          y -= lineHeight;
        }

        y =
          bottomY -
          9;

        start +=
          chunk.length;
      }

      continue;
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

      const columnCount =
        Math.max(
          1,
          headers.length,
          ...rows.map(
            row =>
              Array.isArray(row)
                ? row.length
                : 0
          )
        );

      const columnWidth =
        contentWidth /
        columnCount;
      const padding = 6;
      const fontSize =
        9.25;
      const lineHeight =
        14.4;

      const drawRow =
        (
          cells,
          {
            header = false
          } = {}
        ) => {
          const wrapped =
            Array.from(
              {
                length:
                  columnCount
              },
              (
                _,
                index
              ) =>
                wrapPdfText(
                  cells?.[
                    index
                  ] ?? "",
                  Math.max(
                    3,
                    (
                      columnWidth -
                      padding * 2
                    ) /
                      fontSize
                  )
                )
            );

          const lineCount =
            Math.max(
              1,
              ...wrapped.map(
                value =>
                  value.length
              )
            );

          const rowHeight =
            lineCount *
              lineHeight +
            12;

          ensure(
            rowHeight + 2
          );

          const rowBottom =
            y -
            rowHeight +
            4;

          if (header) {
            commands.push(
              pdfFillRect(
                left,
                rowBottom,
                contentWidth,
                rowHeight,
                .94
              )
            );
          }

          commands.push(
            pdfLine(
              left,
              y + 4,
              pageWidth -
                right,
              y + 4,
              .82,
              .55
            )
          );

          commands.push(
            pdfLine(
              left,
              rowBottom,
              pageWidth -
                right,
              rowBottom,
              .84,
              .55
            )
          );

          for (
            let column = 0;
            column <=
              columnCount;
            column++
          ) {
            const x =
              left +
              column *
                columnWidth;

            commands.push(
              pdfLine(
                x,
                y + 4,
                x,
                rowBottom,
                .88,
                .45
              )
            );
          }

          for (
            let column = 0;
            column <
              columnCount;
            column++
          ) {
            let textY =
              y - 7;

            for (
              const line
              of wrapped[
                column
              ]
            ) {
              commands.push(
                pdfPositionedTextCommand(
                  line,
                  left +
                    column *
                      columnWidth +
                    padding,
                  textY,
                  fontSize,
                  {
                    font:
                      header
                        ? "F2"
                        : "F1",
                    gray:
                      header
                        ? .18
                        : .2,
                    bold:
                      header
                  }
                )
              );

              textY -=
                lineHeight;
            }
          }

          y =
            rowBottom -
            5;
        };

      if (headers.length) {
        drawRow(
          headers,
          {
            header: true
          }
        );
      }

      for (
        const row
        of rows
      ) {
        drawRow(row);
      }

      y -= 4;
      continue;
    }

    if (
      block.type ===
        "rule"
    ) {
      ensure(18);
      y -= 6;

      commands.push(
        pdfLine(
          left,
          y,
          pageWidth -
            right,
          y,
          .83,
          .6
        )
      );

      y -= 12;
    }
  }

  if (
    commands.length ||
    !pages.length
  ) {
    pages.push(commands);
  }

  pages.forEach(
    (
      pageCommands,
      index
    ) => {
      pageCommands.push(
        pdfLine(
          left,
          42,
          pageWidth -
            right,
          42,
          .87,
          .55
        )
      );

      pageCommands.push(
        pdfPositionedTextCommand(
          title,
          left,
          27,
          7.6,
          {
            font: "F1",
            gray: .58
          }
        )
      );

      pageCommands.push(
        pdfPositionedTextCommand(
          String(
            index + 1
          ) +
            " / " +
            String(
              pages.length
            ),
          pageWidth -
            right -
            34,
          27,
          7.6,
          {
            font: "F1",
            gray: .58
          }
        )
      );
    }
  );

  const pageObjectIds =
    pages.map(
      (
        _,
        index
      ) =>
        3 +
        index * 2
    );

  const fontBodyId =
    3 +
    pages.length * 2;
  const fontBodyCidId =
    fontBodyId + 1;
  const fontHeadId =
    fontBodyId + 2;
  const fontHeadCidId =
    fontBodyId + 3;
  const infoId =
    fontBodyId + 4;
  const objectCount =
    infoId;

  const objects =
    new Map();

  objects.set(
    1,
    "<< /Type /Catalog /Pages 2 0 R >>"
  );

  objects.set(
    2,
    "<< /Type /Pages /Kids [" +
      pageObjectIds
        .map(
          id =>
            id +
            " 0 R"
        )
        .join(" ") +
      "] /Count " +
      pages.length +
      " >>"
  );

  pages.forEach(
    (
      pageCommands,
      index
    ) => {
      const pageId =
        3 +
        index * 2;
      const contentId =
        pageId + 1;

      const stream =
        pageCommands
          .join("\n");

      objects.set(
        pageId,
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
          "/Resources << /Font << /F1 " +
          fontBodyId +
          " 0 R /F2 " +
          fontHeadId +
          " 0 R >> >> " +
          "/Contents " +
          contentId +
          " 0 R >>"
      );

      objects.set(
        contentId,
        "<< /Length " +
          Buffer.byteLength(
            stream,
            "ascii"
          ) +
          " >>\nstream\n" +
          stream +
          "\nendstream"
      );
    }
  );

  objects.set(
    fontBodyId,
    "<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium " +
      "/Encoding /UniKS-UCS2-H /DescendantFonts [" +
      fontBodyCidId +
      " 0 R] >>"
  );

  objects.set(
    fontBodyCidId,
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium " +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /DW 1000 >>"
  );

  objects.set(
    fontHeadId,
    "<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium " +
      "/Encoding /UniKS-UCS2-H /DescendantFonts [" +
      fontHeadCidId +
      " 0 R] >>"
  );

  objects.set(
    fontHeadCidId,
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium " +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /DW 1000 >>"
  );

  objects.set(
    infoId,
    "<< /Producer <" +
      utf16Hex("ovll") +
      "> /Title <" +
      utf16Hex(title) +
      "> >>"
  );

  const chunks = [
    Buffer.from(
      "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n",
      "binary"
    )
  ];

  const offsets = [0];
  let offset =
    chunks[0].length;

  for (
    let id = 1;
    id <= objectCount;
    id++
  ) {
    offsets[id] =
      offset;

    const chunk =
      Buffer.from(
        id +
          " 0 obj\n" +
          objects.get(id) +
          "\nendobj\n",
        "ascii"
      );

    chunks.push(chunk);
    offset +=
      chunk.length;
  }

  const xrefOffset =
    offset;

  let xref =
    "xref\n0 " +
    (
      objectCount + 1
    ) +
    "\n0000000000 65535 f \n";

  for (
    let id = 1;
    id <= objectCount;
    id++
  ) {
    xref +=
      String(
        offsets[id]
      ).padStart(
        10,
        "0"
      ) +
      " 00000 n \n";
  }

  xref +=
    "trailer\n<< /Size " +
    (
      objectCount + 1
    ) +
    " /Root 1 0 R /Info " +
    infoId +
    " 0 R >>\n" +
    "startxref\n" +
    xrefOffset +
    "\n%%EOF";

  chunks.push(
    Buffer.from(
      xref,
      "ascii"
    )
  );

  return Buffer.concat(
    chunks
  );
}
