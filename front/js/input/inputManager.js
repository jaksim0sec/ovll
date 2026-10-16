/** One owner per pointer stream. Native input is untouched unless onStart returns true. */
export function createInputManager({ target = window } = {}) {
  const lifetime = new AbortController();
  const owners = new Map();
  let active = null;
  let destroyed = false;

  function finish(event, reason) {
    if (!active) return;
    const session = active;
    active = null;
    // Clear ownership before release: lostpointercapture may fire synchronously.
    if (session.captureTarget?.hasPointerCapture(session.pointerId)) {
      session.captureTarget.releasePointerCapture(session.pointerId);
    }
    if (reason) session.owner.onCancel?.({ reason, event });
    else session.owner.onEnd?.(event);
  }

  function cancel(reason = "cancel") { finish(null, reason); }

  function registerOwner({ element, signal, onStart, onMove, onEnd, onCancel }) {
    if (destroyed) throw new Error("Input Manager is destroyed");
    if (!element || typeof onStart !== "function") throw new TypeError("An owner needs an element and onStart");
    if (owners.has(element)) throw new Error("Input element already has an owner");
    const owner = { onStart, onMove, onEnd, onCancel };

    function unregister() {
      if (owners.get(element) !== owner) return;
      owners.delete(element);
      signal?.removeEventListener("abort", unregister);
      if (active?.owner === owner) cancel("owner-unregistered");
    }

    owner.unregister = unregister;
    owners.set(element, owner);
    signal?.addEventListener("abort", unregister, { once: true });
    if (signal?.aborted) unregister();
    return {
      unregister,
      cancel(reason = "owner-cancel") { if (active?.owner === owner) cancel(reason); }
    };
  }

  const options = { capture: true, signal: lifetime.signal };
  target.addEventListener("pointerdown", event => {
    if (active || destroyed) return;
    // The closest registered element decides; rejected input is not handed to an ancestor.
    const element = event.composedPath().find(item => owners.has(item));
    const owner = owners.get(element);
    if (!owner || owner.onStart(event) !== true || owners.get(element) !== owner || destroyed) return;
    const captureTarget = event.target?.setPointerCapture ? event.target : null;
    active = { owner, pointerId: event.pointerId, captureTarget };
    // Synthetic events have no active browser pointer and cannot be captured.
    if (event.isTrusted) captureTarget?.setPointerCapture(event.pointerId);
  }, options);
  target.addEventListener("pointermove", event => {
    if (active?.pointerId === event.pointerId) active.owner.onMove?.(event);
  }, options);
  target.addEventListener("pointerup", event => {
    if (active?.pointerId === event.pointerId) finish(event);
  }, options);
  for (const type of ["pointercancel", "lostpointercapture"]) {
    target.addEventListener(type, event => {
      if (active?.pointerId === event.pointerId) finish(event, type);
    }, options);
  }
  target.addEventListener("blur", () => cancel("window-blur"), { signal: lifetime.signal });
  target.document?.addEventListener("visibilitychange", () => {
    if (target.document.hidden) cancel("document-hidden");
  }, { signal: lifetime.signal });

  return {
    registerOwner,
    cancel,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      lifetime.abort();
      // Abort signals own registration cleanup, including the one active stream.
      try { cancel("manager-destroyed"); }
      finally {
        // Unregister through the handles so external signals retain no listeners.
        for (const owner of owners.values()) owner.unregister();
      }
    }
  };
}
