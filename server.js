import 'dotenv/config';
import express from 'express';
import {iconSvg,nodeDefinitionsPublic} from './backend/ovllPointer/nodeCatalog.js';
import {mountLocalPointerRoutes} from './backend/ovllPointer/localHttp.js';
import compression from 'compression';
import {randomUUID} from 'crypto';
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

/*
 * Bump this for every deployed app update.
 * The frontend compares this server value with its locally stored version
 * before loading application assets.
 */
const APP_VERSION = '2026.10.10.10';

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
   RUNTIME HEALTH
========================================================= */

app.get('/api/logs',(_req,res)=>{
  res.set('Cache-Control','no-store').json({
    ok:true,generatedAt:new Date().toISOString(),
    runtime:serverRuntimeHealth(),logs:[]
  });
});

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