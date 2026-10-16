/** Owns global chrome only. Page selection is requested through onNavigate. */
export function createAppShell({ element, onNavigate, onMenuOpen = () => {} }) {
  const lifetime = new AbortController();
  const menu = element.querySelector("#global-menu");
  const content = element.querySelector(".shell-content");
  const trigger = element.querySelector("[data-menu-trigger]");
  const backdrop = element.querySelector(".shell-backdrop");
  const title = element.querySelector("[data-page-title]");
  const navigation = [...menu.querySelectorAll("[data-page]")];
  // Match main's dock behavior for desktop pointers and wide touch screens.
  const desktop = matchMedia("(min-width: 43.76rem) and (hover: hover) and (pointer: fine), (min-width: 60.01rem)");
  let open = false;
  let destroyed = false;

  function setMenuOpen(value, { focus = true } = {}) {
    if (destroyed) return;
    const next = Boolean(value);
    if (next && !open) onMenuOpen();
    const focusWasInMenu = menu.contains(document.activeElement);
    open = next;
    element.classList.toggle("menu-open", open);
    trigger.hidden = open;
    trigger.setAttribute("aria-expanded", String(open));
    menu.inert = !open;
    menu.setAttribute("aria-hidden", String(!open));
    content.inert = open && !desktop.matches;
    backdrop.hidden = !open || desktop.matches;
    if (open && !desktop.matches) {
      menu.setAttribute("role", "dialog");
      menu.setAttribute("aria-modal", "true");
    } else {
      menu.removeAttribute("role");
      menu.removeAttribute("aria-modal");
    }
    if (focus && open) (navigation.find(button => button.getAttribute("aria-current") === "page") ?? navigation[0]).focus();
    else if (!open && focusWasInMenu) trigger.focus();
  }

  const options = { signal: lifetime.signal };
  trigger.addEventListener("click", () => setMenuOpen(true), options);
  for (const button of element.querySelectorAll("[data-menu-dismiss]")) {
    button.addEventListener("click", () => setMenuOpen(false), options);
  }
  for (const button of navigation) {
    button.addEventListener("click", () => {
      if (!desktop.matches) setMenuOpen(false);
      onNavigate(button.dataset.page);
    }, options);
  }
  element.addEventListener("keydown", event => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
    } else if (event.key === "Tab" && !desktop.matches) {
      const buttons = [...menu.querySelectorAll("button")];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  }, options);
  function syncViewport() {
    element.classList.toggle("is-docked", desktop.matches);
    setMenuOpen(desktop.matches, { focus: false });
  }
  desktop.addEventListener("change", syncViewport, options);
  syncViewport();

  return {
    setMenuOpen,
    setActivePage(id) {
      if (destroyed) return;
      let label = "Ovll";
      for (const button of navigation) {
        if (button.dataset.page === id) {
          button.setAttribute("aria-current", "page");
          label = button.textContent.trim();
        } else button.removeAttribute("aria-current");
      }
      title.textContent = label;
      document.title = `${label} · Ovll`;
    },
    destroy() {
      if (destroyed) return;
      setMenuOpen(false);
      destroyed = true;
      lifetime.abort();
      element.classList.remove("is-docked");
    }
  };
}
