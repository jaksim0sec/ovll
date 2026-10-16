/** TEMPORARY beta UI-test fixture. Delete this module and CSS after visual QA. */
export function mountUiTest({ root = document.querySelector("#app") } = {}) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../../css/uiTest.css", import.meta.url).href;
  document.head.append(link);

  const panel = document.createElement("aside");
  panel.className = "ui-test-panel";
  panel.setAttribute("aria-label", "임시 UI 테스트");
  panel.innerHTML = `
    <button class="ui-test-toggle" type="button" aria-expanded="false">UI 테스트 · 임시</button>
    <div class="ui-test-controls" hidden>
      <label>테마
        <select data-theme><option value="system">기기 설정</option><option value="dark">다크</option><option value="light">라이트</option></select>
      </label>
      <label>페이지 영역 높이 <output data-page-value>100%</output>
        <input type="range" data-page-height min="55" max="100" value="100">
      </label>
      <label>입력기 목업 높이 <output data-input-value>96px</output>
        <input type="range" data-input-height min="56" max="260" value="96" step="4">
      </label>
      <textarea data-input aria-label="임시 입력기 테스트" placeholder="입력·키보드·높이 테스트용 (전송/저장 없음)"></textarea>
      <small>임시 목업 · 실제 Composer가 아니며 입력은 저장되지 않음</small>
    </div>`;
  document.body.append(panel);

  const toggle = panel.querySelector(".ui-test-toggle");
  const controls = panel.querySelector(".ui-test-controls");
  const theme = panel.querySelector("[data-theme]");
  const page = panel.querySelector("[data-page-height]");
  const input = panel.querySelector("[data-input-height]");
  const textarea = panel.querySelector("[data-input]");
  const onToggle = () => {
    controls.hidden = !controls.hidden;
    toggle.setAttribute("aria-expanded", String(!controls.hidden));
  };
  const onTheme = () => { document.documentElement.dataset.uiTestTheme = theme.value; };
  const onPage = () => {
    root.style.setProperty("--ui-test-page-height", `${page.value}%`);
    panel.querySelector("[data-page-value]").value = `${page.value}%`;
  };
  const onInput = () => {
    textarea.style.height = `${input.value}px`;
    panel.querySelector("[data-input-value]").value = `${input.value}px`;
  };
  toggle.addEventListener("click", onToggle);
  theme.addEventListener("change", onTheme);
  page.addEventListener("input", onPage);
  input.addEventListener("input", onInput);
  root.classList.add("ui-test-active");
  onPage();
  onInput();

  return () => {
    panel.remove();
    link.remove();
    root.classList.remove("ui-test-active");
    root.style.removeProperty("--ui-test-page-height");
    delete document.documentElement.dataset.uiTestTheme;
  };
}
