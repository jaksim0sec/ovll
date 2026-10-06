(function (global) {
  "use strict";

  const THEME_KEY =
    "ovll:theme";

  function createOvllWorkspaceUI(
    options = {}
  ) {
    const document =
      options.document ||
      global.document;

    const Navigation =
      options.navigation ===
        undefined
        ? global.OvllNavigation
        : options.navigation;

    const root =
      options.root ||
      document;

    const workspace =
      options.workspace ||
      root.querySelector?.(
        "#workspace,[data-ovll-workspace]"
      );

    const chatPage =
      options.chatPage ||
      root.querySelector?.(
        "#chat-page,[data-ovll-chat-page]"
      );

    const canvasPage =
      options.canvasPage ||
      root.querySelector?.(
        "#canvas-page,[data-ovll-canvas-page]"
      );

    const modeSwitch =
      options.modeSwitch ||
      root.querySelector?.(
        "#mode-switch,[data-ovll-mode-switch]"
      );

    const modeChat =
      options.modeChat ||
      modeSwitch?.querySelector?.(
        '[data-mode="chat"]'
      );

    const modeCanvas =
      options.modeCanvas ||
      modeSwitch?.querySelector?.(
        '[data-mode="canvas"]'
      );

    const historyEnabled =
      options.history !== false;

    const navigationEventsEnabled =
      options.navigationEvents !==
        false;

    const initialModeOption =
      options.initialMode ===
        "canvas"
        ? "canvas"
        : options.initialMode ===
            "chat"
          ? "chat"
          : null;

    const viewportRoot =
      options.viewportRoot ||
      (
        options.scopeViewportToWorkspace
          ? workspace
          : document.documentElement
      );

    const themeRoot =
      options.themeRoot ||
      document.documentElement;

    const gestureBlockSelector =
      String(
        options.gestureBlockSelector ||
        [
          "#topbar",
          "#composer",
          "#mode-switch",
          "[data-ovll-topbar]",
          "[data-ovll-composer]",
          "[data-ovll-mode-switch]",
          ".astra-message-canvas-link",
          ".astra-message-action",
          ".ovll-error-notice",
          "input",
          "textarea",
          "select",
          "button",
          "a",
          "[contenteditable='true']"
        ].join(",")
      );

    if (
      !workspace ||
      !chatPage ||
      !canvasPage ||
      !modeSwitch ||
      !modeChat ||
      !modeCanvas ||
      !viewportRoot ||
      !themeRoot
    ) {
      throw new Error(
        "Ovll Workspace UI DOM 구조가 올바르지 않습니다."
      );
    }

  const clamp = (
    value,
    min,
    max
  ) =>
    Math.min(
      max,
      Math.max(
        min,
        value
      )
    );

  const events =
    new Map();

  const listeners = [];

  const virtualKeyboard =
    global.navigator
      ?.virtualKeyboard ||
    null;

  let useKeyboardOverlay =
    false;

  try {
    if (
      virtualKeyboard &&
      "overlaysContent"
        in virtualKeyboard
    ) {
      virtualKeyboard
        .overlaysContent =
        true;

      useKeyboardOverlay =
        true;
    }
  } catch {}

  function getUrlMode() {
    if (!historyEnabled) {
      return (
        initialModeOption ||
        "chat"
      );
    }

    const value =
      new URLSearchParams(
        global.location.search
      )
        .get(
          "mode"
        );

    return value ===
      "canvas"
      ? "canvas"
      : "chat";
  }

  function modeUrl(
    mode
  ) {
    const url =
      new URL(
        global.location.href
      );

    if (!historyEnabled) {
      return url;
    }

    url.searchParams.set(
      "mode",
      mode === "canvas"
        ? "canvas"
        : "chat"
    );

    return url;
  }

  function setUrlMode(
    mode
  ) {
    if (!historyEnabled) {
      return;
    }

    try {
      global.history
        .replaceState(
          global.history.state,
          "",
          modeUrl(
            mode
          )
        );
    } catch {}
  }

  function getFrameHeight() {
    return Math.max(
      1,
      Math.round(
        global.innerHeight ||
        document.documentElement
          .clientHeight ||
        1
      )
    );
  }

  function getKeyboardHeight() {
    if (
      !useKeyboardOverlay
    ) {
      return 0;
    }

    const value =
      Number(
        virtualKeyboard
          ?.boundingRect
          ?.height ||
        0
      );

    return Number.isFinite(
      value
    )
      ? Math.max(
          0,
          Math.round(
            value
          )
        )
      : 0;
  }

  function getViewportHeight() {
    if (
      useKeyboardOverlay
    ) {
      return Math.max(
        1,
        getFrameHeight() -
        getKeyboardHeight()
      );
    }

    return Math.max(
      1,
      Math.round(
        global.visualViewport
          ?.height ||
        global.innerHeight ||
        document.documentElement
          .clientHeight ||
        1
      )
    );
  }

  function getViewportTop() {
    if (
      useKeyboardOverlay
    ) {
      return 0;
    }

    const value =
      Number(
        global.visualViewport
          ?.offsetTop ||
        0
      );

    return Number.isFinite(
      value
    )
      ? Math.round(
          value
        )
      : 0;
  }

  function getViewportWidth() {
    return Math.max(
      1,
      Math.round(
        workspace.clientWidth ||
        document.documentElement
          .clientWidth ||
        global.innerWidth ||
        global.visualViewport
          ?.width ||
        1
      )
    );
  }

  const initialMode =
    initialModeOption ||
    getUrlMode();

  const state = {
    mode:
      initialMode,
    progress:
      initialMode === "canvas"
        ? 1
        : 0,
    viewportWidth:
      getViewportWidth(),
    viewportHeight:
      getViewportHeight(),
    canvasApi:
      null,
    destroyed:
      false,
    transitionFrame:
      null,
    viewportFrame:
      null
  };

  function on(
    name,
    handler
  ) {
    if (
      typeof handler !==
        "function"
    ) {
      return () => {};
    }

    if (
      !events.has(name)
    ) {
      events.set(
        name,
        new Set()
      );
    }

    events
      .get(name)
      .add(
        handler
      );

    return () =>
      off(
        name,
        handler
      );
  }

  function off(
    name,
    handler
  ) {
    events
      .get(name)
      ?.delete(
        handler
      );
  }

  function emit(
    name,
    payload
  ) {
    for (
      const handler
      of events.get(name) ||
      []
    ) {
      try {
        handler(
          payload,
          api
        );
      } catch (
        error
      ) {
        console.error(
          error
        );
      }
    }
  }

  function listen(
    element,
    type,
    handler,
    options
  ) {
    element.addEventListener(
      type,
      handler,
      options
    );

    listeners.push(
      () => {
        element
          .removeEventListener(
            type,
            handler,
            options
          );
      }
    );
  }

  function render() {
    const progress =
      clamp(
        state.progress,
        0,
        1
      );

    viewportRoot
      .style
      .setProperty(
        "--page-progress",
        String(
          progress
        )
      );

    workspace.dataset.mode =
      state.mode;

    const offset =
      -progress *
      state.viewportWidth;

    chatPage.style.transform =
      `translate3d(${offset}px,0,0)`;

    canvasPage.style.transform =
      `translate3d(${offset}px,0,0)`;

    const settled =
      !workspace.classList.contains(
        "is-dragging"
      ) &&
      (
        progress === 0 ||
        progress === 1
      );

    chatPage.setAttribute(
      "aria-hidden",
      String(
        settled &&
        state.mode !== "chat"
      )
    );

    canvasPage.setAttribute(
      "aria-hidden",
      String(
        settled &&
        state.mode !== "canvas"
      )
    );

    modeChat.setAttribute(
      "aria-selected",
      String(
        state.mode ===
          "chat"
      )
    );

    modeCanvas.setAttribute(
      "aria-selected",
      String(
        state.mode ===
          "canvas"
      )
    );
  }

  function syncCanvasInteraction() {
    const canvas =
      state.canvasApi;

    if (
      !canvas ||
      typeof canvas
        .setInteractionEnabled !==
        "function"
    ) {
      return;
    }

    canvas
      .setInteractionEnabled(
        state.mode ===
          "canvas"
      );
  }

  function bindCanvas(
    canvasApi
  ) {
    state.canvasApi =
      canvasApi ||
      null;

    syncCanvasInteraction();

    return api;
  }

  function stopTransition() {
    if (
      state.transitionFrame !==
        null
    ) {
      cancelAnimationFrame(
        state.transitionFrame
      );

      state.transitionFrame =
        null;
    }

    workspace
      .classList
      .remove(
        "is-dragging"
      );

    modeSwitch
      .classList
      .remove(
        "is-dragging"
      );
  }

  function snapTo(
    target,
    options = {}
  ) {
    stopTransition();

    const end =
      clamp(
        Number(target) ||
        0,
        0,
        1
      );

    if (
      options.immediate ===
        true
    ) {
      state.progress =
        end;

      render();

      emit(
        "snap",
        {
          mode:
            state.mode,
          progress:
            state.progress
        }
      );

      return;
    }

    const startProgress =
      clamp(
        state.progress,
        0,
        1
      );

    const distance =
      Math.abs(
        end -
        startProgress
      );

    if (
      distance <
      .001
    ) {
      state.progress =
        end;

      render();

      emit(
        "snap",
        {
          mode:
            state.mode,
          progress:
            state.progress
        }
      );

      return;
    }

    workspace
      .classList
      .add(
        "is-dragging"
      );

    modeSwitch
      .classList
      .add(
        "is-dragging"
      );

    const started =
      performance.now();

    const duration =
      280 +
      distance *
      55;

    const tick =
      now => {
        if (
          state.destroyed
        ) {
          state.transitionFrame =
            null;
          return;
        }

        const t =
          clamp(
            (
              now -
              started
            ) /
            duration,
            0,
            1
          );

        const eased =
          1 -
          Math.pow(
            1 - t,
            4
          );

        state.progress =
          startProgress +
          (
            end -
            startProgress
          ) *
          eased;

        render();

        if (
          t < 1
        ) {
          state.transitionFrame =
            requestAnimationFrame(
              tick
            );

          return;
        }

        state.transitionFrame =
          null;
        state.progress =
          end;

        workspace
          .classList
          .remove(
            "is-dragging"
          );

        modeSwitch
          .classList
          .remove(
            "is-dragging"
          );

        render();

        emit(
          "snap",
          {
            mode:
              state.mode,
            progress:
              state.progress
          }
        );
      };

    state.transitionFrame =
      requestAnimationFrame(
        tick
      );
  }

  function setMode(
    mode,
    options = {}
  ) {
    if (
      pageGesture?.active
    ) {
      resetPageGesture(
        false
      );
    }

    const target =
      mode === "canvas"
        ? "canvas"
        : "chat";

    const previous =
      state.mode;

    const navigationEnabled =
      historyEnabled &&
      options.history !==
        false &&
      previous !==
        target &&
      !!Navigation;

    const marker =
      Navigation
        ?.current?.();

    if (
      navigationEnabled &&
      target === "canvas" &&
      marker?.layer === "base"
    ) {
      try {
        Navigation.open(
          "canvas",
          {
            url:
              modeUrl(
                "canvas"
              ).href
          }
        );
      } catch {
        setUrlMode(
          target
        );
      }
    } else if (
      navigationEnabled &&
      target === "chat" &&
      marker?.layer === "canvas"
    ) {
      Navigation.close(
        "canvas"
      );
    } else if (
      navigationEnabled &&
      target === "chat" &&
      marker?.parentLayer ===
        "canvas" &&
      marker.depth >= 2
    ) {
      Navigation.goToDepth(
        marker.depth - 2
      );
    } else {
      setUrlMode(
        target
      );
    }

    state.mode =
      target;

    syncCanvasInteraction();

    if (
      previous !==
        target ||
      options.force ===
        true
    ) {
      emit(
        "modechange",
        {
          mode:
            target,
          previous
        }
      );
    }

    snapTo(
      target === "canvas"
        ? 1
        : 0,
      {
        immediate:
          options.immediate ===
            true
      }
    );

    return api;
  }

  function toggleMode() {
    return setMode(
      state.mode ===
        "chat"
        ? "canvas"
        : "chat"
    );
  }

  function setDarkMode(
    enabled = true
  ) {
    const root =
      themeRoot;

    const dark =
      !!enabled;

    root.classList.toggle(
      "dark",
      dark
    );

    root.dataset.theme =
      dark
        ? "dark"
        : "light";

    root.style.colorScheme =
      dark
        ? "dark"
        : "light";

    const meta =
      document.querySelector(
        'meta[name="theme-color"]'
      );

    if (meta) {
      meta.content =
        dark
          ? "#060606"
          : "#f1f1ef";
    }

    try {
      localStorage.setItem(
        THEME_KEY,
        dark
          ? "dark"
          : "light"
      );
    } catch {}

    return api;
  }

  function toggleDarkMode() {
    return setDarkMode(
      !themeRoot
        .classList
        .contains(
          "dark"
        )
    );
  }

  function syncViewport() {
    if (
      state.destroyed
    ) {
      return;
    }

    const width =
      getViewportWidth();

    const frameHeight =
      getFrameHeight();

    const height =
      getViewportHeight();

    const top =
      getViewportTop();

    const previousHeight =
      state.viewportHeight;

    state.viewportWidth =
      width;

    state.viewportHeight =
      height;

    const root =
      viewportRoot;

    root.classList.toggle(
      "viewport-shrinking",
      height <
        previousHeight -
        1
    );

    root.classList.toggle(
      "viewport-growing",
      height >
        previousHeight +
        1
    );

    root.classList.toggle(
      "keyboard-overlay",
      useKeyboardOverlay
    );

    root.dataset.viewportStrategy =
      useKeyboardOverlay
        ? "virtual-keyboard-overlay"
        : "visual-viewport";

    const rootStyle =
      root.style;

    rootStyle.setProperty(
      "--app-frame-top",
      `${top}px`
    );

    rootStyle.setProperty(
      "--app-frame-height",
      `${
        useKeyboardOverlay
          ? frameHeight
          : height
      }px`
    );

    rootStyle.setProperty(
      "--app-stage-height",
      `${height}px`
    );

    rootStyle.setProperty(
      "--real-vh",
      `${height}px`
    );

    rootStyle.setProperty(
      "--viewport-height",
      `${height}px`
    );

    rootStyle.setProperty(
      "--real-vh-unit",
      `${height / 100}px`
    );

    const keyboardHeight =
      Math.max(
        0,
        frameHeight -
        height
      );

    rootStyle.setProperty(
      "--keyboard-height",
      `${keyboardHeight}px`
    );

    rootStyle.setProperty(
      "--visual-viewport-top",
      `${top}px`
    );

    render();

    emit(
      "viewport",
      {
        width,
        height,
        top,
        frameHeight,
        keyboardHeight,
        strategy:
          useKeyboardOverlay
            ? "virtual-keyboard-overlay"
            : "visual-viewport"
      }
    );
  }

  function scheduleViewportSync() {
    if (
      state.viewportFrame !==
        null
    ) {
      return;
    }

    state.viewportFrame =
      requestAnimationFrame(
        () => {
          state.viewportFrame =
            null;

          syncViewport();
        }
      );
  }

  const pageGesture = {
    active: false,
    touchId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
    horizontal: false
  };

  function getTouchById(
    touches,
    id
  ) {
    for (
      let index = 0;
      index < touches.length;
      index += 1
    ) {
      if (
        touches[index]
          .identifier === id
      ) {
        return touches[index];
      }
    }

    return null;
  }

  function pointInsideGestureBlocker(
    target
  ) {
    if (
      !target ||
      typeof target.closest !==
        "function"
    ) {
      return false;
    }

    if (
      target.closest(
        gestureBlockSelector
      )
    ) {
      return true;
    }

    let node =
      target;

    while (
      node &&
      node !== chatPage
    ) {
      if (
        node instanceof
          HTMLElement
      ) {
        const style =
          global.getComputedStyle(
            node
          );

        if (
          node.scrollWidth >
            node.clientWidth + 2 &&
          (
            style.overflowX ===
              "auto" ||
            style.overflowX ===
              "scroll"
          )
        ) {
          return true;
        }
      }

      node =
        node.parentElement;
    }

    return false;
  }

  function resetPageGesture(
    restore = true
  ) {
    pageGesture.active =
      false;
    pageGesture.touchId =
      null;
    pageGesture.horizontal =
      false;
    pageGesture.velocityX =
      0;

    workspace
      .classList
      .remove(
        "is-dragging"
      );

    if (restore) {
      state.progress =
        state.mode ===
          "canvas"
          ? 1
          : 0;

      render();
    }
  }

  function beginPageGesture(
    event
  ) {
    if (
      state.destroyed ||
      state.mode !== "chat" ||
      pageGesture.active ||
      pillGesture.active ||
      !event.touches ||
      event.touches.length !== 1
    ) {
      return;
    }

    const target =
      event.target;

    if (
      !chatPage.contains(
        target
      ) ||
      pointInsideGestureBlocker(
        target
      )
    ) {
      return;
    }

    stopTransition();

    const touch =
      event.touches[0];

    pageGesture.active =
      true;
    pageGesture.touchId =
      touch.identifier;
    pageGesture.startX =
      touch.clientX;
    pageGesture.startY =
      touch.clientY;
    pageGesture.lastX =
      touch.clientX;
    pageGesture.lastTime =
      performance.now();
    pageGesture.velocityX =
      0;
    pageGesture.horizontal =
      false;

    state.progress = 0;
  }

  function updatePageGesture(
    event
  ) {
    if (
      !pageGesture.active ||
      state.mode !== "chat"
    ) {
      return;
    }

    const touch =
      getTouchById(
        event.touches,
        pageGesture.touchId
      );

    if (!touch) {
      return;
    }

    const dx =
      touch.clientX -
      pageGesture.startX;

    const dy =
      touch.clientY -
      pageGesture.startY;

    const absX =
      Math.abs(dx);

    const absY =
      Math.abs(dy);

    if (
      !pageGesture.horizontal &&
      Math.max(
        absX,
        absY
      ) < 8
    ) {
      return;
    }

    if (
      !pageGesture.horizontal
    ) {
      if (
        absY >= absX ||
        dx >= 0
      ) {
        resetPageGesture(
          false
        );

        return;
      }

      pageGesture.horizontal =
        true;

      workspace
        .classList
        .add(
          "is-dragging"
        );

      emit(
        "gesturestart",
        {
          x:
            pageGesture.startX,
          y:
            pageGesture.startY,
          mode:
            "chat"
        }
      );
    }

    event.preventDefault();

    const next =
      clamp(
        -dx /
          Math.max(
            1,
            state.viewportWidth
          ),
        0,
        1
      );

    const now =
      performance.now();

    const dt =
      Math.max(
        1,
        now -
        pageGesture.lastTime
      );

    const instant =
      (
        touch.clientX -
        pageGesture.lastX
      ) / dt;

    pageGesture.velocityX =
      pageGesture.velocityX *
        .72 +
      instant *
        .28;

    pageGesture.lastX =
      touch.clientX;
    pageGesture.lastTime =
      now;

    state.progress =
      next;

    render();
  }

  function finishPageGesture() {
    if (
      !pageGesture.active
    ) {
      return;
    }

    const horizontal =
      pageGesture.horizontal;

    const velocity =
      pageGesture.velocityX;

    const progress =
      clamp(
        state.progress,
        0,
        1
      );

    resetPageGesture(
      false
    );

    if (!horizontal) {
      state.progress = 0;
      render();
      return;
    }

    const openCanvas =
      velocity < -.34 ||
      progress >= .42;

    if (openCanvas) {
      setMode(
        "canvas"
      );

      return;
    }

    state.mode =
      "chat";

    snapTo(
      0
    );
  }

  function cancelPageGesture() {
    if (
      !pageGesture.active
    ) {
      return;
    }

    resetPageGesture(
      true
    );
  }

  const pillGesture = {
    active: false,
    pointerId: null,
    startX: 0,
    startProgress: 0,
    lastX: 0,
    lastTime: 0,
    velocityX: 0,
    moved: false
  };

  let suppressModeClick =
    false;

  function resetPillGesture() {
    pillGesture.active =
      false;
    pillGesture.pointerId =
      null;
    pillGesture.moved =
      false;
    pillGesture.velocityX =
      0;

    modeSwitch
      .classList
      .remove(
        "is-dragging"
      );
  }

  function beginPillGesture(
    event
  ) {
    if (
      state.destroyed ||
      pillGesture.active
    ) {
      return;
    }

    if (
      event.button !==
        undefined &&
      event.button !== 0
    ) {
      return;
    }

    stopTransition();

    pillGesture.active =
      true;
    pillGesture.pointerId =
      event.pointerId;
    pillGesture.startX =
      event.clientX;
    pillGesture.startProgress =
      clamp(
        state.progress,
        0,
        1
      );
    pillGesture.lastX =
      event.clientX;
    pillGesture.lastTime =
      performance.now();
    pillGesture.velocityX =
      0;
    pillGesture.moved =
      false;

    modeSwitch
      .classList
      .add(
        "is-dragging"
      );

    if (
      event.pointerType !==
        "mouse"
    ) {
      try {
        modeSwitch
          .setPointerCapture(
            event.pointerId
          );
      } catch {}
    }
  }

  function updatePillGesture(
    event
  ) {
    if (
      !pillGesture.active ||
      event.pointerId !==
        pillGesture.pointerId
    ) {
      return;
    }

    const dx =
      event.clientX -
      pillGesture.startX;

    if (
      !pillGesture.moved &&
      Math.abs(dx) > 5
    ) {
      pillGesture.moved =
        true;

      if (
        event.pointerType ===
          "mouse"
      ) {
        try {
          modeSwitch
            .setPointerCapture(
              event.pointerId
            );
        } catch {}
      }
    }

    if (
      !pillGesture.moved
    ) {
      return;
    }

    event.preventDefault();

    const width =
      Math.max(
        1,
        modeSwitch
          .getBoundingClientRect()
          .width
      );

    const next =
      clamp(
        pillGesture.startProgress +
        dx / width,
        -.12,
        1.12
      );

    const now =
      performance.now();

    const dt =
      Math.max(
        1,
        now -
        pillGesture.lastTime
      );

    const instantVelocity =
      (
        event.clientX -
        pillGesture.lastX
      ) / dt;

    pillGesture.velocityX =
      pillGesture.velocityX *
        .7 +
      instantVelocity *
        .3;

    pillGesture.lastX =
      event.clientX;
    pillGesture.lastTime =
      now;

    state.progress =
      next;

    render();
  }

  function finishPillGesture(
    event
  ) {
    if (
      !pillGesture.active ||
      event.pointerId !==
        pillGesture.pointerId
    ) {
      return;
    }

    const moved =
      pillGesture.moved;

    const velocity =
      pillGesture.velocityX;

    const progress =
      clamp(
        state.progress,
        0,
        1
      );

    try {
      modeSwitch
        .releasePointerCapture(
          event.pointerId
        );
    } catch {}

    resetPillGesture();

    if (!moved) {
      state.progress =
        state.mode ===
          "canvas"
          ? 1
          : 0;

      render();
      return;
    }

    suppressModeClick =
      true;

    event.preventDefault();

    let target;

    if (
      velocity > .34
    ) {
      target = 1;
    } else if (
      velocity < -.34
    ) {
      target = 0;
    } else {
      target =
        progress >= .5
          ? 1
          : 0;
    }

    setMode(
      target === 1
        ? "canvas"
        : "chat"
    );

    setTimeout(
      () => {
        suppressModeClick =
          false;
      },
      0
    );
  }

  function cancelPillGesture(
    event
  ) {
    if (
      !pillGesture.active ||
      (
        event?.pointerId !==
          undefined &&
        event.pointerId !==
          pillGesture.pointerId
      )
    ) {
      return;
    }

    resetPillGesture();

    state.progress =
      state.mode ===
        "canvas"
        ? 1
        : 0;

    render();
  }

  function handleModeClick(
    event
  ) {
    if (
      suppressModeClick ||
      pillGesture.active
    ) {
      return;
    }

    const button =
      event.target
        .closest(
          "button[data-mode]"
        );

    if (
      !button ||
      !modeSwitch
        .contains(
          button
        )
    ) {
      return;
    }

    const mode =
      button.dataset.mode;

    if (
      mode === "chat" ||
      mode === "canvas"
    ) {
      setMode(
        mode
      );
    }
  }

  listen(
    workspace,
    "touchstart",
    beginPageGesture,
    {
      passive: true,
      capture: true
    }
  );

  listen(
    workspace,
    "touchmove",
    updatePageGesture,
    {
      passive: false,
      capture: true
    }
  );

  listen(
    workspace,
    "touchend",
    finishPageGesture,
    {
      passive: true,
      capture: true
    }
  );

  listen(
    workspace,
    "touchcancel",
    cancelPageGesture,
    {
      passive: true,
      capture: true
    }
  );

  listen(
    modeSwitch,
    "pointerdown",
    beginPillGesture,
    {
      passive: true
    }
  );

  listen(
    modeSwitch,
    "pointermove",
    updatePillGesture,
    {
      passive: false
    }
  );

  listen(
    modeSwitch,
    "pointerup",
    finishPillGesture,
    {
      passive: false
    }
  );

  listen(
    modeSwitch,
    "pointercancel",
    cancelPillGesture,
    {
      passive: true
    }
  );

  listen(
    modeSwitch,
    "lostpointercapture",
    cancelPillGesture,
    {
      passive: true
    }
  );

  listen(
    modeSwitch,
    "click",
    handleModeClick
  );

  listen(
    global,
    "resize",
    scheduleViewportSync
  );

  listen(
    global,
    "orientationchange",
    () => {
      setTimeout(
        scheduleViewportSync,
        120
      );
    }
  );

  listen(
    global,
    "pageshow",
    scheduleViewportSync
  );

  if(
    typeof global.ResizeObserver ===
      "function"
  ) {
    const workspaceResizeObserver =
      new global.ResizeObserver(
        scheduleViewportSync
      );

    workspaceResizeObserver
      .observe(
        workspace
      );

    listeners.push(
      () =>
        workspaceResizeObserver
          .disconnect()
    );
  }

  if (historyEnabled) {
    listen(
      global,
      "popstate",
      () => {
        const target =
          getUrlMode();

        if (
          target !==
            state.mode
        ) {
          setMode(
            target,
            {
              history:
                false,
              immediate:
                true
            }
          );
        }
      }
    );
  }

  if (navigationEventsEnabled) {
    listen(
      global,
      "ovll:navigation-back",
      event => {
        if (
          event.detail
            ?.layer ===
          "canvas" &&
          state.mode ===
            "canvas"
        ) {
          setMode(
            "chat",
            {
              history:
                false,
              immediate:
                true
            }
          );
        }
      }
    );
  }

  if (
    useKeyboardOverlay &&
    virtualKeyboard
  ) {
    listen(
      virtualKeyboard,
      "geometrychange",
      scheduleViewportSync
    );
  } else if (
    global.visualViewport
  ) {
    listen(
      global.visualViewport,
      "resize",
      scheduleViewportSync
    );

    listen(
      global.visualViewport,
      "scroll",
      scheduleViewportSync
    );
  }

  const api = {
    getMode() {
      return state.mode;
    },

    getProgress() {
      return state.progress;
    },

    getViewportInfo() {
      return {
        strategy:
          useKeyboardOverlay
            ? "virtual-keyboard-overlay"
            : "visual-viewport",
        frameHeight:
          getFrameHeight(),
        height:
          getViewportHeight(),
        top:
          getViewportTop(),
        keyboardHeight:
          Math.max(
            0,
            getFrameHeight() -
            getViewportHeight()
          )
      };
    },

    setMode,
    toggleMode,
    setDarkMode,
    toggleDarkMode,
    bindCanvas,
    syncViewport,
    on,
    off,

    destroy() {
      if (
        state.destroyed
      ) {
        return;
      }

      state.destroyed =
        true;

      stopTransition();

      if (
        state.viewportFrame !==
          null
      ) {
        cancelAnimationFrame(
          state.viewportFrame
        );

        state.viewportFrame =
          null;
      }

      listeners
        .splice(0)
        .forEach(
          cleanup => {
            try {
              cleanup();
            } catch {}
          }
        );

      events.clear();

      state.canvasApi =
        null;
    }
  };

  const frozenApi =
    Object.freeze(
      api
    );

  if (
    historyEnabled &&
    initialMode === "canvas" &&
    Navigation
      ?.isCurrent?.(
        "base"
      )
  ) {
    try {
      const canvasUrl =
        modeUrl(
          "canvas"
        );

      setUrlMode(
        "chat"
      );

      Navigation.open(
        "canvas",
        {
          url:
            canvasUrl.href
        }
      );
    } catch {
      setUrlMode(
        state.mode
      );
    }
  } else {
    setUrlMode(
      state.mode
    );
  }

  render();
  syncViewport();

  return frozenApi;
  }

  global.createOvllWorkspaceUI =
    createOvllWorkspaceUI;
})(window);
