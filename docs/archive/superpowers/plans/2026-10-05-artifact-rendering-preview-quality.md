# Artifact Rendering and Preview Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn generated artifacts into professional, semantically structured files and make chat/library previews render the actual generated artifact safely and consistently.

**Architecture:** Introduce one server-side canonical document model that owns content extraction and structure recovery. PDF and HTML renderers consume that model instead of independently re-parsing runtime values, while the frontend shared preview engine selects a source by file capability so binary formats are never decoded as generic text and HTML bytes remain sandboxed.

**Tech Stack:** Node.js ESM, Express, browser JavaScript IIFEs, Chrome headless CLI when available, existing built-in PDF writer, CSS paged media, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-05-artifact-rendering-preview-quality-design.md`

## Global Constraints

- Do not add `@sparticuz/chromium` in this rollout: its Chromium payload is over 50 MB and the target deployment memory/package budget is not known.
- Do not add `puppeteer-core` merely as a wrapper: it does not provision Chrome and therefore does not solve the current deployment failure mode by itself.
- Keep the existing discovered/system Chromium path as an optional preferred backend.
- High-quality output must remain useful when Chromium is unavailable, because the real inspected sample used the built-in fallback.
- HTML preview keeps `sandbox="allow-scripts"` and MUST NOT add `allow-same-origin`.
- Generated HTML remains self-contained; network access stays blocked by CSP.
- Actual artifact bytes are authoritative for direct-renderable formats.
- Binary office containers must never be passed to `Blob.text()`.
- Do not duplicate document parsing between PDF renderers.
- Do not fabricate substantive content or metadata that is absent from the source.
- Every deployed code update bumps `server.js` `APP_VERSION`.
- Preserve current public artifact API URLs and local FileStore compatibility.

## Evidence / External Rulings

- Puppeteer `Page.pdf()` can honor CSS page size, print backgrounds, font waiting, tagging, and outlines, but `puppeteer-core` requires an explicitly provisioned executable.
- Serverless Chromium packages are large and can need substantial memory; therefore Chromium bundling is a deployment decision, not a hidden renderer dependency.
- MDN recommends sandboxing untrusted `srcdoc`; omitting `allow-same-origin` gives it an opaque origin.
- CSS paged-media/fragmentation properties `@page`, `break-inside`, `orphans`, and `widows` are the correct basis for print composition.
- Noto Sans KR is OFL-1.1 and suitable for deterministic Korean typography when a deployment font asset is provisioned. This rollout prepares the CSS/font hook but does not silently add a large font package without confirming deployment budget.

## Review Focus

- Runtime wrappers such as `{ outputs: { result } }` and workflow-file metadata must not leak into document prose.
- Natural Korean section labels such as `제1장:`, `제2장:`, `제3장:` must become semantic headings in both Chromium and fallback PDF output.
- A local DOCX/XLSX Blob must never be decoded with `.text()`; semantic preview metadata is the only text source for those formats.
- HTML containing prose around one fenced HTML document must render the fenced document without the wrapper prose or fence markers.
- The provided one-page gorani report structure must visibly show title/section hierarchy, paragraph rhythm, and balanced whitespace after fallback PDF rendering.

---

### Task 1: Canonical artifact content and document structure

**Files:**
- Create: `artifactDocument.js`
- Create: `test/artifactDocument.test.js`

**Interfaces:**
- Produces: `extractArtifactContent(sources, options) -> { values, plainText, truncated }`
- Produces: `createArtifactDocument(sources, { title }) -> { title, blocks, plainText, truncated }`
- Produces: `extractHtmlArtifact(sources, { title }) -> string`

- [ ] **Step 1: Write failing tests for semantic source extraction**

Cover:
- `{outputs:{result:"본문"}}` emits only `본문`
- workflow-file uses `text` and omits `kind/id/mime/size/source`
- duplicate identical sources are emitted once
- multiple semantic sources preserve order
- JSON-like arbitrary objects remain structurally serializable only when no semantic field exists

Run: `node --test test/artifactDocument.test.js`
Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement semantic extraction**

Known content-bearing fields win before generic object serialization:
`outputs.result`, `result`, `text`, `content`, `markdown`.

Workflow-file objects use `text` only.

- [ ] **Step 3: Add failing document-structure tests**

Cover:
- Markdown heading/list/table/code/quote/rule
- `제1장: ...`, `제2장: ...`, `제3장: ...` become level-2 headings
- short numbered headings `1. 제목` followed by prose may promote conservatively
- normal full sentences are not promoted
- title comes from explicit metadata, otherwise first level-1 heading

- [ ] **Step 4: Implement one canonical parser**

Return only the block types in the spec. Preserve paragraph boundaries and code indentation.

- [ ] **Step 5: Add failing HTML extraction tests**

Cover:
- complete document preserved
- fenced document unwrapped
- prose + one fenced HTML selects fence only
- fragment wrapped
- structured `{html,css,js}` assembled
- plain prose escaped into paragraphs
- no fence markers leak

- [ ] **Step 6: Implement `extractHtmlArtifact()`**

Ensure doctype + UTF-8. Do not sanitize away requested script/style content because execution isolation belongs to the preview sandbox; only normalize wrappers.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test test/artifactDocument.test.js`
Expected: PASS.

