import {deflateRawSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {
  renderPdfFallback,
  renderPdfWithChrome
} from './pdfRenderer.js';
import {
  createArtifactDocument,
  extractArtifactContent,
  extractHtmlArtifact
} from './artifactDocument.js';

const STORE = new Map();
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TEXT_CHARS = 420000;

const FORMAT_INFO = {
  PDF:  {ext: 'pdf',  mime: 'application/pdf'},
  DOCX: {ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},
  XLSX: {ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
  CSV:  {ext: 'csv',  mime: 'text/csv; charset=utf-8'},
  TXT:  {ext: 'txt',  mime: 'text/plain; charset=utf-8'},
  MD:   {ext: 'md',   mime: 'text/markdown; charset=utf-8'},
  JSON: {ext: 'json', mime: 'application/json; charset=utf-8'},
  HTML: {ext: 'html', mime: 'text/html; charset=utf-8'},
  RTF:  {ext: 'rtf',  mime: 'application/rtf'}
};

function prune() {
  const now = Date.now();
  for (const [id, item] of STORE.entries()) {
    if (now - item.createdAt > TTL_MS) STORE.delete(id);
  }
}

function formatName(value) {
  const raw = String(value || 'TXT').trim().toUpperCase().replace(/^\./, '');
  if (FORMAT_INFO[raw]) return raw;
  if (raw === 'MARKDOWN') return 'MD';
  if (raw === 'TEXT') return 'TXT';
  if (raw === 'WORD') return 'DOCX';
  if (raw === 'EXCEL' || raw === 'SHEET') return 'XLSX';
  return 'TXT';
}

function previewKindForFormat(format) {
  if (format === 'PDF') return 'pdf';
  if (format === 'HTML') return 'html';
  if (format === 'MD' || format === 'DOCX' || format === 'RTF') return 'document';
  if (format === 'TXT') return 'text';
  if (format === 'XLSX' || format === 'CSV') return 'spreadsheet';
  if (format === 'JSON') return 'code';
  return 'binary';
}

function safeBaseName(value) {
  const clean = String(value || 'result')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return clean || 'result';
}

function withExtension(name, ext) {
  const base = safeBaseName(name);
  const dot = base.lastIndexOf('.');
  if (dot > 0 && base.slice(dot + 1).toLowerCase() === ext.toLowerCase()) return base;
  return base + '.' + ext;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function compactValue(value, depth = 0) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth > 5) return '[nested]';
  if (Array.isArray(value)) return value.map(item => compactValue(item, depth + 1)).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => key + ': ' + compactValue(item, depth + 1)).join('\n');
  }
  return String(value);
}

function sourceText(sources) {
  return extractArtifactContent(
    sources
  ).plainText.slice(
    0,
    MAX_TEXT_CHARS
  );
}

