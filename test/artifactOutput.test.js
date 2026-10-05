import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStoredArtifact,
  getStoredArtifact
} from "../artifactStore.js";
import {
  createArtifactDocument
} from "../artifactDocument.js";
import {
  pdfDocumentHtml,
  renderPdfFallback
} from "../pdfRenderer.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("HTML artifacts preserve runnable markup instead of escaping it", async () => {
  const source =
    "<!doctype html><html><head><title>demo</title></head><body><h1>Hello</h1><script>document.body.dataset.ready='1'</script></body></html>";

  const artifact = await createStoredArtifact({
    format: "HTML",
    filename: "demo",
    sources: [source]
  });

  const stored = getStoredArtifact(artifact.id);
  const html = stored.buffer.toString("utf8");

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.match(html, /<script>document\.body\.dataset\.ready='1'<\/script>/);
  assert.doesNotMatch(html, /&lt;h1&gt;/);
});

test("HTML artifacts unwrap fenced complete documents", async () => {
  const artifact = await createStoredArtifact({
    format: "HTML",
    filename: "fenced",
    sources: [
      "~~~html\n<!doctype html><html><body><main>Rendered</main></body></html>\n~~~"
    ]
  });

  const stored = getStoredArtifact(artifact.id);
  const html = stored.buffer.toString("utf8");

  assert.match(html, /<main>Rendered<\/main>/);
  assert.doesNotMatch(html, /~~~html/);
});

test("common file formats have distinct visual kinds", () => {
  const source = read("front/js/artifactVisuals.js");
  const fakeWindow = {};

  new Function("window", source)(fakeWindow);

  const visual = fakeWindow.OvllArtifactVisuals.visual;

  const expected = {
    PDF: "pdf",
    PNG: "image",
    TXT: "text",
    MD: "text",
    HTML: "html",
    DOCX: "document",
    XLSX: "spreadsheet",
    CSV: "spreadsheet",
    PPTX: "presentation",
    JSON: "code",
    JS: "code",
    ZIP: "archive",
    MP3: "audio",
    MP4: "video"
  };

  for (const [format, kind] of Object.entries(expected)) {
    assert.equal(
      visual({ format, name: "sample." + format.toLowerCase() }).kind,
      kind,
      format + " should use " + kind + " icon"
    );
  }
});

test("PDF fallback uses the dedicated embedded-font renderer", async () => {
  const renderer =
    read(
      "pdfKitRenderer.js"
    );

  assert.match(
    renderer,
    /from\s+"pdfkit"/
  );
  assert.match(
    renderer,
    /@fontsource\/noto-sans-kr/
  );
  assert.match(
    renderer,
    /registerFont/
  );

  const previous =
    process.env
      .OVLL_DISABLE_CHROME;

  process.env
    .OVLL_DISABLE_CHROME =
    "1";

  try {
    const artifact =
      await createStoredArtifact({
        format: "PDF",
        filename: "korean",
        sources: [
          "# 조사 및 요약 결과 보고서\n\n제1장: 개요\n앞서 수집된 조사 결과를 요약합니다.\n\n제2장: 세부 내용\n다음 문장도 별도 문단으로 읽혀야 합니다."
        ]
      });

    const stored =
      getStoredArtifact(
        artifact.id
      );

    assert.equal(
      artifact.renderer,
      "pdfkit-fallback"
    );
    assert.equal(
      stored.buffer
        .subarray(0,5)
        .toString("ascii"),
      "%PDF-"
    );
    assert.doesNotMatch(
      stored.buffer
        .toString("latin1"),
      /HYSMyeongJo|HYGoThic/
    );
    assert.ok(
      stored.buffer.length >
        5000
    );
  } finally {
    if (
      previous ===
        undefined
    ) {
      delete process.env
        .OVLL_DISABLE_CHROME;
    } else {
      process.env
        .OVLL_DISABLE_CHROME =
        previous;
    }
  }
});test("PDF HTML renderer uses canonical Korean chapter headings and paged media", () => {
  const document =
    createArtifactDocument(
      [
        "고라니 종합 보고서\n\n제1장: 생태\n첫 번째 본문입니다.\n\n제2장: 서식지\n두 번째 본문입니다."
      ],
      {
        title:
          "고라니 종합 보고서"
      }
    );

  const html =
    pdfDocumentHtml(
      document
    );

  assert.match(
    html,
    /<h2[^>]*>제1장: 생태<\/h2>/
  );
  assert.match(
    html,
    /<h2[^>]*>제2장: 서식지<\/h2>/
  );
  assert.match(
    html,
    /@page\s*\{[^}]*size\s*:\s*A4/i
  );
  assert.match(
    html,
    /break-inside\s*:\s*avoid/i
  );
  assert.match(
    html,
    /orphans\s*:\s*3/
  );
  assert.match(
    html,
    /widows\s*:\s*3/
  );
  assert.match(
    html,
    /word-break\s*:\s*keep-all/
  );
});

