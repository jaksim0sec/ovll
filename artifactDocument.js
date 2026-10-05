const MAX_TEXT_CHARS = 420000;

function normalizeNewlines(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineText(value) {
  return normalizeNewlines(value)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function semanticValue(value, depth = 0) {
  if (value == null) return "";

  if (typeof value === "string") {
    return normalizeNewlines(value).trim();
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (depth > 8) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(item => semanticValue(item, depth + 1))
      .filter(Boolean)
      .join("\n\n");
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (
    value.kind === "workflow-file" ||
    value.kind === "workflow-artifact"
  ) {
    if (
      typeof value.text === "string" &&
      value.text.trim()
    ) {
      return normalizeNewlines(value.text).trim();
    }

    if (
      typeof value.previewText === "string" &&
      value.previewText.trim()
    ) {
      return normalizeNewlines(value.previewText).trim();
    }
  }

  const semanticCandidates = [
    value?.outputs?.result,
    value.result,
    value.text,
    value.content,
    value.markdown,
    value.html
  ];

  for (const candidate of semanticCandidates) {
    const text = semanticValue(
      candidate,
      depth + 1
    );

    if (text) {
      return text;
    }
  }

  try {
    return JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    return "";
  }
}

export function extractArtifactContent(
  sources,
  options = {}
) {
  const list =
    Array.isArray(sources)
      ? sources
      : [sources];

  const seen = new Set();
  const values = [];
  let truncated = false;
  let length = 0;

  for (const source of list) {
    let text =
      semanticValue(source);

    if (!text) {
      continue;
    }

    text =
      normalizeNewlines(text)
        .trim();

    if (
      !text ||
      seen.has(text)
    ) {
      continue;
    }

    seen.add(text);

    const separator =
      values.length
        ? 2
        : 0;

    const remaining =
      MAX_TEXT_CHARS -
      length -
      separator;

    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (text.length > remaining) {
      text =
        text.slice(0, remaining);
      truncated = true;
    }

    values.push(text);
    length +=
      separator +
      text.length;
  }

  return {
    values,
    plainText:
      values.join("\n\n"),
    truncated:
      truncated ||
      options.truncated === true
  };
}

function tableCells(line) {
  const value =
    String(line || "")
      .trim();

  if (!value.includes("|")) {
    return [];
  }

  return value
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cell =>
      inlineText(cell)
    );
}

function isTableDivider(line) {
  const cells =
    tableCells(line);

  return (
    cells.length > 0 &&
    cells.every(cell =>
      /^:?-{3,}:?$/.test(
        cell.replace(/\s+/g, "")
      )
    )
  );
}

function looksLikeNaturalHeading(
  line,
  lines,
  index
) {
  const text =
    String(line || "")
      .trim();

  if (!text) {
    return 0;
  }

  if (
    /^제\s*\d+\s*장\s*[:：.\-]?\s*\S+/u
      .test(text)
  ) {
    return 2;
  }

  const numbered =
    text.match(
      /^(\d{1,2})[.)]\s+(.+)$/
    );

  if (
    numbered &&
    text.length <= 64
  ) {
    const next =
      lines
        .slice(index + 1)
        .find(value =>
          String(value || "").trim()
        )
        ?.trim() ||
      "";

    if (
      next &&
      !/^\d{1,2}[.)]\s+/.test(next) &&
      !/^[-*+]\s+/.test(next)
    ) {
      return 2;
    }
  }

  return 0;
}

