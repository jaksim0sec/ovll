import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadPolicy() {
  const source =
    fs.readFileSync(
      new URL(
        "../front/js/artifactRequest.js",
        import.meta.url
      ),
      "utf8"
    );

  const window = {};

  vm.runInNewContext(
    source,
    {
      window
    },
    {
      filename:
        "front/js/artifactRequest.js"
    }
  );

  return window
    .OvllArtifactRequest;
}

test("artifact request extracts explicit page targets", () => {
  const policy =
    loadPolicy();

  assert.equal(
    policy.resolve({
      request:
        "고라니 보고서를 PDF 3페이지 분량으로 만들어줘"
    }).targetPages,
    3
  );

  assert.equal(
    policy.resolve({
      request:
        "A4 4장 분량의 보고서.pdf로 만들어줘"
    }).targetPages,
    4
  );

  assert.equal(
    policy.resolve({
      request:
        "2쪽 정도의 요약문을 결과.pdf로 만들어줘"
    }).targetPages,
    2
  );
});

test("artifact request never mistakes chapter labels for page targets", () => {
  const policy =
    loadPolicy();

  assert.equal(
    policy.resolve({
      request:
        "제3장: 사람과의 관계를 포함해서 보고서.pdf로 만들어줘"
    }).targetPages,
    null
  );
});

test("artifact request keeps existing format and filename behavior", () => {
  const policy =
    loadPolicy();

  const resolved =
    policy.resolve({
      request:
        "파일명은 고라니 보고서.pdf로 만들어줘"
    });

  assert.equal(
    resolved.format,
    "PDF"
  );
  assert.equal(
    resolved.filename,
    "고라니 보고서"
  );
});
