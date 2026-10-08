# Artifact Rendering and Preview Quality Design

Date: 2026-10-05

## Goal

Make generated ovll artifacts look and behave like deliberate, professional documents instead of thin text dumps, while preserving safe previews and avoiding format-specific corruption.

This design covers the complete path:

`runtime values -> artifact content normalization -> format renderer -> artifact storage -> local persistence -> shared preview engine -> chat/library preview`

The target is not decorative excess. The target is strong hierarchy, readable typography, stable page composition, faithful content structure, and predictable previews.

## Evidence from the current shipped output

A real generated one-page Korean PDF was visually inspected at 200 DPI.

Observed characteristics:
- title is readable but visually detached from the document body
- chapter-like lines such as `제1장:`, `제2장:`, `제3장:` are rendered as ordinary body text instead of section headings
- almost the entire document is one typographic level
- horizontal rhythm is weak because paragraphs and section transitions use nearly the same spacing
- page composition is top-heavy with a large unused lower area
- footer uses a generic result label instead of useful document identity
- the PDF contains non-embedded `HYSMyeongJo-Medium` / `HYGoThic-Medium` CID fonts, confirming the sample used the built-in PDF fallback rather than the Chromium HTML renderer
- the visual result is materially below what the existing HTML/CSS renderer could produce

The extracted text still contains three semantic sections, so the hierarchy exists in the content and is being lost during rendering rather than being absent from the source.

## Current root causes

### 1. Artifact content has no canonical semantic representation

`createFile` forwards upstream runtime values to `/api/create-artifact`.

Those values may be:
- a final text string
- a Gemini result object
- a workflow file descriptor
- arrays of values
- nested objects

`artifactStore.sourceText()` currently serializes arbitrary objects using `key: value` recursion.

That means runtime transport structure can leak into actual document content and every renderer must independently guess what part is meaningful.

### 2. PDF has two independent document parsers

The Chromium renderer in `pdfRenderer.js` parses source text into HTML.

The built-in fallback in `artifactStore.js` separately parses the same text into PDF blocks.

The two paths do not share one semantic document model. They can therefore disagree about:
- headings
- paragraphs
- tables
- code fences
- lists
- title extraction
- inferred structure

Renderer choice can change the meaning and hierarchy of the same artifact.

### 3. The deployed environment can fall into a much weaker PDF backend

`renderPdfWithChrome()` only works when a Chrome-compatible executable is already available through the host environment or configured path.

The repository currently does not provide a Chromium runtime dependency.

When Chrome is unavailable, PDF generation uses the custom byte-level fallback.

The inspected real output came from that fallback.

### 4. Built-in PDF typography is not deterministic

The fallback references Korean CID fonts but does not embed them.

Consequences:
- visual output depends on the PDF viewer/platform
- glyph metrics are approximated manually
- no modern Korean font family/weight system can be guaranteed
- line wrapping cannot faithfully match actual rendered glyph widths

### 5. Section inference is too Markdown-specific

The real source uses natural Korean report headings such as:
- `제1장: ...`
- `제2장: ...`
- `제3장: ...`

These are meaningful headings but are not Markdown `##` headings.

The current parsers therefore render them as normal paragraph content.

### 6. HTML artifact normalization is too narrow

`stripHtmlFence()` only unwraps a fenced HTML block when the whole source is exactly one fence.

Common model output such as:

`설명 문장 + fenced HTML`

can therefore be stored with the explanatory wrapper or fence markers mixed into the output document.

Fragments, full documents, fenced documents, and prose-wrapped documents currently share one heuristic path.

### 7. Generic previewText can override the actual artifact representation

Every stored artifact gets `previewText: sourceText(sources).slice(0, 6000)`.

The shared preview engine resolves content generically.

For an HTML artifact, the actual stored bytes should be authoritative. Generic source text must not win over the normalized HTML artifact bytes.

### 8. Binary office formats can be treated like text

`previewKind()` currently classifies DOCX as text/document-preview input.

`previewText()` first attempts `blob.text()` for any local blob.

A local DOCX/XLSX-like binary ZIP container must never be decoded as arbitrary text for preview.

The preview source must be selected by format capability, not by whether a Blob happens to expose `.text()`.

## External technical basis