export function createArtifactDocument(
  sources,
  {
    title = ""
  } = {}
) {
  const content =
    extractArtifactContent(
      sources
    );

  const lines =
    normalizeNewlines(
      content.plainText
    ).split("\n");

  const explicitTitle =
    inlineText(title);

  if (explicitTitle) {
    const firstIndex =
      lines.findIndex(line =>
        line.trim()
      );

    if (
      firstIndex >= 0 &&
      inlineText(
        lines[firstIndex]
      ) === explicitTitle
    ) {
      lines.splice(
        firstIndex,
        1
      );
    }
  }

  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    const text =
      inlineText(
        paragraph.join(" ")
      );

    if (text) {
      blocks.push({
        type: "paragraph",
        text
      });
    }

    paragraph = [];
  };

  const flushList = () => {
    if (
      list &&
      list.items.length
    ) {
      blocks.push(list);
    }

    list = null;
  };

  for (
    let index = 0;
    index < lines.length;
    index++
  ) {
    const raw =
      lines[index];
    const trimmed =
      raw.trim();

    if (
      /^(?:`{3,}|~{3,})/
        .test(trimmed)
    ) {
      flushParagraph();
      flushList();

      const fence =
        trimmed.startsWith("~")
          ? "~"
          : "`";

      const language =
        trimmed
          .replace(
            new RegExp(
              "^" +
              fence +
              "{3,}"
            ),
            ""
          )
          .trim();

      const code = [];

      index++;

      while (
        index < lines.length &&
        !new RegExp(
          "^" +
          fence +
          "{3,}"
        ).test(
          lines[index]
            .trim()
        )
      ) {
        code.push(
          lines[index]
        );
        index++;
      }

      blocks.push({
        type: "code",
        language:
          language.slice(0, 40),
        text:
          code
            .join("\n")
            .replace(
              /\t/g,
              "    "
            )
      });

      continue;
    }

    if (
      trimmed.includes("|") &&
      index + 1 <
        lines.length &&
      isTableDivider(
        lines[index + 1]
      )
    ) {
      flushParagraph();
      flushList();

      const headers =
        tableCells(trimmed);
      const rows = [];

      index += 2;

      while (
        index <
          lines.length &&
        lines[index].trim() &&
        lines[index]
          .includes("|")
      ) {
        rows.push(
          tableCells(
            lines[index]
          )
        );
        index++;
      }

      index--;

      blocks.push({
        type: "table",
        headers,
        rows
      });

      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const markdownHeading =
      trimmed.match(
        /^(#{1,3})\s+(.+)$/
      );

    if (markdownHeading) {
      flushParagraph();
      flushList();

      blocks.push({
        type: "heading",
        level:
          markdownHeading[1]
            .length,
        text:
          inlineText(
            markdownHeading[2]
          )
      });

      continue;
    }

    const naturalLevel =
      looksLikeNaturalHeading(
        trimmed,
        lines,
        index
      );

    if (naturalLevel) {
      flushParagraph();
      flushList();

      blocks.push({
        type: "heading",
        level:
          naturalLevel,
        text:
          inlineText(
            trimmed
          )
      });

      continue;
    }

    if (
      /^(?:-{3,}|\*{3,}|_{3,})$/
        .test(trimmed)
    ) {
      flushParagraph();
      flushList();

      blocks.push({
        type: "rule"
      });

      continue;
    }

    const unordered =
      trimmed.match(
        /^[-*+]\s+(.+)$/
      );

    const ordered =
      trimmed.match(
        /^\d+[.)]\s+(.+)$/
      );

    if (
      unordered ||
      ordered
    ) {
      flushParagraph();

      const orderedList =
        !!ordered;

      if (
        list &&
        list.ordered !==
          orderedList
      ) {
        flushList();
      }

      if (!list) {
        list = {
          type: "list",
          ordered:
            orderedList,
          items: []
        };
      }

      list.items.push(
        inlineText(
          (
            unordered ||
            ordered
          )[1]
        )
      );

      continue;
    }

    const quote =
      trimmed.match(
        /^>\s?(.*)$/
      );

    if (quote) {
      flushParagraph();
      flushList();

      blocks.push({
        type: "quote",
        text:
          inlineText(
            quote[1]
          )
      });

      continue;
    }

    paragraph.push(
      trimmed
    );
  }

  flushParagraph();
  flushList();

  const firstHeading =
    blocks.find(
      block =>
        block.type ===
          "heading" &&
        block.level === 1
    ) ||
    blocks.find(
      block =>
        block.type ===
          "heading"
    );

  return {
    title:
      explicitTitle ||
      firstHeading?.text ||
      "",
    blocks,
    plainText:
      content.plainText,
    truncated:
      content.truncated
  };
}

function ensureHtmlHead(
  source,
  title
) {
  let document =
    String(source || "")
      .trim();

  if (
    !/^\s*<!doctype\s+html/i
      .test(document)
  ) {
    document =
      "<!doctype html>" +
      document;
  }

  if (
    !/<html\b/i.test(document)
  ) {
    return "";
  }

  if (
    !/<head\b/i.test(document)
  ) {
    document =
      document.replace(
        /<html([^>]*)>/i,
        "<html$1><head></head>"
      );
  }

  if (
    !/<meta\s+[^>]*charset=/i
      .test(document)
  ) {
    document =
      document.replace(
        /<head([^>]*)>/i,
        match =>
          match +
          '<meta charset="utf-8">'
      );
  }

  if (
    title &&
    !/<title\b/i
      .test(document)
  ) {
    document =
      document.replace(
        /<head([^>]*)>/i,
        match =>
          match +
          "<title>" +
          escapeHtml(title) +
          "</title>"
      );
  }

  return document;
}

function htmlDocument(
  body,
  {
    title = "",
    css = "",
    js = ""
  } = {}
) {
  const style =
    css
      ? "<style>" +
        String(css) +
        "</style>"
      : "";

  const script =
    js
      ? "<script>" +
        String(js) +
        "</script>"
      : "";

  return (
    "<!doctype html>" +
    '<html lang="ko">' +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    (
      title
        ? "<title>" +
          escapeHtml(title) +
          "</title>"
        : ""
    ) +
    style +
    "</head>" +
    "<body>" +
    String(body || "") +
    script +
    "</body>" +
    "</html>"
  );
}

function strongestFencedHtml(
  text
) {
  const matches = [];
  const pattern =
    /(?:`{3,}|~{3,})\s*(?:html?|xml)?\s*\n([\s\S]*?)\n(?:`{3,}|~{3,})/gi;

  let match;

  while (
    (
      match =
        pattern.exec(text)
    )
  ) {
    matches.push(
      match[1].trim()
    );
  }

  if (!matches.length) {
    return "";
  }

  return matches
    .sort(
      (a, b) => {
        const markupScore =
          value =>
            /<!doctype\s+html|<html\b|<body\b|<main\b|<section\b|<article\b|<div\b/i
              .test(value)
              ? 1
              : 0;

        return (
          markupScore(b) -
          markupScore(a) ||
          b.length -
          a.length
        );
      }
    )[0];
}

export function extractHtmlArtifact(
  sources,
  {
    title = ""
  } = {}
) {
  const list =
    Array.isArray(sources)
      ? sources
      : [sources];

  for (const source of list) {
    if (
      source &&
      typeof source ===
        "object" &&
      !Array.isArray(source) &&
      (
        typeof source.html ===
          "string" ||
        typeof source.css ===
          "string" ||
        typeof source.js ===
          "string"
      )
    ) {
      const markup =
        String(
          source.html ||
          ""
        ).trim();

      if (
        /<html\b/i.test(markup)
      ) {
        let document =
          ensureHtmlHead(
            markup,
            title
          );

        if (source.css) {
          document =
            document.replace(
              /<\/head>/i,
              "<style>" +
              String(source.css) +
              "</style></head>"
            );
        }

        if (source.js) {
          document =
            document.replace(
              /<\/body>/i,
              "<script>" +
              String(source.js) +
              "</script></body>"
            );
        }

        return document;
      }

      return htmlDocument(
        markup,
        {
          title,
          css:
            source.css ||
            "",
          js:
            source.js ||
            ""
        }
      );
    }
  }

  const content =
    extractArtifactContent(
      list
    );

  const fenced =
    strongestFencedHtml(
      content.plainText
    );

  const source =
    fenced ||
    content.plainText
      .trim();

  if (!source) {
    return htmlDocument(
      "",
      {
        title
      }
    );
  }

  if (
    /<html\b/i.test(source)
  ) {
    return (
      ensureHtmlHead(
        source,
        title
      ) ||
      htmlDocument(
        source,
        {
          title
        }
      )
    );
  }

  const looksLikeMarkup =
    /<body\b|<main\b|<section\b|<article\b|<div\b|<h[1-6]\b|<p\b|<style\b|<script\b/i
      .test(source);

  if (looksLikeMarkup) {
    return htmlDocument(
      source,
      {
        title
      }
    );
  }

  const paragraphs =
    source
      .split(/\n\s*\n+/)
      .map(
        paragraph =>
          "<p>" +
          escapeHtml(
            paragraph
              .replace(
                /\n+/g,
                " "
              )
              .trim()
          ) +
          "</p>"
      )
      .join("");

  return htmlDocument(
    paragraphs,
    {
      title
    }
  );
}
