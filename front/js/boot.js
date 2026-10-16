import { createAppShell } from "./shell/appShell.js";
import { createPageHost } from "./shell/pageHost.js";
import { createInputManager } from "./input/inputManager.js";

const root = document.querySelector("#app");
const status = document.querySelector("#boot-status");
const lifetime = new AbortController();
const input = createInputManager();
let shell;
let pages;

function destroy() {
  lifetime.abort();
  try { pages?.destroy(); }
  finally {
    shell?.destroy();
    input.destroy();
  }
}

try {
  pages = createPageHost({
    element: document.querySelector("#page-host"),
    onChange: id => shell.setActivePage(id)
  });
  shell = createAppShell({
    element: root,
    onNavigate: id => pages.activate(id),
    onMenuOpen: () => input.cancel("menu-open")
  });
  for (const id of ["workspace", "library"]) {
    const element = document.querySelector(`#${id}-template`).content.firstElementChild.cloneNode(true);
    // Empty pages intentionally register no events, input owners or domain state.
    pages.register(id, { element });
  }
  root.hidden = false;
  pages.activate("workspace");
  status.hidden = true;
  window.addEventListener("pagehide", event => {
    if (event.persisted) input.cancel("page-hidden");
    else destroy();
  }, { signal: lifetime.signal });
} catch (error) {
  destroy();
  root.hidden = true;
  status.hidden = false;
  status.textContent = "Ovll을 불러오지 못했습니다 새로고침해 주세요";
  console.error("Ovll initialization failed", error);
}