### Browser PDF generation

Chrome officially supports headless HTML-to-PDF via `--print-to-pdf`.

Modern Puppeteer PDF generation additionally exposes:
- `printBackground`
- `preferCSSPageSize`
- `waitForFonts`
- tagged PDF generation
- document outline generation

The PDF implementation should use CSS paged-media rules rather than manually approximating page layout whenever Chromium is available.

### Paged media

Use:
- `@page`
- `break-before`
- `break-after`
- `break-inside`
- `orphans`
- `widows`

for print pagination.

Do not build new behavior around deprecated `page-break-*` properties except as compatibility aliases.

### HTML sandboxing

HTML preview remains isolated using an iframe sandbox.

Scripts may run only inside the sandbox.

Do not grant `allow-same-origin`.

A sandboxed `srcdoc` without `allow-same-origin` receives an opaque origin, which prevents access to the parent page origin/storage.

Network, popups, top navigation, forms, frame nesting, and object embedding remain denied unless a future explicit requirement changes that policy.

## Design principles

### One semantic document, many renderers

Content interpretation happens once.

PDF HTML rendering, PDF fallback rendering, HTML generation, Markdown preview, and document preview consume the same canonical semantic representation where applicable.

### Actual artifact bytes are authoritative

For formats that can be rendered directly, preview the actual stored artifact.

`previewText` is metadata/fallback, not a substitute for the generated file.

### Binary formats are never guessed as text

Text decoding is allowed only for explicit text-capable formats.

### Professional hierarchy comes from source meaning

Do not invent claims, summaries, dates, authors, or extra content.

Styling may infer structure from strong textual signals such as chapter labels, but may not create unsupported substantive content.

### Primary quality must work in the real deployment

A beautiful renderer that is never selected in production is not a solution.

The Chromium availability problem must be solved or the fallback must itself meet a strong minimum quality bar.

## Proposed architecture

Introduce a server-side canonical artifact content module:

`artifactDocument.js`

Responsibilities:
- normalize runtime artifact sources
- select actual content-bearing values from wrappers
- preserve source order
- produce a canonical document model
- extract runnable HTML when the requested format is HTML
- expose plain text/preview text without transport metadata

`artifactStore.js` becomes storage + format dispatch.

`pdfRenderer.js` becomes PDF-specific rendering from the canonical document model.

`front/js/previewSandbox.js` becomes format-aware preview source resolution + sandboxed rendering.

## Canonical document model

Initial model:

```js
{
  title: string,
  blocks: [
    { type: "heading", level: 1 | 2 | 3, text: string },
    { type: "paragraph", text: string },
    { type: "list", ordered: boolean, items: string[] },
    { type: "quote", text: string },
    { type: "code", language: string, text: string },
    { type: "table", headers: string[], rows: string[][] },
    { type: "rule" }
  ],
  plainText: string,
  truncated: boolean
}
```

Do not place renderer CSS or runtime edge metadata in this model.

## Source normalization

Artifact source extraction follows explicit precedence.

### Text-bearing Gemini/workflow result

If a source is an object, inspect known semantic fields before generic serialization:
- `outputs.result`
- `result`
- `text`
- `content`
- `markdown`
- `html`

Only use a generic object representation when there is no known content-bearing value and the requested output format actually benefits from structured data, such as JSON/CSV/XLSX.

### Workflow file descriptor

For `workflow-file` objects:
- prefer `text` when present
- keep `textTruncated` as metadata
- do not render `kind`, `id`, `mime`, `size`, or `source` as document prose

### Multiple sources

Preserve order.

Do not repeat identical content.

Separate independent text sources with semantic section boundaries rather than arbitrary `key: value` flattening.

## Document structure recovery

The canonical parser supports Markdown plus conservative natural-document structure.

Recognize:
- Markdown headings
- fenced code
- Markdown tables
- ordered/unordered lists
- blockquotes
- rules
- blank-line paragraph boundaries

Also recognize natural section headings when they satisfy conservative patterns:
- `제1장:`, `제2장:`, `제3장:`
- `1. 제목` / `1) 제목` when short and followed by body content
- short standalone lines followed by paragraph text when surrounding evidence strongly indicates a heading

Do not promote ordinary sentences ending in punctuation.

