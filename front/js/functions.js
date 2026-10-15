/* =========================================================
   Astra
   Common Utilities
   ========================================================= */

(function (global) {
  "use strict";

  /* ---------------------------------------------------------
     Clamp
     --------------------------------------------------------- */

  function clamp(value, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return min;
    }

    return Math.min(
      max,
      Math.max(min, number)
    );
  }


  /* ---------------------------------------------------------
     Lerp
     --------------------------------------------------------- */

  function lerp(a, b, t) {
    return (
      Number(a) +
      (Number(b) - Number(a)) *
      Number(t)
    );
  }


  /* ---------------------------------------------------------
     UUID
     --------------------------------------------------------- */

  function uuid(prefix = "id") {
    if (
      global.crypto &&
      typeof global.crypto.randomUUID === "function"
    ) {
      return `${prefix}-${global.crypto.randomUUID()}`;
    }

    const random =
      Math.random()
        .toString(36)
        .slice(2, 10);

    const time =
      Date.now()
        .toString(36);

    return `${prefix}-${time}-${random}`;
  }


  /* ---------------------------------------------------------
     Escape HTML
     --------------------------------------------------------- */

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  /* ---------------------------------------------------------
     Deep Clone
     --------------------------------------------------------- */

  function clone(value) {
    if (
      value === null ||
      typeof value !== "object"
    ) {
      return value;
    }

    if (
      typeof structuredClone === "function"
    ) {
      try {
        return structuredClone(value);
      } catch {
        /* fallback */
      }
    }

    return JSON.parse(
      JSON.stringify(value)
    );
  }


  /* ---------------------------------------------------------
     Debounce
     --------------------------------------------------------- */

  function debounce(
    fn,
    delay = 0
  ) {
    if (typeof fn !== "function") {
      throw new TypeError(
        "debounce 대상은 함수여야 합니다."
      );
    }

    let timer = null;

    function debounced(...args) {
      if (timer !== null) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => {
        timer = null;

        fn.apply(
          this,
          args
        );
      }, delay);
    }

    debounced.cancel = function () {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    return debounced;
  }


  /* ---------------------------------------------------------
     Throttle
     --------------------------------------------------------- */

  function throttle(
    fn,
    interval = 0
  ) {
    if (typeof fn !== "function") {
      throw new TypeError(
        "throttle 대상은 함수여야 합니다."
      );
    }

    let lastTime = 0;
    let timer = null;
    let lastArgs = null;
    let lastThis = null;

    function invoke() {
      lastTime = Date.now();

      timer = null;

      fn.apply(
        lastThis,
        lastArgs
      );

      lastArgs = null;
      lastThis = null;
    }

    function throttled(...args) {
      const now = Date.now();
      const remaining =
        interval -
        (now - lastTime);

      lastArgs = args;
      lastThis = this;

      if (remaining <= 0) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }

        invoke();
        return;
      }

      if (timer === null) {
        timer = setTimeout(
          invoke,
          remaining
        );
      }
    }

    throttled.cancel = function () {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      lastArgs = null;
      lastThis = null;
    };

    return throttled;
  }


  /* ---------------------------------------------------------
     RAF Throttle
     --------------------------------------------------------- */

  function rafThrottle(fn) {
    if (typeof fn !== "function") {
      throw new TypeError(
        "rafThrottle 대상은 함수여야 합니다."
      );
    }

    let frame = null;
    let lastArgs = null;
    let lastThis = null;

    function flush() {
      frame = null;

      const args = lastArgs;
      const context = lastThis;

      lastArgs = null;
      lastThis = null;

      fn.apply(
        context,
        args
      );
    }

    function throttled(...args) {
      lastArgs = args;
      lastThis = this;

      if (frame !== null) {
        return;
      }

      frame =
        global.requestAnimationFrame
          ? global.requestAnimationFrame(
              flush
            )
          : setTimeout(
              flush,
              16
            );
    }

    throttled.cancel = function () {
      if (frame === null) {
        return;
      }

      if (
        global.cancelAnimationFrame &&
        typeof frame === "number"
      ) {
        global.cancelAnimationFrame(
          frame
        );
      } else {
        clearTimeout(frame);
      }

      frame = null;
      lastArgs = null;
      lastThis = null;
    };

    return throttled;
  }


  /* ---------------------------------------------------------
     DOM Helpers
     --------------------------------------------------------- */

  function $(selector, root = document) {
    return root.querySelector(selector);
  }


  function $$(selector, root = document) {
    return Array.from(
      root.querySelectorAll(selector)
    );
  }


  /* ---------------------------------------------------------
     Numeric Helper
     --------------------------------------------------------- */

  function number(
    value,
    fallback = 0
  ) {
    const result = Number(value);

    return Number.isFinite(result)
      ? result
      : fallback;
  }


  /* ---------------------------------------------------------
     Point
     --------------------------------------------------------- */

  function point(
    x = 0,
    y = 0
  ) {
    return {
      x: number(x),
      y: number(y)
    };
  }


  /* ---------------------------------------------------------
     Distance
     --------------------------------------------------------- */

  function distance(
    x1,
    y1,
    x2,
    y2
  ) {
    return Math.hypot(
      number(x2) - number(x1),
      number(y2) - number(y1)
    );
  }


  function distanceBetween(
    a,
    b
  ) {
    return distance(
      a?.x,
      a?.y,
      b?.x,
      b?.y
    );
  }


  /* ---------------------------------------------------------
     Event
     --------------------------------------------------------- */

  function preventDefault(event) {
    if (
      event &&
      typeof event.preventDefault === "function"
    ) {
      event.preventDefault();
    }
  }


  /* ---------------------------------------------------------
     Public API
     --------------------------------------------------------- */

  const utils = Object.freeze({
    clamp,
    lerp,

    uuid,
    escapeHtml,
    clone,

    debounce,
    throttle,
    rafThrottle,

    $,
    $$,

    number,

    point,
    distance,
    distanceBetween,

    preventDefault
  });


  /*
    새 코드의 공통 접근점
  */
  global.AstraUtils = utils;


  /*
    디버깅/개발 편의를 위해
    이름을 직접 접근할 수 있게도 둠.
    나중에 필요 없으면 제거 가능.
  */
  global.clamp = clamp;
  global.lerp = lerp;
  global.uuid = uuid;
  global.escapeHtml = escapeHtml;
  global.clone = clone;

})(window);