Commit: `feat: add canonical artifact document model`

---

### Task 2: Unify PDF renderers and materially improve fallback visual quality

**Files:**
- Modify: `pdfRenderer.js`
- Modify: `artifactStore.js`
- Modify: `test/artifactOutput.test.js`
- Test: `test/artifactDocument.test.js`

**Interfaces:**
- Consumes: `createArtifactDocument()`
- Changes: `renderPdfWithChrome({ document })`
- Produces: `renderPdfFallback(document, metadata) -> Buffer`

- [ ] **Step 1: Write failing renderer-parity tests**

Assert:
- Chromium print HTML and fallback consume the same canonical heading blocks
- natural Korean chapter headings appear as section headings, not paragraph text
- PDF artifact previewText comes from canonical plainText rather than runtime serialization
- renderer metadata remains `html-chromium` or `builtin-fallback`

- [ ] **Step 2: Move Chromium HTML generation to canonical blocks**

Remove independent Markdown parsing from `pdfRenderer.js`.

Generate semantic print HTML from document blocks.

Print CSS must include:
- A4 `@page`
- 18-20 mm margins
- `break-inside`
- `orphans:3`
- `widows:3`
- repeated table headers
- Korean `word-break:keep-all`
- explicit font hook using `OVLL_PDF_FONT_URL` when configured, then Noto/system fallbacks

- [ ] **Step 3: Write failing fallback hierarchy/table tests**

Force `OVLL_DISABLE_CHROME=1`.

Assert PDF byte content/layout commands distinguish level-1/2 headings and table cells are drawn column-by-column rather than flattened to `Header: value · ...`.

- [ ] **Step 4: Implement canonical fallback renderer**

Use the document blocks directly.

Improve:
- title/section typography
- chapter spacing
- paragraph rhythm
- hanging list indentation
- table column grid
- code/quote surfaces
- footer title + page numbers
- page-fill behavior without inventing content

Keep valid Korean CID output for resilience.

- [ ] **Step 5: Make artifactStore normalize once**

Create the canonical document once for PDF/MD/TXT/DOCX/RTF preview metadata.

Remove old PDF parsing responsibility from `artifactStore.js`.

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test test/artifactDocument.test.js test/artifactOutput.test.js`
Expected: PASS.

Commit: `fix: unify and upgrade PDF artifact rendering`

---

### Task 3: Make HTML artifact bytes the normalized executable document

**Files:**
- Modify: `artifactStore.js`
- Modify: `test/artifactOutput.test.js`

**Interfaces:**
- Consumes: `extractHtmlArtifact()`
- Artifact result adds stable `previewKind`

- [ ] **Step 1: Add failing artifact-store HTML tests**

Assert:
- prose + fenced HTML stores only generated document
- structured `{html,css,js}` stores one runnable HTML document
- `previewText` for HTML is a fallback and does not contain fence markers
- artifact response returns `previewKind:"html"`

- [ ] **Step 2: Route HTML build through canonical extractor**

Remove legacy `stripHtmlFence()/ensureHtmlDocument()` from `artifactStore.js`.

- [ ] **Step 3: Add format-aware preview metadata**

PDF=image-like direct viewer metadata, HTML=html, MD=document, JSON/JS/CSS/XML=code, CSV=spreadsheet/text-table, DOCX/RTF=document, XLSX=spreadsheet.

Binary direct-view formats receive no arbitrary binary-decoded preview text.

- [ ] **Step 4: Run artifact tests and commit**

Run: `node --test test/artifactOutput.test.js`
Expected: PASS.

Commit: `fix: normalize generated HTML artifact bytes`

---

### Task 4: Format-aware shared frontend preview source resolution

**Files:**
- Modify: `front/js/previewSandbox.js`
- Modify: `test/artifactOutput.test.js`
- Modify: `test/uiArchitecture.test.js`

**Interfaces:**
- Preserve: `OvllPreviewEngine.canPreview/kind/render`
- Add internal capability split: direct-binary URL, HTML bytes, semantic text, code text, document text

- [ ] **Step 1: Write failing preview-source tests**

Using a small fake DOM/Blob/FileStore harness, prove:
- HTML local blob bytes beat stale previewText
- HTML remote bytes beat previewText when no local blob
- DOCX/XLSX local blobs never call `blob.text()`
- PDF uses object/remote URL without text decoding
- unknown binary returns false for inline preview

- [ ] **Step 2: Refactor source resolution by preview capability**

Do not use one generic `previewText()` for every format.

HTML source order:
1. local blob text
2. remote artifact fetch
3. previewText fallback

Office binary:
- semantic previewText only
- no Blob text decoding

- [ ] **Step 3: Harden HTML sandbox document injection**

Keep `sandbox="allow-scripts"` only.

Keep CSP network/frame/object denial.

Inject deterministic `<base href="about:blank">` behavior so relative navigation does not target the parent app context.

- [ ] **Step 4: Improve CSV/document/code branches**

CSV becomes table-like preview when safely parseable, text fallback otherwise.

MD/DOCX/RTF use document renderer only when semantic text exists.

Code stays bounded.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test test/artifactOutput.test.js test/uiArchitecture.test.js`
Expected: PASS.