The sample's `제1장`, `제2장`, `제3장` lines must become level-2 section headings.

## PDF visual system

### Overall composition

Target visual language:
- clean Korean editorial/report document
- quiet neutral palette
- strong but restrained title
- clear section rhythm
- compact readable body measure
- deliberate whitespace
- no generic office-template decoration

### Page

A4 portrait.

Use approximately:
- top margin: 18-20 mm
- side margins: 18-20 mm
- bottom margin: 18-20 mm

Keep text measure in a comfortable report range rather than stretching the full page.

### Typography

Primary family:
- deterministic Korean-capable sans-serif

Preferred implementation:
- self-hosted Noto Sans KR variable font or equivalent open font loaded by the PDF renderer
- 400/500/650-700-equivalent hierarchy

Approximate hierarchy:
- document title: 24-28 pt equivalent
- section heading: 14-16 pt equivalent
- subsection: 11.5-13 pt equivalent
- body: 9.8-10.5 pt equivalent
- metadata/footer: 7.5-8 pt equivalent

Body line height:
- approximately 1.65-1.75

Use Korean-friendly word breaking:
- `word-break: keep-all`
- `overflow-wrap: anywhere` only as emergency overflow protection

### Title area

The title should feel connected to the body.

Use:
- compact upper spacing
- strong title
- subtle document rule/accent
- optional neutral subtitle only when source metadata explicitly contains one

Do not fabricate an author/date.

### Section headings

Natural chapter headings become visible sections.

Use:
- larger weight/size
- generous top spacing
- smaller bottom spacing
- optional chapter number treatment using typography, not decorative boxes

Do not render `제1장:` as ordinary body text.

### Paragraphs

Use actual paragraph blocks.

Do not concatenate unrelated lines into one giant paragraph.

Use:
- 3-5 mm paragraph rhythm
- `orphans: 3`
- `widows: 3`

### Lists

Real bullets/numbers with hanging indentation.

Avoid page breaks between a marker and its first line.

### Tables

Render actual tables.

Use:
- repeated table headers
- subtle header fill
- restrained borders
- numeric/content alignment when safely inferred
- row break avoidance where practical

Never collapse a table into `Header: value · Header: value` prose in the primary renderer.

### Code

Use a real monospace block with:
- muted surface
- border
- preserved indentation
- sensible wrapping/overflow policy
- page splitting only when necessary

### Quotes/callouts

Use restrained left rule/background.

### Footer

Use real document title, not generic `결과물`, when title is known.

Include page number.

Do not repeat long titles beyond a safe length.

## Chromium PDF backend

Move from raw CLI-only execution to a controllable browser API when practical.

Recommended backend:
- `puppeteer-core`
- an explicitly provisioned Chromium executable for the deployment

For serverless-compatible environments, `@sparticuz/chromium` is a viable backend, but it is large and must be adopted only with deployment-size awareness.

PDF options:
- `printBackground: true`
- `preferCSSPageSize: true`
- `waitForFonts: true`
- `tagged: true` where supported
- `outline: true` where supported
- header/footer disabled because ovll owns document footer styling

Wait for `document.fonts.ready` before printing.

## Korean font provisioning

The current inspected fallback does not embed a deterministic font.

Use a self-hosted Korean font package instead of depending on host-installed fonts.

Preferred candidate:
- `@fontsource-variable/noto-sans-kr`

The renderer should resolve the local font asset and make it available to the generated print document.

Do not fetch Google Fonts or other remote font resources at render time.

## Built-in PDF fallback

The fallback remains because artifact generation should not become unavailable solely because Chromium launch fails.

However, it must consume the canonical document model rather than re-parse source text.

Minimum fallback requirements:
- same heading recognition as Chromium
- real section spacing
- paragraphs/lists/quotes/code
- table rows with column layout when feasible
- page-number footer
- document title footer
- no runtime wrapper metadata
- no Markdown markers leaking into output

The fallback is a resilience mode, not the preferred visual backend.

Artifact metadata must expose the renderer used so diagnostics can identify fallback frequency.

## HTML artifact normalization

Create a dedicated HTML extraction function.

