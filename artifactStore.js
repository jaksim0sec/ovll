import {deflateRawSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {renderPdfWithChrome} from './pdfRenderer.js';

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
  const list = Array.isArray(sources) ? sources : [sources];
  return list.map(item => compactValue(item)).filter(Boolean).join('\n\n').slice(0, MAX_TEXT_CHARS);
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

function inlineDocumentText(value) {
  return String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\x60([^\x60]+)\x60/g, '$1')
    .replace(/\\([\\*_[\](){}#+.!>\x60~-])/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeDocumentMarkup(value) {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '- ')
    .replace(/<\s*h1\b[^>]*>/gi, '# ')
    .replace(/<\s*h2\b[^>]*>/gi, '## ')
    .replace(/<\s*h3\b[^>]*>/gi, '### ')
    .replace(/<\s*blockquote\b[^>]*>/gi, '> ')
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6]|blockquote|pre|section|article)\s*>/gi, '\n')
    .replace(/\r\n?/g, '\n');
}

function markdownTableCells(line) {
  const value = String(line || '').trim();
  if (!value.includes('|')) return [];
  return value
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => inlineDocumentText(cell));
}

function isMarkdownTableDivider(line) {
  const cells = markdownTableCells(line);
  return (
    cells.length > 0 &&
    cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
  );
}

function parsePdfBlocks(sources) {
  const text = normalizeDocumentMarkup(sourceText(sources));
  const lines = text.split('\n');
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    const value = inlineDocumentText(paragraph.join(' '));
    if (value) blocks.push({type: 'paragraph', text: value});
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const trimmed = raw.trim();

    if (/^(?:\x60{3,}|~{3,})/.test(trimmed)) {
      flushParagraph();
      const fence = trimmed.startsWith('~') ? '~' : '\x60';
      const code = [];
      index++;
      while (
        index < lines.length &&
        !new RegExp('^' + fence + '{3,}').test(lines[index].trim())
      ) {
        code.push(lines[index]);
        index++;
      }
      blocks.push({
        type: 'code',
        text: code.join('\n').replace(/\t/g, '    ')
      });
      continue;
    }

    if (
      trimmed.includes('|') &&
      index + 1 < lines.length &&
      isMarkdownTableDivider(lines[index + 1])
    ) {
      flushParagraph();
      const rows = [markdownTableCells(trimmed)];
      index += 2;
      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes('|')
      ) {
        rows.push(markdownTableCells(lines[index]));
        index++;
      }
      index--;
      blocks.push({type: 'table', rows});
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: inlineDocumentText(heading[2])
      });
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({type: 'rule'});
      continue;
    }

    const ordered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      blocks.push({
        type: 'list',
        marker: ordered[1] + '.',
        text: inlineDocumentText(ordered[2])
      });
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({
        type: 'list',
        marker: '•',
        text: inlineDocumentText(bullet[1])
      });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({
        type: 'quote',
        text: inlineDocumentText(quote[1])
      });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();

  return blocks.length
    ? blocks
    : [{type: 'paragraph', text: inlineDocumentText(text)}];
}

