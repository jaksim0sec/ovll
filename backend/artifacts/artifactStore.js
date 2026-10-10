import {deflateRawSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {
  renderPdfFallback,
  pdfFallbackCoverage,
  renderPdfWithChrome
} from './pdfRenderer.js';
import {
  createArtifactDocument,
  extractArtifactContent,
  extractHtmlArtifact
} from './artifactDocument.js';

export const ARTIFACT_LIMITS=Object.freeze({ttlMs:2*60*60*1000,maxInputBytes:1048576,
  maxArtifactBytes:4*1024*1024,maxTotalBytes:32*1024*1024,maxCount:64,maxConcurrent:2,
  deadlineMs:30000,maxRows:5000,maxColumns:40});
const artifactError=(code,status=413)=>Object.assign(new Error(code),{code,status});
const MAX_TEXT_CHARS = 420000;

function throwIfArtifactAborted(
  signal
) {
  if (
    !signal?.aborted
  ) {
    return;
  }

  if (
    signal.reason instanceof
      Error
  ) {
    throw signal.reason;
  }

  const error =
    new Error(
      "Artifact creation aborted."
    );

  error.code =
    "ARTIFACT_ABORTED";
  error.status =
    499;

  throw error;
}

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

function formatName(value) {
  const raw = String(value || 'TXT').trim().toUpperCase().replace(/^\./, '');
  if (FORMAT_INFO[raw]) return raw;
  if (raw === 'MARKDOWN') return 'MD';
  if (raw === 'TEXT') return 'TXT';
  if (raw === 'WORD') return 'DOCX';
  if (raw === 'EXCEL' || raw === 'SHEET') return 'XLSX';
  throw artifactError('ARTIFACT_UNSUPPORTED_FORMAT',422);
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

function tableCandidate(sources) {
  let value=Array.isArray(sources)&&sources.length===1?sources[0]:sources;
  for(let depth=0;depth<8&&value&&typeof value==='object'&&!Array.isArray(value);depth++){
    if(Array.isArray(value.rows))return value;
    const inner=value.outputs?.result??value.result??value.text??value.content;
    if(inner===undefined)break;value=inner;
  }
  return value;
}
function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  text=String(text).replace(/^\uFEFF/,'');
  let delimiter=',',headerQuoted=false,sawTab=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){if(headerQuoted&&text[i+1]==='"')i++;else headerQuoted=!headerQuoted;}
    else if(!headerQuoted&&ch===','){sawTab=false;break;}
    else if(!headerQuoted&&ch==='\t')sawTab=true;
    else if(!headerQuoted&&(ch==='\n'||ch==='\r'))break;
  }
  if(sawTab)delimiter='\t';
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++;}
      else if(quoted||cell==='')quoted=!quoted;
      else cell+=ch;
    }else if(!quoted&&ch===delimiter){row.push(cell);cell='';}
    else if(!quoted&&(ch==='\n'||ch==='\r')){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);rows.push(row);row=[];cell='';
    }else cell+=ch;
  }
  if(quoted)throw artifactError('ARTIFACT_INVALID_CSV',422);
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return rows;
}
function tableData(sources){
  const candidate=tableCandidate(sources);let rows,headers=false;
  if(candidate&&Array.isArray(candidate.rows)){
    rows=candidate.rows;
    if(Array.isArray(candidate.headers)){rows=[candidate.headers,...rows];headers=true;}
  }else if(Array.isArray(candidate)&&candidate.every(Array.isArray))rows=candidate;
  else if(Array.isArray(candidate)&&candidate.length&&candidate.every(item=>item&&typeof item==='object'&&!Array.isArray(item))){
    const keys=[...new Set(candidate.flatMap(item=>Object.keys(item)))];
    rows=[keys,...candidate.map(item=>keys.map(key=>compactValue(item[key])))];headers=true;
  }else if(candidate&&typeof candidate==='object'){
    rows=[['항목','값'],...Object.entries(candidate).map(([key,value])=>[key,compactValue(value)])];headers=true;
  }else{
    const text=typeof candidate==='string'?candidate:sourceText(sources);
    const table=createArtifactDocument([text]).blocks.find(block=>block.type==='table');
    if(table){rows=[table.headers,...table.rows];headers=true;}else rows=parseCsv(text);
  }
  const rowLimit=ARTIFACT_LIMITS.maxRows+Number(headers),columnLimit=ARTIFACT_LIMITS.maxColumns;
  const columnCount=rows.reduce((max,row)=>Math.max(max,Array.isArray(row)?row.length:1),0);
  return {rows:rows.slice(0,rowLimit).map(row=>(Array.isArray(row)?row:[row]).slice(0,columnLimit).map(value=>compactValue(value))),
    omittedRows:Math.max(0,rows.length-rowLimit),omittedColumns:Math.max(0,columnCount-columnLimit)};
}
function tableRows(sources){return tableData(sources).rows;}

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

