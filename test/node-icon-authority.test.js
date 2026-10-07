import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const svgLibrarySource =
  fs.readFileSync(
    new URL(
      "../front/js/svgLibrary.js",
      import.meta.url
    ),
    "utf8"
  );

const apiSource =
  fs.readFileSync(
    new URL(
      "../front/js/api.js",
      import.meta.url
    ),
    "utf8"
  );

const BUILTIN_TYPES = [
  "start",
  "research",
  "organize",
  "judge",
  "write",
  "file",
  "createFile"
];

function createStorage(initial = {}) {
  const values =
    new Map(
      Object.entries(initial)
    );

  return {
    getItem(key) {
      return values.has(key)
        ? values.get(key)
        : null;
    },
    setItem(key, value) {
      values.set(
        key,
        String(value)
      );
    },
    value(key) {
      return values.get(key);
    }
  };
}

function createBrowser({
  storedDefinitions = null,
  fetchDefinitions = null,
  fetchError = null
} = {}) {
  const storage =
    createStorage(
      storedDefinitions
        ? {
            "ovll:node-definitions":
              JSON.stringify(
                storedDefinitions
              )
          }
        : {}
    );

  const window = {
    OVLL_RUNTIME: {},
    setTimeout,
    clearTimeout
  };

  const context = {
    window,
    localStorage: storage,
    console,
    AbortController,
    URL,
    setTimeout,
    clearTimeout,
    fetch: async () => {
      if (fetchError) {
        throw fetchError;
      }

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            nodes:
              fetchDefinitions || {}
          };
        }
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(
    svgLibrarySource,
    context
  );
  vm.runInContext(
    apiSource,
    context
  );

  return {
    window,
    storage
  };
}

function serverDefinitions(icon) {
  return Object.fromEntries(
    BUILTIN_TYPES.map(
      type => [
        type,
        {
          name: type,
          icon:
            `<svg data-source="server">${icon}-${type}</svg>`
        }
      ]
    )
  );
}

test(
  "fresh node definitions preserve server-owned built-in icons",
  async () => {
    const expected =
      serverDefinitions(
        "fresh"
      );
    const browser =
      createBrowser({
        fetchDefinitions: {
          ...expected,
          "custom:demo": {
            name: "custom",
            icon:
              "<svg data-source=\"custom\"></svg>"
          }
        }
      });

    const definitions =
      await browser.window
        .AstraAPI
        .getNodeDefinitions({
          force: true
        });

    for (
      const type of BUILTIN_TYPES
    ) {
      assert.equal(
        definitions[type].icon,
        expected[type].icon,
        `${type} must preserve server icon`
      );
    }

    assert.equal(
      definitions["custom:demo"].icon,
      "<svg data-source=\"custom\"></svg>"
    );

    const stored =
      JSON.parse(
        browser.storage.value(
          "ovll:node-definitions"
        )
      );

    assert.equal(
      stored.start.icon,
      expected.start.icon
    );
  }
);

test(
  "stored node definitions refresh from the server when online",
  async () => {
    const cached =
      serverDefinitions(
        "cached"
      );
    const fresh =
      serverDefinitions(
        "fresh"
      );
    const browser =
      createBrowser({
        storedDefinitions:
          cached,
        fetchDefinitions:
          fresh
      });

    const definitions =
      await browser.window
        .AstraAPI
        .getNodeDefinitions();

    for (
      const type of BUILTIN_TYPES
    ) {
      assert.equal(
        definitions[type].icon,
        fresh[type].icon,
        `${type} must refresh stale stored icon`
      );
    }
  }
);

test(
  "stored server node icons survive offline without frontend normalization",
  async () => {
    const expected =
      serverDefinitions(
        "cached"
      );
    const browser =
      createBrowser({
        storedDefinitions:
          expected,
        fetchError:
          new Error(
            "offline"
          )
      });

    const definitions =
      await browser.window
        .AstraAPI
        .getNodeDefinitions();

    for (
      const type of BUILTIN_TYPES
    ) {
      assert.equal(
        definitions[type].icon,
        expected[type].icon,
        `${type} cached icon must stay server-owned`
      );
    }
  }
);

test(
  "svg library exposes generic icons but no built-in node icon authority",
  () => {
    const browser =
      createBrowser();

    assert.equal(
      browser.window
        .OvllSvgLibrary
        .has("composerSend"),
      true
    );
    assert.match(
      browser.window
        .OvllSvgLibrary
        .get("composerSend"),
      /<svg/
    );
    assert.equal(
      browser.window
        .OvllSvgLibrary
        .getNodeIcon,
      undefined
    );
    assert.equal(
      browser.window
        .OvllSvgLibrary
        .hasNodeIcon,
      undefined
    );
    assert.equal(
      browser.window
        .OvllSvgLibrary
        .nodeIcons,
      undefined
    );
  }
);
