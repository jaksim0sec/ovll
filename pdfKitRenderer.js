import PDFDocument from "pdfkit";
import {
  createRequire
} from "node:module";
import {
  existsSync,
  readFileSync
} from "node:fs";
import path from "node:path";

const require =
  createRequire(
    import.meta.url
  );

const PT_PER_MM =
  72 / 25.4;

const PAGE = {
  width: 595.28,
  height: 841.89,
  marginTop:
    18 * PT_PER_MM,
  marginRight:
    18 * PT_PER_MM,
  marginBottom:
    20 * PT_PER_MM,
  marginLeft:
    18 * PT_PER_MM
};

let fontCache = null;
let fontBufferCache = null;

const TEXT_HEIGHT_CACHE_LIMIT =
  2048;
const textHeightCaches =
  new WeakMap();

function fontPackageRoot() {
  const candidates = [];

  try {
    candidates.push(
      path.dirname(
        require.resolve(
          "@fontsource/noto-sans-kr/package.json"
        )
      )
    );
  } catch {}

  try {
    candidates.push(
      path.dirname(
        require.resolve(
          "@fontsource/noto-sans-kr"
        )
      )
    );
  } catch {}

  return candidates.find(Boolean) || "";
}

function resolveFontFile(
  weight
) {
  const root =
    fontPackageRoot();

  if (!root) {
    throw new Error(
      "Noto Sans KR font package is unavailable."
    );
  }

  const files = [
    `noto-sans-kr-korean-${weight}-normal.woff`,
    `noto-sans-kr-korean-${weight}-normal.woff2`
  ];

  for (const file of files) {
    const candidate =
      path.join(
        root,
        "files",
        file
      );

    if (
      existsSync(
        candidate
      )
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Noto Sans KR ${weight} font file is unavailable.`
  );
}

function fonts() {
  if (fontCache) {
    return fontCache;
  }

  const regular =
    resolveFontFile(
      400
    );

  fontCache = {
    regular,
    medium:
      regular,
    bold:
      regular
  };

  return fontCache;
}

function cleanText(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /\r\n?/g,
      "\n"
    )
    .trim();
}

function titleText(
  document,
  metadata
) {
  return cleanText(
    document?.title ||
    metadata?.title ||
    "ovll result"
  ).slice(
    0,
    120
  );
}

function collectBuffer(
  doc
) {
  return new Promise(
    (resolve, reject) => {
      const chunks = [];

      doc.on(
        "data",
        chunk => {
          chunks.push(
            Buffer.from(
              chunk
            )
          );
        }
      );

      doc.on(
        "end",
        () => {
          resolve(
            Buffer.concat(
              chunks
            )
          );
        }
      );

      doc.on(
        "error",
        reject
      );

      doc.end();
    }
  );
}

function fontBuffer() {
  if (fontBufferCache) {
    return fontBufferCache;
  }

  const resolved =
    fonts();

  fontBufferCache =
    readFileSync(
      resolved.regular
    );

  return fontBufferCache;
}

function registerFonts(
  doc
) {
  doc.registerFont(
    "NotoKR",
    fontBuffer()
  );
}

function bottomLimit(
  doc
) {
  return (
    doc.page.height -
    PAGE.marginBottom -
    18
  );
}

function ensureSpace(
  doc,
  height
) {
  if (
    doc.y +
    height >
    bottomLimit(doc)
  ) {
    doc.addPage();
  }
}

function textHeight(
  doc,
  text,
  {
    width,
    font =
      "NotoKR",
    size = 10.4,
    lineGap = 4.6
  } = {}
) {
  const normalized =
    cleanText(text) || " ";

  let cache =
    textHeightCaches.get(doc);

  if (!cache) {
    cache = new Map();
    textHeightCaches.set(
      doc,
      cache
    );
  }

  const cacheKey = [
    font,
    size,
    lineGap,
    Number(width).toFixed(2),
    normalized
  ].join("\u0000");

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  doc.font(font)
    .fontSize(size);

  const height =
    doc.heightOfString(
      normalized,
      {
        width,
        lineGap,
        align:
          "left"
      }
    );

  if (
    cache.size <
    TEXT_HEIGHT_CACHE_LIMIT
  ) {
    cache.set(
      cacheKey,
      height
    );
  }

  return height;
}

function drawTitle(
  doc,
  title
) {
  ensureSpace(
    doc,
    92
  );

  doc.font(
    "NotoKR"
  )
    .fontSize(25)
    .fillColor(
      "#111111"
    )
    .text(
      title,
      {
        width:
          doc.page.width -
          PAGE.marginLeft -
          PAGE.marginRight,
        lineGap: 3
      }
    );

  doc.moveDown(.58);

  const y =
    doc.y + 2;

  doc.strokeColor(
    "#D9DCE1"
  )
    .lineWidth(.7)
    .moveTo(
      PAGE.marginLeft,
      y
    )
    .lineTo(
      doc.page.width -
      PAGE.marginRight,
      y
    )
    .stroke();

  doc.y =
    y + 22;
}

function drawHeading(
  doc,
  block
) {
  const level =
    Math.max(
      1,
      Math.min(
        3,
        Number(
          block.level
        ) || 2
      )
    );

  const styles = {
    1: {
      size: 20,
      before: 22,
      after: 12,
      font:
        "NotoKR"
    },
    2: {
      size: 15.2,
      before: 25,
      after: 9,
      font:
        "NotoKR"
    },
    3: {
      size: 12.3,
      before: 20,
      after: 7,
      font:
        "NotoKR"
    }
  };

  const style =
    styles[level];

  const available =
    doc.page.width -
    PAGE.marginLeft -
    PAGE.marginRight;

  const height =
    textHeight(
      doc,
      block.text,
      {
        width:
          available,
        font:
          style.font,
        size:
          style.size,
        lineGap: 2.6
      }
    );

  ensureSpace(
    doc,
    style.before +
    height +
    style.after +
    12
  );

  doc.y +=
    style.before;

  doc.font(
    style.font
  )
    .fontSize(
      style.size
    )
    .fillColor(
      "#17181B"
    )
    .text(
      cleanText(
        block.text
      ),
      {
        width:
          available,
        lineGap: 2.6
      }
    );

  doc.y +=
    style.after;
}

function drawParagraph(
  doc,
  block
) {
  const available =
    doc.page.width -
    PAGE.marginLeft -
    PAGE.marginRight;

  const size = 10.35;
  const lineGap = 5.25;

  ensureSpace(
    doc,
    42
  );

  doc.font(
    "NotoKR"
  )
    .fontSize(
      size
    )
    .fillColor(
      "#303236"
    )
    .text(
      cleanText(
        block.text
      ),
      {
        width:
          available,
        lineGap,
        paragraphGap: 0
      }
    );

  doc.y += 11;
}

function drawList(
  doc,
  block
) {
  const items =
    Array.isArray(
      block.items
    )
      ? block.items
      : [];

  items.forEach(
    (item, index) => {
      const marker =
        block.ordered
          ? `${index + 1}.`
          : "•";

      const markerWidth =
        22;

      const contentWidth =
        doc.page.width -
        PAGE.marginLeft -
        PAGE.marginRight -
        markerWidth;

      ensureSpace(
        doc,
        30
      );

      const y =
        doc.y;

      doc.font(
        "NotoKR"
      )
        .fontSize(
          9.8
        )
        .fillColor(
          "#55585E"
        )
        .text(
          marker,
          PAGE.marginLeft,
          y,
          {
            width:
              markerWidth - 3,
            align:
              block.ordered
                ? "right"
                : "center"
          }
        );

      doc.font(
        "NotoKR"
      )
        .fontSize(
          10.15
        )
        .fillColor(
          "#303236"
        )
        .text(
          cleanText(item),
          PAGE.marginLeft +
          markerWidth,
          y,
          {
            width:
              contentWidth,
            lineGap: 4.7
          }
        );

      doc.y += 7;
    }
  );

  doc.y += 3;
}

function drawQuote(
  doc,
  block
) {
  const x =
    PAGE.marginLeft;
  const width =
    doc.page.width -
    PAGE.marginLeft -
    PAGE.marginRight;
  const padX = 15;
  const padY = 12;

  const innerWidth =
    width -
    padX * 2 -
    4;

  const height =
    textHeight(
      doc,
      block.text,
      {
        width:
          innerWidth,
        size: 10,
        lineGap: 4.7
      }
    ) +
    padY * 2;

  ensureSpace(
    doc,
    height + 14
  );

  const y =
    doc.y;

  doc.roundedRect(
    x,
    y,
    width,
    height,
    5
  )
    .fill(
      "#F5F6F7"
    );

  doc.rect(
    x,
    y,
    3,
    height
  )
    .fill(
      "#AEB4BD"
    );

  doc.font(
    "NotoKR"
  )
    .fontSize(10)
    .fillColor(
      "#4F5359"
    )
    .text(
      cleanText(
        block.text
      ),
      x +
      padX,
      y +
      padY,
      {
        width:
          innerWidth,
        lineGap: 4.7
      }
    );

  doc.y =
    y +
    height +
    12;
}

function drawCode(
  doc,
  block
) {
  const x =
    PAGE.marginLeft;
  const width =
    doc.page.width -
    PAGE.marginLeft -
    PAGE.marginRight;
  const pad = 13;

  const text =
    String(
      block.text ||
      ""
    );

  const height =
    textHeight(
      doc,
      text || " ",
      {
        width:
          width -
          pad * 2,
        size: 8.7,
        lineGap: 3.2
      }
    ) +
    pad * 2;

  if (
    height >
    bottomLimit(doc) -
    PAGE.marginTop
  ) {
    doc.addPage();

    doc.font(
      "NotoKR"
    )
      .fontSize(8.7)
      .fillColor(
        "#34373C"
      )
      .text(
        text,
        {
          width:
            width,
          lineGap: 3.2
        }
      );

    doc.y += 10;
    return;
  }

  ensureSpace(
    doc,
    height + 14
  );

  const y =
    doc.y;

  doc.roundedRect(
    x,
    y,
    width,
    height,
    5
  )
    .fillAndStroke(
      "#F4F5F6",
      "#E0E3E7"
    );

  doc.font(
    "NotoKR"
  )
    .fontSize(8.7)
    .fillColor(
      "#34373C"
    )
    .text(
      text,
      x + pad,
      y + pad,
      {
        width:
          width -
          pad * 2,
        lineGap: 3.2
      }
    );

  doc.y =
    y +
    height +
    12;
}

function normalizedTable(
  block
) {
  const MAX_TABLE_COLUMNS = 12;
  const MAX_TABLE_ROWS = 300;
  const MAX_TABLE_CELL_CHARS = 3000;

  const headers =
    Array.isArray(
      block.headers
    )
      ? block.headers
      : [];

  const rows =
    Array.isArray(
      block.rows
    )
      ? block.rows.slice(
          0,
          MAX_TABLE_ROWS
        )
      : [];

  const count =
    Math.min(
      MAX_TABLE_COLUMNS,
      Math.max(
        headers.length,
        ...rows.map(
          row =>
            Array.isArray(row)
              ? row.length
              : 0
        ),
        1
      )
    );

  const cellText =
    value =>
      cleanText(
        value || ""
      ).slice(
        0,
        MAX_TABLE_CELL_CHARS
      );

  return {
    count,
    headers:
      Array.from(
        {
          length: count
        },
        (_, index) =>
          cellText(
            headers[index] ||
            `열 ${index + 1}`
          )
      ),
    rows:
      rows.map(
        row =>
          Array.from(
            {
              length: count
            },
            (_, index) =>
              cellText(
                row?.[index] ||
                ""
              )
          )
      )
  };
}

function tableRowHeight(
  doc,
  row,
  widths,
  {
    font,
    size
  }
) {
  const padY = 8;
  const padX = 8;

  return (
    Math.max(
      18,
      ...row.map(
        (cell, index) =>
          textHeight(
            doc,
            cell || " ",
            {
              width:
                widths[index] -
                padX * 2,
              font,
              size,
              lineGap: 2.8
            }
          )
      )
    ) +
    padY * 2
  );
}

function drawTableRow(
  doc,
  row,
  widths,
  {
    header = false,
    measuredHeight = null
  } = {}
) {
  const x =
    PAGE.marginLeft;

  const font =
    "NotoKR";

  const size =
    header
      ? 9.2
      : 9.1;

  const height =
    Number.isFinite(
      measuredHeight
    ) &&
    measuredHeight > 0
      ? measuredHeight
      : tableRowHeight(
          doc,
          row,
          widths,
          {
            font,
            size
          }
        );

  ensureSpace(
    doc,
    height + 4
  );

  const y =
    doc.y;

  let cellX = x;

  row.forEach(
    (cell, index) => {
      const width =
        widths[index];

      doc.rect(
        cellX,
        y,
        width,
        height
      )
        .fillAndStroke(
          header
            ? "#F0F2F4"
            : "#FFFFFF",
          "#D9DDE2"
        );

      doc.font(font)
        .fontSize(size)
        .fillColor(
          header
            ? "#24262A"
            : "#35383D"
        )
        .text(
          cell,
          cellX + 8,
          y + 8,
          {
            width:
              width - 16,
            lineGap: 2.8
          }
        );

      cellX +=
        width;
    }
  );

  doc.y =
    y +
    height;
}

function drawTable(
  doc,
  block
) {
  const table =
    normalizedTable(
      block
    );

  const totalWidth =
    doc.page.width -
    PAGE.marginLeft -
    PAGE.marginRight;

  const widths =
    Array.from(
      {
        length:
          table.count
      },
      () =>
        totalWidth /
        table.count
    );

  const headerHeight =
    tableRowHeight(
      doc,
      table.headers,
      widths,
      {
        font:
          "NotoKR",
        size: 9.2
      }
    );

  ensureSpace(
    doc,
    Math.max(
      60,
      headerHeight + 4
    )
  );

  drawTableRow(
    doc,
    table.headers,
    widths,
    {
      header: true,
      measuredHeight:
        headerHeight
    }
  );

  for (
    const row
    of table.rows
  ) {
    const rowHeight =
      tableRowHeight(
        doc,
        row,
        widths,
        {
          font:
            "NotoKR",
          size: 9.1
        }
      );

    if (
      doc.y +
      rowHeight >
      bottomLimit(doc)
    ) {
      doc.addPage();

      drawTableRow(
        doc,
        table.headers,
        widths,
        {
          header: true,
          measuredHeight:
            headerHeight
        }
      );
    }

    drawTableRow(
      doc,
      row,
      widths,
      {
        measuredHeight:
          rowHeight
      }
    );
  }

  doc.y += 14;
}

function drawRule(
  doc
) {
  ensureSpace(
    doc,
    24
  );

  doc.y += 4;

  doc.strokeColor(
    "#D8DCE1"
  )
    .lineWidth(.65)
    .moveTo(
      PAGE.marginLeft,
      doc.y
    )
    .lineTo(
      doc.page.width -
      PAGE.marginRight,
      doc.y
    )
    .stroke();

  doc.y += 18;
}

function drawFooter(
  doc,
  title,
  pageNumber,
  pageCount
) {
  const y =
    doc.page.height -
    34;

  doc.strokeColor(
    "#E1E3E6"
  )
    .lineWidth(.55)
    .moveTo(
      PAGE.marginLeft,
      y - 9
    )
    .lineTo(
      doc.page.width -
      PAGE.marginRight,
      y - 9
    )
    .stroke();

  doc.font(
    "NotoKR"
  )
    .fontSize(7.4)
    .fillColor(
      "#9B9FA6"
    )
    .text(
      title,
      PAGE.marginLeft,
      y,
      {
        width:
          300,
        height:
          10,
        lineBreak:
          false,
        ellipsis:
          true
      }
    );

  doc.font(
    "NotoKR"
  )
    .fontSize(7.4)
    .fillColor(
      "#9B9FA6"
    )
    .text(
      `${pageNumber} / ${pageCount}`,
      doc.page.width -
      PAGE.marginRight -
      55,
      y,
      {
        width: 55,
        height:
          10,
        align:
          "right",
        lineBreak:
          false
      }
    );
}

export async function renderPdfKitDocument(
  document,
  metadata = {}
) {
  const title =
    titleText(
      document,
      metadata
    );

  const doc =
    new PDFDocument({
      size: "A4",
      margins: {
        top:
          PAGE.marginTop,
        right:
          PAGE.marginRight,
        bottom:
          PAGE.marginBottom,
        left:
          PAGE.marginLeft
      },
      bufferPages:
        false,
      compress:
        false,
      info: {
        Title:
          title,
        Producer:
          "ovll"
      }
    });

  registerFonts(doc);

  drawTitle(
    doc,
    title
  );

  const blocks =
    Array.isArray(
      document?.blocks
    )
      ? document.blocks
      : [];

  let skippedMatchingH1 =
    false;

  for (const block of blocks) {
    if (!block) {
      continue;
    }

    if (
      !skippedMatchingH1 &&
      block.type ===
        "heading" &&
      Number(
        block.level
      ) === 1 &&
      cleanText(
        block.text
      ) === title
    ) {
      skippedMatchingH1 =
        true;
      continue;
    }

    if (
      block.type ===
        "heading"
    ) {
      drawHeading(
        doc,
        block
      );
      continue;
    }

    if (
      block.type ===
        "paragraph"
    ) {
      drawParagraph(
        doc,
        block
      );
      continue;
    }

    if (
      block.type ===
        "list"
    ) {
      drawList(
        doc,
        block
      );
      continue;
    }

    if (
      block.type ===
        "quote"
    ) {
      drawQuote(
        doc,
        block
      );
      continue;
    }

    if (
      block.type ===
        "code"
    ) {
      drawCode(
        doc,
        block
      );
      continue;
    }

    if (
      block.type ===
        "table"
    ) {
      drawTable(
        doc,
        block
      );
      continue;
    }

    if (
      block.type ===
        "rule"
    ) {
      drawRule(doc);
    }
  }

  return collectBuffer(
    doc
  );
}