async function buildBuffer(
  format,
  sources,
  metadata = {},
  document = null,
  options = {}
) {
  const signal =
    options.signal;

  throwIfArtifactAborted(
    signal
  );

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
        await renderPdfWithChrome(
          {
            document:
              canonicalDocument,
            title:
              metadata.title ||
              canonicalDocument.title ||
              ''
          },
          {
            signal
          }
        );

      if (browserBuffer) {
        return {
          buffer:
            browserBuffer,
          renderer:
            'html-chromium'
        };
      }
    } catch (error) {
      if (
        signal?.aborted
      ) {
        throwIfArtifactAborted(
          signal
        );
      }

      console.warn(
        '[artifact pdf] Chromium render failed; using fallback renderer.',
        error?.message || error
      );
    }

    throwIfArtifactAborted(
      signal
    );

    return {
      buffer:
        await renderPdfFallback(
          canonicalDocument,
          {
            title:
              canonicalDocument.title ||
              metadata.title ||
              ''
          },
          {
            signal
          }
        ),
      coverage:pdfFallbackCoverage(canonicalDocument),
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
async function createArtifactInStore(
  input = {},
  options = {}
) {
  const {store:STORE,limits,now,build}=options.storeContext;

  const signal =
    options.signal;

  options.checkDeadline?.();
  throwIfArtifactAborted(
    signal
  );

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

  if(document.unavailableSources>0)throw artifactError('ARTIFACT_SOURCE_UNAVAILABLE',422);

  if (!document.title) {
    document.title =
      title;
  }

  const built =
    await build(
      format,
      sources,
      {
        title
      },
      document,
      {
        signal
      }
    );

  options.checkDeadline?.();
  throwIfArtifactAborted(
    signal
  );

  const buffer =
    built.buffer;

  if(buffer.length>limits.maxArtifactBytes)throw artifactError('ARTIFACT_OUTPUT_TOO_LARGE');
  const total=[...STORE.values()].reduce((sum,item)=>sum+item.size,0);
  if(total+buffer.length>limits.maxTotalBytes)throw artifactError('ARTIFACT_STORE_FULL',503);
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

  const tableCoverage=(format==='CSV'||format==='XLSX')?tableData(sources):{};
  const coverage={omittedRows:(tableCoverage.omittedRows||0)+(built.coverage?.omittedRows||0),omittedColumns:(tableCoverage.omittedColumns||0)+(built.coverage?.omittedColumns||0),
    omittedCharacters:((format==='CSV'||format==='XLSX'||format==='JSON')?0:(document.omittedCharacters||0))+(built.coverage?.omittedCharacters||0),sourceTruncated:(format==='CSV'||format==='XLSX'||format==='JSON')?document.sourceAvailability==='partial':document.truncated===true};
  const truncated=coverage.sourceTruncated||coverage.omittedRows>0||coverage.omittedColumns>0||coverage.omittedCharacters>0;
  const item = {
    id,
    name,
    format,
    mime:
      info.mime,
    size:
      buffer.length,
    createdAt:
      now(),
    buffer,
    renderer:
      built.renderer,
    targetPages,
    previewKind,
    previewText,
    truncated,coverage,availability:'temporary',expiresAt:now()+limits.ttlMs,
    sourceAvailability:document.sourceAvailability||'complete'
  };

  options.checkDeadline?.();
  throwIfArtifactAborted(
    signal
  );

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
    truncated:item.truncated,coverage:item.coverage,availability:item.availability,
    expiresAt:item.expiresAt,sourceAvailability:item.sourceAvailability,
    previewUrl:
      baseUrl +
      '?inline=1',
    downloadUrl:
      baseUrl
  };
}

