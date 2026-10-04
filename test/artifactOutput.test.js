import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStoredArtifact,
  getStoredArtifact
} from "../artifactStore.js";

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

test("builtin PDF fallback positions glyphs explicitly and repairs inline headings", async () => {
  const source = read("artifactStore.js");

  assert.match(source, /function\s+pdfPositionedTextCommand\s*\(/);
  assert.match(source, /function\s+normalizeInlineDocumentStructure\s*\(/);
  assert.match(source, /function\s+utf16PdfTextHex\s*\(/);
  assert.match(source, /\/DW\s+1000/);
  assert.match(source, /\sTm\b/);

  const previous = process.env.OVLL_DISABLE_CHROME;
  process.env.OVLL_DISABLE_CHROME = "1";

  try {
    const artifact = await createStoredArtifact({
      format: "PDF",
      filename: "korean",
      sources: [
        "조사 및 요약 결과 보고서 ## 1. 개요 앞서 수집된 조사 결과를 요약합니다. 다음 문장도 별도 문단으로 읽혀야 합니다."
      ]
    });

    const stored = getStoredArtifact(artifact.id);
    const pdf = stored.buffer.toString("latin1");

    assert.equal(artifact.renderer, "builtin-fallback");
    assert.match(pdf, /\sTm\n<[0-9A-F]{4,}> Tj/);
    assert.doesNotMatch(pdf, /<FEFF[0-9A-F]+> Tj/);
    assert.ok(stored.buffer.length > 1000);
  } finally {
    if (previous === undefined) {
      delete process.env.OVLL_DISABLE_CHROME;
    } else {
      process.env.OVLL_DISABLE_CHROME = previous;
    }
  }
});