Commit: `fix: make artifact previews format aware`

---

### Task 5: Upgrade shared preview UI for PDF/HTML/document surfaces

**Files:**
- Modify: `front/css/chat.css`
- Modify: `front/js/app.js`
- Modify: `test/uiArchitecture.test.js`

**Interfaces:**
- Shared chat/library preview remains `AstraApp.previewArtifact()`
- Preview root receives format class/data attribute from the hydrated artifact

- [ ] **Step 1: Add failing architecture/style assertions**

Assert:
- preview remains shared by chat and library
- preview panel gets format-kind class/data
- PDF/HTML body has zero unnecessary content padding
- document/text mode remains scrollable with readable max width
- mobile panel uses dynamic viewport height and safe-area padding

- [ ] **Step 2: Attach preview kind to the root/panel**

No duplicate preview implementations.

- [ ] **Step 3: Refine layout CSS**

Desktop:
- wider panel for HTML/PDF
- compact header
- full-height render canvas
- neutral PDF/HTML backing surface

Mobile:
- `dvh`-aware height
- safe-area header
- content owns scrolling
- controls remain reachable

Document/text:
- measured text width
- stronger heading rhythm
- code remains monospace, not document typography

- [ ] **Step 4: Run UI tests and commit**

Run: `node --test test/uiArchitecture.test.js`
Expected: PASS.

Commit: `fix: refine shared artifact preview surfaces`

---

### Task 6: Visual regression, security headers, full verification, version, and main rollout

**Files:**
- Modify: `server.js`
- Modify: `test/artifactOutput.test.js`
- Verify: all changed files

**Interfaces:**
- No public route changes.
- HTML artifact inline response gains restrictive defense-in-depth CSP/referrer/opener headers where compatible with artifact preview fetching.

- [ ] **Step 1: Add failing server-header assertions**

For inline HTML artifact responses, assert:
- `X-Content-Type-Options: nosniff`
- restrictive CSP suitable for direct artifact navigation
- referrer policy
- no relaxation of iframe sandbox responsibility

- [ ] **Step 2: Add safe headers without breaking Blob/srcdoc preview**

The application preview fetches bytes and places them in its own sandbox; server headers are defense-in-depth for direct URL navigation.

- [ ] **Step 3: Generate a visual fixture equivalent to the uploaded gorani report**

Use the same structural shape:
- one title
- three `제N장:` sections
- several Korean paragraphs

Generate with Chromium when available and forced fallback separately.

- [ ] **Step 4: Render generated PDFs to PNG and inspect**

Use PDF render workflow at 200 DPI.

Verify:
- no clipping/overlap
- no broken Korean glyphs
- title clearly dominates
- three sections visibly distinct
- paragraph line length/rhythm improved
- footer document identity correct
- page balance materially improved versus the uploaded sample

If visual inspection finds a defect, add a regression test where representable before fixing it.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 0 failures.

- [ ] **Step 6: Re-read current main version and bump APP_VERSION**

Increment current main deployment version without overwriting concurrent bumps.

- [ ] **Step 7: Final whole-branch review**

Check:
- no duplicate parser remains
- no binary `Blob.text()` path for DOCX/XLSX
- no `allow-same-origin`
- no remote font/CDN dependency
- no hidden Chromium package-size increase
- no stale raw HTML source winning over artifact bytes
- no unrelated UI changes

- [ ] **Step 8: Merge/apply to main**

User explicitly requested application through main rollout. Merge only after verification evidence is collected.

Commit: `chore: bump app version for artifact rendering rollout`
