import 'dotenv/config';
import express from 'express';
import {iconSvg,CUSTOM_NODE_TYPE_RE,nodeDefinitionsPublic,GENERATABLE_NODE_TYPES,getNodeDefinition,getPortDefinition,NODE_DEFINITION_PROMPT} from './backend/ovllPointer/nodeCatalog.js';
import {cloneWorkflow,clipInstructionText,normalizeMemory,validateWorkflow,buildPlannerWorkflow,normalizeConversationHistory,normalizePlannerPurpose,planWorkflow,geminiHttpFailure} from './backend/ovllPointer/legacyCompatibility.js';
import {mountLocalPointerRoutes} from './backend/ovllPointer/localHttp.js';
import compression from 'compression';
import {randomUUID} from 'crypto';
import {
  createGeminiExecution
} from './backend/ai/geminiExecution.js';
import {
  bindRequestAbort
} from './backend/http/requestAbort.js';
import {
  createStoredArtifact,
  getStoredArtifact
} from './backend/artifacts/artifactStore.js';
import {
  warmPdfFallback
} from './backend/artifacts/pdfRenderer.js';

const app = express();

app.use(express.json({limit: '1mb'}));
app.use(compression());

const DEFAULT_NATIVE_APP_ORIGINS = [
  'capacitor://localhost',
  'https://localhost'
];

const NATIVE_APP_ORIGINS =
  new Set(
    String(
      process.env.NATIVE_APP_ORIGINS ||
      DEFAULT_NATIVE_APP_ORIGINS.join(',')
    )
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );

app.use(
  '/api',
  (req, res, next) => {
    const origin =
      req.get('Origin');

    if (
      origin &&
      NATIVE_APP_ORIGINS.has(origin)
    ) {
      res.set(
        'Access-Control-Allow-Origin',
        origin
      );
      res.vary('Origin');
      res.set(
        'Access-Control-Allow-Methods',
        'GET,POST,OPTIONS'
      );
      res.set(
        'Access-Control-Allow-Headers',
        'Accept,Content-Type'
      );
      res.set(
        'Access-Control-Max-Age',
        '86400'
      );
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    return next();
  }
);

const PORT = process.env.PORT || 3000;

const geminiExecution =
  createGeminiExecution();

const GEMINI_LOG_LIMIT = 100;
const geminiRequestLogs = [];

const BOOT_ID = randomUUID();
const BOOT_STARTED_AT = Date.now();
let eventLoopLagMs = 0;
let maxEventLoopLagMs = 0;
let severeLagCount = 0;
let lastSevereLagAt = null;

{
  const intervalMs = 1000;
  let expected =
    Date.now() + intervalMs;

  const timer =
    setInterval(
      () => {
        const now =
          Date.now();

        eventLoopLagMs =
          Math.max(
            0,
            now - expected
          );

        maxEventLoopLagMs =
          Math.max(
            maxEventLoopLagMs,
            eventLoopLagMs
          );

        if (
          eventLoopLagMs >= 250
        ) {
          severeLagCount++;
          lastSevereLagAt =
            new Date(now)
              .toISOString();

          console.warn(
            '[server event-loop stall]',
            {
              lagMs:
                eventLoopLagMs,
              maxLagMs:
                maxEventLoopLagMs,
              severeLagCount
            }
          );
        }

        expected =
          now + intervalMs;
      },
      intervalMs
    );

  timer.unref?.();
}

function serverRuntimeHealth() {
  const memory =
    process.memoryUsage();

  const uptimeSec =
    Math.max(
      0,
      Math.floor(
        (
          Date.now() -
          BOOT_STARTED_AT
        ) / 1000
      )
    );

  return {
    bootId:
      BOOT_ID,
    startedAt:
      new Date(
        BOOT_STARTED_AT
      ).toISOString(),
    uptimeSec,
    recentRestart:
      uptimeSec < 300,
    rssBytes:
      memory.rss,
    heapUsedBytes:
      memory.heapUsed,
    heapTotalBytes:
      memory.heapTotal,
    eventLoopLagMs,
    maxEventLoopLagMs,
    severeLagCount,
    lastSevereLagAt
  };
}

function compactLogPreview(
  value,
  max = 280
) {
  let text = '';

  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text =
        JSON.stringify(value);
    } catch {
      text =
        String(value ?? '');
    }
  }

  text =
    text
      .replace(/\s+/g, ' ')
      .trim();

  if (text.length <= max) {
    return text;
  }

  return (
    text.slice(0, max - 1) +
    '…'
  );
}

