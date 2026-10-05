import test from "node:test";
import assert from "node:assert/strict";

import {
  createArtifactDocument,
  extractArtifactContent,
  extractHtmlArtifact
} from "../artifactDocument.js";

test("semantic result wrappers do not leak transport keys", () => {
  const content =
    extractArtifactContent([
      {
        outputs: {
          result:
            "실제 본문"
        },
        report:
          "internal"
      }
    ]);

  assert.equal(
    content.plainText,
    "실제 본문"
  );
  assert.doesNotMatch(
    content.plainText,
    /outputs|result|report/
  );
});

test("workflow file descriptors use only their text payload", () => {
  const content =
    extractArtifactContent([
      {
        kind:
          "workflow-file",
        id:
          "file:1",
        name:
          "source.md",
        mime:
          "text/markdown",
        size:
          999,
        source:
          "upload",
        text:
          "# 제목\n본문"
      }
    ]);

  assert.equal(
    content.plainText,
    "# 제목\n본문"
  );
  assert.doesNotMatch(
    content.plainText,
    /workflow-file|file:1|text\/markdown|999|upload/
  );
});

test("duplicate semantic sources are emitted once and order is preserved", () => {
  const content =
    extractArtifactContent([
      "첫 번째",
      {
        result:
          "두 번째"
      },
      "첫 번째"
    ]);

  assert.equal(
    content.plainText,
    "첫 번째\n\n두 번째"
  );
});

test("natural Korean chapter labels become section headings", () => {
  const document =
    createArtifactDocument(
      [
        "고라니 종합 보고서\n\n제1장: 생태\n고라니의 생태 설명입니다.\n\n제2장: 서식지\n서식지 설명입니다.\n\n제3장: 보전\n보전 설명입니다."
      ],
      {
        title:
          "고라니 종합 보고서"
      }
    );

  assert.deepEqual(
    document.blocks
      .filter(
        block =>
          block.type ===
          "heading"
      )
      .map(
        block => [
          block.level,
          block.text
        ]
      ),
    [
      [
        2,
        "제1장: 생태"
      ],
      [
        2,
        "제2장: 서식지"
      ],
      [
        2,
        "제3장: 보전"
      ]
    ]
  );
});

test("markdown tables code lists quotes and rules stay semantic", () => {
  const document =
    createArtifactDocument([
      "# 제목\n\n- 하나\n- 둘\n\n> 인용\n\n| 이름 | 값 |\n| --- | --- |\n| A | 1 |\n\n~~~js\nconst x = 1;\n~~~\n\n---"
    ]);

  assert.deepEqual(
    document.blocks
      .map(
        block =>
          block.type
      ),
    [
      "heading",
      "list",
      "quote",
      "table",
      "code",
      "rule"
    ]
  );

  assert.deepEqual(
    document.blocks[3],
    {
      type: "table",
      headers: [
        "이름",
        "값"
      ],
      rows: [
        [
          "A",
          "1"
        ]
      ]
    }
  );
});

test("ordinary sentences are not promoted to headings", () => {
  const document =
    createArtifactDocument([
      "이 문장은 평범한 설명 문장입니다.\n다음 문장도 계속되는 설명입니다."
    ]);

  assert.equal(
    document.blocks[0]
      .type,
    "paragraph"
  );
});

test("HTML extraction selects fenced document over wrapper prose", () => {
  const html =
    extractHtmlArtifact([
      "아래는 결과입니다.\n\n~~~html\n<!doctype html><html><body><main id=\"ok\">Rendered</main></body></html>\n~~~\n\n설명 끝"
    ]);

  assert.match(
    html,
    /<main id="ok">Rendered<\/main>/
  );
  assert.doesNotMatch(
    html,
    /아래는 결과입니다|설명 끝|~~~html/
  );
});

test("structured html css js input becomes one runnable document", () => {
  const html =
    extractHtmlArtifact([
      {
        html:
          "<main id=\"demo\">Hi</main>",
        css:
          "#demo{font-weight:700}",
        js:
          "document.body.dataset.ready='1'"
      }
    ]);

  assert.match(
    html,
    /<main id="demo">Hi<\/main>/
  );
  assert.match(
    html,
    /<style>[^]*#demo\{font-weight:700\}[^]*<\/style>/
  );
  assert.match(
    html,
    /<script>[^]*document\.body\.dataset\.ready='1'[^]*<\/script>/
  );
});

test("plain prose HTML output is escaped into semantic paragraphs", () => {
  const html =
    extractHtmlArtifact([
      "첫 문단\n\n둘째 <문단>"
    ]);

  assert.match(
    html,
    /<p>첫 문단<\/p>/
  );
  assert.match(
    html,
    /<p>둘째 &lt;문단&gt;<\/p>/
  );
});
