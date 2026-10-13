/* Rich composer adapter. Visual editor + legacy plain-text request contract. */
(function (global) {
  "use strict";

  const glyphs = Object.freeze({
    mention: '<circle cx="9.35" cy="9.8" r="2.35"/><path d="M11.7 9.8v2.1c0 1.36 1.26 1.86 2.2 1.02a6.9 6.9 0 1 0-2.08 3.53"/>',
    canvas: '<rect x="3.25" y="3.25" width="5.3" height="5.3" rx="1.45"/><rect x="11.45" y="11.45" width="5.3" height="5.3" rx="1.45"/><path d="M8.55 5.9h2.1a2 2 0 0 1 2 2v3.55"/>',
    slash: '<path d="M12.8 3.9 7.2 16.1"/>',
    plus: '<path d="M10 3.8v12.4M3.8 10h12.4"/>',
    up: '<path d="M10 15V4.8m-4.2 4.3L10 4.8l4.2 4.3"/>',
    folder: '<path d="M3.2 6.3c0-1.1.9-2 2-2h2.3l1.5 1.5h5.8c1.1 0 2 .9 2 2v6.1c0 1.1-.9 2-2 2H5.2c-1.1 0-2-.9-2-2z"/>',
    workflow: '<rect x="3.2" y="3.4" width="5" height="5" rx="1.5"/><rect x="11.8" y="11.6" width="5" height="5" rx="1.5"/><path d="M8.2 5.9h2.1a2 2 0 0 1 2 2v3.7"/>',
    close: '<path d="m5.6 5.6 8.8 8.8m0-8.8-8.8 8.8"/>',
    arrow: '<path d="m7.2 4.7 5.2 5.3-5.2 5.3"/>',
    enter: '<path d="M15.8 5.2v4.4a3.5 3.5 0 0 1-3.5 3.5H4.8m3-3-3 3 3 3"/>'
  });
  const svg = (name) => '<svg viewBox="0 0 20 20" width="20" height="20" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (glyphs[name] || glyphs.workflow) + '</svg>';
  const escapeId = value => String(value || "").slice(0, 150);
  const mobile = () => global.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches ||
    /Android|iPhone|iPad|iPod/i.test(global.navigator?.userAgent || "");

  function mount(config) {
    const { form, input, attach, submit } = config || {};
    if (!form || !input || !submit) return null;
    if (form.ovllRichComposer) return form.ovllRichComposer;
    const doc = input.ownerDocument;
    const editor = doc.createElement("div");
    editor.className = "ovll-rich-editor";
    editor.contentEditable = "true";
    editor.spellcheck = true;
    editor.dataset.placeholder = input.placeholder || "무엇을 할까요?";
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", "작업 입력");
    editor.setAttribute("aria-multiline", "true");
    editor.setAttribute("autocapitalize", "sentences");
    const picker = doc.createElement("div");
    picker.className = "ovll-rich-picker";
    picker.hidden = true;
    picker.setAttribute("role", "listbox");
    picker.setAttribute("aria-label", "노드 및 명령 검색");
    const mention = doc.createElement("button");
    const canvas = doc.createElement("button");
    const commands = doc.createElement("button");
    function tool(button, name, label) {
      button.type = "button";
      button.className = "ovll-rich-tool ovll-rich-" + name;
      button.innerHTML = svg(name);
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    tool(mention, "mention", "노드 및 저장 함수 태그");
    tool(canvas, "canvas", "캔버스 노드 참조");
    tool(commands, "slash", "빠른 명령");
    if (attach) attach.title = "파일 추가";
    form.insertBefore(editor, submit);
    form.insertBefore(mention, submit);
    form.insertBefore(canvas, submit);
    form.insertBefore(commands, submit);
    form.appendChild(picker);
    form.classList.add("ovll-composer-rich");
    if (attach) attach.classList.add("ovll-rich-attach");
    submit.classList.add("ovll-rich-send");

    let composing = false;
    let openType = "";
    let entries = [];
    let selectedIndex = 0;
    let selectedRange = null;
    let mentionRange = null;
    let selectedTag = null;
    let busy = false;
    let attachmentEnabled = true;

    function textPart(target, value) {
      if (!value) return;
      const last = target[target.length - 1];
      if (last?.type === "text") last.text += value;
      else target.push({ type: "text", text: value });
    }
    function parts() {
      const result = [];
      function visit(node) {
        if (node.nodeType === 3) { textPart(result, node.nodeValue); return; }
        if (node.nodeType !== 1) return;
        if (node.dataset.ovllRefKind) {
          result.push({ type: node.dataset.ovllRefKind, id: node.dataset.ovllRefId,
            label: node.dataset.ovllRefLabel });
          return;
        }
        if (node.tagName === "BR") {
          // Browsers add a terminal BR as a caret placeholder after a line break.
          if (node.nextSibling === null && node.previousSibling?.nodeName === "BR") return;
          textPart(result, "\n"); return;
        }
        const block = node !== editor && /^(DIV|P)$/i.test(node.tagName);
        if (block && result.length) textPart(result, "\n");
        if (block && node.childNodes.length === 1 && node.firstChild?.nodeName === "BR") return;
        for (const child of node.childNodes) visit(child);
      }
      for (const child of editor.childNodes) visit(child);
      return result.filter(p => p.type !== "text" || p.text);
    }
    function plainValue() {
      return parts().map(p => {
        if (p.type === "text") return p.text;
        const prefix = p.type === "node_type" ? "노드 타입" :
          p.type === "node_instance" ? "캔버스 노드" : "저장 함수";
        return "@" + p.label + "〔" + prefix + ":" + p.id + "〕";
      }).join("");
    }
    function syncValue() { input.value = plainValue(); }
    function hasRefs() { return parts().some(p => p.type !== "text"); }
    function update() {
      syncValue();
      resize();
      submit.disabled = busy || !input.value.trim();
    }
    function resize() {
      // Let the rich text and inline chips determine the row height.
      // Measuring an already expanded grid would keep single-line drafts expanded.
      editor.style.height = "";
      const refs = hasRefs();
      const hasNewline = input.value.includes("\n");
      if (!refs && !hasNewline) form.classList.remove("is-expanded");
      const expanded = refs || hasNewline || editor.scrollHeight > 38;
      form.classList.toggle("is-expanded", expanded);
      const height = editor.getBoundingClientRect().height;
      const root = config.styleRoot || doc.documentElement;
      const rootStyle = root.style;
      rootStyle.setProperty("--composer-input-height", height + "px");
      const formHeight = form.getBoundingClientRect().height;
      const rootComputed = global.getComputedStyle(doc.documentElement);
      const configured = rootComputed.getPropertyValue("--composer-height").trim();
      const base = parseFloat(configured);
      const baseHeight = Number.isFinite(base) ?
        (configured.endsWith("rem") ? base * (parseFloat(rootComputed.fontSize) || 16) : base) : 88;
      rootStyle.setProperty("--composer-form-height", formHeight + "px");
      rootStyle.setProperty("--composer-live-height", Math.max(formHeight, baseHeight) + "px");
      return formHeight;
    }
    function changed() {
      if (composing) return;
      update();
      detectTrigger();
    }
    function caretRange() {
      const sel = global.getSelection?.();
      if (!sel?.rangeCount) return null;
      const range = sel.getRangeAt(0);
      return editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
    }
    function remember() { const range = caretRange(); if (range) selectedRange = range; }
    function setCaret(range) {
      // Restoring a selection in a blurred mobile contenteditable can wake
      // the IME on some WebViews. Keep the range without forcing focus.
      if (!mobile() || doc.activeElement === editor) {
        const selection = global.getSelection?.();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      selectedRange = range.cloneRange();
    }
    function focusEnd() {
      if (!mobile()) editor.focus();
      const range = doc.createRange();
      range.selectNodeContents(editor); range.collapse(false);
      setCaret(range);
    }
    function refIcon(item) {
      if (item.iconKey) {
        const trusted = global.OvllSvgLibrary?.get?.(item.iconKey);
        if (trusted) return trusted;
      }
      return svg(item.type === "node_type" ? "workflow" : "canvas");
    }
    function createTag(item) {
      const tag = doc.createElement("span");
      tag.className = "ovll-rich-ref";
      tag.contentEditable = "false";
      tag.dataset.ovllRefKind = item.type;
      tag.dataset.ovllRefId = escapeId(item.id);
      tag.dataset.ovllRefLabel = String(item.label || "").slice(0, 120);
      tag.title = String(item.detail || item.id || "");
      tag.innerHTML = refIcon(item);
      const title = doc.createElement("span");
      title.textContent = item.label;
      tag.appendChild(title);
      tag.addEventListener("click", event => {
        event.stopPropagation();
        selectedTag = tag;
        prepareManualPicker();
        openMenu("tag");
      });
      return tag;
    }
    function insertTag(item) {
      let range = mentionRange || selectedRange || caretRange();
      if (!range || !editor.contains(range.commonAncestorContainer)) {
        range = doc.createRange(); range.selectNodeContents(editor); range.collapse(false);
      }
      if (!mobile()) editor.focus();
      range.deleteContents();
      const tag = createTag(item);
      const space = doc.createTextNode(" ");
      range.insertNode(space);
      range.insertNode(tag);
      range.setStartAfter(space); range.collapse(true);
      setCaret(range);
      selectedTag = null; mentionRange = null;
      closeMenu();
      update();
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function knownReferences() {
      const defs = config.getDefinitions?.() || {};
      const refs = [];
      for (const [id, definition] of Object.entries(defs)) {
        if (!definition || !definition.name) continue;
        refs.push({ type: "node_type", id, label: String(definition.name),
          detail: String(definition.desc || "기존 노드 정의"),
          iconKey: definition.iconKey, category: "노드" });
      }
      for (const node of config.getCanvasNodes?.() || []) {
        const id = node?.id || node?.nodeId;
        if (!id) continue;
        const type = node.type || node.definitionType;
        const def = defs[type] || {};
        refs.push({ type: "node_instance", id, label: node.name || node.label || def.name || "캔버스 노드",
          detail: "캔버스에 배치된 노드", iconKey: def.iconKey, category: "캔버스" });
      }
      for (const fn of config.getFunctions?.() || []) {
        if (!fn?.id) continue;
        refs.push({ type: "function", id: fn.id, label: fn.name || fn.title || fn.purpose || "저장 함수",
          detail: fn.purpose || "저장된 함수", iconKey: fn.iconKey || "custom", category: "함수" });
      }
      return refs;
    }
    function prepareManualPicker() {
      remember();
      // Opening a picker is not an intent to type. Dismiss an existing IME,
      // but retain the saved range so choosing a node never reopens it.
      if (mobile() && doc.activeElement === editor) editor.blur();
    }
    function closeMenu() {
      picker.hidden = true;
      picker.replaceChildren();
      openType = ""; entries = []; mentionRange = null; selectedTag = null;
      mention.setAttribute("aria-expanded", "false");
      canvas.setAttribute("aria-expanded", "false");
      commands.setAttribute("aria-expanded", "false");
    }
    function listFor(type) {
      if (type === "tag") return [{ action: "remove-tag", label: "참조 삭제", detail: "선택한 태그만 제거", icon: "close" }];
      if (type === "commands") return [
        { action: "nodes", label: "노드 태그", detail: "기존 노드를 지정", icon: "mention" },
        { action: "canvas", label: "캔버스 참조", detail: "현재 캔버스 노드를 지정", icon: "canvas" },
        ...(attachmentEnabled && attach && !attach.hidden ?
          [{ action: "attach", label: "파일 추가", detail: "기존 첨부 기능 사용", icon: "folder" }] : []),
        { action: "newline", label: "줄바꿈", detail: "커서 위치에 새 줄 삽입", icon: "enter" }
      ];
      const refs = knownReferences();
      return type === "canvas" ? refs.filter(x => x.type === "node_instance") : refs;
    }
    function renderMenu() {
      picker.replaceChildren();
      if (!entries.length) {
        const empty = doc.createElement("p");
        empty.className = "ovll-rich-empty";
        empty.textContent = openType === "canvas" ? "캔버스에 참조할 노드가 없어" : "검색 결과가 없어";
        picker.append(empty); return;
      }
      entries.slice(0, 40).forEach((item, i) => {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "ovll-rich-option" + (selectedIndex === i ? " is-selected" : "");
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-selected", String(selectedIndex === i));
        const icon = doc.createElement("span");
        icon.className = "ovll-rich-option-icon";
        icon.innerHTML = item.action ? svg(item.icon) : refIcon(item);
        const info = doc.createElement("span");
        info.className = "ovll-rich-option-label";
        const name = doc.createElement("strong");
        name.textContent = item.label;
        const detail = doc.createElement("small");
        detail.textContent = item.detail || "";
        info.append(name, detail); btn.append(icon, info);
        if (item.category) {
          const cat = doc.createElement("small");
          cat.className = "ovll-rich-option-kind";
          cat.textContent = item.category;
          btn.append(cat);
        }
        btn.addEventListener("pointerdown", e => e.preventDefault());
        btn.addEventListener("click", () => choose(item));
        picker.append(btn);
      });
    }
    function openMenu(type, search, queryRange) {
      if (picker.hidden || openType !== type) remember();
      openType = type;
      if (queryRange) mentionRange = queryRange;
      const query = String(search || "").trim().toLowerCase();
      entries = listFor(type).filter(x => !query ||
        [x.label, x.detail, x.id].some(y => String(y || "").toLowerCase().includes(query)));
      selectedIndex = 0;
      picker.hidden = false;
      renderMenu();
      mention.setAttribute("aria-expanded", String(type === "nodes"));
      canvas.setAttribute("aria-expanded", String(type === "canvas"));
      commands.setAttribute("aria-expanded", String(type === "commands"));
    }
    function insertText(text) {
      const range = selectedRange || caretRange();
      if (!mobile()) editor.focus();
      if (!range || !editor.contains(range.commonAncestorContainer)) { focusEnd(); return insertText(text); }
      range.deleteContents();
      const node = doc.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node); range.collapse(true);
      setCaret(range);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function choose(item) {
      if (!item) return;
      if (!item.action) { insertTag(item); return; }
      if (openType === "commands" && mentionRange) {
        selectedRange = mentionRange.cloneRange();
        selectedRange.deleteContents();
        selectedRange.collapse(true);
      }
      if (item.action === "remove-tag" && selectedTag) {
        selectedTag.remove(); closeMenu(); update();
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (item.action === "attach") {
        closeMenu(); attach?.click();
      } else if (item.action === "newline") {
        closeMenu(); insertText("\n");
      } else if (item.action === "nodes" || item.action === "canvas") {
        closeMenu(); openMenu(item.action);
      }
    }
    function detectTrigger() {
      if (composing) return;
      const range = caretRange();
      if (!range?.collapsed || range.startContainer.nodeType !== 3) {
        if (openType === "nodes" || openType === "commands") closeMenu();
        return;
      }
      const before = range.startContainer.data.slice(0, range.startOffset);
      const match = before.match(/(?:^|\s)([@/])([^\s@/]*)$/u);
      if (!match) {
        if (openType === "nodes" || openType === "commands") closeMenu();
        return;
      }
      const queryRange = doc.createRange();
      queryRange.setStart(range.startContainer, range.startOffset - match[2].length - 1);
      queryRange.setEnd(range.startContainer, range.startOffset);
      openMenu(match[1] === "@" ? "nodes" : "commands", match[2], queryRange);
    }
    function setDraft(value) {
      editor.replaceChildren();
      const items = Array.isArray(value) ? value : [{ type: "text", text: String(value || "") }];
      for (const p of items) {
        if (!p || typeof p !== "object") continue;
        if (p.type === "text") editor.append(doc.createTextNode(String(p.text || "")));
        else if (["node_type", "node_instance", "function"].includes(p.type) &&
          typeof p.id === "string" && typeof p.label === "string") {
          const defs = config.getDefinitions?.() || {};
          const iconKey = p.type === "node_type" ? defs[p.id]?.iconKey : "";
          editor.append(createTag({ ...p, iconKey }));
        }
      }
      closeMenu(); update();
    }
    function clear() { setDraft(""); }
    function setBusy(value) { busy = !!value; update(); }
    function setAttachmentEnabled(value) {
      attachmentEnabled = !!value;
      if (attach) attach.hidden = !attachmentEnabled;
    }
    function setPlaceholder(value) {
      editor.dataset.placeholder = String(value || "무엇을 할까요?");
    }
    editor.addEventListener("input", changed);
    editor.addEventListener("compositionstart", () => { composing = true; });
    editor.addEventListener("compositionend", () => { composing = false; changed(); });
    editor.addEventListener("paste", event => {
      const clipboard = event.clipboardData?.getData("text/plain");
      if (typeof clipboard !== "string") return;
      event.preventDefault(); remember(); insertText(clipboard);
    });
    editor.addEventListener("keydown", event => {
      if (event.isComposing || composing || event.keyCode === 229) return;
      if (!picker.hidden) {
        if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopImmediatePropagation();
          selectedIndex = (selectedIndex + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % Math.max(entries.length, 1);
          renderMenu(); return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault(); event.stopImmediatePropagation();
          choose(entries[selectedIndex]); return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey && !mobile()) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!submit.disabled) form.requestSubmit();
      }
    });
    editor.addEventListener("keyup", remember);
    editor.addEventListener("mouseup", remember);
    editor.addEventListener("blur", () => { if (openType === "tag") return; });
    [mention, canvas, commands].forEach(btn => btn.setAttribute("aria-expanded", "false"));
    [mention, canvas, commands].forEach(btn => {
      btn.addEventListener("pointerdown", remember);
    });
    mention.addEventListener("click", () => { prepareManualPicker(); openMenu("nodes"); });
    canvas.addEventListener("click", () => { prepareManualPicker(); openMenu("canvas"); });
    commands.addEventListener("click", () => { prepareManualPicker(); openMenu("commands"); });
    form.addEventListener("submit", syncValue, { capture: true });
    doc.addEventListener("pointerdown", event => {
      if (!form.contains(event.target)) closeMenu();
    });
    setDraft(input.value);
    const api = { element: editor, resize, getParts: parts, getValue: plainValue,
      hasRefs, setDraft, clear, setBusy, setPlaceholder, setAttachmentEnabled,
      focus: () => editor.focus(), closeMenu };
    form.ovllRichComposer = api;
    return api;
  }
  global.OvllComposer = Object.freeze({ mount });
})(window);
