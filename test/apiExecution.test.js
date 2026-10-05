import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadApi(fetchImpl = async () => ({
  ok: true,
  status: 200,
  async json() {
    return { ok: true };
  }
})) {
  const source = fs.readFileSync(
    new URL("../front/js/api.js", import.meta.url),
    "utf8"
  );

  const window = {};
  const context = {
    window,
    fetch: fetchImpl,
    console,
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(source, context, {
    filename: "front/js/api.js"
  });

  return window.AstraAPI;
}

function groupWithText(text) {
  return {
    nodes: [
      {
        id: "write",
        type: "write",
        params: {
          request: "정리해"
        },
        inputs: {
          source: {
            value: {
              file: {
                text
              }
            }
          }
        }
      }
    ],
    internalConnections: []
  };
}

test("execution payload preserves markdown line structure", () => {
  const api = loadApi();
  const text = "## 제목\r\n\r\n- 하나\r\n- 둘";

  const payload = api.buildExecutionPayload(
    groupWithText(text),
    {
      userRequest: "  이걸   정리해  ",
      memory: {
        flow: "  앞 흐름  ",
        recent: "  최근   내용  ",
        detail: "  세부   내용  "
      }
    }
  );

  assert.equal(
    payload.nodes[0].inputs.source.value.file.text,
    "## 제목\n\n- 하나\n- 둘"
  );
  assert.equal(payload.context.userRequest, "이걸 정리해");
  assert.equal(payload.context.memory.recent, "최근 내용");
});

test("execution payload preserves code indentation", () => {
  const api = loadApi();
  const text = "function x() {\n  return 1;\n}";

  const payload = api.buildExecutionPayload(
    groupWithText(text)
  );

  assert.equal(
    payload.nodes[0].inputs.source.value.file.text,
    text
  );
});

test("nested execution text is not cut at the old 3000 character cap", () => {
  const api = loadApi();
  const text = "A".repeat(7000);

  const payload = api.buildExecutionPayload(
    groupWithText(text)
  );

  assert.ok(
    payload.nodes[0].inputs.source.value.file.text.length > 3000
  );
});

test("long structured truncation preserves both head and tail", () => {
  const api = loadApi();
  const text =
    "HEAD\n" +
    "x".repeat(50000) +
    "\nTAIL";

  const payload = api.buildExecutionPayload(
    groupWithText(text)
  );

  const actual =
    payload.nodes[0].inputs.source.value.file.text;

  assert.match(actual, /^HEAD\n/);
  assert.match(actual, /TAIL$/);
  assert.match(actual, /omitted/i);
});

test("executeGroup sends the canonical execution payload", async () => {
  let captured = null;

  const api = loadApi(
    async (_url, options) => {
      captured = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            results: []
          };
        }
      };
    }
  );

  const group = groupWithText("a\n  b");
  const context = {
    userRequest: "test"
  };

  const expected =
    api.buildExecutionPayload(
      group,
      context
    );

  await api.executeGroup(
    group,
    context
  );

  assert.equal(
    JSON.stringify(captured),
    JSON.stringify(expected)
  );
  assert.equal(
    api.measureExecutionPayloadChars(
      group,
      context
    ),
    JSON.stringify(expected).length
  );
});
