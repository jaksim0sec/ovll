import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const execFileAsync = promisify(execFile);
let cachedChromeExecutable;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function executableFile(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    await access(candidate, fsConstants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

async function resolveChromeExecutable() {
  if (cachedChromeExecutable !== undefined) {
    return cachedChromeExecutable;
  }

  const explicit = [
    process.env.OVLL_CHROME_PATH,
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ];

  for (const candidate of explicit) {
    const file = await executableFile(candidate);
    if (file) {
      cachedChromeExecutable = file;
      return file;
    }
  }

  const commands = process.platform === 'win32'
    ? ['chrome.exe', 'msedge.exe']
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ]
      : [
          'google-chrome-stable',
          'google-chrome',
          'chromium',
          'chromium-browser',
          'chrome',
          'chrome-headless-shell'
        ];

  for (const candidate of commands) {
    const direct = candidate.includes('/') || candidate.includes('\\')
      ? await executableFile(candidate)
      : candidate;

    if (!direct) continue;

    try {
      await execFileAsync(direct, ['--version'], {
        timeout: 2500,
        windowsHide: true,
        maxBuffer: 256 * 1024
      });
      cachedChromeExecutable = direct;
      return direct;
    } catch {}
  }

  cachedChromeExecutable = null;
  return null;
}

function inlineText(value) {
  return String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\x60([^\x60]+)\x60/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function inlineHtml(value) {
  let text = escapeHtml(String(value ?? ''));
  const code = [];

  text = text.replace(/\x60([^\x60\n]+)\x60/g, (_, body) => {
    const token = '@@OVLL_CODE_' + code.length + '@@';
    code.push('<code>' + body + '</code>');
    return token;
  });

  text = text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');

  code.forEach((html, index) => {
    text = text.replace('@@OVLL_CODE_' + index + '@@', html);
  });

  return text;
}

function tableCells(line) {
  const value = String(line || '').trim();
  if (!value.includes('|')) return [];
  return value
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function isTableDivider(line) {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function normalizeDocumentText(
  value
){
  let text=
    String(value??"")
      .replace(/\r\n?/g,"\n")
      .replace(
        /([^\n])\s+(#{1,4}\s+)/g,
        "$1\n$2"
      );

  const lineBreaks=
    (text.match(/\n/g)||[])
      .length;

  if(
    text.length>180&&
    lineBreaks<2
  ){
    text=text.replace(
      /([.!?。])\s+(?=[^\s])/g,
      "$1\n"
    );
  }

  return text;
}

function documentHtml(text, title) {
  const lines = normalizeDocumentText(text).split('\n');
  const out = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let firstHeading = '';

  const firstContentIndex=
    lines.findIndex(
      line=>line.trim()
    );

  if(firstContentIndex>=0){
    const first=
      lines[firstContentIndex]
        .trim();

    const next=
      lines
        .slice(firstContentIndex+1)
        .find(line=>line.trim())
        ?.trim()||
      "";

    if(
      first.length<=72&&
      !/^#{1,4}\s+/.test(first)&&
      /^#{1,4}\s+/.test(next)&&
      !/[.!?。]$/.test(first)
    ){
      lines[firstContentIndex]=
        "# "+first;
    }
  }

  const flushParagraph = () => {
    const value = paragraph.join(' ').trim();
    if (value) out.push('<p>' + inlineHtml(value) + '</p>');
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      return;
    }
    out.push(
      '<' + listType + '>' +
      listItems.map(item => '<li>' + inlineHtml(item) + '</li>').join('') +
      '</' + listType + '>'
    );
    listType = null;
    listItems = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (/^(?:\x60{3,}|~{3,})/.test(trimmed)) {
      flushParagraph();
      flushList();
      const marker = trimmed.startsWith('~') ? '~' : String.fromCharCode(96);
      const code = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith(marker.repeat(3))) {
        code.push(lines[index]);
        index++;
      }
      out.push('<pre><code>' + escapeHtml(code.join('\n').replace(/\t/g, '    ')) + '</code></pre>');
      continue;
    }

    if (trimmed.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph();
      flushList();
      const rows = [tableCells(trimmed)];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(tableCells(lines[index]));
        index++;
      }
      index--;
      const header = rows.shift() || [];
      out.push(
        '<div class="table-wrap"><table><thead><tr>' +
        header.map(cell => '<th>' + inlineHtml(cell) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map(row =>
          '<tr>' +
          header.map((_, column) => '<td>' + inlineHtml(row[column] || '') + '</td>').join('') +
          '</tr>'
        ).join('') +
        '</tbody></table></div>'
      );
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, heading[1].length);
      const headingText = inlineText(heading[2]);
      if (!firstHeading) firstHeading = headingText;
      out.push('<h' + level + '>' + inlineHtml(heading[2]) + '</h' + level + '>');
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      out.push('<hr>');
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(ordered[1]);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      out.push('<blockquote>' + inlineHtml(quote[1]) + '</blockquote>');
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  const documentTitle = inlineText(firstHeading || title || '문서').slice(0, 120);
  const addTitle = !firstHeading && documentTitle && documentTitle !== '문서';

  const css = [
    '@page{size:A4;margin:18mm 18mm 20mm}',
    '*{box-sizing:border-box}',
    'html{print-color-adjust:exact;-webkit-print-color-adjust:exact}',
    'body{margin:0;color:#181818;background:#fff;font-family:"Noto Sans KR","Noto Sans CJK KR","Apple SD Gothic Neo","Malgun Gothic","NanumGothic",sans-serif;font-size:10.5pt;line-height:1.72;letter-spacing:-.01em;word-break:keep-all;overflow-wrap:anywhere}',
    'article{width:100%}',
    '.document-title{margin:0 0 9mm;font-size:25pt;line-height:1.2;font-weight:750;letter-spacing:-.035em;color:#111}',
    'h1,h2,h3,h4{break-after:avoid-page;page-break-after:avoid;margin-left:0;margin-right:0;color:#111;letter-spacing:-.028em}',
    'h1{margin-top:0;margin-bottom:6mm;font-size:24pt;line-height:1.2;font-weight:760;border-bottom:1px solid #dedede;padding-bottom:4mm}',
    'h2{margin-top:8mm;margin-bottom:3.5mm;font-size:16.5pt;line-height:1.35;font-weight:730}',
    'h3{margin-top:6mm;margin-bottom:2.5mm;font-size:13pt;line-height:1.42;font-weight:700}',
    'h4{margin-top:5mm;margin-bottom:2mm;font-size:11pt;line-height:1.45;font-weight:700}',
    'p{margin:0 0 4.2mm;orphans:3;widows:3}',
    'strong{font-weight:720;color:#101010}',
    'em{font-style:italic}',
    'a{color:inherit;text-decoration-color:#999;text-underline-offset:2px}',
    'ul,ol{margin:1.5mm 0 4.5mm;padding-left:6mm}',
    'li{margin:1.2mm 0;padding-left:1mm;break-inside:avoid}',
    'blockquote{margin:4mm 0 5mm;padding:3.5mm 4.5mm;border-left:3px solid #b7b7b7;border-radius:0 3mm 3mm 0;background:#f7f7f7;color:#4b4b4b;break-inside:avoid}',
    'pre{margin:4mm 0 5mm;padding:4mm 4.5mm;border:1px solid #e1e1e1;border-radius:3mm;background:#f6f6f6;white-space:pre-wrap;word-break:break-word;break-inside:auto}',
    'code{font-family:"SFMono-Regular","Cascadia Mono","Roboto Mono","Consolas",monospace;font-size:.9em;background:#f2f2f2;border-radius:1.2mm;padding:.2em .35em}',
    'pre code{padding:0;background:transparent;border-radius:0;font-size:8.8pt;line-height:1.62}',
    'hr{border:0;border-top:1px solid #dfdfdf;margin:7mm 0}',
    '.table-wrap{margin:4mm 0 6mm;break-inside:auto}',
    'table{width:100%;border-collapse:separate;border-spacing:0;font-size:9.2pt;line-height:1.5;border:1px solid #dedede;border-radius:2.5mm;overflow:hidden}',
    'thead{display:table-header-group}',
    'tr{break-inside:avoid}',
    'th,td{padding:2.7mm 3mm;text-align:left;vertical-align:top;border-bottom:1px solid #e6e6e6;border-right:1px solid #ececec}',
    'th{font-weight:700;background:#f3f3f3;color:#222}',
    'tr:last-child td{border-bottom:0}',
    'th:last-child,td:last-child{border-right:0}',
    '.doc-footer{position:fixed;bottom:-13mm;left:0;right:0;padding-top:2.2mm;border-top:1px solid #e5e5e5;color:#a0a0a0;font-size:7.5pt;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  ].join('');

  return '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(documentTitle) + '</title>' +
    '<style>' + css + '</style></head><body><article>' +
    (addTitle ? '<h1 class="document-title">' + escapeHtml(documentTitle) + '</h1>' : '') +
    out.join('') +
    '</article><div class="doc-footer">' + escapeHtml(documentTitle) + '</div>' +
    '</body></html>';
}

export async function renderPdfWithChrome(input = {}) {
  const executable = await resolveChromeExecutable();
  if (!executable) return null;

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ovll-pdf-'));
  const htmlPath = path.join(tempDir, 'document.html');
  const pdfPath = path.join(tempDir, 'document.pdf');

  try {
    await writeFile(
      htmlPath,
      documentHtml(input.text, input.title),
      'utf8'
    );

    try {
      await execFileAsync(
        executable,
        [
          '--headless',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-background-networking',
          '--disable-extensions',
          '--disable-sync',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--no-sandbox',
          '--allow-file-access-from-files',
          '--no-pdf-header-footer',
          '--run-all-compositor-stages-before-draw',
          '--user-data-dir=' + path.join(tempDir, 'profile'),
          '--virtual-time-budget=600',
          '--print-to-pdf=' + pdfPath,
          pathToFileURL(htmlPath).href
        ],
        {
          timeout: 8000,
          windowsHide: true,
          maxBuffer: 1024 * 1024
        }
      );
    } catch (error) {
      cachedChromeExecutable = null;
      throw error;
    }

    const buffer = await readFile(pdfPath);
    if (buffer.length < 8 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('Headless Chrome did not produce a valid PDF.');
    }

    return buffer;
  } finally {
    await rm(tempDir, {recursive: true, force: true}).catch(() => {});
  }
}
