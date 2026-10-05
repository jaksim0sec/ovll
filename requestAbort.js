export function bindRequestAbort(
  req,
  res
) {
  const controller =
    new AbortController();

  let cleaned = false;

  const abort =
    () => {
      if (
        controller
          .signal
          .aborted
      ) {
        return;
      }

      controller.abort();
    };

  const onRequestAborted =
    () => {
      abort();
    };

  const onResponseClose =
    () => {
      if (
        res?.writableEnded ===
          true
      ) {
        return;
      }

      abort();
    };

  req?.once?.(
    "aborted",
    onRequestAborted
  );

  res?.once?.(
    "close",
    onResponseClose
  );

  return {
    signal:
      controller.signal,
    cleanup() {
      if (cleaned) {
        return;
      }

      cleaned = true;

      req?.off?.(
        "aborted",
        onRequestAborted
      );

      res?.off?.(
        "close",
        onResponseClose
      );
    }
  };
}