function pushGeminiRequestLog(
  entry
) {
  geminiRequestLogs.unshift({
    id: randomUUID(),
    at:
      new Date()
        .toISOString(),
    ...entry
  });

  if (
    geminiRequestLogs.length >
    GEMINI_LOG_LIMIT
  ) {
    geminiRequestLogs.length =
      GEMINI_LOG_LIMIT;
  }
}

function groupLogMeta(
  body
) {
  const nodes =
    Array.isArray(body?.nodes)
      ? body.nodes
      : [];

  return {
    nodeTypes:
      nodes
        .map(node =>
          String(
            node?.type || ''
          ).trim()
        )
        .filter(Boolean)
        .slice(0, 12),
    nodeCount:
      nodes.length
  };
}

/*
 * Bump this for every deployed app update.
 * The frontend compares this server value with its locally stored version
 * before loading application assets.
 */
const APP_VERSION = '2026.10.09.36';

/* =========================================================
   GENERATED ARTIFACT API
========================================================= */

app.post(
  '/api/create-artifact',
  async (req, res) => {
    const abortContext =
      bindRequestAbort(
        req,
        res
      );

    try {
      const artifact =
        await createStoredArtifact(
          {
            format:
              req.body?.format,
            filename:
              req.body?.filename,
            targetPages:
              req.body?.targetPages,
            sources:
              req.body?.sources
          },
          {
            signal:
              abortContext.signal
          }
        );

      if (
        abortContext.signal
          .aborted
      ) {
        return;
      }

      return res.json({
        ok: true,
        artifact
      });
    } catch (error) {
      if (
        abortContext.signal
          .aborted
      ) {
        return;
      }

      console.error(
        '[artifact create]',
        error
      );

      const status =
        Number(
          error?.status
        ) || 400;

      return res
        .status(status)
        .json({
          ok: false,
          code:
            String(
              error?.code || ''
            ),
          error:
            error?.message ||
            '파일을 생성하지 못했습니다.'
        });
    } finally {
      abortContext.cleanup();
    }
  }
);

