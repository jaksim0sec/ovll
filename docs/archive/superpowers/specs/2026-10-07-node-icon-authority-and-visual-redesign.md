# OVLL Node Icon Authority and Visual Redesign

Date: 2026-10-07

## Goal

Make node icons in OVLL visually coherent and make the server the single source of truth for built-in node icon SVGs.

The visual direction follows the provided reference: rounded monoline outline icons with consistent optical size, stroke weight, spacing, and corner treatment. Icons should remain legible at the current small node-header size.

## Authority

Built-in node icons are server-owned.

- `server.js` `defaultNodeDef.*.icon` is the canonical source for built-in node icon SVG.
- `front/js/api.js` must not replace built-in server icons with local frontend copies.
- `front/js/svgLibrary.js` must not own built-in node icons.
- Generic UI icons such as composer, canvas, copy, retry, node-add, and similar controls remain frontend-owned.
- Cached node definitions should preserve the icon returned by the server instead of normalizing it to a frontend icon set.
- Tests must enforce server authority for built-in node icons.

## Visual System

All built-in node icons use a shared visual grammar:

- `viewBox="0 0 20 20"`
- outline-first construction
- rounded line caps and joins
- visibly soft corner radii
- minimal or no solid fills
- balanced optical size across the set
- similar perceived stroke weight at node-header size
- simple silhouettes with as few internal details as possible
- no dependency on node background colors to carve out negative space

The icons keep their existing per-node color through `currentColor`.

CSS must not globally overwrite an SVG's authored stroke width. The SVG remains responsible for its own stroke geometry.

## Icon Mapping

### start — 시작하기

A rounded triangular play mark.

It should feel softer than the current icon, with noticeably rounded corners rather than a sharp media-player triangle.

### research — 조사하기

A globe.

Use a circular outer contour and a minimal longitude/latitude structure. Internal lines should be reduced enough to remain clean at 20x20.

### organize — 정리하기

A brain.

Use a symmetric, rounded brain outline with a simple center division. Avoid excessive folds.

### judge — 평가하기

Balance scales.

Use a compact, centered scale with rounded endpoints and shallow bowls. It should communicate judgement rather than completion or success.

### write — 작성하기

A broad pen-nib symbol.

The nib should be wider and rounder than the first visual proposal. Avoid a tall, narrow diamond silhouette. Prefer a squat, horizontally broader outer contour with generous corner radii and a simple center slit or ink detail.

This icon should occupy roughly the same perceived width as the globe and brain instead of reading as a thin vertical object.

### file — 파일 추가하기

A folder.

Use a rounded folder outline with a soft tab transition. Avoid a document-sheet metaphor.

### createFile — 생성하기

A rounded four-point sparkle/star.

Keep the concept but convert it to an outline form with strongly rounded transitions and enough inner breathing room to match the rest of the set.

## Optical Alignment

Exact geometric bounding boxes do not need to match. Perceived size does.

At the rendered node-header size:

- globe, brain, scales, pen, folder, and sparkle should feel similar in visual mass
- no icon should look noticeably smaller because of empty geometry
- no icon should look heavier because of large solid fill regions
- the pen icon may be slightly wider than the others to preserve the requested broader shape
- the whole set should feel more rounded than the supplied reference where doing so improves consistency

## Files Affected

Expected implementation scope:

- `server.js`
  - replace built-in node SVGs with the new rounded monoline set
- `front/js/api.js`
  - remove frontend built-in-icon override behavior
  - keep server-provided icons in fresh and cached node definitions
- `front/js/svgLibrary.js`
  - remove built-in node icon ownership/API
  - keep unrelated frontend UI icons
- `front/css/node.css`
  - remove or narrow the rule that forcibly overrides authored SVG stroke width
- `test/node-icon-authority.test.js`
  - invert authority tests so server SVGs remain authoritative

No unrelated node layout, execution, connection, parameter, or interaction behavior should change.

## Verification

Implementation must verify:

1. Fresh node definitions use the SVG returned by the server.
2. Cached definitions do not get replaced by frontend built-in icons.
3. `svgLibrary.js` no longer acts as the built-in node icon authority.
4. Custom-node icon handling is not regressed.
5. Every built-in node type still renders an SVG.
6. Node icon CSS does not destroy the SVG-authored stroke hierarchy.
7. Existing node behavior tests still pass.

## Success Criteria

The change is complete when:

- there is one canonical built-in node icon source, on the server
- the frontend no longer silently overrides those icons
- all seven built-in node icons visually belong to one rounded monoline family
- the write icon is noticeably broader and softer than the previous proposal
- the icons remain clear at the actual node size in both light and dark mode