test("fallback PDF accepts canonical section hierarchy", async () => {
  const document =
    createArtifactDocument(
      [
        "# 고라니 종합 보고서\n\n제1장: 생태\n본문입니다."
      ]
    );

  const buffer =
    await renderPdfFallback(
      document,
      {
        title:
          document.title
      }
    );

  assert.equal(
    buffer
      .subarray(0,5)
      .toString("ascii"),
    "%PDF-"
  );
  assert.ok(
    buffer.length >
      5000
  );
});test("fallback PDF renders canonical tables through the table layout engine", async () => {
  const renderer =
    read(
      "pdfKitRenderer.js"
    );

  assert.match(
    renderer,
    /function\s+drawTable\s*\(/
  );
  assert.match(
    renderer,
    /function\s+drawTableRow\s*\(/
  );

  const document = {
    title:
      "표 테스트",
    plainText:
      "",
    truncated:
      false,
    blocks: [
      {
        type: "table",
        headers: [
          "A",
          "B"
        ],
        rows: [
          [
            "1",
            "2"
          ]
        ]
      }
    ]
  };

  const buffer =
    await renderPdfFallback(
      document,
      {
        title:
          document.title
      }
    );

  assert.equal(
    buffer
      .subarray(0,5)
      .toString("ascii"),
    "%PDF-"
  );
  assert.ok(
    buffer.length >
      5000
  );
});test("PDF artifact preview text uses canonical semantic content", async () => {
  const previous =
    process.env
      .OVLL_DISABLE_CHROME;

  process.env
    .OVLL_DISABLE_CHROME =
    "1";

  try {
    const artifact =
      await createStoredArtifact({
        format: "PDF",
        filename:
          "semantic",
        sources: [
          {
            outputs: {
              result:
                "실제 본문"
            },
            report:
              "internal"
          }
        ]
      });

    assert.equal(
      artifact.previewText,
      "실제 본문"
    );
    assert.doesNotMatch(
      artifact.previewText,
      /outputs|result|report/
    );
  } finally {
    if (
      previous ===
        undefined
    ) {
      delete process.env
        .OVLL_DISABLE_CHROME;
    } else {
      process.env
        .OVLL_DISABLE_CHROME =
        previous;
    }
  }
});


test("HTML artifact selects fenced document over wrapper prose", async () => {
  const artifact =
    await createStoredArtifact({
      format: "HTML",
      filename: "wrapped",
      sources: [
        "설명 시작\n\n~~~html\n<!doctype html><html><body><main id=\"real\">Real</main></body></html>\n~~~\n\n설명 끝"
      ]
    });

  const stored =
    getStoredArtifact(
      artifact.id
    );

  const html =
    stored.buffer
      .toString("utf8");

  assert.match(
    html,
    /<main id="real">Real<\/main>/
  );
  assert.doesNotMatch(
    html,
    /설명 시작|설명 끝|~~~html/
  );
  assert.equal(
    artifact.previewKind,
    "html"
  );
  assert.doesNotMatch(
    artifact.previewText || "",
    /~~~html|설명 시작|설명 끝/
  );
});

test("structured HTML CSS JS artifact stores one runnable document", async () => {
  const artifact =
    await createStoredArtifact({
      format: "HTML",
      filename: "app",
      sources: [
        {
          html:
            "<main id=\"app\">Hello</main>",
          css:
            "#app{font-weight:700}",
          js:
            "document.body.dataset.ready='1'"
        }
      ]
    });

  const stored =
    getStoredArtifact(
      artifact.id
    );

  const html =
    stored.buffer
      .toString("utf8");

  assert.match(
    html,
    /<main id="app">Hello<\/main>/
  );
  assert.match(
    html,
    /#app\{font-weight:700\}/
  );
  assert.match(
    html,
    /document\.body\.dataset\.ready='1'/
  );
  assert.equal(
    artifact.previewKind,
    "html"
  );
});

test("artifact preview metadata is format aware", async () => {
  const cases = [
    ["PDF", "pdf"],
    ["HTML", "html"],
    ["MD", "document"],
    ["TXT", "text"],
    ["DOCX", "document"],
    ["RTF", "document"],
    ["XLSX", "spreadsheet"],
    ["CSV", "spreadsheet"],
    ["JSON", "code"]
  ];

  const previous =
    process.env
      .OVLL_DISABLE_CHROME;

  process.env
    .OVLL_DISABLE_CHROME =
    "1";

  try {
    for (
      const [
        format,
        expected
      ] of cases
    ) {
      const artifact =
        await createStoredArtifact({
          format,
          filename:
            "preview-" +
            format.toLowerCase(),
          sources: [
            format === "XLSX" ||
            format === "CSV"
              ? [
                  {
                    name: "A",
                    value: 1
                  }
                ]
              : "본문"
          ]
        });

      assert.equal(
        artifact.previewKind,
        expected,
        format
      );
    }
  } finally {
    if (
      previous ===
        undefined
    ) {
      delete process.env
        .OVLL_DISABLE_CHROME;
    } else {
      process.env
        .OVLL_DISABLE_CHROME =
        previous;
    }
  }
});


test("inline HTML artifact route has defense-in-depth security headers", () => {
  const server =
    read(
      "server.js"
    );

  assert.match(
    server,
    /Content-Security-Policy/
  );
  assert.match(
    server,
    /Referrer-Policy/
  );
  assert.match(
    server,
    /frame-ancestors 'none'/
  );
  assert.match(
    server,
    /connect-src 'none'/
  );
  assert.match(
    server,
    /object-src 'none'/
  );
});


test("fallback PDF embeds a deterministic Korean font", async () => {
  const previous =
    process.env
      .OVLL_DISABLE_CHROME;

  process.env
    .OVLL_DISABLE_CHROME =
    "1";

  try {
    const artifact =
      await createStoredArtifact({
        format: "PDF",
        filename:
          "embedded-korean",
        sources: [
          "# 한글 제목\n\n제1장: 한글 섹션\n영문 ABC와 숫자 123을 함께 표시합니다."
        ]
      });

    const stored =
      getStoredArtifact(
        artifact.id
      );

    const pdf =
      stored.buffer
        .toString(
          "latin1"
        );

    assert.equal(
      artifact.renderer,
      "pdfkit-fallback"
    );

    assert.doesNotMatch(
      pdf,
      /HYSMyeongJo|HYGoThic/
    );

    assert.match(
      pdf,
      /\/FontFile\d?\b/
    );
  } finally {
    if (
      previous ===
        undefined
    ) {
      delete process.env
        .OVLL_DISABLE_CHROME;
    } else {
      process.env
        .OVLL_DISABLE_CHROME =
        previous;
    }
  }
});