Accepted inputs:
1. complete HTML document
2. one fenced HTML document
3. prose plus one fenced HTML document
4. HTML fragment
5. structured object containing `html`, optionally `css`, optionally `js`
6. plain prose

Rules:

### Complete document

Preserve document markup.

Ensure:
- doctype
- UTF-8 charset

### Fenced HTML

Select the strongest HTML fence.

Strip the fence markers.

If prose exists outside the fence, do not inject that prose into the rendered document.

### Structured HTML/CSS/JS input

Build one isolated document:
- HTML becomes body/markup
- CSS becomes inline `<style>`
- JS becomes inline `<script>`

### Fragment

Wrap in a complete UTF-8 document.

### Plain prose

Escape it and render it as semantic paragraphs.

Never place raw Markdown fence markers into the resulting HTML artifact.

## Artifact preview metadata

Replace generic preview semantics with format-aware metadata.

Suggested artifact fields:

```js
{
  id,
  name,
  format,
  mime,
  size,
  renderer,
  previewKind,
  previewText,
  previewUrl,
  downloadUrl
}
```

`previewText` policy:
- TXT/MD/JSON/JS/CSS/XML/CSV: meaningful text
- DOCX/RTF: semantic source text only
- HTML: optional source fallback, but never preferred over actual artifact bytes
- PDF/image/audio/video/binary office container: no arbitrary binary-decoded preview text

## Frontend preview source policy

The shared preview engine chooses its source by format.

### HTML

Priority:
1. local HTML Blob bytes
2. remote artifact bytes
3. normalized HTML preview fallback

Never prefer generic raw source text over generated HTML bytes.

### PDF

Priority:
1. local object URL
2. remote inline artifact URL

Use the browser PDF viewer in an unsandboxed viewer frame when required by browser PDF support. The PDF itself is inert document content and must not share the HTML execution sandbox configuration.

### Image

Use local object URL first, then remote URL.

### Markdown

Read text and render through the existing semantic document renderer.

### TXT

Plain text.

### JSON / JS / CSS / XML

Code preview with bounded lines/characters.

### CSV

Table-oriented preview when parseable, text fallback otherwise.

### DOCX / XLSX

Never call `blob.text()`.

Use stored semantic preview text/data created at artifact generation time.

### Unknown binary

No inline preview.

Offer file metadata/download only.

## HTML sandbox policy

Keep:
- iframe `sandbox="allow-scripts"`
- no `allow-same-origin`
- `referrerpolicy="no-referrer"`

CSP remains restrictive:
- default none
- inline script allowed inside opaque sandbox
- inline style allowed
- image/media limited to data/blob
- network connect denied
- frames denied
- objects denied
- forms denied through sandbox
- top navigation denied through sandbox

Add a stable generated base URL policy so relative anchors do not unexpectedly target the parent document.

Do not weaken sandboxing simply to make external CDN assets work.

Generated HTML should be self-contained for reliable preview.

## Preview UI

The shared preview panel should visually distinguish rendering modes without adding clutter.

### HTML

- full content viewport
- neutral canvas behind iframe
- iframe fills available preview panel
- loading state until frame is attached
- optional subtle `격리 미리보기` micro-label in metadata, not a large warning

### PDF

- maximize vertical document area
- remove unnecessary padding around viewer
- use correct aspect/fit behavior
- keep file header/actions compact

### Text/document

- readable maximum line length
- document typography for MD/DOCX/RTF source preview
- code typography only for code formats

### Mobile

- preview panel uses available viewport height
- header remains reachable
- content scroll belongs to the preview body, not nested unnecessary wrappers

## Local persistence

Generated artifact bytes are persisted locally as the authoritative file.

Metadata stored with local file includes:
- format
- renderer
- previewKind
- semantic preview text when applicable
- origin artifact ID

Hydration must not let old generic preview text replace richer local metadata.

## Server artifact response

Keep:
- correct Content-Type
- `nosniff`
- explicit attachment/inline disposition

For HTML artifacts served from the artifact endpoint, add defense-in-depth response headers appropriate for direct navigation:
- restrictive CSP
- no opener relationship where supported
- no framing assumptions beyond the dedicated preview pipeline

The normal ovll HTML preview should still use sandboxed local/remote bytes rather than directly navigating the top-level app to generated HTML.

## Testing