function tableRows(sources) {
  const list = Array.isArray(sources) ? sources : [sources];
  const candidate = list.length === 1 ? list[0] : list;
  if (Array.isArray(candidate) && candidate.length && candidate.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    const keys = [...new Set(candidate.flatMap(item => Object.keys(item)))].slice(0, 40);
    return [keys, ...candidate.slice(0, 5000).map(item => keys.map(key => compactValue(item[key])))];
  }
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return [['항목', '값'], ...Object.entries(candidate).slice(0, 5000).map(([key, value]) => [key, compactValue(value)])];
  }
  return sourceText(sources).split(/\r?\n/).slice(0, 5000).map(line => [line]);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function csvBuffer(sources) {
  const body = tableRows(sources).map(row => row.map(csvEscape).join(',')).join('\r\n');
  return Buffer.from('\uFEFF' + body, 'utf8');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimeDate(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function zipBuffer(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = dosTimeDate();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const localBuffer = Buffer.concat(locals);
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(localBuffer.length, 16);
  return Buffer.concat([localBuffer, centralBuffer, end]);
}

function docxBuffer(sources) {
  const paragraphs = sourceText(sources).split(/\r?\n/).map(line =>
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Malgun Gothic"/></w:rPr><w:t xml:space="preserve">' + xmlEscape(line || ' ') + '</w:t></w:r></w:p>'
  ).join('');
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraphs +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
  return zipBuffer([
    {name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},
    {name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
    {name: 'word/document.xml', data: documentXml}
  ]);
}

function columnName(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function xlsxBuffer(sources) {
  const rows = tableRows(sources).slice(0, 10000);
  const sheetRows = rows.map((row, r) => {
    const cells = row.slice(0, 100).map((value, c) => '<c r="' + columnName(c) + (r + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>').join('');
    return '<row r="' + (r + 1) + '">' + cells + '</row>';
  }).join('');
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + sheetRows + '</sheetData></worksheet>';
  return zipBuffer([
    {name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'},
    {name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Result" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'},
    {name: 'xl/worksheets/sheet1.xml', data: sheet}
  ]);
}

function rtfBuffer(sources) {
  let body = '';
  for (const char of sourceText(sources)) {
    if (char === '\\' || char === '{' || char === '}') body += '\\' + char;
    else if (char === '\n') body += '\\par\n';
    else {
      const code = char.charCodeAt(0);
      body += code > 127 ? '\\u' + (code > 32767 ? code - 65536 : code) + '?' : char;
    }
  }
  return Buffer.from('{\\rtf1\\ansi\\deff0 ' + body + '}', 'utf8');
}

async function withArtifactTimeout(
  work,
  timeoutMs,
  code,
  message
) {
  let timer = null;

  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error =
            new Error(message);

          error.code =
            code;
          error.status =
            504;

          reject(error);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function buildBuffer(
  format,
  sources,
  metadata = {},
  document = null
) {
  const canonicalDocument =
    document ||
    createArtifactDocument(
      sources,
      {
        title:
          metadata.title ||
          ""
      }
    );

  if (format === 'PDF') {
    try {
      const browserBuffer =
        await renderPdfWithChrome({
          document:
            canonicalDocument,
          title:
            metadata.title ||
            canonicalDocument.title ||
            ''
        });

      if (browserBuffer) {
        return {
          buffer:
            browserBuffer,
          renderer:
            'html-chromium'
        };
      }
    } catch (error) {
      console.warn(
        '[artifact pdf] Chromium render failed; using fallback renderer.',
        error?.message || error
      );
    }

    return {
      buffer:
        await withArtifactTimeout(
          renderPdfFallback(
            canonicalDocument,
            {
              title:
                canonicalDocument.title ||
                metadata.title ||
                ''
            }
          ),
          60000,
          'PDF_RENDER_TIMEOUT',
          'PDF 렌더링 시간이 초과되었습니다.'
        ),
      renderer:
        'pdfkit-fallback'
    };
  }

  if (format === 'DOCX') {
    return {
      buffer:
        docxBuffer([
          canonicalDocument
            .plainText
        ]),
      renderer:
        'native'
    };
  }

  if (format === 'XLSX') {
    return {
      buffer:
        xlsxBuffer(sources),
      renderer:
        'native'
    };
  }

  if (format === 'CSV') {
    return {
      buffer:
        csvBuffer(sources),
      renderer:
        'native'
    };
  }

  if (format === 'JSON') {
    return {
      buffer:
        Buffer.from(
          JSON.stringify(
            Array.isArray(sources) &&
            sources.length === 1
              ? sources[0]
              : sources,
            null,
            2
          ),
          'utf8'
        ),
      renderer:
        'native'
    };
  }

  if (format === 'HTML') {
    return {
      buffer:
        Buffer.from(
          extractHtmlArtifact(
            sources,
            {
              title:
                metadata.title ||
                canonicalDocument.title ||
                ''
            }
          ),
          'utf8'
        ),
      renderer:
        'native'
    };
  }

  if (format === 'RTF') {
    return {
      buffer:
        rtfBuffer([
          canonicalDocument
            .plainText
        ]),
      renderer:
        'native'
    };
  }

  return {
    buffer:
      Buffer.from(
        canonicalDocument
          .plainText,
        'utf8'
      ),
    renderer:
      'native'
  };
}
export async function createStoredArtifact(input = {}) {
  prune();

  const format =
    formatName(
      input.format
    );

  const info =
    FORMAT_INFO[format];

  const targetPages =
    Number.isInteger(
      Number(
        input.targetPages
      )
    ) &&
    Number(
      input.targetPages
    ) >= 1 &&
    Number(
      input.targetPages
    ) <= 30
      ? Number(
          input.targetPages
        )
      : null;

  const sources =
    Array.isArray(
      input.sources
    )
      ? input.sources
      : [
          input.sources
        ].filter(
          value =>
            value !==
            undefined
        );

  const name =
    withExtension(
      input.filename ||
      'result',
      info.ext
    );

  const title =
    name.replace(
      /\.[^.]+$/,
      ''
    );

  const document =
    createArtifactDocument(
      sources
    );

  if (!document.title) {
    document.title =
      title;
  }

  const built =
    await buildBuffer(
      format,
      sources,
      {
        title
      },
      document
    );

  const buffer =
    built.buffer;

  const id =
    randomUUID();

  const previewKind =
    previewKindForFormat(
      format
    );

  let previewText = "";

  if (
    format === 'PDF' ||
    format === 'MD' ||
    format === 'TXT' ||
    format === 'DOCX' ||
    format === 'RTF'
  ) {
    previewText =
      document
        .plainText
        .slice(
          0,
          6000
        );
  } else if (
    format === 'CSV' ||
    format === 'XLSX'
  ) {
    previewText =
      tableRows(sources)
        .slice(0, 80)
        .map(row =>
          row
            .slice(0, 24)
            .join('\t')
        )
        .join('\n')
        .slice(0, 6000);
  } else if (
    format === 'JSON'
  ) {
    previewText =
      buffer
        .toString('utf8')
        .slice(0, 6000);
  }

  const item = {
    id,
    name,
    format,
    mime:
      info.mime,
    size:
      buffer.length,
    createdAt:
      Date.now(),
    buffer,
    renderer:
      built.renderer,
    targetPages,
    previewKind,
    previewText
  };

  STORE.set(
    id,
    item
  );

  const baseUrl =
    '/api/artifacts/' +
    encodeURIComponent(
      item.id
    );

  return {
    id:
      item.id,
    name:
      item.name,
    format:
      item.format,
    mime:
      item.mime,
    size:
      item.size,
    renderer:
      item.renderer,
    targetPages:
      item.targetPages,
    previewKind:
      item.previewKind,
    previewText:
      item.previewText,
    previewUrl:
      baseUrl +
      '?inline=1',
    downloadUrl:
      baseUrl
  };
}

export function getStoredArtifact(id) {
  prune();
  return STORE.get(String(id || '')) || null;
}
