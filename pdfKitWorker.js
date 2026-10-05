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

parentPort.once(
  "message",
  async payload => {
    try {
      const buffer =
        await renderPdfKitDocument(
          payload?.document,
          payload?.metadata || {}
        );

      parentPort.postMessage({
        ok: true,
        buffer
      });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        error: {
          message:
            error?.message ||
            "PDFKit worker failed.",
          code:
            error?.code ||
            ""
        }
      });
    } finally {
      parentPort.close();
    }
  }
);