### Canonical content tests

Prove:
- `{ outputs: { result: "..." } }` yields only the result text
- workflow-file metadata does not appear as document prose
- `file.text` is used when present
- multiple sources preserve order
- natural Korean `제1장:` headings become semantic headings
- Markdown headings/lists/tables/code remain structured

### PDF tests

Primary renderer tests:
- semantic document generates print HTML with expected heading/table/code classes
- print CSS contains paged-media controls
- Korean font is explicitly loaded
- renderer reports Chromium vs fallback accurately

Visual fixture test:
- generate a report equivalent in structure to the provided one-page sample
- render the generated PDF to PNG
- assert PDF validity and renderer metadata
- manually inspect reference render during implementation for hierarchy, clipping, page balance, and glyph quality

Fallback tests:
- natural chapter headings are visually distinct
- no Markdown/fence markers leak
- table fallback remains columnar rather than key/value prose when possible

### HTML artifact tests

Prove:
- complete HTML preserved
- fenced HTML unwrapped
- prose + fenced HTML selects the fenced document
- fragment wrapped
- structured `{html, css, js}` assembled
- no fence markers leak into stored bytes

### Preview engine tests

Prove:
- HTML local blob wins over stale `previewText`
- HTML remote bytes win over source fallback
- DOCX/XLSX local blob is never passed to `blob.text()`
- PDF uses URL/object URL path
- Markdown uses document renderer
- code formats remain bounded
- unknown binary refuses inline preview

### Sandbox tests

Prove:
- `allow-scripts` present
- `allow-same-origin` absent
- CSP blocks connect/frame/object
- source receives UTF-8 metadata
- relative base behavior is deterministic

### UI regression tests

Prove:
- chat and library both call the same shared preview engine
- preview header/actions remain accessible
- mobile preview content does not overflow behind global controls
- new browser scripts are included in boot/service-worker cache when applicable

## Rollout order

1. Canonical artifact content model and extraction tests.
2. Move HTML normalization onto canonical extraction.
3. Move PDF parsing onto canonical document model.
4. Improve PDF print HTML/CSS using paged-media controls.
5. Provision deterministic Korean font.
6. Add explicit controllable Chromium backend.
7. Keep and upgrade canonical-model fallback.
8. Make artifact metadata format-aware.
9. Refactor frontend preview source resolution by format.
10. Improve HTML sandbox document injection without weakening isolation.
11. Improve shared preview panel layout for HTML/PDF/document/code.
12. Run full tests and visual PDF render verification.
13. Bump `server.js` APP_VERSION for the deployed implementation.

## Success criteria

This work is complete only when:
- the provided sample structure would render `제1장`, `제2장`, `제3장` as real sections
- PDF title/body/section hierarchy is visibly professional rather than one-level text
- PDF output uses deterministic Korean typography in the preferred backend
- production no longer silently depends on a host-provided Chrome binary for high-quality output
- fallback output remains readable and semantically consistent if Chromium fails
- HTML artifacts preview the actual generated HTML rather than stale/raw wrapper text
- CSS and JavaScript execute only inside the isolated HTML preview
- HTML preview never receives parent-origin privileges
- DOCX/XLSX binary bytes are never decoded as generic text
- chat and library use the same format-aware preview engine
- no runtime wrapper metadata leaks into generated document prose
- no Markdown/code fences leak into HTML/PDF output
- the complete automated test suite passes
- the final PDF is re-rendered and visually inspected for clipping, overlap, broken glyphs, hierarchy, spacing, and page balance
- `server.js` APP_VERSION is incremented for the deployed code change

## References

- Chrome Headless supports `--print-to-pdf` and disabling default browser PDF header/footer.
- Puppeteer PDF generation supports print backgrounds, CSS page-size preference, font waiting, tagging, and outlines.
- CSS Paged Media / Fragmentation provide `@page`, `break-*`, `orphans`, and `widows` for print composition.
- MDN recommends sandboxing untrusted `srcdoc`; omitting `allow-same-origin` gives the sandbox an opaque origin.
- Fontsource provides self-hosted Noto Sans KR variable font assets under OFL-1.1.
- Serverless Chromium packages require explicit deployment-size/font consideration and should not be adopted as an invisible dependency.