app.get(
  '/api/artifacts/:id',
  (req, res) => {
    const artifact =
      getStoredArtifact(
        req.params.id
      );

    if (!artifact) {
      return res
        .status(404)
        .json({
          ok: false,
          error:
            '파일을 찾을 수 없습니다.'
        });
    }

    const inline =
      String(
        req.query?.inline ||
        ''
      ) === '1';

    const responseHeaders = {
      'Content-Type':
        artifact.mime,
      'Content-Length':
        String(
          artifact.size
        ),
      'Content-Disposition':
        (inline
          ? 'inline'
          : 'attachment') +
        "; filename*=UTF-8''" +
        encodeURIComponent(
          artifact.name
        ),
      'X-Content-Type-Options':
        'nosniff',
      'Cache-Control':
        'private, no-store',
      'Referrer-Policy':
        'no-referrer'
    };

    if (
      inline &&
      artifact.format ===
        'HTML'
    ) {
      responseHeaders[
        'Content-Security-Policy'
      ] = [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "font-src data:",
        "media-src data: blob:",
        "connect-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join('; ');
    }

    res.set(
      responseHeaders
    );

    return res.send(
      artifact.buffer
    );
  }
);

/* =========================================================
   GEMINI GROUP EXECUTION API
========================================================= */

app.post(
  '/api/execute-group',
  async (req, res) => {
    const abortContext =
      bindRequestAbort(
        req,
        res
      );

    try {
      const result =
        await geminiExecution
          .executeGroup(
            {
              nodes:
                req.body?.nodes,
              connections:
                req.body?.connections,
              context:
                req.body?.context
            },
            {
              signal:
                abortContext.signal
            }
          );

      if (
        abortContext.signal
          .aborted
      ) {
        return;
      }

      pushGeminiRequestLog({
        kind: 'execution',
        ok: true,
        ...groupLogMeta(
          req.body
        ),
        model:
          result.model,
        usage:
          result.usage,
        diagnostics:
          result.diagnostics,
        preview:
          compactLogPreview(
            result.results
          )
      });

      console.info(
        '[Gemini execution]',
        {
          model:
            result.model,
          inputTokens:
            result.usage
              ?.inputTokens ??
            null,
          cachedTokens:
            result.usage
              ?.cachedTokens ??
            null,
          outputTokens:
            result.usage
              ?.outputTokens ??
            null,
          thoughtTokens:
            result.usage
              ?.thoughtTokens ??
            null,
          totalTokens:
            result.usage
              ?.totalTokens ??
            null,
          thinkingLevel:
            result.diagnostics
              ?.thinkingLevel ??
            null,
          primaryAttempts:
            result.diagnostics
              ?.primaryAttempts ??
            null,
          transientRetries:
            result.diagnostics
              ?.transientRetries ??
            null,
          repairAttempts:
            result.diagnostics
              ?.repairAttempts ??
            null,
          fallbackUsed:
            result.diagnostics
              ?.fallbackUsed ===
              true,
          durationMs:
            result.diagnostics
              ?.durationMs ??
            null
        }
      );

      return res.json({
        ok: true,
        model:
          result.model,
        usage:
          result.usage,
        diagnostics:
          result.diagnostics,
        results:
          result.results
      });
    } catch (error) {
      if (
        abortContext.signal
          .aborted ||
        error?.code ===
          'GEMINI_REQUEST_ABORTED'
      ) {
        return;
      }

      const failure =
        geminiHttpFailure(
          error,
          'Gemini execution failed.'
        );

      pushGeminiRequestLog({
        kind: 'execution',
        ok: false,
        ...groupLogMeta(
          req.body
        ),
        code:
          failure.code,
        status:
          failure.status,
        retryable:
          error?.retryable ===
            true,
        diagnostics:
          error?.diagnostics ??
          null,
        preview:
          compactLogPreview(
            failure.body?.error
          )
      });

      console.warn(
        '[Gemini execution failed]',
        {
          code:
            failure.code,
          status:
            error?.status ??
            null,
          retryable:
            error?.retryable ===
              true,
          diagnostics:
            error?.diagnostics ??
            null
        }
      );

      return res
        .status(
          failure.status
        )
        .json(
          failure.body
        );
    } finally {
      abortContext
        .cleanup();
    }
  }
);

app.post(
  '/api/finalize-run',
  async (req, res) => {
    const abortContext =
      bindRequestAbort(
        req,
        res
      );

    try {
      const result =
        await geminiExecution
          .finalizeRun(
            {
              run:
                req.body?.run,
              userRequest:
                req.body
                  ?.userRequest,
              memory:
                req.body?.memory
            },
            {
              signal:
                abortContext.signal
            }
          );

      if (
        abortContext.signal
          .aborted
      ) {
        return;
      }

      pushGeminiRequestLog({
        kind: 'finalizer',
        ok: true,
        model:
          result.model,
        usage:
          result.usage,
        diagnostics:
          result.diagnostics,
        preview:
          compactLogPreview(
            result.message
          )
      });

      console.info(
        '[Gemini final response]',
        {
          model:
            result.model,
          inputTokens:
            result.usage
              ?.inputTokens ??
            null,
          cachedTokens:
            result.usage
              ?.cachedTokens ??
            null,
          outputTokens:
            result.usage
              ?.outputTokens ??
            null,
          thoughtTokens:
            result.usage
              ?.thoughtTokens ??
            null,
          totalTokens:
            result.usage
              ?.totalTokens ??
            null,
          thinkingLevel:
            result.diagnostics
              ?.thinkingLevel ??
            null,
          primaryAttempts:
            result.diagnostics
              ?.primaryAttempts ??
            null,
          transientRetries:
            result.diagnostics
              ?.transientRetries ??
            null,
          repairAttempts:
            result.diagnostics
              ?.repairAttempts ??
            null,
          durationMs:
            result.diagnostics
              ?.durationMs ??
            null
        }
      );

      return res.json({
        ok: true,
        model:
          result.model,
        usage:
          result.usage,
        diagnostics:
          result.diagnostics,
        message:
          result.message
      });
    } catch (error) {
      if (
        abortContext.signal
          .aborted ||
        error?.code ===
          'GEMINI_REQUEST_ABORTED'
      ) {
        return;
      }

      const failure =
        geminiHttpFailure(
          error,
          'Gemini final response failed.'
        );

      pushGeminiRequestLog({
        kind: 'finalizer',
        ok: false,
        code:
          failure.code,
        status:
          failure.status,
        retryable:
          error?.retryable ===
            true,
        diagnostics:
          error?.diagnostics ??
          null,
        preview:
          compactLogPreview(
            failure.body?.error
          )
      });

      console.warn(
        '[Gemini final response failed]',
        {
          code:
            failure.code,
          status:
            error?.status ??
            null,
          retryable:
            error?.retryable ===
            true
        }
      );

      return res
        .status(
          failure.status
        )
        .json(
          failure.body
        );
    } finally {
      abortContext
        .cleanup();
    }
  }
);

/* =========================================================
   CONVERSATION API
========================================================= */

app.post(
  '/api/chat',
  async (req, res) => {
    const abortContext =
      bindRequestAbort(
        req,
        res
      );

    try {
      const text =
        clipInstructionText(
          req.body?.text,
          6000
        );

      if (!text) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              '대화 내용을 입력해주세요.'
          });
      }

      const workflow =
        cloneWorkflow(
          req.body?.workflow
        );

      validateWorkflow(
        workflow
      );

      const compact =
        buildPlannerWorkflow(
          workflow
        );

      const result =
        await geminiExecution
          .chat(
            {
              text,
              history:
                normalizeConversationHistory(
                  req.body?.history
                ),
              memory:
                normalizeMemory(
                  req.body?.memory
                ),
              workflow:
                compact.workflow
            },
            {
              signal:
                abortContext.signal
            }
          );

      if (
        abortContext.signal
          .aborted
      ) {
        return;
      }

      pushGeminiRequestLog({
        kind: 'chat',
        ok: true,
        model:
          result.model,
        usage:
          result.usage,
        diagnostics:
          result.diagnostics,
        preview:
          compactLogPreview(
            result.message
          )
      });

      return res.json({
        ok: true,
        mode:
          result.mode,
        message:
          result.message,
        model:
          result.model
      });
    } catch (error) {
      if (
        abortContext.signal
          .aborted ||
        error?.code ===
          'GEMINI_REQUEST_ABORTED'
      ) {
        return;
      }

      const failure =
        geminiHttpFailure(
          error,
          'Gemini conversation failed.'
        );

      pushGeminiRequestLog({
        kind: 'chat',
        ok: false,
        code:
          failure.code,
        status:
          failure.status,
        retryable:
          error?.retryable ===
            true,
        diagnostics:
          error?.diagnostics ??
          null,
        preview:
          compactLogPreview(
            failure.body?.error
          )
      });

      return res
        .status(
          failure.status
        )
        .json(
          failure.body
        );
    } finally {
      abortContext.cleanup();
    }
  }
);