export function createArtifactStore({limits:overrides={},now=()=>Date.now(),build=buildBuffer}={}){
  const limits={...ARTIFACT_LIMITS,...overrides},store=new Map();let active=0;
  const prune=()=>{for(const [id,item] of store)if(now()>=item.expiresAt)store.delete(id);};
  const stats=()=>{prune();return{count:store.size,active,totalBytes:[...store.values()].reduce((sum,item)=>sum+item.size,0)};};
  const cleanup=setInterval(prune,Math.max(1,Math.min(limits.ttlMs,60000)));cleanup.unref?.();
  async function createStoredArtifact(input={},options={}){
    throwIfArtifactAborted(options.signal);prune();
    formatName(input.format);
    if(Buffer.byteLength(JSON.stringify(input),'utf8')>limits.maxInputBytes)throw artifactError('ARTIFACT_INPUT_TOO_LARGE');
    if(active>=limits.maxConcurrent)throw artifactError('ARTIFACT_BUSY',503);
    if(store.size+active>=limits.maxCount||stats().totalBytes+active*limits.maxArtifactBytes>=limits.maxTotalBytes)
      throw artifactError('ARTIFACT_STORE_FULL',503);
    active++;
    const controller=new AbortController();
    const onAbort=()=>controller.abort(options.signal.reason||artifactError('ARTIFACT_ABORTED',499));
    options.signal?.addEventListener('abort',onAbort,{once:true});
    let rejectAbort;
    const aborted=new Promise((_resolve,reject)=>{rejectAbort=reject;});
    const onInternalAbort=()=>rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort',onInternalAbort,{once:true});
    const timer=setTimeout(()=>controller.abort(artifactError('ARTIFACT_DEADLINE',504)),limits.deadlineMs);
    const deadlineAt=Date.now()+limits.deadlineMs;
    const checkDeadline=()=>{if(Date.now()>=deadlineAt&&!controller.signal.aborted)controller.abort(artifactError('ARTIFACT_DEADLINE',504));};
    const work=createArtifactInStore(input,{...options,signal:controller.signal,checkDeadline,storeContext:{store,limits,now,build}})
      .finally(()=>{active--;clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);controller.signal.removeEventListener('abort',onInternalAbort);});
    return Promise.race([work,aborted]);
  }
  return{createStoredArtifact,getStoredArtifact(id){prune();return store.get(String(id||''))||null;},stats,
    dispose(){clearInterval(cleanup);store.clear();}};
}
const defaultStore=createArtifactStore();
export const createStoredArtifact=defaultStore.createStoredArtifact;
export const getStoredArtifact=defaultStore.getStoredArtifact;

// Mount before the creation handler. The store independently enforces resource bounds.
export function createArtifactAdmissionGuard({minutePerIp=12,maxClients=3000,now=()=>Date.now()}={}){
  const recent=new Map();
  return(req,res,next)=>{
    const at=now();for(const [ip,bucket] of recent)if(at-bucket.start>=60000)recent.delete(ip);
    const ip=req.ip||'unknown',bucket=recent.get(ip)||{start:at,count:0};
    if(bucket.count>=minutePerIp||(!recent.has(ip)&&recent.size>=maxClients)){
      const seconds=Math.max(1,Math.ceil((60000-(at-bucket.start))/1000));
      return res.set('Retry-After',String(seconds)).status(429).json({ok:false,code:'ARTIFACT_RATE_LIMIT',retryAfterSeconds:seconds});
    }
    bucket.count++;recent.set(ip,bucket);next();
  };
}
