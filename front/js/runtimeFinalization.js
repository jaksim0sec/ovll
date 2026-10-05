(function (global) {
  "use strict";

  function nodeStates(run) {
    return Object.values(
      run?.nodes || {}
    );
  }

  function artifacts(run) {
    return nodeStates(run)
      .map(
        state =>
          state?.result
            ?.artifact ||
          state?.result
            ?.file ||
          null
      )
      .filter(Boolean);
  }

  function terminalStates(run) {
    const states =
      new Map(
        nodeStates(run)
          .map(
            state => [
              String(
                state?.id || ""
              ),
              state
            ]
          )
      );

    const outgoing =
      new Map(
        [...states.keys()]
          .map(
            id => [
              id,
              []
            ]
          )
      );

    for (
      const connection
        of run?.workflow
          ?.connections || []
    ) {
      const from =
        String(
          connection?.from?.node ||
          ""
        );
      const to =
        String(
          connection?.to?.node ||
          ""
        );

      if (
        outgoing.has(from) &&
        states.has(to)
      ) {
        outgoing
          .get(from)
          .push(to);
      }
    }

    return [...states.values()]
      .filter(
        state => {
          if (
            state?.status !==
              "SUCCESS"
          ) {
            return false;
          }

          const children =
            outgoing.get(
              String(
                state?.id || ""
              )
            ) || [];

          return !children.some(
            childId =>
              states.get(
                childId
              )?.status ===
                "SUCCESS"
          );
        }
      );
  }

  function decide(run) {
    const status =
      String(
        run?.status || ""
      );

    if (
      status ===
        "CANCELLED"
    ) {
      return {
        mode: "skip",
        reason: "cancelled",
        message: ""
      };
    }

    if (
      status ===
        "FAILED"
    ) {
      return {
        mode: "local",
        reason: "failed",
        message: ""
      };
    }

    const terminals =
      terminalStates(run);

    const producedArtifacts =
      artifacts(run);

    if (
      producedArtifacts.length &&
      terminals.length > 0 &&
      terminals.every(
        state =>
          state?.type ===
            "createFile" ||
          state?.type ===
            "file"
      )
    ) {
      return {
        mode: "local",
        reason:
          "artifact-only",
        message: ""
      };
    }

    if (
      terminals.length === 1
    ) {
      const terminal =
        terminals[0];

      if (
        terminal?.type !==
          "judge"
      ) {
        const value =
          terminal?.result
            ?.outputs?.result;

        if (
          typeof value ===
            "string" &&
          value.trim()
        ) {
          return {
            mode: "local",
            reason:
              "terminal-text",
            message:
              value.trim()
          };
        }
      }
    }

    return {
      mode: "model",
      reason:
        terminals.length > 1
          ? "multiple-terminals"
          : "synthesis-required",
      message: ""
    };
  }

  global
    .OvllRuntimeFinalization =
    Object.freeze({
      decide
    });
})(window);
