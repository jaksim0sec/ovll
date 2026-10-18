/** One owner per gesture. Multi-pointer groups require explicit opt-in by that owner. */
export function createInputManager({ target = window } = {}) {
  const lifetime = new AbortController();
  const owners = new Map();
  let active = null;
  let destroyed = false;

  function release(pointer) {
    if (pointer.captureTarget?.hasPointerCapture(pointer.pointerId)) {
      pointer.captureTarget.releasePointerCapture(pointer.pointerId);
    }
  }
  function finish(event, reason) {
    if (!active) return;
    const session = active;
    if (reason) {
      active = null;
      for (const pointer of session.pointers.values()) release(pointer);
      session.owner.onCancel?.({ reason, event });
      return;
    }
    const pointer = session.pointers.get(event.pointerId);
    if (!pointer) return;
    session.pointers.delete(event.pointerId);
    if (!session.pointers.size) active = null;
    release(pointer);
    session.owner.onEnd?.(event);
  }
  function cancel(reason = "cancel") { finish(null, reason); }

  function registerOwner({ element, signal, onStart, onMove, onEnd, onCancel, multiPointer = false }) {
    if (destroyed) throw new Error("Input Manager is destroyed");
    if (!element || typeof onStart !== "function") throw new TypeError("An owner needs an element and onStart");
    if (owners.has(element)) throw new Error("Input element already has an owner");
    const owner = { onStart, onMove, onEnd, onCancel, multiPointer: multiPointer === true };

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
    if (destroyed) return;
    // The closest registered element decides; rejected input is not handed to an ancestor.
    const element = event.composedPath().find(item => owners.has(item));
    const owner = owners.get(element);
    if (!owner || (active && (active.owner !== owner || !owner.multiPointer || active.pointers.has(event.pointerId)))) return;
    if (owner.onStart(event) !== true || owners.get(element) !== owner || destroyed) return;
    const captureTarget = event.target?.setPointerCapture ? event.target : null;
    if (!active) active = { owner, pointers: new Map() };
    active.pointers.set(event.pointerId, { pointerId: event.pointerId, captureTarget });
    // Synthetic events have no active browser pointer and cannot be captured.
    if (event.isTrusted) captureTarget?.setPointerCapture(event.pointerId);
  }, options);
  target.addEventListener("pointermove", event => {
    if (active?.pointers.has(event.pointerId)) active.owner.onMove?.(event);
  }, options);
  target.addEventListener("pointerup", event => {
    if (active?.pointers.has(event.pointerId)) finish(event);
  }, options);
  for (const type of ["pointercancel", "lostpointercapture"]) {
    target.addEventListener(type, event => {
      if (active?.pointers.has(event.pointerId)) finish(event, type);
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
