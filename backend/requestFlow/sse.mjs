// HTTP route must authenticate caller and authorize roomId before these helpers.
// SSE connection loss does not stop the server-side request.
export function encodeEvent(event) {
  if (!event?.requestId || !Number.isSafeInteger(event.revision)) throw new Error('Invalid SSE event');
  const type = String(event.type).replace(/[^a-z0-9_-]/gi, '');
  return `id: ${event.requestId}:${event.revision}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}
export function startSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no'
  });
}
export function sendSSE(res, event) {
  if (!res.destroyed && !res.writableEnded) res.write(encodeEvent(event));
}
export async function stopSnapshot(runtime, { roomId, requestId }) {
  const state = await runtime.stop(roomId, requestId);
  return state ? { status: 202, body: state } : { status: 404, body: { error: 'request_not_found' } };
}
export function statusSnapshot(runtime, { roomId, requestId }) {
  const state = runtime.status(roomId, requestId);
  return state ? { status: 200, body: state } : { status: 404, body: { error: 'request_not_found' } };
}
