/**
 * Minimal HTTP/SSE bridge for requestRunner.
 * Framework-neutral: call sendSSE(res, event) from runner.publish;
 * authenticate room ownership at the HTTP route BEFORE exposing stop/status.
 */
export function formatSSE(event) {
  if (!event || !event.requestId || !Number.isInteger(event.revision)) {
    throw new Error("Invalid event");
  }
  const clean = JSON.stringify({
    roomId: event.roomId,
    requestId: event.requestId,
    revision: event.revision,
    type: event.type,
    data: event.data
  });
  // Serialized JSON is single-line, preventing injection into SSE framing.
  return "id: " + event.requestId + ":" + event.revision +
    "\nevent: " + String(event.type).replace(/[^a-zA-Z0-9_-]/g, "") +
    "\ndata: " + clean + "\n\n";
}

export function prepareSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
}

export function sendSSE(res, event) {
  if (!res.destroyed && !res.writableEnded) res.write(formatSSE(event));
}

/**
 * Both stop and status use the same request identity; the route authenticates
 * the user/session and must authorize access to roomId before calling.
 */
export function stopRequest(runner, { roomId, requestId }) {
  const snapshot = runner.stop(roomId, requestId);
  return snapshot ? { httpStatus: 202, body: snapshot } : { httpStatus: 404, body: { error: "request_not_found" } };
}

export function requestStatus(runner, { roomId, requestId }) {
  const r = runner.getRequest(roomId, requestId);
  if (!r) return { httpStatus: 404, body: { error: "request_not_found" } };
  return {
    httpStatus: 200,
    body: {
      roomId: r.roomId, requestId: r.requestId,
      revision: r.revision ?? 0, status: r.status,
      currentLayer: r.currentLayer, planIndex: r.planIndex ?? null
    }
  };
}