function pdfGlyphUnits(char) {
  if (!char) return 0;
  if (char === '\t') return 2.4;
  if (/\s/.test(char)) return .34;
  const code = char.codePointAt(0);
  if (code <= 0x007f) {
    if (/[ilI1.,:;!'|]/.test(char)) return .28;
    if (/[mwMW@#%&]/.test(char)) return .82;
    return .55;
  }
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff)
  ) {
    return 1;
  }
  return 1.05;
}

function pdfTextUnits(value) {
  let total = 0;
  for (const char of Array.from(String(value ?? ''))) {
    total += pdfGlyphUnits(char);
  }
  return total;
}

function wrapPdfText(value, maxUnits) {
  const text = String(value ?? '');
  if (!text) return [''];

  const result = [];

  for (const physicalLine of text.split('\n')) {
    if (!physicalLine) {
      result.push('');
      continue;
    }

    let current = '';
    let units = 0;
    let lastSpace = -1;

    const pushCurrent = () => {
      const out = current.trimEnd();
      if (out || !result.length) result.push(out);
      current = '';
      units = 0;
      lastSpace = -1;
    };

    for (const char of Array.from(physicalLine)) {
      const nextUnits = units + pdfGlyphUnits(char);

      if (current && nextUnits > maxUnits) {
        if (lastSpace >= 0) {
          const before = current.slice(0, lastSpace).trimEnd();
          const after = current.slice(lastSpace + 1).trimStart();
          if (before) result.push(before);
          current = after;
          units = pdfTextUnits(current);
          lastSpace = -1;
          for (let i = 0; i < current.length; i++) {
            if (/\s/.test(current[i])) lastSpace = i;
          }
        } else {
          pushCurrent();
        }
      }

      current += char;
      units += pdfGlyphUnits(char);
      if (/\s/.test(char)) lastSpace = current.length - 1;
    }

    if (current || !result.length) pushCurrent();
  }

  return result.length ? result : [''];
}

function utf16Hex(value) {
  const buffer = Buffer.from('\uFEFF' + String(value), 'utf16le');
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const a = buffer[i];
    buffer[i] = buffer[i + 1];
    buffer[i + 1] = a;
  }
  return buffer.toString('hex').toUpperCase();
}

function pdfNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function pdfTextCommand(text, x, y, size, font = 'F1', gray = .15) {
  return [
    'BT',
    '/' + font + ' ' + pdfNumber(size) + ' Tf',
    pdfNumber(gray) + ' g',
    pdfNumber(x) + ' ' + pdfNumber(y) + ' Td',
    '<' + utf16Hex(text) + '> Tj',
    'ET'
  ].join('\n');
}

function pdfBuffer(sources, metadata = {}) {
  const blocks = parsePdfBlocks(sources);
  const pageWidth = 595;
  const pageHeight = 842;
  const left = 54;
  const right = 54;
  const top = 56;
  const bottom = 58;
  const contentWidth = pageWidth - left - right;
  const pages = [];
  let commands = [];
  let y = pageHeight - top;

  const newPage = () => {
    if (commands.length) pages.push(commands);
    commands = [];
    y = pageHeight - top;
  };

  const ensure = height => {
    if (y - height < bottom) newPage();
  };

  const drawTextLines = ({
    text,
    x = left,
    width = contentWidth,
    size = 10.5,
    lineHeight = 16.8,
    font = 'F1',
    gray = .15,
    before = 0,
    after = 8
  }) => {
    const lines = wrapPdfText(text, Math.max(4, width / size));
    const needed = before + lines.length * lineHeight + after;
    ensure(needed);
    y -= before;
    for (const line of lines) {
      commands.push(pdfTextCommand(line, x, y, size, font, gray));
      y -= lineHeight;
    }
    y -= after;
  };

  for (const block of blocks) {
    if (!block) continue;

    if (block.type === 'heading') {
      const level = Math.max(1, Math.min(3, Number(block.level) || 1));
      const style =
        level === 1
          ? {size: 22, lineHeight: 29, before: 4, after: 14, gray: .08}
          : level === 2
            ? {size: 15.5, lineHeight: 22, before: 8, after: 10, gray: .1}
            : {size: 12.4, lineHeight: 18.5, before: 6, after: 8, gray: .12};

      drawTextLines({
        text: block.text,
        size: style.size,
        lineHeight: style.lineHeight,
        font: 'F2',
        gray: style.gray,
        before: style.before,
        after: style.after
      });

      if (level === 1) {
        ensure(10);
        commands.push(
          '.88 G\n.7 w\n' +
          pdfNumber(left) + ' ' + pdfNumber(y + 4) + ' m\n' +
          pdfNumber(pageWidth - right) + ' ' + pdfNumber(y + 4) + ' l\nS'
        );
        y -= 7;
      }
      continue;
    }

    if (block.type === 'paragraph') {
      drawTextLines({
        text: block.text,
        size: 10.6,
        lineHeight: 17.2,
        font: 'F1',
        gray: .16,
        after: 9
      });
      continue;
    }

    if (block.type === 'list') {
      const markerWidth = 20;
      const lines = wrapPdfText(
        block.text,
        Math.max(4, (contentWidth - markerWidth) / 10.4)
      );
      const lineHeight = 16.8;
      const needed = lines.length * lineHeight + 7;
      ensure(needed);
      commands.push(
        pdfTextCommand(
          block.marker || '•',
          left + 2,
          y,
          10.2,
          'F2',
          .2
        )
      );
      for (const line of lines) {
        commands.push(
          pdfTextCommand(
            line,
            left + markerWidth,
            y,
            10.4,
            'F1',
            .16
          )
        );
        y -= lineHeight;
      }
      y -= 7;
      continue;
    }

    if (block.type === 'quote') {
      const pad = 12;
      const bar = 3;
      const lines = wrapPdfText(
        block.text,
        Math.max(4, (contentWidth - pad * 2 - 8) / 10.2)
      );
      const lineHeight = 16.5;
      const height = lines.length * lineHeight + 18;
      ensure(height + 8);
      const boxTop = y + 4;
      const boxBottom = y - height + 8;
      commands.push(
        '.965 g\n' +
        pdfNumber(left) + ' ' + pdfNumber(boxBottom) + ' ' +
        pdfNumber(contentWidth) + ' ' + pdfNumber(height) + ' re f'
      );
      commands.push(
        '.68 g\n' +
        pdfNumber(left) + ' ' + pdfNumber(boxBottom) + ' ' +
        pdfNumber(bar) + ' ' + pdfNumber(height) + ' re f'
      );
      y = boxTop - 12;
      for (const line of lines) {
        commands.push(
          pdfTextCommand(
            line,
            left + pad + 3,
            y,
            10.2,
            'F1',
            .28
          )
        );
        y -= lineHeight;
      }
      y = boxBottom - 8;
      continue;
    }

    if (block.type === 'code') {
      const pad = 12;
      const lines = String(block.text || '')
        .split('\n')
        .flatMap(line =>
          wrapPdfText(
            line || ' ',
            Math.max(4, (contentWidth - pad * 2) / 9.1)
          )
        );
      const lineHeight = 14.4;
      const maxLinesPerPage = 42;

      for (let start = 0; start < Math.max(1, lines.length); start += maxLinesPerPage) {
        const chunk = lines.slice(start, start + maxLinesPerPage);
        const height = chunk.length * lineHeight + 20;
        ensure(height + 8);
        const boxBottom = y - height + 6;
        commands.push(
          '.95 g\n' +
          pdfNumber(left) + ' ' + pdfNumber(boxBottom) + ' ' +
          pdfNumber(contentWidth) + ' ' + pdfNumber(height) + ' re f'
        );
        y -= 9;
        for (const line of chunk) {
          commands.push(
            pdfTextCommand(
              line,
              left + pad,
              y,
              9.1,
              'F2',
              .22
            )
          );
          y -= lineHeight;
        }
        y = boxBottom - 9;
      }
      continue;
    }

    if (block.type === 'table') {
      const rows = Array.isArray(block.rows) ? block.rows.filter(Array.isArray) : [];
      if (!rows.length) continue;
      const headers = rows[0].map((cell, index) => cell || ('열 ' + (index + 1)));

      drawTextLines({
        text: headers.join('   ·   '),
        size: 9.6,
        lineHeight: 15.5,
        font: 'F2',
        gray: .18,
        before: 3,
        after: 5
      });

      for (const row of rows.slice(1)) {
        const pairs = headers
          .map((header, index) => {
            const value = inlineDocumentText(row[index] || '');
            return value ? header + ': ' + value : '';
          })
          .filter(Boolean);

        if (!pairs.length) continue;

        const text = pairs.join('   ·   ');
        const lines = wrapPdfText(text, contentWidth / 9.5);
        const lineHeight = 15;
        const height = lines.length * lineHeight + 12;
        ensure(height + 2);
        commands.push(
          '.975 g\n' +
          pdfNumber(left) + ' ' + pdfNumber(y - height + 7) + ' ' +
          pdfNumber(contentWidth) + ' ' + pdfNumber(height) + ' re f'
        );
        y -= 2;
        for (const line of lines) {
          commands.push(
            pdfTextCommand(
              line,
              left + 7,
              y,
              9.5,
              'F1',
              .18
            )
          );
          y -= lineHeight;
        }
        y -= 5;
      }
      y -= 5;
      continue;
    }

    if (block.type === 'rule') {
      ensure(18);
      y -= 5;
      commands.push(
        '.87 G\n.65 w\n' +
        pdfNumber(left) + ' ' + pdfNumber(y) + ' m\n' +
        pdfNumber(pageWidth - right) + ' ' + pdfNumber(y) + ' l\nS'
      );
      y -= 13;
    }
  }

  if (commands.length || !pages.length) pages.push(commands);

  const titleBlock =
    blocks.find(block => block?.type === 'heading' && block.level === 1) ||
    blocks.find(block => block?.type === 'heading');

  const documentTitle =
    inlineDocumentText(
      metadata.title ||
      titleBlock?.text ||
      'ovll result'
    ).slice(0, 120);

  pages.forEach((pageCommands, index) => {
    pageCommands.push(
      '.86 G\n.55 w\n' +
      pdfNumber(left) + ' 42 m\n' +
      pdfNumber(pageWidth - right) + ' 42 l\nS'
    );
    pageCommands.push(
      pdfTextCommand(
        documentTitle,
        left,
        27,
        7.7,
        'F2',
        .55
      )
    );
    pageCommands.push(
      pdfTextCommand(
        String(index + 1) + ' / ' + String(pages.length),
        pageWidth - right - 34,
        27,
        7.7,
        'F2',
        .55
      )
    );
  });

  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const fontBodyId = 3 + pages.length * 2;
  const fontBodyCidId = fontBodyId + 1;
  const fontHeadId = fontBodyId + 2;
  const fontHeadCidId = fontBodyId + 3;
  const infoId = fontBodyId + 4;
  const objectCount = infoId;
  const objects = new Map();

  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(
    2,
    '<< /Type /Pages /Kids [' +
    pageObjectIds.map(id => id + ' 0 R').join(' ') +
    '] /Count ' + pages.length + ' >>'
  );

  pages.forEach((pageCommands, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    const stream = pageCommands.join('\n');
    objects.set(
      pageId,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 ' + fontBodyId + ' 0 R /F2 ' + fontHeadId + ' 0 R >> >> ' +
      '/Contents ' + contentId + ' 0 R >>'
    );
    objects.set(
      contentId,
      '<< /Length ' + Buffer.byteLength(stream, 'ascii') + ' >>\nstream\n' +
      stream +
      '\nendstream'
    );
  });

  objects.set(
    fontBodyId,
    '<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium ' +
    '/Encoding /UniKS-UCS2-H /DescendantFonts [' + fontBodyCidId + ' 0 R] >>'
  );
  objects.set(
    fontBodyCidId,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium ' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> >>'
  );
  objects.set(
    fontHeadId,
    '<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium ' +
    '/Encoding /UniKS-UCS2-H /DescendantFonts [' + fontHeadCidId + ' 0 R] >>'
  );
  objects.set(
    fontHeadCidId,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium ' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> >>'
  );
  objects.set(
    infoId,
    '<< /Producer <' + utf16Hex('ovll') + '> /Title <' + utf16Hex(documentTitle) + '> >>'
  );

  const chunks = [
    Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')
  ];
  const offsets = [0];
  let offset = chunks[0].length;

  for (let id = 1; id <= objectCount; id++) {
    offsets[id] = offset;
    const chunk = Buffer.from(
      id + ' 0 obj\n' + objects.get(id) + '\nendobj\n',
      'ascii'
    );
    chunks.push(chunk);
    offset += chunk.length;
  }

  const xrefOffset = offset;
  let xref =
    'xref\n0 ' + (objectCount + 1) +
    '\n0000000000 65535 f \n';

  for (let id = 1; id <= objectCount; id++) {
    xref +=
      String(offsets[id]).padStart(10, '0') +
      ' 00000 n \n';
  }

  xref +=
    'trailer\n<< /Size ' + (objectCount + 1) +
    ' /Root 1 0 R /Info ' + infoId + ' 0 R >>\n' +
    'startxref\n' + xrefOffset + '\n%%EOF';

  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
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

function htmlBuffer(sources) {
  const body = sourceText(sources).split(/\r?\n/).map(line => '<p>' + xmlEscape(line || ' ') + '</p>').join('');
  return Buffer.from('<!doctype html><html><head><meta charset="utf-8"><title>ovll result</title></head><body>' + body + '</body></html>', 'utf8');
}

async function buildBuffer(format, sources, metadata = {}) {
  if (format === 'PDF') {
    try {
      const browserBuffer =
        await renderPdfWithChrome({
          text:
            sourceText(sources),
          title:
            metadata.title || ''
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
        pdfBuffer(
          sources,
          metadata
        ),
      renderer:
        'builtin-fallback'
    };
  }

  if (format === 'DOCX') return {buffer: docxBuffer(sources), renderer: 'native'};
  if (format === 'XLSX') return {buffer: xlsxBuffer(sources), renderer: 'native'};
  if (format === 'CSV') return {buffer: csvBuffer(sources), renderer: 'native'};
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
  if (format === 'HTML') return {buffer: htmlBuffer(sources), renderer: 'native'};
  if (format === 'RTF') return {buffer: rtfBuffer(sources), renderer: 'native'};

  return {
    buffer:
      Buffer.from(
        sourceText(sources),
        'utf8'
      ),
    renderer:
      'native'
  };
}

export async function createStoredArtifact(input = {}) {
  prune();
  const format = formatName(input.format);
  const info = FORMAT_INFO[format];
  const sources = Array.isArray(input.sources) ? input.sources : [input.sources].filter(value => value !== undefined);
  const name = withExtension(input.filename || 'result', info.ext);
  const built =
    await buildBuffer(
      format,
      sources,
      {
        title:
          name.replace(/\.[^.]+$/, '')
      }
    );
  const buffer =
    built.buffer;
  const id = randomUUID();
  const item = {id, name, format, mime: info.mime, size: buffer.length, createdAt: Date.now(), buffer, renderer: built.renderer, previewText: sourceText(sources).slice(0, 6000)};
  STORE.set(id, item);
  const baseUrl =
    '/api/artifacts/' +
    encodeURIComponent(
      item.id
    );

  return {
    id: item.id,
    name: item.name,
    format: item.format,
    mime: item.mime,
    size: item.size,
    renderer:
      item.renderer,
    previewText:
      item.previewText,
    previewUrl:
      baseUrl + '?inline=1',
    downloadUrl:
      baseUrl
  };
}

export function getStoredArtifact(id) {
  prune();
  return STORE.get(String(id || '')) || null;
}
