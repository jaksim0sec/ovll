import express from 'express';
import { randomUUID } from 'node:crypto';
import { KernelError } from './graph.js';
import { sseFrame } from './events.js';

// Standalone, opt-in vNext application. Deliberately NOT mounted from legacy server.js.
export function createVNextApp({ repository, kernel, events, authenticate, authorize } = {}) {
  if (!repository || !kernel || !events || typeof authenticate !== 'function' || typeof authorize !== 'function') {
    throw new KernelError('SECURITY_DEPENDENCIES_REQUIRED', 'Authenticated vNext services are required', 500);
  }
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(async (req, res, next) => {
    try {
      const user = await authenticate(req);
      if (!user?.actorRef || !user?.workspaceRef) throw new KernelError('NOT_AUTHENTICATED', 'Authentication required', 401);
      req.vnext = Object.freeze({ actorRef: user.actorRef, workspaceRef: user.workspaceRef, taskRef: user.taskRef });
      next();
    } catch (err) { next(err); }
  });
  async function access(req, kind, graphId) {
    const yes = await authorize({ ...req.vnext, actionKind: kind, graphId });
    if (!yes) throw new KernelError('FORBIDDEN', 'Resource access denied', 403);
  }
  app.post('/api/vnext/graphs/:graphId', async (req, res, next) => {
    try { await access(req, 'graph.create', req.params.graphId);
      res.status(201).json(repository.create(req.vnext.workspaceRef, req.params.graphId));
    } catch (err) { next(err); }
  });
  app.get('/api/vnext/graphs/:graphId', async (req, res, next) => {
    try { await access(req, 'graph.read', req.params.graphId);
      res.json(repository.get(req.vnext.workspaceRef, req.params.graphId));
    } catch (err) { next(err); }
  });
  app.post('/api/vnext/turns', async (req, res, next) => {
    try {
      const graphId = req.body?.graphId;
      if (graphId !== undefined) await access(req, 'graph.read', graphId);
      const header = req.get('Idempotency-Key');
      if (header && !/^[a-zA-Z0-9_:.\-]{1,128}$/.test(header)) throw new KernelError('BAD_IDEMPOTENCY_KEY');
      const result = await kernel.submit(req.body?.turn, { ...req.vnext, requestRef: header || randomUUID(), graphId });
      res.json(result);
    } catch (err) { next(err); }
  });
  app.get('/api/vnext/events', async (req, res, next) => {
    try {
      await access(req, 'events.read');
      const rawCursor = req.get('Last-Event-ID') || '0';
      if (!/^\d{1,15}$/.test(rawCursor)) throw new KernelError('BAD_CURSOR');
      const cursor = Number(rawCursor);
      const ws = req.vnext.workspaceRef;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      const send = event => res.write(sseFrame(event));
      const close = events.subscribe(ws, send);
      const snapshot = events.read(ws, cursor);
      if (snapshot.resetRequired) {
        res.write('event: resync_required\ndata: {}\n\n');
      } else {
        for (const item of snapshot.events) send(item);
      }
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
      heartbeat.unref?.();
      res.on('close', () => { clearInterval(heartbeat); close(); });
    } catch (err) { next(err); }
  });
  app.use((err, _req, res, _next) => {
    const status = err instanceof KernelError ? err.status : (err?.type === 'entity.too.large' ? 413 : 500);
    if (!res.headersSent) res.status(status).json({ error: { code: err.code || (status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR') } });
    else res.end();
  });
  return app;
}
