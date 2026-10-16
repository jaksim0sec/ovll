/** Owns page identity, mounted DOM and one AbortSignal per activation. Hooks are synchronous. */
export function createPageHost({ element, onChange = () => {} }) {
  const pages = new Map();
  let current = null;
  let transitioning = false;
  let destroyed = false;

  function deactivate() {
    if (!current) return;
    const previous = current;
    current = null;
    previous.controller.abort();
    try { previous.page.onLeave?.(previous.context); }
    finally {
      previous.page.element.remove();
      onChange(null);
    }
  }

  return {
    register(id, page) {
      if (destroyed) throw new Error("Page Host is destroyed");
      if (!id || !page?.element) throw new TypeError("A page needs an id and element");
      if (pages.has(id)) throw new Error(`Page already registered: ${id}`);
      pages.set(id, { ...page });
    },
    activate(id) {
      if (destroyed) throw new Error("Page Host is destroyed");
      if (transitioning) throw new Error("Page transitions cannot be nested");
      const page = pages.get(id);
      if (!page) throw new Error(`Unknown page: ${id}`);
      if (current?.id === id) return;
      transitioning = true;
      try {
        deactivate();
        // Abort/leave hooks may dispose the entire host synchronously.
        if (destroyed) return;
        const controller = new AbortController();
        const context = { element: page.element, signal: controller.signal };
        current = { id, page, controller, context };
        element.replaceChildren(page.element);
        try { page.onEnter?.(context); }
        catch (error) { deactivate(); throw error; }
        if (destroyed) return;
        onChange(id);
        if (!destroyed) page.element.focus({ preventScroll: true });
      } finally { transitioning = false; }
    },
    getActivePage() { return current?.id ?? null; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try { deactivate(); }
      finally { pages.clear(); }
    }
  };
}