/* =========================================================
   WORKFLOW API
========================================================= */

app.post(
  '/api/workflow',
  async (req, res) => {
    try {
      const text =
        clipInstructionText(
          req.body?.text,
          6000
        );

      const purpose =
        normalizePlannerPurpose(
          req.body?.purpose
        );

      const currentWorkflow =
        cloneWorkflow(
          req.body?.workflow
        );

      validateWorkflow(
        currentWorkflow
      );

      const memory =
        normalizeMemory(
          req.body?.memory
        );

if (!text) {
        return res.status(400).json({
          ok: false,
          error:
            '작업 내용을 입력해주세요.'
        });
      }

      const result =
        await planWorkflow(
          text,
          currentWorkflow,
          memory,
          normalizeConversationHistory(
            req.body?.history
          ),
          {
            purpose
          }
        );

      return res.json({
        ok: true,
        mode:
          result.planner.mode,
        workflow:
          result.workflow,
        message:
          result.planner.message,
        blocks:
          result.planner.blocks,
        question:
          result.planner.question,
        memory:
          result.planner.memory
      });
    } catch (error) {
      console.error(
        '[workflow]',
        error
      );

      const status =
        error?.status === 429
          ? 429
          : error?.status === 413
            ? 413
            : 500;

      return res.status(
        status
      ).json({
        ok: false,
        code:
          String(
            error?.code ||
            (
              status === 429
                ? 'PLANNER_RATE_LIMIT'
                : status === 413
                  ? 'PLANNER_PAYLOAD_TOO_LARGE'
                  : 'PLANNER_ERROR'
            )
          ),
        error:
          error?.message ||
          '워크플로우를 처리하지 못했습니다.',
        retryable:
          error?.retryable ===
            true ||
          status === 429 ||
          status >= 500
      });
    }
  }
);

