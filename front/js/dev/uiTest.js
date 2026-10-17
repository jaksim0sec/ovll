/**
 * TEMPORARY BETA VISUAL FIXTURE — not the actual Chat, Canvas or Composer.
 * Remove this module, stylesheet and boot/index references after UI QA.
 * It changes only the existing Workspace preview.
 */
export function mountUiTest({ workspace, app }) {
  if (!workspace || !app) throw new TypeError("UI test requires Workspace and App Shell elements");
  const lifetime = new AbortController();
  const { signal } = lifetime;

  // TEMPORARY: render a visible testing surface on the default Workspace route.
  workspace.classList.add("ui-test-workspace");
  workspace.innerHTML = `
    <div class="ui-test-heading">
      <div>
        <span class="ui-test-kicker">BETA · 임시 시각 테스트</span>
        <h1 id="workspace-title">워크스페이스</h1>
      </div>
      <button type="button" class="ui-test-toggle" data-test-toggle aria-controls="ui-test-controls" aria-expanded="true">조절 접기</button>
    </div>
    <div id="ui-test-controls" class="ui-test-controls">
      <label>테마
        <select data-theme>
          <option value="system">기기 설정</option>
          <option value="dark">다크</option>
          <option value="light">라이트</option>
        </select>
      </label>
      <label>페이지 영역 최대 높이 <output data-page-value>100%</output>
        <input type="range" data-page-height min="55" max="100" value="100">
      </label>
      <label>입력기 높이 <output data-input-value>96px</output>
        <input type="range" data-input-height min="56" max="240" value="96" step="4">
      </label>
    </div>
    <div class="ui-test-stage" aria-label="임시 페이지 영역">
      <div class="ui-test-surface">
        <section class="ui-test-preview">
          <span class="ui-test-preview-title">Chat</span>
          <p>대화 영역 미구현</p>
        </section>
        <section class="ui-test-preview">
          <span class="ui-test-preview-title">Canvas</span>
          <p>캔버스 영역 미구현</p>
        </section>
      </div>
    </div>
    <div class="ui-test-composer">
      <label for="ui-test-textarea">입력기 · 임시 목업</label>
      <textarea id="ui-test-textarea" data-composer rows="2" placeholder="텍스트 입력 및 모바일 키보드 확인"></textarea>
      <span>실제 Composer가 아님 · 전송/저장 없음</span>
    </div>`;

  const toggle = workspace.querySelector("[data-test-toggle]");
  const controls = workspace.querySelector("#ui-test-controls");
  const theme = workspace.querySelector("[data-theme]");
  const page = workspace.querySelector("[data-page-height]");
  const input = workspace.querySelector("[data-input-height]");
  const composer = workspace.querySelector("[data-composer]");

  toggle.addEventListener("click", () => {
    controls.hidden = !controls.hidden;
    toggle.setAttribute("aria-expanded", String(!controls.hidden));
    toggle.textContent = controls.hidden ? "테스트 조절" : "조절 접기";
  }, { signal });

  theme.addEventListener("change", () => {
    document.documentElement.dataset.uiTestTheme = theme.value;
  }, { signal });

  page.addEventListener("input", () => {
    // TEMPORARY: constrain the real Page Host, not an unrelated floating panel.
    app.style.setProperty("--ui-test-max-page-height", `${page.value}%`);
    workspace.querySelector("[data-page-value]").value = `${page.value}%`;
  }, { signal });

  input.addEventListener("input", () => {
    // TEMPORARY: resize the textarea located inside Workspace.
    composer.style.height = `${input.value}px`;
    workspace.querySelector("[data-input-value]").value = `${input.value}px`;
  }, { signal });

  app.classList.add("ui-test-active");
  app.style.setProperty("--ui-test-max-page-height", "100%");
  composer.style.height = "96px";

  return () => {
    lifetime.abort();
    workspace.classList.remove("ui-test-workspace");
    app.classList.remove("ui-test-active");
    app.style.removeProperty("--ui-test-max-page-height");
    delete document.documentElement.dataset.uiTestTheme;
  };
}
