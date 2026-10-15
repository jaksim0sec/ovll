(function(global) {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN_SCALE = 0.12;
  const MAX_SCALE = 3;
  const U = global.AstraUtils || {};
  const clamp = U.clamp || ((value, min, max) => Math.min(max, Math.max(min, value)));
  const clone = U.clone || (value => {
    try { return structuredClone(value); }
    catch { return JSON.parse(JSON.stringify(value)); }
  });
  const escapeHtml = U.escapeHtml || (value => String(value ?? '').replace(
    /[&<>'"]/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])
  ));
  const icons = {
    toggle: `
      <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path d="m6.7 8 3.3 3.3L13.3 8" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    delete: `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5.65 6.55h8.7M6.95 6.6l.46 7.05c.05.74.66 1.3 1.4 1.3h2.38c.74 0 1.35-.56 1.4-1.3l.46-7.05M7.85 4.75h4.3" stroke="currentColor" stroke-width="1.42" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    run: `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M7.5 5.7c-.52-.33-1.2.05-1.2.67v7.26c0 .62.68 1 1.2.67l5.8-3.63c.5-.31.5-1.03 0-1.34L7.5 5.7Z" stroke="currentColor" stroke-width="1.42" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    stop: `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="4.1" y="4.1" width="11.8" height="11.8" rx="4.1" stroke="currentColor" stroke-width="1.24"/>
        <rect x="8.2" y="8.2" width="3.6" height="3.6" rx="1.05" fill="currentColor"/>
      </svg>
    `,
    fileResult: `
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5.45 3.65h5.2l3.9 3.9v7.05a1.75 1.75 0 0 1-1.75 1.75H5.45A1.75 1.75 0 0 1 3.7 14.6V5.4a1.75 1.75 0 0 1 1.75-1.75Z" stroke="currentColor" stroke-width="1.38" stroke-linejoin="round"/>
        <path d="M10.65 3.65v2.9a1 1 0 0 0 1 1h2.9M6.8 10.4h4.9M6.8 12.95h3.65" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `
  };
  function svgEl(name, attrs = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  }
  function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function endpoint(value) {
    if (typeof value !== 'string') throw new Error('연결 endpoint가 문자열이 아닙니다.');
    const dot = value.lastIndexOf('.');
    if (dot < 1 || dot === value.length - 1) throw new Error(`잘못된 endpoint입니다: ${value}`);
    return { skillNode: value.slice(0, dot), port: value.slice(dot + 1) };
  }
  function pathFor(a, b) {
    const bend = clamp(
      Math.abs(b.x - a.x) * 0.22 + Math.abs(b.y - a.y) * 0.05,
      28,
      85
    );
    return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`.replace(/\s+/g, ' ');
  }
  const CanvasPlugins = (() => {
    if (global.OvllCanvasPlugins) {
      return global.OvllCanvasPlugins;
    }

    const plugins = new Map();
    const subscribers = new Set();

    function emit(detail = {}) {
      const payload = {
        ...detail,
        plugins: [...plugins.keys()]
      };

      for (const listener of subscribers) {
        try {
          listener(payload);
        } catch (error) {
          console.warn(
            'Canvas plugin listener failed:',
            error
          );
        }
      }
    }

    function register(plugin) {
      const id =
        String(plugin?.id || '')
          .trim();

      if (!id) {
        throw new Error(
          'Canvas plugin id가 필요합니다.'
        );
      }

      if (
        !plugin ||
        typeof plugin !== 'object'
      ) {
        throw new TypeError(
          'Canvas plugin이 올바르지 않습니다.'
        );
      }

      plugins.set(id, plugin);
      emit({
        type: 'register',
        pluginId: id
      });

      return () => {
        if (
          plugins.get(id) !==
          plugin
        ) {
          return false;
        }

        plugins.delete(id);
        emit({
          type: 'unregister',
          pluginId: id
        });

        return true;
      };
    }

    function invalidate(pluginId) {
      const id =
        String(pluginId || '');

      if (
        id &&
        !plugins.has(id)
      ) {
        return false;
      }

      emit({
        type: 'invalidate',
        pluginId: id || null
      });

      return true;
    }

    function onChange(listener) {
      if (
        typeof listener !==
        'function'
      ) {
        return () => {};
      }

      subscribers.add(listener);

      return () => {
        subscribers.delete(listener);
      };
    }

    function resolveDefinitions(
      baseDefinitions = {},
      context = {}
    ) {
      const base =
        baseDefinitions &&
        typeof baseDefinitions ===
          'object' &&
        !Array.isArray(
          baseDefinitions
        )
          ? baseDefinitions
          : {};

      const merged = {
        ...base
      };

      for (const plugin of plugins.values()) {
        if (
          typeof plugin
            ?.getDefinitions !==
          'function'
        ) {
          continue;
        }

        const contribution =
          plugin.getDefinitions({
            ...context,
            baseDefinitions: base,
            currentDefinitions: {
              ...merged
            }
          });

        if (
          !contribution ||
          typeof contribution !==
            'object' ||
          Array.isArray(
            contribution
          )
        ) {
          continue;
        }

        Object.assign(
          merged,
          contribution
        );
      }

      return merged;
    }

    function prepareRuntime(input = {}) {
      let workflow =
        clone(
          input.workflow || {
            skillNodes: [],
            connections: []
          }
        );

      let pivotId =
        String(
          input.pivotId || ''
        );

      const visiblePivot =
        String(
          input.visiblePivot ||
          input.pivotId ||
          ''
        );

      const runtimeToVisible = {};
      const projectors = [];

      for (const plugin of plugins.values()) {
        if (
          typeof plugin
            ?.prepareRuntime !==
          'function'
        ) {
          continue;
        }

        const result =
          plugin.prepareRuntime({
            ...input,
            workflow,
            pivotId,
            visiblePivot
          });

        if (!result) {
          continue;
        }

        if (
          result.workflow &&
          typeof result.workflow ===
            'object'
        ) {
          workflow =
            clone(
              result.workflow
            );
        }

        if (
          result.pivotId !==
          undefined &&
          result.pivotId !==
          null
        ) {
          pivotId =
            String(
              result.pivotId
            );
        }

        Object.assign(
          runtimeToVisible,
          result.runtimeToVisible ||
          {}
        );

        if (
          typeof result.projectEvent ===
            'function'
        ) {
          projectors.push(
            result.projectEvent
          );
        }
      }

      function project(event) {
        let events = [event];

        for (
          let index =
            projectors.length - 1;
          index >= 0;
          index--
        ) {
          const projector =
            projectors[index];

          events =
            events.flatMap(
              item => {
                const projected =
                  projector(item);

                if (
                  Array.isArray(
                    projected
                  )
                ) {
                  return projected;
                }

                return projected
                  ? [projected]
                  : [];
              }
            );
        }

        return events;
      }

      return {
        workflow,
        pivotId,
        visiblePivot,
        runtimeToVisible,
        resolveVisibleSkillNodeId(id) {
          const key =
            String(id || '');

          return (
            runtimeToVisible[key] ||
            key
          );
        },
        project
      };
    }

    const api =
      Object.freeze({
        register,
        invalidate,
        onChange,
        resolveDefinitions,
        prepareRuntime,
        list() {
          return [
            ...plugins.values()
          ];
        }
      });

    global.OvllCanvasPlugins =
      api;

    return api;
  })();

  global.mountCanvasSkillNode = async function(target, options = {}) {
    if (typeof target === 'string') target = document.querySelector(target);
    if (!(target instanceof Element)) throw new TypeError('target must be a DOM Element or selector');
    const previousState = target._canvasSkillNode?.getState?.() || null;
    target._canvasSkillNode?.destroy?.();
    let skillDefinitions = options.skillDefinitions || {};
    const pluginContext =
      String(
        options.pluginContext ||
        'workspace'
      );
    const getFreshSkillDefinitions =
      global.AstraAPI?.getSkillDefinitions;
    const canRefreshDefinitions =
      options.refreshDefinitions !== false &&
      typeof getFreshSkillDefinitions === 'function' &&
      global.navigator?.onLine !== false;

    if (canRefreshDefinitions) {
      try {
        const freshDefinitions = await getFreshSkillDefinitions.call(
          global.AstraAPI,
          { force: true }
        );

        if (
          freshDefinitions &&
          typeof freshDefinitions === 'object' &&
          !Array.isArray(freshDefinitions)
        ) {
          skillDefinitions =
            freshDefinitions.skillDefinitions ||
            freshDefinitions;
        }
      } catch (error) {
        console.warn(
          'Node skillDefinitions unavailable; continuing with cached UI state.',
          error
        );
      }
    }
    const viewport = target.matches('#canvas-viewport,[data-canvas-viewport]')
      ? target
      : target.querySelector('#canvas-viewport,[data-canvas-viewport]');
    if (!viewport) throw new Error('canvas viewport가 없습니다.');
    const world = viewport.querySelector('#canvas-world,[data-canvas-world]');
    const connectionSvg = viewport.querySelector('#canvas-connections,[data-canvas-connections]');
    const skillNodesLayer = viewport.querySelector('#canvas-skill-nodes,[data-canvas-skill-nodes]');
    if (!world || !connectionSvg || !skillNodesLayer) {
      throw new Error('Canvas DOM 구조가 올바르지 않습니다.');
    }
    let connectionLayer = connectionSvg.querySelector('.vc-connection-layer');
    let dragLayer = connectionSvg.querySelector('.vc-drag-connection-layer');
    if (!connectionLayer) {
      connectionLayer = document.createElementNS(SVG_NS, 'g');
      connectionLayer.className.baseVal = 'vc-connection-layer';
      connectionSvg.appendChild(connectionLayer);
    }
    if (!dragLayer) {
      dragLayer = document.createElementNS(SVG_NS, 'g');
      dragLayer.className.baseVal = 'vc-drag-connection-layer';
      connectionSvg.appendChild(dragLayer);
    }
    const state = {
      skillNodes: [],
      connections: [],
      selectedSkillNode: null,
      scale: 1,
      offset: { x: 0, y: 0 },
      pointers: new Map(),
      skillNodeDrag: null,
      canvasPan: null,
      pinch: null,
      connectionDrag: null,
      interactionEnabled: options.interactionEnabled !== false,
      destroyed: false,
      connectionFrame: null,
      panMotionFrame: null,
      lastSkillNodeDragEndAt: 0,
      enteringSkillNodes: new Set(),
      runtimeConnections: new Set(),
      runtimeSkillNodes: new Map(),
      runLocked: false,
      runPivot: null,
      portTap: {
        key: "",
        at: 0
      },
      connectionRemovalTimers:
        new Set()
    };
    let baseDefinitions =
      skillDefinitions &&
      typeof skillDefinitions ===
        'object' &&
      !Array.isArray(skillDefinitions)
        ? skillDefinitions
        : {};

    const registry =
      new Map();
    const events = new Map();
    const listeners = [];
    const observers = [];
    const connectionElements = new Map();
    function on(name, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(fn);
      return () => off(name, fn);
    }
    function off(name, fn) {
      events.get(name)?.delete(fn);
    }
    function emit(name, payload) {
      for (const fn of events.get(name) || []) {
        try { fn(payload, api); }
        catch (error) { console.error(error); }
      }
    }
    function listen(element, type, handler, opts) {
      element.addEventListener(type, handler, opts);
      listeners.push(() => element.removeEventListener(type, handler, opts));
    }
    function scheduleConnectionRender() {
      if (state.destroyed || state.connectionFrame !== null) return;
      state.connectionFrame = requestAnimationFrame(() => {
        state.connectionFrame = null;
        if (!state.destroyed) renderConnections();
      });
    }

    function stopPanMotion() {
      if (
        state.panMotionFrame !==
        null
      ) {
        cancelAnimationFrame(
          state.panMotionFrame
        );
        state.panMotionFrame =
          null;
      }

      viewport.classList.remove(
        'vc-panning'
      );
    }

    function startPanMotion(
      velocityX,
      velocityY
    ) {
      stopPanMotion();

      if (
        global.matchMedia?.(
          '(prefers-reduced-motion: reduce)'
        ).matches
      ) {
        return;
      }

      let vx =
        Number(velocityX) || 0;

      let vy =
        Number(velocityY) || 0;

      const speed =
        Math.hypot(
          vx,
          vy
        );

      if (speed < .08) {
        return;
      }

      const maxSpeed = 1.6;

      if (speed > maxSpeed) {
        const ratio =
          maxSpeed / speed;
        vx *= ratio;
        vy *= ratio;
      }

      let previous =
        performance.now();

      viewport.classList.add(
        'vc-panning'
      );

      const frame = now => {
        if (
          state.destroyed ||
          !state.interactionEnabled ||
          state.pointers.size ||
          state.skillNodeDrag ||
          state.connectionDrag ||
          state.pinch
        ) {
          stopPanMotion();
          return;
        }

        const dt =
          Math.min(
            32,
            Math.max(
              1,
              now - previous
            )
          );

        previous = now;

        state.offset.x +=
          vx * dt;

        state.offset.y +=
          vy * dt;

        const damping =
          Math.pow(
            .86,
            dt / 16.67
          );

        vx *= damping;
        vy *= damping;

        renderTransform();
        scheduleConnectionRender();

        if (
          Math.hypot(
            vx,
            vy
          ) < .035
        ) {
          stopPanMotion();

          emit(
            'viewportSettled',
            {
              scale:
                state.scale,
              offset: {
                ...state.offset
              }
            }
          );

          return;
        }

        state.panMotionFrame =
          requestAnimationFrame(
            frame
          );
      };

      state.panMotionFrame =
        requestAnimationFrame(
          frame
        );
    }
    function normalizePort(port, index, direction) {
      return {
        ...(port || {}),
        id: String(port?.id ?? `${direction}-${index}`),
        name: port?.name ?? port?.id ?? `${direction}-${index}`,
        type: port?.type || 'any',
        required: !!port?.required,
        multiple: port?.multiple !== false,
        accepts: Array.isArray(port?.accepts) && port.accepts.length
          ? [...port.accepts]
          : ['any']
      };
    }
    function normalizeDefinition(type, definition) {
      return {
        ...(definition || {}),
        name: definition?.name || type,
        color: definition?.color || '#888888',
        iconKey: typeof definition?.iconKey === 'string' ? definition.iconKey : '',
        icon: typeof definition?.icon === 'string' ? definition.icon : '',
        inputs: Array.isArray(definition?.inputs)
          ? definition.inputs.map((port, index) => normalizePort(port, index, 'input'))
          : [],
        outputs: Array.isArray(definition?.outputs)
          ? definition.outputs.map((port, index) => normalizePort(port, index, 'output'))
          : [],
        params: Array.isArray(definition?.params) ? definition.params : []
      };
    }
    function getDefinition(type) {
      return registry.get(type) || null;
    }
    function rebuildRegistry(
      options = {}
    ) {
      const resolved =
        CanvasPlugins
          .resolveDefinitions(
            baseDefinitions,
            {
              context:
                pluginContext
            }
          );

      registry.clear();

      for (
        const [
          type,
          definition
        ] of Object.entries(
          resolved
        )
      ) {
        registry.set(
          type,
          normalizeDefinition(
            type,
            definition
          )
        );
      }

      if (
        options.render !== false
      ) {
        render();
      }

      if (
        options.emit !== false
      ) {
        emit(
          'definitionsChange',
          getSkillDefinitions()
        );
      }

      return registry;
    }
    function setSkillDefinitions(nextDefinitions = {}) {
      const source =
        nextDefinitions &&
        typeof nextDefinitions === 'object' &&
        !Array.isArray(nextDefinitions)
          ? nextDefinitions
          : {};

      baseDefinitions =
        source;

      rebuildRegistry();

      return api;
    }
    function getSkillDefinitions() {
      return Object.fromEntries(
        registry.entries()
      );
    }
    function getBaseSkillDefinitions() {
      return {
        ...baseDefinitions
      };
    }
    function prepareRuntime(
      pivotId,
      options = {}
    ) {
      return CanvasPlugins
        .prepareRuntime({
          workflow:
            getWorkflow(),
          pivotId:
            String(
              pivotId || ''
            ),
          visiblePivot:
            String(
              pivotId || ''
            ),
          mode:
            options.mode ===
              'target'
              ? 'target'
              : 'spread',
          context:
            pluginContext,
          skillDefinitions:
            getSkillDefinitions(),
          baseDefinitions:
            getBaseSkillDefinitions()
        });
    }

    rebuildRegistry({
      render: false,
      emit: false
    });

    const stopPluginUpdates =
      CanvasPlugins.onChange(
        () => {
          if (
            state.destroyed
          ) {
            return;
          }

          rebuildRegistry();
        }
      );

    listeners.push(
      stopPluginUpdates
    );
    function getSkillNode(id) {
      return state.skillNodes.find(skillNode => skillNode.id === id) || null;
    }
    function getSkillNodeElement(id) {
      return [...skillNodesLayer.querySelectorAll('.vc-skill-node')].find(
        element => element.dataset.skillNodeId === String(id)
      ) || null;
    }
    function normalizeSkillNode(input) {
      return {
        id: String(
          input?.id ||
          `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
        ),
        type: String(input?.type || ''),
        x: Number(input?.x) || 0,
        y: Number(input?.y) || 0,
        expanded: !!input?.expanded,
        data: clone(input?.data || {})
      };
    }
    function legacyRequestValue(
      skillNode,
      values
    ) {
      if (
        values.request
      ) {
        return String(
          values.request
        );
      }

      const text =
        (...parts) =>
          parts
            .map(value =>
              String(value || "")
                .trim()
            )
            .filter(Boolean)
            .join(" · ");

      switch (skillNode.type) {
        case "research":
          return text(
            values.topic,
            values.filter
          );

        case "organize":
          return text(
            values.criteria,
            values.format
          );

        case "judge":
          return values.condition
            ? String(
                values.condition
              ) + "인지 판단해줘"
            : "";

        case "write":
          return text(
            values.about,
            values.title,
            values.length,
            values.style
          );

        case "convert":
          return String(
            values.instruction ||
            ""
          );

        case "createFile":
          if (
            values.filename ||
            values.format
          ) {
            return (
              text(
                values.filename,
                values.format
              ) +
              " 파일로 만들어줘"
            );
          }

          return "";

        default:
          return "";
      }
    }

    function renderSlotContent(skillNode, definition) {
      const out = [];
      const values =
        skillNode.data?.params ||
        {};

      const visibleParams =
        (definition.params || [])
          .filter(
            param =>
              param.hidden !== true
          );

      for (
        const param
        of visibleParams
      ) {
        const isRequest =
          param.kind ===
            "request" ||
          param.id ===
            "request";

        const value =
          isRequest
            ? legacyRequestValue(
                skillNode,
                values
              )
            : (
                values[param.id] ??
                ""
              );

        const maxLength =
          Math.max(
            1,
            Number(
              param.maxLength ||
              1800
            ) || 1800
          );

        if (isRequest) {
          out.push(`
            <div class="vc-request-group">
              <textarea
                class="vc-slot-param vc-request-input"
                data-param-id="${escapeHtml(param.id)}"
                data-param-kind="request"
                maxlength="${maxLength}"
                placeholder="${escapeHtml(param.placeholder || "이 노드가 할 일을 편하게 적어줘")}"
              >${escapeHtml(value)}</textarea>
            </div>
          `);

          continue;
        }

        out.push(`
          <div class="vc-param-group">
            <label class="vc-param-label">
              ${escapeHtml(param.name || param.id)}
            </label>
            <textarea
              class="vc-slot-param"
              data-param-id="${escapeHtml(param.id)}"
              maxlength="${maxLength}"
              placeholder="${escapeHtml(param.placeholder || "")}"
            >${escapeHtml(value)}</textarea>
          </div>
        `);
      }

      if (skillNode.type === 'file') {
        const mime = skillNode.data?.mime || '알 수 없는 형식';
        const size = Number(skillNode.data?.size || 0);
        const text = size < 1024
          ? `${size} B`
          : size < 1048576
            ? `${(size / 1024).toFixed(1)} KB`
            : `${(size / 1048576).toFixed(1)} MB`;
        const downloadUrl =
          String(
            skillNode.data
              ?.downloadUrl ||
            ""
          );
        const previewText =
          String(
            skillNode.data
              ?.textPreview ||
            skillNode.data
              ?.previewText ||
            ""
          )
            .trim()
            .slice(0, 900);
        const imagePreview =
          String(
            skillNode.data
              ?.imagePreview ||
            ""
          );

        out.push(`
          <div class="vc-slot-custom">
            <div class="vc-file-meta">
              <span>${escapeHtml(mime)}</span>
              <span>${escapeHtml(text)}</span>
            </div>
            ${
              imagePreview
                ? `
                  <div class="vc-file-image-preview">
                    <img
                      src="${escapeHtml(imagePreview)}"
                      alt=""
                    >
                  </div>
                `
                : previewText
                  ? `
                    <div class="vc-file-preview">
                      ${escapeHtml(previewText)}
                    </div>
                  `
                  : ''
            }
            ${
              downloadUrl
                ? `
                  <a
                    class="vc-file-download"
                    href="${escapeHtml(downloadUrl)}"
                    download="${escapeHtml(skillNode.data?.name || 'result')}"
                  >
                    <span>다운로드</span>
                    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="M9 3.2v7.3m0 0 2.65-2.65M9 10.5 6.35 7.85M4 13.5h10" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </a>
                `
                : ''
            }
          </div>
        `);
      }

      if (
        (
          definition.desc ||
          definition.description
        ) &&
        !visibleParams.some(
          param =>
            param.kind ===
              "request" ||
            param.id ===
              "request"
        )
      ) {
        out.push(`
          <div class="vc-slot-description">
            ${escapeHtml(definition.desc || definition.description || '')}
          </div>
        `);
      }

      return out.join('');
    }

    function runtimeStatusLabel(status) {
      return ({
        WAITING: '대기',
        RUNNING: '실행 중',
        SUCCESS: '완료',
        FAILED: '실패',
        SKIPPED: '건너뜀',
        STALE: '재실행 필요'
      })[
        String(status || '')
          .toUpperCase()
      ] || '실행';
    }

    function compactRuntimeReport(
      value,
      max = 88
    ) {
      let raw = "";

      if (
        typeof value ===
          'string'
      ) {
        raw = value;
      } else if (
        value &&
        typeof value ===
          'object'
      ) {
        raw =
          value.summary ||
          value.title ||
          value.message ||
          "";
      }

      raw =
        String(raw || "")
          .trim();

      if (!raw) {
        return "";
      }

      const documentLike =
        /\r|\n/.test(raw) ||
        /(^|\n)\s{0,3}#{1,6}\s/.test(raw) ||
        /(^|\n)\s*(?:[-*+]\s|\d+[.)]\s)/.test(raw) ||
        /```/.test(raw) ||
        raw.length > max;

      if (documentLike) {
        return "";
      }

      return raw
        .replace(
          /[`*_#>~\[\]]/g,
          ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim()
        .slice(
          0,
          max
        );
    }

    function runtimeSummary(
      runtimeState
    ) {
      if (
        !runtimeState ||
        typeof runtimeState !==
          'object'
      ) {
        return '';
      }

      if (
        runtimeState.status ===
          'FAILED'
      ) {
        return String(
          runtimeState.error
            ?.message ||
          '실행에 실패했습니다.'
        );
      }

      if (
        runtimeState.status ===
          'RUNNING'
      ) {
        return '오블이 이 작업을 처리하고 있어요';
      }

      if (
        runtimeState.status ===
          'SKIPPED'
      ) {
        return '앞 단계 결과 때문에 실행하지 않았어요';
      }

      const result =
        runtimeState.result || {};

      const artifact =
        result.artifact ||
        result.file;

      if (artifact?.name) {
        return `${artifact.name} 생성 완료`;
      }

      const report =
        compactRuntimeReport(
          result.report ??
          runtimeState.report
        );

      if (report) {
        return report;
      }

      return runtimeState.status ===
        'SUCCESS'
        ? '작업 완료'
        : '';
    }

    function renderRuntimeState(
      runtimeState
    ) {
      if (!runtimeState?.status) {
        return '';
      }

      const status =
        String(
          runtimeState.status
        ).toLowerCase();

      const summary =
        runtimeSummary(
          runtimeState
        );

      return `
        <div
          class="vc-runtime-result vc-runtime-${escapeHtml(status)}"
          data-action="runtime-result"
        >
          <span class="vc-runtime-dot"></span>
          <span class="vc-runtime-state-label">${escapeHtml(runtimeStatusLabel(runtimeState.status))}</span>
          ${
            summary
              ? `<span class="vc-runtime-summary">${escapeHtml(summary)}</span>`
              : ''
          }
        </div>
      `;
    }

    function renderPorts(skillNode, ports, direction) {
      const cls = direction === 'input' ? 'vc-input' : 'vc-output';
      return (ports || []).map(port => `
        <div
          class="vc-port-hit ${cls}"
          data-port-dir="${direction}"
          data-port-id="${escapeHtml(port.id)}"
          data-skill-node-id="${escapeHtml(skillNode.id)}"
        >
          <span class="vc-port-anchor">
            <span class="vc-port-pill"></span>
          </span>
          <span class="vc-port-label">${escapeHtml(port.name)}</span>
        </div>
      `).join('');
    }
    function observeSkillNode(element) {
      if (!element || !skillNodeResizeObserver) return;
      try { skillNodeResizeObserver.observe(element); } catch {}
    }
    const skillNodeResizeObserver = new ResizeObserver(entries => {
      if (state.destroyed) return;
      for (const entry of entries) {
        const skillNode = getSkillNode(entry.target?.dataset?.skillNodeId);
        if (!skillNode) continue;
        positionPorts(entry.target, getDefinition(skillNode.type));
      }
      scheduleConnectionRender();
    });
    observers.push(() => skillNodeResizeObserver.disconnect());
    function skillNodeReadyForExecution(
      skillNode,
      options = {}
    ) {
      if (!skillNode) {
        return false;
      }

      if (String(skillNode.type||'').startsWith('pointer:')) return true;

      if (skillNode.type === 'start') {
        return true;
      }

      if (skillNode.type === 'file') {
        return !!(
          skillNode.data?.generated ||
          skillNode.data?.source === 'upload' ||
          skillNode.data?.fileId ||
          (
            typeof skillNode.data?.name ===
              'string' &&
            skillNode.data.name.trim()
          )
        );
      }

      const hasParams =
        Object.values(
          skillNode.data?.params || {}
        ).some(value =>
          String(value ?? '').trim()
        );

      return (
        hasParams ||
        options.hasIncoming === true
      );
    }

    function runScopeReady(
      skillNodeId,
      mode = 'closed'
    ) {
      const startId =
        String(skillNodeId || '');

      if (!startId) {
        return false;
      }

      const executionMode = mode === 'open' || mode === 'spread' ? 'spread' : 'target';

      const scope = new Set();
      const queue = [startId];

      while (queue.length) {
        const current =
          queue.shift();

        if (
          !current ||
          scope.has(current)
        ) {
          continue;
        }

        scope.add(current);

        for (
          const connection
          of state.connections
        ) {
          if (
            connection.to.skillNode ===
              current
          ) {
            queue.push(
              connection.from.skillNode
            );
          }

          if (
            executionMode ===
              'spread' &&
            connection.from.skillNode ===
              current
          ) {
            queue.push(
              connection.to.skillNode
            );
          }
        }
      }

      for (const id of scope) {
        const hasIncoming =
          state.connections.some(
            connection =>
              connection.to.skillNode ===
                id &&
              scope.has(
                connection.from.skillNode
              )
          );

        if (
          !skillNodeReadyForExecution(
            getSkillNode(id),
            {
              hasIncoming
            }
          )
        ) {
          return false;
        }
      }

      return true;
    }

    function syncRunButtonStates() {
      for (
        const element
        of skillNodesLayer.querySelectorAll(
          '.vc-skill-node'
        )
      ) {
        const skillNode =
          getSkillNode(
            element.dataset.skillNodeId
          );

        const button =
          element.querySelector(
            '.vc-skill-node-run'
          );

        if (!skillNode || !button) {
          continue;
        }

        const cancelling =
          state.runLocked &&
          state.runPivot === skillNode.id;

        const disabled =
          !cancelling &&
          (
            state.runLocked ||
            !runScopeReady(skillNode.id)
          );

        button.disabled =
          disabled;

        button.setAttribute(
          'aria-disabled',
          String(disabled)
        );

        button.classList.toggle(
          'is-disabled',
          disabled
        );
      }
    }

    function renderSkillNodes() {
      skillNodesLayer.textContent = '';
      for (const skillNode of state.skillNodes) {
        const definition = getDefinition(skillNode.type);
        if (!definition) continue;
        const element = document.createElement('div');
        const runtimeState =
          state.runtimeSkillNodes.get(skillNode.id) || null;
        const classes = ['vc-skill-node'];

        if (
          state.enteringSkillNodes.has(
            skillNode.id
          )
        ) {
          classes.push(
            'vc-entering'
          );
        }
        if (skillNode.type === 'file') classes.push('vc-file-skillNode');
        if (skillNode.id === state.selectedSkillNode) classes.push('vc-selected');
        if (skillNode.expanded) classes.push('vc-expanded');
        if (runtimeState?.status) {
          classes.push(
            `vc-runtime-${String(runtimeState.status).toLowerCase()}`
          );
        }
        element.className = classes.join(' ');
        element.dataset.skillNodeId = skillNode.id;
        if (
          skillNode.type === 'file' &&
          skillNode.data?.generated
        ) {
          element.dataset.generated =
            'true';
        }
        element.style.left = `${skillNode.x}px`;
        element.style.top = `${skillNode.y}px`;
        element.style.setProperty('--skill-node-color', definition.color);
        const fileName = skillNode.type === 'file'
          ? skillNode.data?.name || '이름 없는 파일'
          : definition.name;
        const extension =
          skillNode.type === 'file' && fileName.includes('.')
            ? fileName.split('.').pop().toUpperCase()
            : 'FILE';
        const skillNodeIcon =
          skillNode.type === 'file' &&
          skillNode.data?.generated
            ? icons.fileResult
            : global.OvllSvgLibrary?.get?.(definition.iconKey) || definition.icon || '';
        element.innerHTML = `
          <div class="vc-skill-node-head">
            <span class="vc-skill-node-icon">${skillNodeIcon}</span>
            ${
              skillNode.type === 'file'
                ? `
                  <span class="vc-file-title-wrap">
                    <span
                      class="vc-file-title"
                      title="${escapeHtml(fileName)}"
                    >
                      ${escapeHtml(fileName)}
                    </span>
                    <span class="vc-file-type">
                      ${escapeHtml(extension)}
                    </span>
                  </span>
                `
                : `
                  <span class="vc-skill-node-title">
                    ${escapeHtml(definition.name)}
                  </span>
                `
            }
            <div class="vc-skill-node-actions">
              <button
                type="button"
                class="vc-skill-node-action vc-skill-node-toggle"
                data-action="toggle"
                aria-expanded="${String(!!skillNode.expanded)}"
                aria-label="상세 내용 ${skillNode.expanded ? '닫기' : '열기'}"
              >
                ${icons.toggle}
              </button>
            </div>
          </div>
          <div class="vc-skill-node-body">
            ${renderSlotContent(skillNode, definition)}
            ${renderRuntimeState(runtimeState)}
          </div>
          <div class="vc-skill-node-footer">
            ${
              skillNode.type === 'file' &&
              skillNode.data?.generated
                ? ''
                : `
                  <button
                    type="button"
                    class="vc-skill-node-run${state.runLocked && state.runPivot === skillNode.id ? ' is-cancel' : state.runLocked || runtimeState?.status === 'RUNNING' ? ' is-running' : ''}${!state.runLocked && !runScopeReady(skillNode.id) ? ' is-disabled' : ''}"
                    data-action="${state.runLocked && state.runPivot === skillNode.id ? 'cancel-run' : 'run'}"
                    aria-label="${state.runLocked && state.runPivot === skillNode.id ? '실행 중단' : !runScopeReady(skillNode.id) ? '실행할 내용 필요' : '이 노드부터 실행'}"
                    aria-disabled="${state.runLocked && state.runPivot !== skillNode.id || !state.runLocked && !runScopeReady(skillNode.id) ? 'true' : 'false'}"
                    ${state.runLocked && state.runPivot !== skillNode.id || !state.runLocked && !runScopeReady(skillNode.id) ? 'disabled' : ''}
                  >
                    ${state.runLocked && state.runPivot === skillNode.id ? icons.stop : icons.run}
                    <span>${state.runLocked && state.runPivot === skillNode.id ? '중단하기' : '실행하기'}</span>
                  </button>
                `
            }
            <button
              type="button"
              class="vc-skill-node-delete"
              data-action="delete"
              aria-label="노드 삭제"
            >
              ${icons.delete}
              <span>삭제하기</span>
            </button>
          </div>
          ${renderPorts(skillNode, definition.inputs, 'input')}
          ${renderPorts(skillNode, definition.outputs, 'output')}
        `;
        // Apply the same icon stroke contract as composer mentions and
        // the add-skillNode palette without rewriting server-provided SVG markup.
        element.querySelector('.vc-skill-node-icon svg')?.classList.add('svg-icon');
        skillNodesLayer.appendChild(element);
        observeSkillNode(element);
        setSkillNodeExpanded(skillNode, skillNode.expanded, true);
        positionPorts(element, definition);

        if (
          state.enteringSkillNodes.has(
            skillNode.id
          )
        ) {
          requestAnimationFrame(
            () => {
              if (
                !element.isConnected
              ) {
                return;
              }

              element.classList.add(
                'vc-entered'
              );

              setTimeout(
                () => {
                  state.enteringSkillNodes.delete(
                    skillNode.id
                  );

                  element.classList.remove(
                    'vc-entering',
                    'vc-entered'
                  );
                },
                360
              );
            }
          );
        }
      }
      markConnectedPorts();
      renderConnections();
    }
    function positionPorts(element, definition) {
      if (!element || !definition) return;
      const height = Math.max(50, element.offsetHeight || 74);
      function place(selector, ports) {
        [...element.querySelectorAll(selector)].forEach((port, index) => {
          const y =
            ((index + 1) / Math.max(1, ports.length + 1)) *
            height;
          port.style.height = '32px';
          port.style.top = `${y - 16}px`;
        });
      }
      place('.vc-port-hit.vc-input', definition.inputs || []);
      place('.vc-port-hit.vc-output', definition.outputs || []);
    }
    function getPortElement(skillNodeId, portId, direction) {
      return [...skillNodesLayer.querySelectorAll('.vc-port-hit')].find(
        element =>
          element.dataset.skillNodeId === String(skillNodeId) &&
          element.dataset.portId === String(portId) &&
          element.dataset.portDir === direction
      ) || null;
    }
    function portPoint(skillNodeId, portId, direction) {
      const skillNode = getSkillNode(skillNodeId);
      const element = getSkillNodeElement(skillNodeId);
      const definition = getDefinition(skillNode?.type);
      if (!skillNode || !element || !definition) return null;
      const ports =
        direction === 'input'
          ? definition.inputs || []
          : definition.outputs || [];
      const index = ports.findIndex(
        port => String(port.id) === String(portId)
      );
      if (index < 0) return null;
      const portElement = getPortElement(skillNodeId, portId, direction);
      if (!portElement) return null;

      /*
       * Connections live inside the same transformed world as the skillNodes.
       * Keep their endpoints in world/layout coordinates too. Reading
       * getBoundingClientRect() here mixes transient visual-viewport/page
       * transforms into the connection geometry while the mobile keyboard
       * is opening or closing, which can leave only the SVG shifted.
       */
      return {
        x:
          element.offsetLeft +
          (
            direction === 'input'
              ? 0
              : element.offsetWidth
          ),
        y:
          element.offsetTop +
          portElement.offsetTop +
          portElement.offsetHeight / 2
      };
    }
    function markConnectedPorts() {
      skillNodesLayer
        .querySelectorAll('.vc-port-pill.vc-connected')
        .forEach(element => element.classList.remove('vc-connected'));
      for (const connection of state.connections) {
        getPortElement(
          connection.from.skillNode,
          connection.from.port,
          'output'
        )?.querySelector('.vc-port-pill')?.classList.add('vc-connected');
        getPortElement(
          connection.to.skillNode,
          connection.to.port,
          'input'
        )?.querySelector('.vc-port-pill')?.classList.add('vc-connected');
      }
    }
    function removeConnectionElement(id) {
      const element = connectionElements.get(id);
      if (!element) return;
      element.remove();
      connectionElements.delete(id);
    }
    function renderConnections() {
      if (state.destroyed) return;
      const activeIds = new Set();
      for (const connection of state.connections) {
        const from = portPoint(
          connection.from.skillNode,
          connection.from.port,
          'output'
        );
        const to = portPoint(
          connection.to.skillNode,
          connection.to.port,
          'input'
        );
        if (!from || !to) continue;
        activeIds.add(connection.id);
        let path = connectionElements.get(connection.id);
        if (!path) {
          path = svgEl('path');
          path.classList.add('vc-connection');
          path.dataset.connectionId = connection.id;
          path.style.pointerEvents = 'stroke';
          connectionLayer.appendChild(path);
          connectionElements.set(connection.id, path);
        }
        path.setAttribute('d', pathFor(from, to));
        const active =
          state.selectedSkillNode === connection.from.skillNode ||
          state.selectedSkillNode === connection.to.skillNode;
        const runtimeActive =
          state.runtimeConnections.has(
            String(connection.id)
          );

        path.classList.toggle(
          'vc-active',
          active
        );

        path.classList.toggle(
          'vc-runtime-active',
          runtimeActive
        );


      }
      for (const [id] of connectionElements) {
        if (!activeIds.has(id)) removeConnectionElement(id);
      }
      renderDragConnection();
    }
    function renderDragConnection() {
      dragLayer.textContent = '';
      const drag = state.connectionDrag;
      if (!drag) return;

      if (drag.direction === 'output') {
        const to =
          screenToWorld(
            drag.x,
            drag.y
          );

        const anchors =
          Array.isArray(
            drag.anchors
          ) &&
          drag.anchors.length
            ? drag.anchors
            : [
                drag.anchor
              ];

        for (
          const anchor
          of anchors
        ) {
          const from =
            portPoint(
              anchor.skillNode,
              anchor.port,
              'output'
            );

          if (!from || !to) {
            continue;
          }

          const path =
            svgEl(
              'path',
              {
                d:
                  pathFor(
                    from,
                    to
                  )
              }
            );

          path.classList.add(
            'vc-drag-connection'
          );

          path.style.pointerEvents =
            'none';

          dragLayer.appendChild(
            path
          );

          const dot =
            svgEl(
              'circle',
              {
                cx: from.x,
                cy: from.y,
                r: 4
              }
            );

          dot.classList.add(
            'vc-drag-source-dot'
          );

          dot.style.pointerEvents =
            'none';

          dragLayer.appendChild(
            dot
          );
        }

        return;
      }

      const from =
        screenToWorld(
          drag.x,
          drag.y
        );

      const to =
        portPoint(
          drag.anchor.skillNode,
          drag.anchor.port,
          'input'
        );

      if (!from || !to) {
        return;
      }

      const path =
        svgEl(
          'path',
          {
            d:
              pathFor(
                from,
                to
              )
          }
        );

      path.classList.add(
        'vc-drag-connection'
      );

      path.style.pointerEvents =
        'none';

      dragLayer.appendChild(
        path
      );

      const dot =
        svgEl(
          'circle',
          {
            cx: to.x,
            cy: to.y,
            r: 4
          }
        );

      dot.classList.add(
        'vc-drag-source-dot'
      );

      dot.style.pointerEvents =
        'none';

      dragLayer.appendChild(
        dot
      );
    }
    function screenToWorld(clientX, clientY) {
      const rect = viewport.getBoundingClientRect();
      return {
        x: (clientX - rect.left - state.offset.x) / state.scale,
        y: (clientY - rect.top - state.offset.y) / state.scale
      };
    }
    function renderTransform() {
      world.style.transform =
        `translate(${state.offset.x}px,${state.offset.y}px) scale(${state.scale})`;
      emit('viewport', {
        scale: state.scale,
        offset: { ...state.offset }
      });
    }
    function centerWorkflow() {
      if (!state.skillNodes.length) return;
      const rect = viewport.getBoundingClientRect();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const skillNode of state.skillNodes) {
        const element = getSkillNodeElement(skillNode.id);
        const width = element?.offsetWidth || 190;
        const height = element?.offsetHeight || 74;
        minX = Math.min(minX, skillNode.x);
        minY = Math.min(minY, skillNode.y);
        maxX = Math.max(maxX, skillNode.x + width);
        maxY = Math.max(maxY, skillNode.y + height);
      }
      state.offset.x =
        rect.width / 2 -
        ((minX + maxX) / 2) * state.scale;
      state.offset.y =
        rect.height / 2 -
        ((minY + maxY) / 2) * state.scale -
        60;
      renderTransform();
      renderConnections();
    }
    function setSkillNodeExpanded(skillNode, expanded, immediate = false) {
      const element = getSkillNodeElement(skillNode.id);
      if (!element) return;
      const body = element.querySelector('.vc-skill-node-body');
      const toggle = element.querySelector('.vc-skill-node-toggle');
      skillNode.expanded = !!expanded;
      element.classList.toggle('vc-expanded', skillNode.expanded);
      emit('skillNodeExpand', {
        id: skillNode.id,
        expanded: skillNode.expanded
      });
      toggle?.setAttribute('aria-expanded', String(skillNode.expanded));
      toggle?.setAttribute(
        'aria-label',
        `상세 내용 ${skillNode.expanded ? '닫기' : '열기'}`
      );
      if (!body) {
        scheduleConnectionRender();
        return;
      }
      if (immediate) {
        body.style.transition = 'none';
        body.style.height = skillNode.expanded ? 'auto' : '0px';
        positionPorts(element, getDefinition(skillNode.type));
        requestAnimationFrame(() => {
          body.style.transition = '';
          positionPorts(element, getDefinition(skillNode.type));
          renderConnections();
        });
        return;
      }
      if (skillNode.expanded) {
        body.style.height = '0px';
        requestAnimationFrame(() => {
          if (!body) return;
          body.style.height = `${body.scrollHeight}px`;
          trackExpansion(element, body);
        });
        return;
      }
      body.style.height = `${body.scrollHeight}px`;
      requestAnimationFrame(() => {
        body.style.height = '0px';
        trackExpansion(element, body);
      });
    }
    function trackExpansion(element, body) {
      let active = true;
      let frame = null;
      const started = performance.now();
      const duration = 340;
      function tick() {
        if (!active) return;
        positionPorts(
          element,
          getDefinition(
            getSkillNode(element.dataset.skillNodeId)?.type
          )
        );
        renderConnections();
        if (performance.now() - started < duration) {
          frame = requestAnimationFrame(tick);
        } else {
          active = false;
          if (frame !== null) cancelAnimationFrame(frame);
        }
      }
      frame = requestAnimationFrame(tick);
    }
    function selectSkillNode(id) {
      if (id !== null && !getSkillNode(id)) id = null;
      state.selectedSkillNode = id;
      skillNodesLayer
        .querySelectorAll('.vc-skill-node')
        .forEach(element =>
          element.classList.toggle(
            'vc-selected',
            element.dataset.skillNodeId === id
          )
        );
      renderConnections();
      emit('select', id);
    }
    function toggleSkillNodeExpanded(id) {
      const skillNode = getSkillNode(id);
      if (!skillNode) return;
      setSkillNodeExpanded(skillNode, !skillNode.expanded);
      selectSkillNode(id);
      emit('change', getWorkflow());
    }
    function portDef(skillNodeId, portId, direction) {
      const definition = getDefinition(
        getSkillNode(skillNodeId)?.type
      );
      if (!definition) return null;
      const ports =
        direction === 'input'
          ? definition.inputs
          : definition.outputs;
      return ports.find(
        port => String(port.id) === String(portId)
      ) || null;
    }
    function compatible(output, input) {
      const accepts = Array.isArray(input?.accepts)
        ? input.accepts
        : ['any'];
      return !!output &&
        !!input &&
        (
          accepts.includes('any') ||
          accepts.includes(output.type) ||
          output.type === 'any' ||
          (input.type === 'json' &&
            ['text','structured_text','document','boolean','number','object','array']
              .includes(output.type)) ||
          (output.type === 'json' &&
            ['text','structured_text','document','boolean','number','object','array']
              .includes(input.type))
        );
    }
    function wouldCycle(fromId, toId) {
      if (fromId === toId) return true;
      const graph = new Map();
      for (const connection of state.connections) {
        if (!graph.has(connection.from.skillNode)) {
          graph.set(connection.from.skillNode, []);
        }
        graph
          .get(connection.from.skillNode)
          .push(connection.to.skillNode);
      }
      const stack = [toId];
      const seen = new Set();
      while (stack.length) {
        const current = stack.pop();
        if (current === fromId) return true;
        if (seen.has(current)) continue;
        seen.add(current);
        for (const next of graph.get(current) || []) {
          stack.push(next);
        }
      }
      return false;
    }
    function connectionValid(
      fromSkillNodeId,
      fromPortId,
      toSkillNodeId,
      toPortId
    ) {
      const errors = [];
      const source = getSkillNode(fromSkillNodeId);
      const target = getSkillNode(toSkillNodeId);
      const output = portDef(
        fromSkillNodeId,
        fromPortId,
        'output'
      );
      const input = portDef(
        toSkillNodeId,
        toPortId,
        'input'
      );
      if (fromSkillNodeId === toSkillNodeId) {
        errors.push({
          code: 'SELF_CONNECTION',
          message: '노드는 자기 자신에게 연결할 수 없습니다.'
        });
      }
      if (!source) {
        errors.push({
          code: 'MISSING_SOURCE_SKILL_NODE',
          message: `출발 노드 ${fromSkillNodeId}가 존재하지 않습니다.`
        });
      }
      if (!target) {
        errors.push({
          code: 'MISSING_TARGET_SKILL_NODE',
          message: `도착 노드 ${toSkillNodeId}가 존재하지 않습니다.`
        });
      }
      if (!output) {
        errors.push({
          code: 'MISSING_SOURCE_PORT',
          message: `출력 포트 ${fromPortId}가 존재하지 않습니다.`
        });
      }
      if (!input) {
        errors.push({
          code: 'MISSING_TARGET_PORT',
          message: `입력 포트 ${toPortId}가 존재하지 않습니다.`
        });
      }
      if (errors.length) {
        return { ok: false, errors };
      }
      if (
        !input.multiple &&
        state.connections.some(
          connection =>
            connection.to.skillNode === toSkillNodeId &&
            connection.to.port === toPortId
        )
      ) {
        errors.push({
          code: 'INPUT_MULTIPLE',
          message: `입력 포트 ${input.name}은 하나의 연결만 허용합니다.`
        });
      }
      if (!compatible(output, input)) {
        errors.push({
          code: 'TYPE_MISMATCH',
          message: `${output.type} → ${input.type} 타입을 연결할 수 없습니다.`
        });
      }
      if (wouldCycle(fromSkillNodeId, toSkillNodeId)) {
        errors.push({
          code: 'CYCLE',
          message: '이 연결은 순환 구조(Cycle)를 만듭니다.'
        });
      }
      return {
        ok: errors.length === 0,
        errors
      };
    }
    function canConnect(specification) {
      const result = connectionValid(
        specification.from.skillNode,
        specification.from.port,
        specification.to.skillNode,
        specification.to.port
      );
      emit('validate', result);
      return result;
    }
    function uniqueConnectionId() {
      let id;
      do {
        id =
          `c-${Date.now().toString(36)}` +
          Math.random().toString(36).slice(2, 8);
      } while (
        state.connections.some(
          connection => connection.id === id
        )
      );
      return id;
    }
    function sameConnection(a, b) {
      return (
        a.from.skillNode === b.from.skillNode &&
        a.from.port === b.from.port &&
        a.to.skillNode === b.to.skillNode &&
        a.to.port === b.to.port
      );
    }
    function connect(from, to, options = {}) {
      const specification = {
        from: {
          skillNode: String(from.skillNode),
          port: String(from.port)
        },
        to: {
          skillNode: String(to.skillNode),
          port: String(to.port)
        }
      };
      const duplicate = state.connections.find(
        connection =>
          sameConnection(
            connection,
            specification
          )
      );
      if (duplicate) {
        if (
          options.toggleDuplicate !==
          false
        ) {
          disconnect(
            duplicate.id
          );
        }

        return null;
      }
      const result = canConnect(specification);
      if (!result.ok) {
        emit('connectionRejected', result);
        return null;
      }
      const connection = {
        id: uniqueConnectionId(),
        from: specification.from,
        to: specification.to
      };
      if (options.data) connection.data = clone(options.data);
      state.connections.push(connection);
      markConnectedPorts();
      renderConnections();
      emit('connect', clone(connection));
      emit('change', getWorkflow());
      return connection;
    }
    function toggleConnection(
      from,
      to
    ) {
      const specification = {
        from: {
          skillNode: String(from.skillNode),
          port: String(from.port)
        },
        to: {
          skillNode: String(to.skillNode),
          port: String(to.port)
        }
      };

      const duplicate =
        state.connections.find(
          connection =>
            sameConnection(
              connection,
              specification
            )
        );

      if (duplicate) {
        return {
          changed:
            disconnect(
              duplicate.id
            ),
          connected:
            false
        };
      }

      const created =
        connect(
          specification.from,
          specification.to,
          {
            toggleDuplicate:
              false
          }
        );

      return {
        changed:
          !!created,
        connected:
          !!created
      };
    }

    function disconnect(id) {
      const index = state.connections.findIndex(
        connection => connection.id === id
      );
      if (index < 0) return false;
      state.connections.splice(index, 1);
      removeConnectionElement(id);
      markConnectedPorts();
      renderConnections();
      emit('disconnect', id);
      emit('change', getWorkflow());
      return true;
    }

    function softDisconnectPort(
      endpointValue,
      direction
    ) {
      const ids =
        state.connections
          .filter(
            connection =>
              direction === 'input'
                ? (
                    connection.to.skillNode ===
                      endpointValue.skillNode &&
                    connection.to.port ===
                      endpointValue.port
                  )
                : (
                    connection.from.skillNode ===
                      endpointValue.skillNode &&
                    connection.from.port ===
                      endpointValue.port
                  )
          )
          .map(
            connection =>
              connection.id
          );

      if (!ids.length) {
        return false;
      }

      const idSet =
        new Set(ids);

      for (const id of ids) {
        connectionElements
          .get(id)
          ?.classList
          .add(
            'vc-removing'
          );
      }

      const timer =
        setTimeout(
          () => {
            state.connectionRemovalTimers
              .delete(timer);

            state.connections =
              state.connections
                .filter(
                  connection =>
                    !idSet.has(
                      connection.id
                    )
                );

            for (const id of ids) {
              removeConnectionElement(
                id
              );

              emit(
                'disconnect',
                id
              );
            }

            markConnectedPorts();
            renderConnections();

            emit(
              'change',
              getWorkflow()
            );
          },
          140
        );

      state.connectionRemovalTimers
        .add(timer);

      return true;
    }

    function registerPortTap(
      endpointValue,
      direction
    ) {
      const now =
        performance.now();

      const key =
        [
          direction,
          endpointValue.skillNode,
          endpointValue.port
        ].join(':');

      const repeated =
        state.portTap.key ===
          key &&
        now - state.portTap.at <=
          340;

      if (repeated) {
        state.portTap.key = "";
        state.portTap.at = 0;

        return softDisconnectPort(
          endpointValue,
          direction
        );
      }

      state.portTap.key =
        key;
      state.portTap.at =
        now;

      return false;
    }
    function validate() {
      const errors = [];
      const warnings = [];
      const ids = new Set();
      for (const skillNode of state.skillNodes) {
        if (ids.has(skillNode.id)) {
          errors.push({
            code: 'DUPLICATE_SKILL_NODE_ID',
            message: `노드 ID ${skillNode.id}가 중복됩니다.`
          });
        }
        ids.add(skillNode.id);
        if (!registry.has(skillNode.type)) {
          errors.push({
            code: 'UNKNOWN_SKILL_NODE_TYPE',
            message: `노드 타입 ${skillNode.type}이 등록되어 있지 않습니다.`
          });
        }
      }
      const graph = new Map();
      for (const connection of state.connections) {
        const output = portDef(
          connection.from.skillNode,
          connection.from.port,
          'output'
        );
        const input = portDef(
          connection.to.skillNode,
          connection.to.port,
          'input'
        );
        if (!getSkillNode(connection.from.skillNode)) {
          errors.push({
            code: 'MISSING_SOURCE_SKILL_NODE',
            message: `연결 ${connection.id}의 출발 노드가 없습니다.`
          });
        }
        if (!getSkillNode(connection.to.skillNode)) {
          errors.push({
            code: 'MISSING_TARGET_SKILL_NODE',
            message: `연결 ${connection.id}의 도착 노드가 없습니다.`
          });
        }
        if (!output) {
          errors.push({
            code: 'MISSING_SOURCE_PORT',
            message: `연결 ${connection.id}의 출력 포트가 없습니다.`
          });
        }
        if (!input) {
          errors.push({
            code: 'MISSING_TARGET_PORT',
            message: `연결 ${connection.id}의 입력 포트가 없습니다.`
          });
        }
        if (
          output &&
          input &&
          !compatible(output, input)
        ) {
          errors.push({
            code: 'TYPE_MISMATCH',
            message: `${output.type} → ${input.type} 타입이 호환되지 않습니다.`
          });
        }
        if (!graph.has(connection.from.skillNode)) {
          graph.set(connection.from.skillNode, []);
        }
        graph
          .get(connection.from.skillNode)
          .push(connection.to.skillNode);
      }
      const visiting = new Set();
      const visited = new Set();
      function dfs(id) {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        for (const next of graph.get(id) || []) {
          if (dfs(next)) return true;
        }
        visiting.delete(id);
        visited.add(id);
        return false;
      }
      for (const skillNode of state.skillNodes) {
        if (
          !visited.has(skillNode.id) &&
          dfs(skillNode.id)
        ) {
          errors.push({
            code: 'CYCLE',
            message: '워크플로우에 순환 구조(Cycle)가 존재합니다.'
          });
          break;
        }
      }
      const connected = new Set();
      for (const connection of state.connections) {
        connected.add(connection.from.skillNode);
        connected.add(connection.to.skillNode);
      }
      for (const skillNode of state.skillNodes) {
        if (!connected.has(skillNode.id)) {
          warnings.push({
            code: 'ISOLATED_SKILL_NODE',
            skillNode: skillNode.id,
            message:
              `노드 '${getDefinition(skillNode.type)?.name || skillNode.type}'가 연결되지 않았습니다.`
          });
        }
      }
      const result = {
        valid: errors.length === 0,
        errors,
        warnings
      };
      emit('validate', result);
      return result;
    }
    function getWorkflow() {
      return {
        skillNodes: clone(state.skillNodes),
        connections: clone(state.connections)
      };
    }
    function getWorkflowIR() {
      return {
        skillNodes: state.skillNodes.map(skillNode => {
          const item = {
            id: skillNode.id,
            type: skillNode.type,
            params: clone(skillNode.data?.params || {})
          };

          if (skillNode.type === 'file') {
            item.file = {
              source:
                skillNode.data?.generated
                  ? 'generated'
                  : 'upload',
              name:
                String(
                  skillNode.data?.name ||
                  '파일'
                ).slice(0, 240),
              mime:
                String(
                  skillNode.data?.mime ||
                  'application/octet-stream'
                ).slice(0, 160),
              size:
                Math.max(
                  0,
                  Number(
                    skillNode.data?.size ||
                    0
                  ) || 0
                ),
              lastModified:
                Math.max(
                  0,
                  Number(
                    skillNode.data?.lastModified ||
                    0
                  ) || 0
                )
            };

            if (
              typeof skillNode.data?.textPreview ===
                'string' &&
              skillNode.data.textPreview
            ) {
              item.file.textPreview =
                skillNode.data.textPreview.slice(
                  0,
                  12000
                );
              item.file.textTruncated =
                skillNode.data?.textTruncated ===
                  true;
            }
          }

          return item;
        }),
        links: state.connections
          .filter(
            connection =>
              connection.data?.kind !== 'data'
          )
          .map(connection => [
            `${connection.from.skillNode}.${connection.from.port}`,
            `${connection.to.skillNode}.${connection.to.port}`
          ]),
        data: state.connections
          .filter(
            connection =>
              connection.data?.kind === 'data'
          )
          .map(connection => [
            `${connection.from.skillNode}.${connection.from.port}`,
            `${connection.to.skillNode}.${connection.to.port}`
          ])
      };
    }
    function convertEdges(edges, kind) {
      return (
        Array.isArray(edges)
          ? edges
          : []
      )
        .map(edge => {
          try {
            const from = endpoint(edge[0]);
            const to = endpoint(edge[1]);
            return {
              id:
                `c-${Math.random().toString(36).slice(2, 9)}`,
              from,
              to,
              data: { kind }
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
    function setState(saved = {}) {
      const workflow = saved.workflow || saved;
      state.skillNodes =
        Array.isArray(workflow?.skillNodes)
          ? workflow.skillNodes
              .map(normalizeSkillNode)
              .filter(skillNode => registry.has(skillNode.type))
          : [];
      state.connections =
        Array.isArray(workflow?.connections)
          ? clone(workflow.connections)
          : [
              ...convertEdges(workflow?.links, 'flow'),
              ...convertEdges(workflow?.data, 'data')
            ];
      state.connections = state.connections
        .map(connection => ({
          id: String(
            connection.id ||
            `c-${Math.random().toString(36).slice(2, 8)}`
          ),
          from: {
            skillNode: String(connection.from?.skillNode || ''),
            port: String(connection.from?.port || '')
          },
          to: {
            skillNode: String(connection.to?.skillNode || ''),
            port: String(connection.to?.port || '')
          },
          ...(connection.data
            ? { data: clone(connection.data) }
            : {})
        }))
        .filter(
          connection =>
            getSkillNode(connection.from.skillNode) &&
            getSkillNode(connection.to.skillNode)
        );
      if (saved.viewport) {
        state.scale = clamp(
          Number(saved.viewport.scale) || 1,
          MIN_SCALE,
          MAX_SCALE
        );
        state.offset = {
          x: Number(saved.viewport?.offset?.x) || 0,
          y: Number(saved.viewport?.offset?.y) || 0
        };
      }
      state.selectedSkillNode = null;
      render();
      emit('change', getWorkflow());
      return api;
    }
    function applyWorkflowIR(spec, options = {}) {
  if (
    !spec ||
    typeof spec !== 'object' ||
    !Array.isArray(spec.skillNodes)
  ) {
    throw new Error('workflow spec가 올바르지 않습니다.');
  }

  const previousSkillNodes = new Map(
    state.skillNodes.map(skillNode => [skillNode.id, skillNode])
  );

  const previousSkillNodeCount = previousSkillNodes.size;

  const seenSkillNodeIds = new Set();

  const nextSkillNodes = spec.skillNodes.map((skillNode, index) => {
    if (
      !skillNode ||
      typeof skillNode !== 'object' ||
      Array.isArray(skillNode)
    ) {
      throw new Error(`잘못된 노드입니다: ${index}`);
    }

    if (
      typeof skillNode.id !== 'string' ||
      !skillNode.id.trim()
    ) {
      throw new Error(`노드 ID가 올바르지 않습니다: ${index}`);
    }

    const id = skillNode.id.trim();

    if (seenSkillNodeIds.has(id)) {
      throw new Error(`중복된 노드 ID: ${id}`);
    }

    seenSkillNodeIds.add(id);

    if (
      typeof skillNode.type !== 'string' ||
      !registry.has(skillNode.type)
    ) {
      throw new Error(`존재하지 않는 노드 타입: ${skillNode.type}`);
    }

    const previous =
      previousSkillNodes.get(id);

    const hasPosition =
      Number.isFinite(Number(skillNode.x)) &&
      Number.isFinite(Number(skillNode.y));

    const previousData =
      previous?.data &&
      typeof previous.data === 'object'
        ? clone(previous.data)
        : {};

    const incomingData =
      skillNode.data &&
      typeof skillNode.data === 'object'
        ? clone(skillNode.data)
        : {};

    const params =
      skillNode.params &&
      typeof skillNode.params === 'object' &&
      !Array.isArray(skillNode.params)
        ? clone(skillNode.params)
        : previousData.params &&
          typeof previousData.params === 'object'
          ? clone(previousData.params)
          : {};

    return normalizeSkillNode({
      id,
      type: skillNode.type,
      x: hasPosition
        ? Number(skillNode.x)
        : previous?.x ?? 0,
      y: hasPosition
        ? Number(skillNode.y)
        : previous?.y ?? 0,
      expanded:
        skillNode.expanded !== undefined
          ? !!skillNode.expanded
          : previous?.expanded ??
            (options.expanded ?? true),
      data: {
        ...previousData,
        ...incomingData,
        params
      }
    });
  });

  const nextSkillNodeMap = new Map(
    nextSkillNodes.map(skillNode => [skillNode.id, skillNode])
  );

  function buildConnections(edges, kind) {
    if (edges === undefined) {
      return [];
    }

    if (!Array.isArray(edges)) {
      throw new Error(
        `${kind} 연결이 배열이 아닙니다.`
      );
    }

    const seen = new Set();
    const result = [];

    for (
      const edge of edges
    ) {
      if (
        !Array.isArray(edge) ||
        edge.length !== 2
      ) {
        throw new Error(
          `잘못된 ${kind} 연결입니다.`
        );
      }

      const from =
        endpoint(edge[0]);

      const to =
        endpoint(edge[1]);

      const fromSkillNode =
        nextSkillNodeMap.get(from.skillNode);

      const toSkillNode =
        nextSkillNodeMap.get(to.skillNode);

      if (!fromSkillNode) {
        throw new Error(
          `${kind}: 출발 노드가 없습니다: ${from.skillNode}`
        );
      }

      if (!toSkillNode) {
        throw new Error(
          `${kind}: 도착 노드가 없습니다: ${to.skillNode}`
        );
      }

      const output =
        (getDefinition(fromSkillNode.type)?.outputs || [])
          .find(port => String(port.id) === String(from.port));

      const input =
        (getDefinition(toSkillNode.type)?.inputs || [])
          .find(port => String(port.id) === String(to.port));

      if (!output) {
        throw new Error(
          `${kind}: ${fromSkillNode.type}.${from.port}는 존재하지 않는 출력 포트입니다.`
        );
      }

      if (!input) {
        throw new Error(
          `${kind}: ${toSkillNode.type}.${to.port}는 존재하지 않는 입력 포트입니다.`
        );
      }

      if (
        kind === 'data' &&
        !compatible(
          output,
          input
        )
      ) {
        throw new Error(
          `${kind}: ${output.type} → ${input.type} 타입이 호환되지 않습니다.`
        );
      }

      const key =
        `${edge[0]}->${edge[1]}`;

      if (seen.has(key)) {
        throw new Error(
          `${kind}: 중복된 연결입니다: ${key}`
        );
      }

      seen.add(key);

      result.push({
        id:
          `c-${Math.random().toString(36).slice(2, 9)}`,
        from,
        to,
        data: { kind }
      });
    }

    return result;
  }

  const serializedEdges = (edges, kind) => {
    if (edges !== undefined || !Array.isArray(spec.connections)) return edges;
    return spec.connections
      .filter(connection => (connection?.data?.kind === 'data' ? 'data' : 'flow') === kind)
      .map(connection => [
        `${connection.from?.skillNode}.${connection.from?.port}`,
        `${connection.to?.skillNode}.${connection.to?.port}`
      ]);
  };
  const connections = [
    ...buildConnections(
      serializedEdges(spec.links, 'flow'),
      'links'
    ),
    ...buildConnections(
      serializedEdges(spec.data, 'data'),
      'data'
    )
  ];

  // The IR arrays remain the authoritative topology. Projection metadata is
  // matched by both endpoints and channel; layout-only IR preserves prior IDs.
  const connectionKey = connection => JSON.stringify([
    connection.data?.kind === 'data' ? 'data' : 'flow',
    connection.from?.skillNode, connection.from?.port,
    connection.to?.skillNode, connection.to?.port
  ]);
  const connectionMetadata = new Map(
    state.connections.map(connection => [connectionKey(connection), connection])
  );
  if (spec.connections !== undefined) {
    if (!Array.isArray(spec.connections)) throw new Error('연결 메타데이터가 배열이 아닙니다.');
    for (const connection of spec.connections) {
      if (!connection || typeof connection !== 'object') throw new Error('연결 메타데이터가 올바르지 않습니다.');
      connectionMetadata.set(connectionKey(connection), connection);
    }
  }
  for (const connection of connections) {
    const metadata = connectionMetadata.get(connectionKey(connection));
    if (!metadata) continue;
    if (metadata.id) connection.id = String(metadata.id);
    if (metadata.data) connection.data = clone(metadata.data);
  }

  const sharedSkillNodeCount =
    nextSkillNodes.reduce(
      (count, skillNode) =>
        count +
        (
          previousSkillNodes.has(skillNode.id)
            ? 1
            : 0
        ),
      0
    );

  const isNewWorkflow =
    previousSkillNodeCount === 0 ||
    (
      nextSkillNodes.length > 0 &&
      sharedSkillNodeCount === 0
    );

  state.skillNodes =
    nextSkillNodes;

  state.connections =
    connections;

  state.selectedSkillNode = null;

  render();

  const GAP_X = 60;
  const DEFAULT_Y = 0;

  const skillNodeInfo = new Map();

  for (const skillNode of state.skillNodes) {
    const element =
      getSkillNodeElement(skillNode.id);

    skillNodeInfo.set(skillNode.id, {
      width: Math.max(
        190,
        element?.offsetWidth || 190
      ),
      height: Math.max(
        50,
        element?.offsetHeight || 74
      )
    });
  }

  const flowConnections =
    state.connections.filter(
      connection =>
        connection.data?.kind !== 'data'
    );

  const incoming =
    new Map();

  const outgoing =
    new Map();

  for (const skillNode of state.skillNodes) {
    incoming.set(
      skillNode.id,
      []
    );

    outgoing.set(
      skillNode.id,
      []
    );
  }

  for (
    const connection of flowConnections
  ) {
    const from =
      connection.from.skillNode;

    const to =
      connection.to.skillNode;

    if (
      !incoming.has(to) ||
      !outgoing.has(from)
    ) {
      continue;
    }

    if (
      !outgoing
        .get(from)
        .includes(to)
    ) {
      outgoing
        .get(from)
        .push(to);
    }

    if (
      !incoming
        .get(to)
        .includes(from)
    ) {
      incoming
        .get(to)
        .push(from);
    }
  }

  const skillNodeOrder =
    new Map(
      state.skillNodes.map(
        (skillNode, index) => [
          skillNode.id,
          index
        ]
      )
    );

  /*
   * 일반 적용에서는 좌표가 없는 신규 노드만 배치한다.
   * layout 옵션을 지정하면 모든 노드를 명시적으로 다시 배치한다.
   */
  const nodesNeedingPosition =
    state.skillNodes.filter(
      skillNode => {
        const source =
          spec.skillNodes.find(
            item =>
              String(item.id) ===
              skillNode.id
          );

        const hasExplicitPosition =
          Number.isFinite(
            Number(source?.x)
          ) &&
          Number.isFinite(
            Number(source?.y)
          );

        return options.layout === true || (
          !hasExplicitPosition &&
          !previousSkillNodes.has(skillNode.id)
        );
      }
    );

  let topologicalOrder = [];

  if (
    nodesNeedingPosition.length
  ) {
    let baseY = DEFAULT_Y;

    if (
      isNewWorkflow ||
      options.layout === true
    ) {
      const GAP_X = 60;
      const GAP_Y = 36;
      const skillNodeOrder =
        new Map(
          state.skillNodes.map(
            (skillNode, index) => [
              skillNode.id,
              index
            ]
          )
        );

      function buildLayoutGraph(edges) {
        const incoming = new Map();
        const outgoing = new Map();

        for (const skillNode of state.skillNodes) {
          incoming.set(skillNode.id, []);
          outgoing.set(skillNode.id, []);
        }

        for (const connection of edges) {
          const from = connection.from.skillNode;
          const to = connection.to.skillNode;

          if (
            from === to ||
            !incoming.has(from) ||
            !incoming.has(to)
          ) {
            continue;
          }

          if (
            !outgoing.get(from).includes(to)
          ) {
            outgoing.get(from).push(to);
          }

          if (
            !incoming.get(to).includes(from)
          ) {
            incoming.get(to).push(from);
          }
        }

        return {
          incoming,
          outgoing
        };
      }

      function topologicalSort(graph) {
        const indegree = new Map();

        for (const skillNode of state.skillNodes) {
          indegree.set(
            skillNode.id,
            graph.incoming.get(skillNode.id)?.length || 0
          );
        }

        const queue =
          state.skillNodes
            .filter(
              skillNode =>
                (indegree.get(skillNode.id) || 0) === 0
            )
            .sort(
              (a, b) =>
                skillNodeOrder.get(a.id) -
                skillNodeOrder.get(b.id)
            )
            .map(skillNode => skillNode.id);

        const order = [];

        while (queue.length) {
          const currentId = queue.shift();
          order.push(currentId);

          const children =
            (graph.outgoing.get(currentId) || [])
              .slice()
              .sort(
                (a, b) =>
                  skillNodeOrder.get(a) -
                  skillNodeOrder.get(b)
              );

          for (const childId of children) {
            const next =
              (indegree.get(childId) || 0) - 1;

            indegree.set(childId, next);

            if (next === 0) {
              queue.push(childId);
              queue.sort(
                (a, b) =>
                  skillNodeOrder.get(a) -
                  skillNodeOrder.get(b)
              );
            }
          }
        }

        return order;
      }

      let layoutGraph =
        buildLayoutGraph(
          state.connections
        );

      topologicalOrder =
        topologicalSort(
          layoutGraph
        );

      /*
       * data 관계까지 합친 그래프에서 순환이 생기면
       * 실행 순서인 links만 사용해 안전하게 배치한다.
       */
      if (
        topologicalOrder.length !==
        state.skillNodes.length
      ) {
        layoutGraph =
          buildLayoutGraph(
            flowConnections
          );

        topologicalOrder =
          topologicalSort(
            layoutGraph
          );
      }

      const orderedIds =
        new Set(topologicalOrder);

      for (const skillNode of state.skillNodes) {
        if (!orderedIds.has(skillNode.id)) {
          topologicalOrder.push(skillNode.id);
        }
      }

      const layers =
        new Map();

      for (const skillNodeId of topologicalOrder) {
        let layer = 0;

        for (
          const parentId
            of layoutGraph.incoming.get(skillNodeId) || []
        ) {
          layer =
            Math.max(
              layer,
              (layers.get(parentId) || 0) + 1
            );
        }

        layers.set(
          skillNodeId,
          layer
        );
      }

      const layerSkillNodes =
        new Map();

      for (const skillNodeId of topologicalOrder) {
        const layer =
          layers.get(skillNodeId) || 0;

        if (!layerSkillNodes.has(layer)) {
          layerSkillNodes.set(layer, []);
        }

        layerSkillNodes
          .get(layer)
          .push(skillNodeId);
      }

      const maxLayer =
        Math.max(
          ...layerSkillNodes.keys(),
          0
        );

      const layerX =
        new Map();

      let currentX = 0;

      for (
        let layer = 0;
        layer <= maxLayer;
        layer++
      ) {
        const ids =
          layerSkillNodes.get(layer) || [];

        const maxWidth =
          Math.max(
            190,
            ...ids.map(
              id =>
                skillNodeInfo.get(id)?.width || 190
            )
          );

        layerX.set(
          layer,
          currentX
        );

        currentX +=
          maxWidth +
          GAP_X;
      }

      const centerY =
        new Map();

      for (
        let layer = 0;
        layer <= maxLayer;
        layer++
      ) {
        const ids =
          layerSkillNodes.get(layer) || [];

        ids.sort(
          (a, b) => {
            if (layer === 0) {
              return (
                skillNodeOrder.get(a) -
                skillNodeOrder.get(b)
              );
            }

            const parentsA =
              layoutGraph.incoming.get(a) || [];

            const parentsB =
              layoutGraph.incoming.get(b) || [];

            const averageA =
              parentsA.length
                ? parentsA.reduce(
                    (sum, parentId) =>
                      sum +
                      (centerY.get(parentId) || 0),
                    0
                  ) / parentsA.length
                : Number.POSITIVE_INFINITY;

            const averageB =
              parentsB.length
                ? parentsB.reduce(
                    (sum, parentId) =>
                      sum +
                      (centerY.get(parentId) || 0),
                    0
                  ) / parentsB.length
                : Number.POSITIVE_INFINITY;

            if (averageA !== averageB) {
              return averageA - averageB;
            }

            return (
              skillNodeOrder.get(a) -
              skillNodeOrder.get(b)
            );
          }
        );

        const totalHeight =
          ids.reduce(
            (sum, skillNodeId) =>
              sum +
              (skillNodeInfo.get(skillNodeId)?.height || 74),
            0
          ) +
          Math.max(
            0,
            ids.length - 1
          ) * GAP_Y;

        let y =
          baseY -
          totalHeight / 2;

        for (const skillNodeId of ids) {
          const skillNode =
            nextSkillNodeMap.get(skillNodeId);

          if (!skillNode) {
            continue;
          }

          const height =
            skillNodeInfo.get(skillNodeId)?.height || 74;

          skillNode.x =
            layerX.get(layer) || 0;

          skillNode.y =
            y;

          centerY.set(
            skillNodeId,
            y + height / 2
          );

          y +=
            height +
            GAP_Y;
        }
      }
    } else {
      const skillNodeOrder =
        new Map(
          state.skillNodes.map(
            (skillNode, index) => [
              skillNode.id,
              index
            ]
          )
        );

      topologicalOrder =
        state.skillNodes.map(
          skillNode => skillNode.id
        );

      const positioned =
        new Set(
          state.skillNodes
            .filter(
              skillNode =>
                previousSkillNodes.has(skillNode.id) ||
                !nodesNeedingPosition.some(
                  target =>
                    target.id === skillNode.id
                )
            )
            .map(
              skillNode =>
                skillNode.id
            )
        );

      let maxX = 0;

      for (
        const skillNode of state.skillNodes
      ) {
        if (!positioned.has(skillNode.id)) {
          continue;
        }

        const info =
          skillNodeInfo.get(skillNode.id);

        maxX =
          Math.max(
            maxX,
            skillNode.x +
              (
                info?.width ||
                190
              )
          );

        if (Number.isFinite(skillNode.y)) {
          baseY = skillNode.y;
        }
      }

      if (positioned.size) {
        maxX += GAP_X;
      }

      for (
        const skillNodeId of topologicalOrder
      ) {
        const skillNode =
          nextSkillNodeMap.get(skillNodeId);

        if (!skillNode) {
          continue;
        }

        if (
          !nodesNeedingPosition.some(
            target =>
              target.id === skillNodeId
          )
        ) {
          continue;
        }

        const info =
          skillNodeInfo.get(skillNodeId);

        skillNode.x =
          maxX;

        skillNode.y =
          baseY;

        maxX +=
          (
            info?.width ||
            190
          ) +
          GAP_X;

        positioned.add(skillNodeId);
      }
    }

    render();
  }

  for (
    const skillNode of state.skillNodes
  ) {
    const element =
      getSkillNodeElement(skillNode.id);

    if (!element) {
      continue;
    }

    positionPorts(
      element,
      getDefinition(skillNode.type)
    );
  }

  renderConnections();

  /*
   * center는 최초 생성 또는 완전 교체일 때만 허용한다.
   * 일반적인 Planner 갱신에서는 사용자의 viewport를 유지한다.
   */
  if (
    options.center !== false &&
    (
      isNewWorkflow ||
      options.layout === true
    )
  ) {
    centerWorkflow();
  }

  emit(
    'workflowApplied',
    getWorkflow()
  );

  emit(
    'change',
    getWorkflow()
  );

  return getWorkflow();
}
    function findNewSkillNodePosition(ignoreSkillNodeId = null) {
      const rect = viewport.getBoundingClientRect();
      const center = screenToWorld(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      const width = 190;
      const height = 60;
      const gap = 24;
      const spots = [
        [0, 0],
        [0, height + gap],
        [0, -height - gap],
        [-width - gap, 0],
        [width + gap, 0]
      ];
      for (const [dx, dy] of spots) {
        const x =
          center.x -
          width / 2 +
          dx;
        const y =
          center.y -
          height / 2 +
          dy;
        const occupied =
          state.skillNodes.some(
            skillNode =>
              skillNode.id !== ignoreSkillNodeId &&
              Math.abs(skillNode.x - x) <
                width + gap &&
              Math.abs(skillNode.y - y) <
                height + gap
          );
        if (!occupied) {
          return { x, y };
        }
      }
      return {
        x: center.x - width / 2,
        y: center.y - height / 2
      };
    }
    function addSkillNode(type, data = {}) {
      if (!registry.has(type)) {
        throw new Error(
          `존재하지 않는 노드 타입: ${type}`
        );
      }
      const position =
        data.x != null &&
        data.y != null
          ? {
              x: Number(data.x),
              y: Number(data.y)
            }
          : findNewSkillNodePosition();
      const skillNode = normalizeSkillNode({
        id:
          data.id ||
          `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        x: position.x,
        y: position.y,
        expanded:
          data.expanded !== undefined
            ? !!data.expanded
            : true,
        data: data.data || {}
      });
      state.skillNodes.push(skillNode);
      state.selectedSkillNode = skillNode.id;

      if (
        !global.matchMedia?.(
          '(prefers-reduced-motion: reduce)'
        ).matches
      ) {
        state.enteringSkillNodes.add(
          skillNode.id
        );
      }

      render();
      emit('skillNodeAdd', clone(skillNode));
      emit(
        'change',
        getWorkflow()
      );
      return skillNode;
    }
    let layoutAnimationFrame = null;

    function layoutWorkflow() {
      const workflow = getWorkflowIR();

      if (
        global.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        emit('layoutStart');

        applyWorkflowIR(
          workflow,
          {
            layout: true,
            center: true
          }
        );

        emit('layoutEnd');
        return api;
      }

      if (layoutAnimationFrame !== null) {
        cancelAnimationFrame(layoutAnimationFrame);
        layoutAnimationFrame = null;
      }

      emit('layoutStart');

      const startPositions = new Map(
        state.skillNodes.map(skillNode => [
          skillNode.id,
          {
            x: skillNode.x,
            y: skillNode.y
          }
        ])
      );

      const startOffset = {
        x: state.offset.x,
        y: state.offset.y
      };

      applyWorkflowIR(
        workflow,
        {
          layout: true,
          center: true
        }
      );

      const targetPositions = new Map(
        state.skillNodes.map(skillNode => [
          skillNode.id,
          {
            x: skillNode.x,
            y: skillNode.y
          }
        ])
      );

      const targetOffset = {
        x: state.offset.x,
        y: state.offset.y
      };

      for (const skillNode of state.skillNodes) {
        const start =
          startPositions.get(skillNode.id);

        if (!start) continue;

        skillNode.x = start.x;
        skillNode.y = start.y;
      }

      state.offset.x = startOffset.x;
      state.offset.y = startOffset.y;

      render();

      const started = performance.now();
      const duration = 520;

      const spring = progress => {
        if (progress >= 1) return 1;

        const raw =
          1 -
          (1 + 6 * progress) *
          Math.exp(-6 * progress);

        const end =
          1 -
          7 *
          Math.exp(-6);

        return Math.min(
          1,
          raw / end
        );
      };

      function frame(now) {
        const progress =
          Math.min(
            1,
            (now - started) / duration
          );

        const eased =
          spring(progress);

        for (const skillNode of state.skillNodes) {
          const start =
            startPositions.get(skillNode.id);

          const target =
            targetPositions.get(skillNode.id);

          if (!start || !target) continue;

          skillNode.x =
            start.x +
            (target.x - start.x) *
            eased;

          skillNode.y =
            start.y +
            (target.y - start.y) *
            eased;

          const element =
            getSkillNodeElement(skillNode.id);

          if (element) {
            element.style.left =
              `${skillNode.x}px`;

            element.style.top =
              `${skillNode.y}px`;
          }
        }

        state.offset.x =
          startOffset.x +
          (targetOffset.x - startOffset.x) *
          eased;

        state.offset.y =
          startOffset.y +
          (targetOffset.y - startOffset.y) *
          eased;

        renderTransform();
        renderConnections();

        if (progress < 1) {
          layoutAnimationFrame =
            requestAnimationFrame(frame);
          return;
        }

        layoutAnimationFrame = null;

        for (const skillNode of state.skillNodes) {
          const target =
            targetPositions.get(skillNode.id);

          if (!target) continue;

          skillNode.x = target.x;
          skillNode.y = target.y;
        }

        state.offset.x = targetOffset.x;
        state.offset.y = targetOffset.y;

        render();
        emit('change', getWorkflow());
        emit('layoutEnd');
      }

      layoutAnimationFrame =
        requestAnimationFrame(frame);

      return api;
    }
    function removeSkillNode(id) {
      const skillNode = getSkillNode(id);
      if (!skillNode) {
        return false;
      }
      state.skillNodes =
        state.skillNodes.filter(
          item => item.id !== id
        );
      const removed =
        state.connections.filter(
          connection =>
            connection.from.skillNode === id ||
            connection.to.skillNode === id
        );
      state.connections =
        state.connections.filter(
          connection =>
            connection.from.skillNode !== id &&
            connection.to.skillNode !== id
        );
      for (const connection of removed) {
        removeConnectionElement(connection.id);
      }
      if (state.selectedSkillNode === id) {
        state.selectedSkillNode = null;
      }
      render();
      emit('skillNodeRemove', clone(skillNode));
      emit(
        'change',
        getWorkflow()
      );
      return true;
    }
    function setInteractionEnabled(enabled) {
      state.interactionEnabled = !!enabled;
      if (!state.interactionEnabled) {
        stopPanMotion();
        state.pointers.clear();
        state.skillNodeDrag = null;
        state.canvasPan = null;
        state.pinch = null;
        cancelConnectionDrag();
      }
      emit(
        'interaction',
        state.interactionEnabled
      );
      return api;
    }
    function beginConnectionDrag(event, port, skillNode) {
      const direction =
        port.dataset.portDir;

      if (
        direction !== 'output' &&
        direction !== 'input'
      ) {
        return;
      }

      const anchor = {
        skillNode: skillNode.id,
        port: port.dataset.portId
      };

      state.connectionDrag = {
        pointerId:
          event.pointerId,
        direction,
        anchor,
        anchors:
          direction === 'output'
            ? [
                clone(anchor)
              ]
            : null,
        startX:
          event.clientX,
        startY:
          event.clientY,
        startedAt:
          performance.now(),
        moved: false,
        x: event.clientX,
        y: event.clientY,
        pickupCandidate:
          null,
        pickupTimer:
          null
      };

      try {
        viewport.setPointerCapture(
          event.pointerId
        );
      } catch {}

      emit(
        'connectionDragStart',
        clone(
          state.connectionDrag
        )
      );

      renderDragConnection();
    }
    function clearConnectionPickupVisuals(
      drag =
        state.connectionDrag
    ) {
      if (
        drag?.pickupTimer
      ) {
        clearTimeout(
          drag.pickupTimer
        );
        drag.pickupTimer =
          null;
      }

      skillNodesLayer
        .querySelectorAll(
          '.vc-port-pickup-hover, .vc-port-picked'
        )
        .forEach(
          element => {
            element.classList.remove(
              'vc-port-pickup-hover',
              'vc-port-picked'
            );
          }
        );

      if (drag) {
        drag.pickupCandidate =
          null;
      }
    }

    function cancelConnectionDrag(notify = true) {
      const drag = state.connectionDrag;

      if (!drag) {
        dragLayer.textContent = '';
        return false;
      }

      clearConnectionPickupVisuals(
        drag
      );

      if (notify) {
        emit(
          'connectionDragEnd',
          {
            connected: false,
            cancelled: true,
            x: drag.x,
            y: drag.y
          }
        );
      }

      try {
        viewport.releasePointerCapture(
          drag.pointerId
        );
      } catch {}

      state.connectionDrag =
        null;

      dragLayer.textContent =
        '';

      renderConnections();

      return true;
    }
    function findPortHitElement(
      endpointValue,
      direction
    ) {
      return [
        ...skillNodesLayer
          .querySelectorAll(
            '.vc-port-hit'
          )
      ].find(
        element =>
          element.dataset
            .portDir ===
            direction &&
          element.dataset
            .skillNodeId ===
            endpointValue.skillNode &&
          element.dataset
            .portId ===
            endpointValue.port
      ) || null;
    }

    function sameEndpoint(
      a,
      b
    ) {
      return !!(
        a &&
        b &&
        a.skillNode === b.skillNode &&
        a.port === b.port
      );
    }

    function scheduleConnectionPickup(
      candidate
    ) {
      const drag =
        state.connectionDrag;

      if (
        !drag ||
        drag.direction !==
          'output'
      ) {
        return;
      }

      const anchors =
        Array.isArray(
          drag.anchors
        )
          ? drag.anchors
          : [];

      if (
        !candidate ||
        anchors.some(
          anchor =>
            sameEndpoint(
              anchor,
              candidate
            )
        )
      ) {
        if (
          drag.pickupTimer
        ) {
          clearTimeout(
            drag.pickupTimer
          );
          drag.pickupTimer =
            null;
        }

        const previous =
          drag.pickupCandidate;

        if (previous) {
          findPortHitElement(
            previous,
            'output'
          )
            ?.classList
            .remove(
              'vc-port-pickup-hover'
            );
        }

        drag.pickupCandidate =
          null;

        return;
      }

      if (
        sameEndpoint(
          drag.pickupCandidate,
          candidate
        )
      ) {
        return;
      }

      if (
        drag.pickupTimer
      ) {
        clearTimeout(
          drag.pickupTimer
        );
        drag.pickupTimer =
          null;
      }

      if (
        drag.pickupCandidate
      ) {
        findPortHitElement(
          drag.pickupCandidate,
          'output'
        )
          ?.classList
          .remove(
            'vc-port-pickup-hover'
          );
      }

      drag.pickupCandidate =
        clone(candidate);

      findPortHitElement(
        candidate,
        'output'
      )
        ?.classList
        .add(
          'vc-port-pickup-hover'
        );

      drag.pickupTimer =
        setTimeout(
          () => {
            const current =
              state.connectionDrag;

            if (
              !current ||
              current !== drag ||
              current.direction !==
                'output'
            ) {
              return;
            }

            const point =
              screenToWorld(
                current.x,
                current.y
              );

            const hovered =
              getPortAtWorldPoint(
                point,
                'output'
              );

            if (
              !sameEndpoint(
                hovered,
                candidate
              )
            ) {
              scheduleConnectionPickup(
                hovered
              );
              return;
            }

            current.anchors.push(
              clone(candidate)
            );

            const element =
              findPortHitElement(
                candidate,
                'output'
              );

            element
              ?.classList
              .remove(
                'vc-port-pickup-hover'
              );

            element
              ?.classList
              .add(
                'vc-port-picked'
              );

            current.pickupCandidate =
              null;
            current.pickupTimer =
              null;

            emit(
              'connectionDragPickup',
              {
                anchor:
                  clone(
                    candidate
                  ),
                anchors:
                  clone(
                    current.anchors
                  )
              }
            );

            renderDragConnection();
          },
          200
        );
    }

    function getPortAtWorldPoint(
      worldPoint,
      direction
    ) {
      const tolerance = 20;
      for (const skillNode of state.skillNodes) {
        const definition = getDefinition(
          skillNode.type
        );
        if (!definition) continue;
        const ports =
          direction === 'input'
            ? definition.inputs || []
            : definition.outputs || [];
        const element =
          getSkillNodeElement(skillNode.id);
        if (!element) continue;
        const height =
          Math.max(
            50,
            element.offsetHeight || 74
          );
        const width =
          element.offsetWidth || 190;
        for (
          let index = 0;
          index < ports.length;
          index++
        ) {
          const y =
            ((index + 1) /
              Math.max(
                1,
                ports.length + 1
              )) *
            height;
          const centerX =
            direction === 'input'
              ? skillNode.x
              : skillNode.x + width;
          const centerY =
            skillNode.y + y;
          if (
            Math.abs(
              worldPoint.x - centerX
            ) <= tolerance &&
            Math.abs(
              worldPoint.y - centerY
            ) <= tolerance
          ) {
            return {
              skillNode: skillNode.id,
              port: String(
                ports[index].id
              )
            };
          }
        }
      }
      return null;
    }
    function finishConnection(event) {
      const drag =
        state.connectionDrag;

      if (!drag) {
        return false;
      }

      const point =
        screenToWorld(
          event.clientX,
          event.clientY
        );

      let targetPort =
        null;

      let connectedCount =
        0;

      let changedCount =
        0;

      if (
        drag.direction ===
          'output'
      ) {
        targetPort =
          getPortAtWorldPoint(
            point,
            'input'
          );

        if (targetPort) {
          const anchors =
            Array.isArray(
              drag.anchors
            ) &&
            drag.anchors.length
              ? drag.anchors
              : [
                  drag.anchor
                ];

          for (
            const anchor
            of anchors
          ) {
            const result =
              toggleConnection(
                anchor,
                targetPort
              );

            if (
              result.changed
            ) {
              changedCount++;
            }

            if (
              result.connected
            ) {
              connectedCount++;
            }
          }
        }
      } else {
        targetPort =
          getPortAtWorldPoint(
            point,
            'output'
          );

        if (targetPort) {
          const result =
            toggleConnection(
              targetPort,
              drag.anchor
            );

          if (
            result.changed
          ) {
            changedCount = 1;
          }

          if (
            result.connected
          ) {
            connectedCount = 1;
          }
        }
      }

      const connected =
        changedCount > 0;

      emit(
        'connectionDragEnd',
        {
          connected,
          cancelled: false,
          target:
            targetPort
              ? clone(
                  targetPort
                )
              : null,
          count:
            connectedCount,
          changedCount,
          x:
            event.clientX,
          y:
            event.clientY
        }
      );

      cancelConnectionDrag(
        false
      );

      return connected;
    }
    listen(
      skillNodesLayer,
      'pointerdown',
      event => {
        if (
          event.target.closest(
            '[data-action]'
          ) ||
          event.target.closest(
            '.vc-slot-param'
          ) ||
          event.target.closest(
            '.vc-runtime-result'
          ) ||
          event.target.closest(
            '.vc-file-download'
          )
        ) {
          /*
           * Node actions must keep native pointer/click semantics.
           * Letting pointerdown bubble into the viewport starts a skillNode drag
           * and captures the mouse pointer, which can swallow the desktop
           * click before the delegated action handler receives it.
           */
          event.stopPropagation();
        }
      },
      { passive: false }
    );
    listen(
      skillNodesLayer,
      'click',
      event => {
        if (
          event.target.closest(
            '.vc-file-download'
          )
        ) {
          return;
        }

        const action =
          event.target.closest(
            '[data-action]'
          );

        if (!action) {
          const element =
            event.target.closest(
              '.vc-skill-node'
            );

          if (!element) {
            return;
          }

          if (
            performance.now() -
              state.lastSkillNodeDragEndAt <
            180
          ) {
            return;
          }

          const skillNode =
            getSkillNode(
              element.dataset.skillNodeId
            );

          if (!skillNode) {
            return;
          }

          emit(
            'skillNodeClick',
            {
              id: skillNode.id,
              skillNode: clone(skillNode)
            }
          );

          return;
        }

        const element =
          action.closest('.vc-skill-node');
        if (!element) return;
        event.preventDefault();
        event.stopPropagation();
        const skillNode =
          getSkillNode(
            element.dataset.skillNodeId
          );
        if (!skillNode) return;
        if (action.dataset.action === 'runtime-result') {
          const runtime = state.runtimeSkillNodes.get(skillNode.id);
          if (runtime) emit('skillNodeResult', {
            id: skillNode.id,
            skillNode: clone(skillNode),
            runtime: clone(runtime)
          });
          return;
        }
        if (
          action.dataset.action ===
          'cancel-run'
        ) {
          emit(
            'skillNodeRunCancel',
            {
              id: skillNode.id,
              skillNode: clone(skillNode)
            }
          );
          return;
        }

        if (
          action.dataset.action ===
          'run'
        ) {
          if (
            state.runLocked ||
            action.disabled ||
            !runScopeReady(skillNode.id)
          ) {
            return;
          }

          emit(
            'skillNodeRun',
            {
              id: skillNode.id,
              skillNode: clone(skillNode),
              mode: 'target'
            }
          );
          return;
        }
        if (
          action.dataset.action ===
          'toggle'
        ) {
          toggleSkillNodeExpanded(
            skillNode.id
          );
          return;
        }
        if (
          action.dataset.action ===
          'delete'
        ) {
          removeSkillNode(skillNode.id);
        }
      }
    );
    listen(
  skillNodesLayer,
  'input',
  event => {
    const input =
      event.target.closest(
        '.vc-slot-param'
      );

    if (!input) return;

    const element =
      input.closest('.vc-skill-node');

    if (!element) return;

    const skillNode =
      getSkillNode(
        element.dataset.skillNodeId
      );

    if (!skillNode) return;

    skillNode.data ||= {};
    skillNode.data.params ||= {};

    skillNode.data.params[
      input.dataset.paramId
    ] = input.value;

    if (
      input.dataset.paramId ===
        "request" &&
      input.value.trim()
    ) {
      const definition =
        getDefinition(
          skillNode.type
        );

      for (
        const param
        of definition?.params || []
      ) {
        if (
          param?.legacy === true
        ) {
          delete skillNode.data.params[
            String(param.id)
          ];
        }
      }
    }

    if (skillNode.expanded) {
      requestAnimationFrame(() => {
        const body =
          element.querySelector(
            '.vc-skill-node-body'
          );

        if (!body) return;

        body.style.height =
          'auto';

        body.style.height =
          `${body.scrollHeight}px`;

        positionPorts(
          element,
          getDefinition(skillNode.type)
        );

        renderConnections();
      });
    }

    syncRunButtonStates();

    emit('skillNodeEdit', {
      id: skillNode.id,
      param: input.dataset.paramId,
      value: input.value
    });
    emit(
      'change',
      getWorkflow()
    );
  }
);
    /*
      연결선은 canvas 이동 이벤트보다
      먼저 먹는다.
    */
    listen(
      connectionLayer,
      'pointerdown',
      event => {
        const path =
          event.target.closest(
            '.vc-connection'
          );
        if (!path) return;
        event.preventDefault();
        event.stopPropagation();
      },
      { passive: false }
    );
    listen(
      connectionLayer,
      'click',
      event => {
        const path =
          event.target.closest(
            '.vc-connection'
          );
        if (!path) return;
        event.preventDefault();
        event.stopPropagation();
        const id =
          path.dataset.connectionId;
        if (id) {
          disconnect(id);
        }
      }
    );
    listen(
      viewport,
      'pointerdown',
      event => {
        if (!state.interactionEnabled) {
          return;
        }

        stopPanMotion();
        state.pointers.set(
          event.pointerId,
          {
            x: event.clientX,
            y: event.clientY
          }
        );
        if (
          state.pointers.size >= 2
        ) {
          cancelConnectionDrag();
          if (state.skillNodeDrag) {
            finishSkillNodeDrag();
          }
          state.canvasPan = null;
          const [a, b] =
            [...state.pointers.values()];
          const center = mid(a, b);
          const anchor =
            screenToWorld(
              center.x,
              center.y
            );
          state.pinch = {
            d: Math.max(
              1,
              dist(a, b)
            ),
            s: state.scale,
            x: anchor.x,
            y: anchor.y
          };
          return;
        }
        const port =
          event.target.closest(
            '.vc-port-hit'
          );
        if (port) {
          event.preventDefault();
          event.stopPropagation();
          const skillNode =
            getSkillNode(
              port.dataset.skillNodeId
            );
          if (!skillNode) return;
          beginConnectionDrag(
            event,
            port,
            skillNode
          );
          return;
        }
        const skillNodeElement =
          event.target.closest(
            '.vc-skill-node'
          );
        if (skillNodeElement) {
          event.preventDefault();
          event.stopPropagation();
          const skillNode =
            getSkillNode(
              skillNodeElement.dataset.skillNodeId
            );
          if (!skillNode) return;
          selectSkillNode(skillNode.id);
          state.skillNodeDrag = {
            pointerId: event.pointerId,
            skillNode,
            startX: event.clientX,
            startY: event.clientY,
            skillNodeX: skillNode.x,
            skillNodeY: skillNode.y,
            moved: false,
            wasExpanded: !!skillNode.expanded,
            collapseOnDrag:
              !!event.target.closest(
                '.vc-skill-node-head'
              ),
            collapsedForDrag: false
          };
          try {
            viewport.setPointerCapture(
              event.pointerId
            );
          } catch {}
          return;
        }
        selectSkillNode(null);
        state.canvasPan = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startOffsetX: state.offset.x,
          startOffsetY: state.offset.y,
          moved: false,
          lastX: event.clientX,
          lastY: event.clientY,
          lastTime:
            performance.now(),
          velocityX: 0,
          velocityY: 0
        };
        try {
          viewport.setPointerCapture(
            event.pointerId
          );
        } catch {}
      },
      { passive: false }
    );
    listen(
      viewport,
      'pointermove',
      event => {
        if (
          !state.interactionEnabled
        ) {
          return;
        }
        const tracked =
          state.pointers.has(
            event.pointerId
          );
        if (!tracked) return;
        state.pointers.set(
          event.pointerId,
          {
            x: event.clientX,
            y: event.clientY
          }
        );
        if (
          state.pointers.size >= 2
        ) {
          if (state.skillNodeDrag) {
            finishSkillNodeDrag();
          }
          cancelConnectionDrag();
          state.canvasPan = null;
          const points =
            [...state.pointers.values()];
          if (!state.pinch) {
            const center =
              mid(
                points[0],
                points[1]
              );
            const anchor =
              screenToWorld(
                center.x,
                center.y
              );
            state.pinch = {
              d: Math.max(
                1,
                dist(
                  points[0],
                  points[1]
                )
              ),
              s: state.scale,
              x: anchor.x,
              y: anchor.y
            };
          }
          const currentDistance =
            dist(
              points[0],
              points[1]
            );
          const center =
            mid(
              points[0],
              points[1]
            );
          const rect =
            viewport.getBoundingClientRect();
          state.scale =
            clamp(
              state.pinch.s *
                (
                  currentDistance /
                  state.pinch.d
                ),
              MIN_SCALE,
              MAX_SCALE
            );
          state.offset.x =
            center.x -
            rect.left -
            state.pinch.x *
              state.scale;
          state.offset.y =
            center.y -
            rect.top -
            state.pinch.y *
              state.scale;
          renderTransform();
          scheduleConnectionRender();
          return;
        }
        if (
          state.connectionDrag?.pointerId ===
          event.pointerId
        ) {
          event.preventDefault();

          const drag =
            state.connectionDrag;

          drag.x =
            event.clientX;
          drag.y =
            event.clientY;

          if (
            !drag.moved &&
            Math.hypot(
              event.clientX -
                drag.startX,
              event.clientY -
                drag.startY
            ) > 7
          ) {
            drag.moved =
              true;

            state.portTap.key =
              "";
            state.portTap.at =
              0;
          }

          if (
            drag.direction ===
              'output'
          ) {
            const point =
              screenToWorld(
                event.clientX,
                event.clientY
              );

            scheduleConnectionPickup(
              getPortAtWorldPoint(
                point,
                'output'
              )
            );
          }

          emit(
            'connectionDragMove',
            {
              ...clone(drag),
              x:
                event.clientX,
              y:
                event.clientY
            }
          );

          scheduleConnectionRender();
          return;
        }
        if (
          state.skillNodeDrag?.pointerId ===
          event.pointerId
        ) {
          const drag =
            state.skillNodeDrag;
          const dx =
            event.clientX -
            drag.startX;
          const dy =
            event.clientY -
            drag.startY;
          if (
            !drag.moved &&
            Math.hypot(dx, dy) > 7
          ) {
            drag.moved = true;
            const element =
              getSkillNodeElement(
                drag.skillNode.id
              );
            if (element) {
              element.classList.add(
                'vc-dragging'
              );
              emit('skillNodeDragStart', {
                id: drag.skillNode.id,
                x: event.clientX,
                y: event.clientY
              });
              if (
                drag.wasExpanded &&
                drag.collapseOnDrag
              ) {
                setSkillNodeExpanded(
                  drag.skillNode,
                  false,
                  true
                );
                drag.collapsedForDrag =
                  true;
              }
            }
          }
          if (!drag.moved) {
            return;
          }
          event.preventDefault();
          drag.skillNode.x =
            drag.skillNodeX +
            dx /
              state.scale;
          drag.skillNode.y =
            drag.skillNodeY +
            dy /
              state.scale;
          const element =
            getSkillNodeElement(
              drag.skillNode.id
            );
          if (element) {
            element.style.left =
              `${drag.skillNode.x}px`;
            element.style.top =
              `${drag.skillNode.y}px`;
            positionPorts(
              element,
              getDefinition(
                drag.skillNode.type
              )
            );
          }
          emit('skillNodeDragMove', {
            id: drag.skillNode.id,
            x: event.clientX,
            y: event.clientY,
            skillNodeX: drag.skillNode.x,
            skillNodeY: drag.skillNode.y
          });
          scheduleConnectionRender();
          return;
        }
        if (
          state.canvasPan?.pointerId ===
          event.pointerId
        ) {
          const pan =
            state.canvasPan;
          const dx =
            event.clientX -
            pan.startX;
          const dy =
            event.clientY -
            pan.startY;
          if (
            !pan.moved &&
            Math.hypot(dx, dy) > 7
          ) {
            pan.moved = true;

            viewport.classList.add(
              'vc-panning'
            );
          }
          if (!pan.moved) {
            return;
          }
          event.preventDefault();
          const now =
            performance.now();

          const dt =
            Math.max(
              1,
              now -
              pan.lastTime
            );

          const instantX =
            (
              event.clientX -
              pan.lastX
            ) / dt;

          const instantY =
            (
              event.clientY -
              pan.lastY
            ) / dt;

          pan.velocityX =
            pan.velocityX *
              .68 +
            instantX *
              .32;

          pan.velocityY =
            pan.velocityY *
              .68 +
            instantY *
              .32;

          pan.lastX =
            event.clientX;

          pan.lastY =
            event.clientY;

          pan.lastTime =
            now;

          state.offset.x =
            pan.startOffsetX +
            dx;
          state.offset.y =
            pan.startOffsetY +
            dy;
          renderTransform();
          scheduleConnectionRender();
        }
      },
      { passive: false }
    );
    function finishSkillNodeDrag() {
      const drag =
        state.skillNodeDrag;
      if (!drag) return;
      const element =
        getSkillNodeElement(
          drag.skillNode.id
        );
      if (element) {
        element.classList.remove(
          'vc-dragging'
        );
        if (
          drag.wasExpanded &&
          drag.collapsedForDrag
        ) {
          setSkillNodeExpanded(
            drag.skillNode,
            true
          );
        }
      }
      if (drag.moved) {
        state.lastSkillNodeDragEndAt =
          performance.now();
      }

      state.skillNodeDrag = null;
      renderConnections();
      emit('skillNodeDragEnd', {
        id: drag.skillNode.id,
        skillNode: clone(drag.skillNode)
      });
      emit(
        'change',
        getWorkflow()
      );
    }
    function endPointer(event) {
      if (
        state.connectionDrag?.pointerId ===
        event.pointerId
      ) {
        const drag =
          state.connectionDrag;

        if (
          event.type ===
          'pointercancel'
        ) {
          cancelConnectionDrag();
        } else {
          const tapCandidate =
            !drag.moved &&
            performance.now() -
              drag.startedAt <
              320;

          const connected =
            finishConnection(
              event
            );

          if (connected) {
            state.portTap.key =
              "";
            state.portTap.at =
              0;
          } else if (
            tapCandidate
          ) {
            registerPortTap(
              drag.anchor,
              drag.direction
            );
          }
        }
      }
      if (
        state.skillNodeDrag?.pointerId ===
        event.pointerId
      ) {
        finishSkillNodeDrag();
      }
      state.pointers.delete(
        event.pointerId
      );
      if (
        state.pointers.size < 2
      ) {
        state.pinch = null;
      }
      if (
        state.pointers.size === 0
      ) {
        const finishedPan =
          state.canvasPan;

        state.canvasPan = null;
        cancelConnectionDrag();

        if (
          finishedPan?.moved &&
          event.type !==
            'pointercancel'
        ) {
          startPanMotion(
            finishedPan.velocityX,
            finishedPan.velocityY
          );
        } else {
          viewport.classList.remove(
            'vc-panning'
          );
        }
        try {
          viewport.releasePointerCapture(
            event.pointerId
          );
        } catch {}
        renderConnections();
      }
    }
    listen(
      viewport,
      'pointerup',
      endPointer
    );
    listen(
      viewport,
      'pointercancel',
      endPointer
    );
    listen(
      viewport,
      'wheel',
      event => {
        if (!state.interactionEnabled) {
          return;
        }
        event.preventDefault();
        const before =
          screenToWorld(
            event.clientX,
            event.clientY
          );
        const factor =
          Math.exp(
            -event.deltaY *
              0.0015
          );
        const rect =
          viewport.getBoundingClientRect();
        state.scale =
          clamp(
            state.scale *
              factor,
            MIN_SCALE,
            MAX_SCALE
          );
        state.offset.x =
          event.clientX -
          rect.left -
          before.x *
            state.scale;
        state.offset.y =
          event.clientY -
          rect.top -
          before.y *
            state.scale;
        renderTransform();
        renderConnections();
      },
      { passive: false }
    );
    const resizeObserver =
      new ResizeObserver(() => {
        if (state.destroyed) {
          return;
        }
        for (const skillNode of state.skillNodes) {
          const element =
            getSkillNodeElement(
              skillNode.id
            );
          if (element) {
            positionPorts(
              element,
              getDefinition(
                skillNode.type
              )
            );
          }
        }
        scheduleConnectionRender();
      });
    resizeObserver.observe(
      viewport
    );
    observers.push(
      () =>
        resizeObserver.disconnect()
    );
    function render() {
      renderTransform();
      renderSkillNodes();
      renderConnections();
    }
    const api = {
      root: viewport,
      getSkillNode,
      getWorkflow,
      getWorkflowIR,
      getState: () => ({
        workflow: getWorkflow(),
        viewport: {
          scale: state.scale,
          offset: {
            ...state.offset
          }
        }
      }),
      setState,
      applyWorkflowIR,
      addSkillNode,
      removeSkillNode,
      connect,
      disconnect,
      canConnect,
      validate,
      selectSkillNode,
      toggleSkillNodeExpanded,
      setInteractionEnabled,
      setRunLocked(
        locked,
        pivotId = null
      ) {
        const next =
          !!locked;

        const nextPivot =
          next
            ? String(
                pivotId || ''
              )
            : null;

        if (
          state.runLocked === next &&
          state.runPivot === nextPivot
        ) {
          return api;
        }

        state.runLocked =
          next;
        state.runPivot =
          nextPivot;

        renderSkillNodes();

        return api;
      },
      setRuntimeConnections(ids = []) {
        state.runtimeConnections =
          new Set(
            Array.isArray(ids)
              ? ids.map(String)
              : []
          );
        renderConnections();
        return api;
      },
      setRuntimeSkillNodeState(id, runtimeState) {
        const skillNodeId = String(id || '');
        if (!skillNodeId || !getSkillNode(skillNodeId)) {
          return api;
        }
        if (
          !runtimeState ||
          typeof runtimeState !== 'object'
        ) {
          state.runtimeSkillNodes.delete(skillNodeId);
        } else {
          state.runtimeSkillNodes.set(
            skillNodeId,
            clone(runtimeState)
          );
        }
        renderSkillNodes();
        return api;
      },
      clearRuntimeSkillNodeStates() {
        state.runtimeSkillNodes.clear();
        renderSkillNodes();
        return api;
      },
      showRuntimeSkillNode(id) {
        const skillNode =
          getSkillNode(String(id || ''));
        if (!skillNode) {
          return api;
        }
        if (!skillNode.expanded) {
          setSkillNodeExpanded(
            skillNode,
            true
          );
        }
        selectSkillNode(skillNode.id);
        return api;
      },
      isInteractionEnabled:
        () =>
          state.interactionEnabled,
      getSkillDefinition:
        type =>
          getDefinition(type),
      getSkillDefinitions,
      getBaseSkillDefinitions,
      setSkillDefinitions,
      prepareRuntime,
      pluginContext,
      center() {
        centerWorkflow();
        return api;
      },
      layout: layoutWorkflow,
      render,
      on,
      off,
      destroy() {
        if (state.destroyed) {
          return;
        }
        state.destroyed = true;
        if (
          state.connectionFrame !==
          null
        ) {
          cancelAnimationFrame(
            state.connectionFrame
          );
          state.connectionFrame =
            null;
        }

        stopPanMotion();
        listeners
          .splice(0)
          .forEach(
            cleanup => {
              try {
                cleanup();
              } catch {}
            }
          );
        observers
          .splice(0)
          .forEach(
            cleanup => {
              try {
                cleanup();
              } catch {}
            }
          );
        clearConnectionPickupVisuals(
          state.connectionDrag
        );

        state.connectionRemovalTimers
          .forEach(
            timer =>
              clearTimeout(timer)
          );

        state.connectionRemovalTimers
          .clear();

        state.pointers.clear();
        state.skillNodeDrag = null;
        state.canvasPan = null;
        state.pinch = null;
        state.connectionDrag = null;
        state.enteringSkillNodes.clear();
        state.runtimeConnections.clear();
        state.runtimeSkillNodes.clear();
        connectionElements
          .forEach(
            element =>
              element.remove()
          );
        connectionElements.clear();
        connectionLayer.textContent = '';
        dragLayer.textContent = '';
        skillNodesLayer.textContent = '';
        events.clear();
        if (
          target._canvasSkillNode ===
          api
        ) {
          target._canvasSkillNode = null;
        }
        if (
          viewport._canvasSkillNode ===
          api
        ) {
          viewport._canvasSkillNode = null;
        }
      }
    };
    target._canvasSkillNode = api;
    viewport._canvasSkillNode = api;
    const initialState =
      options.initialWorkflow ||
      previousState ||
      {
        skillNodes: [],
        connections: []
      };
    setState(initialState);
    setInteractionEnabled(
      options.interactionEnabled ===
        true
    );
    if (options.onChange) {
      on(
        'change',
        options.onChange
      );
    }
    if (options.onSelect) {
      on(
        'select',
        options.onSelect
      );
    }
    if (options.onConnect) {
      on(
        'connect',
        options.onConnect
      );
    }
    if (options.onValidate) {
      on(
        'validate',
        options.onValidate
      );
    }
    render();
    return api;
  };
  global.getMountedCanvasSkillNode =
    function(target) {
      if (typeof target === 'string') {
        target =
          document.querySelector(
            target
          );
      }
      return (
        target?._canvasSkillNode ||
        null
      );
    };
})(window);