/* =========================================================
   APP VERSION API
========================================================= */

app.get(
  '/api/version',
  (req, res) => {
    res.set({
      'Cache-Control':
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0'
    });

    return res.json({
      ok: true,
      version: APP_VERSION
    });
  }
);

/* =========================================================
   NODE DEFINITION API
========================================================= */

app.get(
  '/api/node-definitions',
  (req, res) => {
    return res.json({
      ok: true,
      nodes:
        nodeDefinitionsPublic,
      iconSvg
    });
  }
);

/* =========================================================
   GEMINI REQUEST LOG
========================================================= */

app.get(
  '/api/logs',
  (req, res) => {
    res.set(
      'Cache-Control',
      'no-store'
    );

    return res.json({
      ok: true,
      generatedAt:
        new Date()
          .toISOString(),
      runtime:
        serverRuntimeHealth(),
      logs:
        geminiRequestLogs
    });
  }
);

/* =========================================================
   CRON TEXT
========================================================= */

app.get(
  '/cron.txt',
  (req, res) => {
    res.set({
      'Content-Type':
        'text/plain; charset=utf-8',
      'Cache-Control':
        'no-store, max-age=0'
    });

    return res.send(
      'nothingToSeeHere\n'
    );
  }
);

mountLocalPointerRoutes(app);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {
    console.error(
      '[server]',
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    return res.status(500).json({
      ok: false,
      error:
        err?.message ||
        'Internal Server Error'
    });
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res.status(404).send(
      'Not Found'
    );
  }
);

/* =========================================================
   SERVER
========================================================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Server running on http://localhost:${PORT}`
    );
    console.log(
      `Version: ${APP_VERSION}`
    );

    void warmPdfFallback()
      .catch(
        error => {
          console.warn(
            '[artifact pdfkit warmup] failed',
            error?.message ||
            error
          );
        }
      );
  }
);