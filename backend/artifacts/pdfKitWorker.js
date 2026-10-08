import {
  parentPort
} from "node:worker_threads";

import {
  renderPdfKitDocument
} from "./pdfKitRenderer.js";

if (!parentPort) {
  throw new Error(
    "PDF worker requires parentPort."
  );
}

parentPort.on(
  "message",
  async payload => {
    const id =
      String(
        payload?.id || ""
      );

    if (!id) {
      return;
    }

    const startedAt =
      Date.now();

    try {
      const buffer =
        await renderPdfKitDocument(
          payload?.document,
          payload?.metadata || {}
        );

      parentPort.postMessage({
        id,
        ok: true,
        durationMs:
          Date.now() -
          startedAt,
        buffer
      });
    } catch (error) {
      parentPort.postMessage({
        id,
        ok: false,
        durationMs:
          Date.now() -
          startedAt,
        error: {
          message:
            error?.message ||
            "PDFKit worker failed.",
          code:
            error?.code ||
            ""
        }
      });
    }
  }
);
