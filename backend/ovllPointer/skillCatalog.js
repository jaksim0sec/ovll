/* =========================================================
   CANONICAL NODE DEFINITION
========================================================= */

/* Server-owned SVG catalog; clients only cache these paths. */
export const iconSvg = Object.freeze({
  play: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="translate(10 10) scale(1.15) translate(-10 -10)">
        <path d="M6.2 5.55c0-1.02 1.12-1.66 2.01-1.15l5.74 3.27c.52.3.84.86.84 1.46s-.32 1.16-.84 1.46l-5.74 3.27c-.89.51-2.01-.13-2.01-1.15V5.55Z"/>
      </g></svg>
    `,
  globe: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="10" cy="10" r="6.2"/>
        <path d="M3.8 10h12.4M10 3.8c1.72 1.82 2.55 3.88 2.55 6.2S11.72 14.38 10 16.2M10 3.8C8.28 5.62 7.45 7.68 7.45 10S8.28 14.38 10 16.2"/>
      </svg>
    `,
  notebook: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5.6 3.9h8.1c.95 0 1.7.75 1.7 1.7v8.8c0 .95-.75 1.7-1.7 1.7H5.85c-1.05 0-1.9-.85-1.9-1.9V5.55c0-.9.7-1.58 1.65-1.65Z"/>
        <path d="M4.1 13h11.3"/>
      </svg>
    `,
  scales: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="10" cy="4.25" r=".82"/>
        <path d="M4.05 6.25h11.9M10 5.1v10.25M7.3 15.65h5.4"/>
        <path d="M4.75 7.97C5.77 7.97 7.33 9.53 7.33 10.55S5.77 13.13 4.75 13.13S2.17 11.57 2.17 10.55S3.73 7.97 4.75 7.97Z"/>
        <path d="M15.25 7.97C16.27 7.97 17.83 9.53 17.83 10.55S16.27 13.13 15.25 13.13S12.67 11.57 12.67 10.55S14.23 7.97 15.25 7.97Z"/>
      </svg>
    `,
  pen: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.8 16.2C4.05 12.7 3.7 9.05 3.95 6.15Q4 5.1 5.05 5.05C8.25 4.9 11.15 4.65 13.58 3.42L16.58 6.42C15.35 8.85 15.1 11.75 14.95 14.95Q14.9 16 13.85 16.05C10.95 16.3 7.3 15.95 3.8 16.2Z"/>
        <circle cx="10" cy="10" r=".82"/>
        <path d="M3.8 16.2l5.62-5.62"/>
      </svg>
    `,
  folder: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3.6 6.6c0-1.15.93-2.08 2.08-2.08h2.28c.5 0 .98.2 1.33.55l.97.98h4.08c1.14 0 2.06.92 2.06 2.06v5.73c0 1.14-.92 2.06-2.06 2.06H5.66c-1.14 0-2.06-.92-2.06-2.06V6.6Z"/>
        <path d="M3.85 8.15h12.3"/>
      </svg>
    `,
  sparkle: `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9.65 3.6Q10 3.35 10.35 3.6C10.8 6.55 13.45 9.2 16.4 9.65Q16.65 10 16.4 10.35C13.45 10.8 10.8 13.45 10.35 16.4Q10 16.65 9.65 16.4C9.2 13.45 6.55 10.8 3.6 10.35Q3.35 10 3.6 9.65C6.55 9.2 9.2 6.55 9.65 3.6Z"/>
      </svg>
    `,
  custom: `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3.4" y="4" width="5.2" height="5.2" rx="1.6" stroke="currentColor" stroke-width="1.45"/><rect x="11.4" y="10.8" width="5.2" height="5.2" rx="1.6" stroke="currentColor" stroke-width="1.45"/><path d="M8.6 6.6h2.1a2 2 0 0 1 2 2v2.2" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>`,
  'open-book': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5.25C7.94 3.88 5.76 3.65 2.92 4.4c-.46.12-.77.5-.77.98v9.22c0 .64.43.97 1.08.8 2.38-.61 4.71-.35 6.77 1.05 2.06-1.4 4.39-1.66 6.77-1.05.65.17 1.08-.16 1.08-.8V5.38c0-.48-.31-.86-.77-.98-2.84-.75-5.02-.52-7.08.85Z"/>
<path d="M10 5.3v11.08"/></svg>`,
  'flask': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.75 3.22h4.5"/>
<path d="M8.65 3.22v4.82L4.38 14.6c-.64.98.06 2.18 1.23 2.18h8.78c1.17 0 1.87-1.2 1.23-2.18l-4.27-6.56V3.22"/>
<path d="M6.42 13.1h7.16"/></svg>`,
  'potted-plant': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="translate(10 10) scale(1.07) translate(-10 -10)"><path d="M5.78 11.36h8.44l-.88 4.07c-.17.82-.88 1.39-1.72 1.39H8.38c-.84 0-1.55-.57-1.72-1.39l-.88-4.07Z"/>
<path d="M5.18 11.36h9.64M10 11.36V6.95"/>
<path d="M9.98 8.23C7.04 8.27 5.04 6.76 4.98 4.17c2.64-.09 4.74 1.19 5 4.06Z"/>
<path d="M10.03 7.26c.08-2.78 1.77-4.36 4.74-4.42.09 2.58-1.51 4.35-4.74 4.42Z"/></g></svg>`,
  'graduation-cap': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2.78 7.65 6.52-3.3c.45-.22.95-.22 1.4 0l6.52 3.3-6.52 3.31c-.45.23-.95.23-1.4 0L2.78 7.65Z"/>
<path d="M5.55 9.12v3.24c0 1.77 1.95 3.01 4.45 3.01s4.45-1.24 4.45-3.01V9.12"/>
<path d="M17.22 7.65v5.08"/>
<circle cx="17.22" cy="13.38" r=".54"/></svg>`,
  'pencil': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.24 12.64 8.51-8.51a1.76 1.76 0 0 1 2.49 0l.63.63a1.76 1.76 0 0 1 0 2.49l-8.51 8.51-4.3 1.18 1.18-4.3Z"/>
<path d="m11.62 5.27 3.11 3.11M4.24 12.64l3.12 3.12"/></svg>`,
  'lightbulb': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.68c-2.95 0-5.12 2.08-5.12 5.05 0 1.91.88 3.22 2.42 4.43.63.5.93 1.05.93 1.88h3.54c0-.83.3-1.38.93-1.88 1.54-1.21 2.42-2.52 2.42-4.43 0-2.97-2.17-5.05-5.12-5.05Z"/>
<path d="M8.19 14.11h3.62M8.59 16.19h2.82"/></svg>`,
  'hourglass': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="translate(10 10) scale(1.07) translate(-10 -10)"><path d="M5.07 3.43h9.86M5.07 16.57h9.86"/>
<path d="M6.12 3.43v1.48c0 2.01 1.08 3.1 3.88 5.09-2.8 1.99-3.88 3.08-3.88 5.09v1.48h7.76v-1.48c0-2.01-1.08-3.1-3.88-5.09 2.8-1.99 3.88-3.08 3.88-5.09V3.43"/></g></svg>`,
  'planet': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="translate(10 10) scale(1.12) translate(-10 -10)"><circle cx="10.03" cy="9.88" r="4.49"/>
<path d="M5.69 8.66C3.2 9.9 2.17 11.3 2.73 12.35c.9 1.69 4.95 1.65 8.95-.07 4.01-1.73 6.72-4.26 5.62-5.65-.66-.84-2.32-.86-4.35-.37"/>
<path d="M7.59 6.13c.7-.39 1.55-.63 2.51-.69"/></g></svg>`,
  'headphones': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.42 10.9V9.5c0-3.48 2.25-5.92 5.58-5.92s5.58 2.44 5.58 5.92v1.4"/>
<path d="M4.36 10.88h.63c.69 0 1.26.57 1.26 1.26v2.84c0 .74-.6 1.34-1.34 1.34h-.55c-.97 0-1.76-.79-1.76-1.76v-1.92c0-.97.79-1.76 1.76-1.76Z"/>
<path d="M15.64 10.88h-.63c-.69 0-1.26.57-1.26 1.26v2.84c0 .74.6 1.34 1.34 1.34h.55c.97 0 1.76-.79 1.76-1.76v-1.92c0-.97-.79-1.76-1.76-1.76Z"/></svg>`,
  'coffee-cup': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.49 6.86h9.55v3.74c0 2.66-1.79 4.29-4.78 4.29s-4.77-1.63-4.77-4.29V6.86Z"/>
<path d="M13.04 7.72h1.31c1.65 0 2.57.91 2.57 2.31s-.92 2.31-2.57 2.31h-.78"/>
<path d="M3.58 16.55h11.9M7.1 4.78c-.47-.62-.38-1.2.18-1.9M10.26 4.78c.49-.62.47-1.21-.02-1.9"/></svg>`,
  'compass': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7.02"/>
<path d="m12.95 7.08-1.89 3.98-4.01 1.86 1.87-4.01 4.03-1.83Z"/>
<circle cx="10" cy="10" r=".49" fill="currentColor" stroke="none"/></svg>`,
  'document': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h5l3.5 3.5v8.2c0 .7-.6 1.3-1.3 1.3H6c-.7 0-1.3-.6-1.3-1.3V4.8c0-.7.6-1.3 1.3-1.3ZM11 3.5V7h3.5M7.1 10h5.3M7.1 13h4.1"/></svg>`,
  'spreadsheet': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="13" height="12" rx="1.7"/><path d="M3.5 8h13M3.5 12h13M8 8v8M12.5 8v8"/></svg>`,
  'chart-line': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3.8v12.4h12.4M6.5 12l3-3 2.8 1.5 3.7-5"/></svg>`,
  'checklist': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3.5" width="12" height="13" rx="1.7"/><path d="m6.5 7 1 1 1.5-2M11 7h2.5m-7 6 1 1 1.5-2M11 13h2.5"/></svg>`,
  'calendar': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="13" height="11.5" rx="1.7"/><path d="M3.5 8.5h13M7 3.5v3M13 3.5v3M7 11h1M12 11h1M7 14h1M12 14h1"/></svg>`,
  'clock': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="6.7"/><path d="M10 5.7v4.5l3 1.8"/></svg>`,
  'search': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.7" cy="8.7" r="5"/><path d="m12.3 12.3 4.1 4.1"/></svg>`,
  'link': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 12 4-4M6.5 10.5l-1 1a3 3 0 0 0 4.2 4.2l2.2-2.2a3 3 0 0 0 0-4.2m1.6.2 1-1a3 3 0 0 0-4.2-4.2L8.1 6.5a3 3 0 0 0 0 4.2"/></svg>`,
  'code': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6.5 6-4 4 4 4m7-8 4 4-4 4M11.5 4.5l-3 11"/></svg>`,
  'database': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="10" cy="5.5" rx="5.7" ry="2.3"/><path d="M4.3 5.5v9c0 1.3 2.5 2.3 5.7 2.3s5.7-1 5.7-2.3v-9M4.3 10c0 1.3 2.5 2.3 5.7 2.3s5.7-1 5.7-2.3"/></svg>`,
  'users': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="6.5" r="2.5"/><path d="M3.5 16v-1.2c0-2.4 1.8-4 4.5-4s4.5 1.6 4.5 4V16M13 4.2a2.5 2.5 0 0 1 0 4.8M14 11c1.7.5 2.5 1.8 2.5 3.8V16"/></svg>`,
  'shield': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 3 6 2.5v4.2c0 3.4-2.7 5.5-6 7.3-3.3-1.8-6-3.9-6-7.3V5.5L10 3Z"/><path d="m7 10 2 2 4-4"/></svg>`,
  'mail': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="14" height="11" rx="1.7"/><path d="m3.7 5.5 5.1 4a2 2 0 0 0 2.4 0l5.1-4"/></svg>`,
  'translate': `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 5h8M7.2 3v2M9.7 5c-.6 4-2.8 6.4-6 8M4.8 7c1.1 2.5 2.8 4.1 5.2 5M10.6 16.5l3-7 3 7M11.8 14h3.6"/></svg>`,
});

const defaultNodeDef = {
  start: {
    name: '시작하기',
    desc: 'AI 작업을 시작하는 기준점입니다.',
    llmdesc: 'workflow의 실행 흐름의 origin임',
    tag: 'START',
    color: '#10B981',
    iconKey: 'play',
    inputs: [],
    outputs: [
      {
        id: 'out',
        name: '실행 방향',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ]
  },

  research: {
    name: '조사하기',
    desc: '찾아볼 내용을 자연스럽게 요청합니다.',
    llmdesc: '입력 자료와 대화 맥락을 바탕으로 request에 적힌 조사 목표를 수행함. request가 없을 때만 legacy topic/filter를 사용함.',
    tag: 'RESEARCH',
    color: '#4F8EF7',
    iconKey: 'globe',
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 최근 3년 생성형 AI 시장 흐름과 주요 기업을 조사해줘',
        default: '',
        maxLength: 1800
      },
      {
        id: 'topic',
        name: '주제',
        hidden: true,
        legacy: true,
        maxLength: 700
      },
      {
        id: 'filter',
        name: '조건',
        hidden: true,
        legacy: true,
        maxLength: 500
      }
    ],
    inputs: [
      {
        id: 'in',
        name: '연결',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: [
      {
        id: 'result',
        name: '결과',
        type: 'research',
        required: false,
        multiple: true,
        accepts: ['research', 'any']
      }
    ]
  },

  organize: {
    name: '정리하기',
    desc: '자료를 원하는 모습으로 정리합니다.',
    llmdesc: '입력 자료를 request에 적힌 목적과 형태에 맞게 정리함. request가 없을 때만 legacy criteria/format을 사용함.',
    tag: 'ORGANIZE',
    color: '#E9A63A',
    iconKey: 'notebook',
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 핵심 수치와 기업별 특징을 비교하기 쉽게 정리해줘',
        default: '',
        maxLength: 1800
      },
      {
        id: 'criteria',
        name: '정리 기준',
        hidden: true,
        legacy: true,
        maxLength: 700
      },
      {
        id: 'format',
        name: '출력 형식',
        hidden: true,
        legacy: true,
        maxLength: 300
      }
    ],
    inputs: [
      {
        id: 'in',
        name: '데이터',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: [
      {
        id: 'result',
        name: '결과',
        type: 'structured',
        required: false,
        multiple: true,
        accepts: ['structured', 'any']
      }
    ]
  },

  judge: {
    name: '평가하기',
    desc: '자료를 원하는 기준으로 판단합니다.',
    llmdesc: 'request에 적힌 판단 기준으로 입력을 평가하고 true/false 한 경로만 엶. request가 없을 때만 legacy condition을 사용함.',
    tag: 'JUDGE',
    color: '#8B6BE8',
    iconKey: 'scales',
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 신뢰할 만한 근거가 충분한지 판단해줘',
        default: '',
        maxLength: 1800
      },
      {
        id: 'condition',
        name: '조건',
        hidden: true,
        legacy: true,
        maxLength: 900
      }
    ],
    inputs: [
      {
        id: 'true',
        name: '참 자료',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      },
      {
        id: 'false',
        name: '거짓 자료',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: [
      {
        id: 'true',
        name: '참 출구',
        type: 'decision',
        required: false,
        multiple: true,
        accepts: ['decision', 'any']
      },
      {
        id: 'false',
        name: '거짓 출구',
        type: 'decision',
        required: false,
        multiple: true,
        accepts: ['decision', 'any']
      }
    ]
  },

  write: {
    name: '작성하기',
    desc: '원하는 결과물을 자연어로 작성 요청합니다.',
    llmdesc: '입력 자료와 맥락을 바탕으로 request에 적힌 최종 글을 직접 작성함. request가 없을 때만 legacy title/length/style/about을 사용함. 페이지 수·쪽 수·분량 목표가 있으면 여백이나 반복으로 때우지 말고 실제 내용 분량과 구조를 충분히 만들어야 함.',
    tag: 'WRITE',
    color: '#D96F83',
    iconKey: 'pen',
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 고등학생도 이해하기 쉽게 5문단 정도의 보고서로 써줘',
        default: '',
        maxLength: 1800
      },
      {
        id: 'title',
        name: '제목',
        hidden: true,
        legacy: true,
        maxLength: 300
      },
      {
        id: 'length',
        name: '분량',
        hidden: true,
        legacy: true,
        maxLength: 200
      },
      {
        id: 'style',
        name: '스타일',
        hidden: true,
        legacy: true,
        maxLength: 300
      },
      {
        id: 'about',
        name: '내용',
        hidden: true,
        legacy: true,
        maxLength: 1200
      }
    ],
    inputs: [
      {
        id: 'in',
        name: '자료',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: [
      {
        id: 'result',
        name: '결과',
        type: 'document',
        required: false,
        multiple: true,
        accepts: ['document', 'any']
      }
    ]
  },


  file: {
    name: '파일 추가하기',
    desc: '작업에 사용할 파일을 추가합니다.',
    llmdesc: '사용자가 제공한 파일을 워크플로우에 입력함. 파일 자체를 생성하거나 변환하는 노드가 아님. 연결이 있어야만 실제로 참조가 가능.',
    tag: 'INPUT',
    color: '#718096',
    iconKey: 'folder',
    inputs: [],
    outputs: [
      {
        id: 'file',
        name: '전달',
        type: 'file',
        required: false,
        multiple: true,
        accepts: ['file', 'any']
      }
    ]
  },

  createFile: {
    name: '생성하기',
    desc: '원하는 파일 결과를 자연스럽게 요청합니다.',
    llmdesc: '입력 결과를 request에 적힌 파일명/형식으로 내보내는 최종 출력 노드임. createFile 자체는 문서 내용을 생성하거나 늘리지 않음. request가 없을 때만 legacy format/filename을 사용함. PDF/DOCX/RTF/HTML/MD 같은 문서 파일은 입력 단계에서 문단 줄바꿈과 제목·목록·표 등 필요한 구조와 요청된 페이지·분량을 갖춘 완성형 콘텐츠를 준비해야 하며 한 줄 텍스트 덩어리로 만들지 않음.',
    tag: 'OUTPUT',
    color: '#0EA5A4',
    iconKey: 'sparkle',
    params: [
      {
        id: 'request',
        name: '요청사항',
        kind: 'request',
        placeholder: '예: 결과를 AI시장보고서.pdf 파일로 만들어줘',
        default: '',
        maxLength: 1200
      },
      {
        id: 'format',
        name: '파일 형식',
        hidden: true,
        legacy: true,
        maxLength: 40
      },
      {
        id: 'filename',
        name: '파일명',
        hidden: true,
        legacy: true,
        maxLength: 160
      }
    ],
    inputs: [
      {
        id: 'in',
        name: '대상',
        type: 'any',
        required: false,
        multiple: true,
        accepts: ['any']
      }
    ],
    outputs: []
  }
};

export const CUSTOM_NODE_TYPE_RE =
  /^custom:[a-zA-Z0-9_-]{1,64}$/;

const customNodeDef = {
  iconKey: 'custom',
  name: '커스텀 노드',
  desc: '사용자가 저장한 서브플로우입니다.',
  llmdesc: '사용자가 직접 만든 불투명 서브플로우. 기존 custom id는 보존하고 새 id를 임의로 만들지 않음.',
  tag: 'CUSTOM',
  color: '#7C6CF2',
  params: [],
  inputs: [
    {
      id: 'in',
      name: '입력',
      type: 'any',
      required: false,
      multiple: true,
      accepts: ['any']
    }
  ],
  outputs: [
    {
      id: 'result',
      name: '결과',
      type: 'any',
      required: false,
      multiple: true,
      accepts: ['any']
    }
  ]
};

/* =========================================================
   NODE DEFINITIONS
========================================================= */

export const nodeDefinitionsPublic = JSON.parse(
  JSON.stringify(defaultNodeDef)
);

export const GENERATABLE_NODE_TYPES = Object.keys(
  defaultNodeDef
).filter(
  type => type !== 'start'
);

export function getNodeDefinition(type) {
  const key = String(type || '');

  if (defaultNodeDef[key]) {
    return defaultNodeDef[key];
  }

  if (CUSTOM_NODE_TYPE_RE.test(key)) {
    return customNodeDef;
  }

  return null;
}

export function getPortDefinition(type, direction, portId) {
  const def = getNodeDefinition(type);
  if (!def) return null;

  const ports =
    direction === 'input'
      ? def.inputs || []
      : def.outputs || [];

  return ports.find(
    port => String(port.id) === String(portId)
  ) || null;
}

function buildNodeDefinitionPrompt() {
  return GENERATABLE_NODE_TYPES
    .map(type => {
      const def = defaultNodeDef[type];

      const inputs =
        (def.inputs || [])
          .map(port => port.id)
          .join(',') || '-';

      const outputs =
        (def.outputs || [])
          .map(port => port.id)
          .join(',') || '-';

      const params =
        (def.params || [])
          .filter(
            param =>
              param.hidden !== true
          )
          .map(
            param =>
              param.id +
              (
                param.kind === 'request'
                  ? ':natural'
                  : ''
              )
          )
          .join(',') || '-';

      return [
        `type=${type}`,
        `name=${def.name}`,
        `입력=${inputs}`,
        `출력=${outputs}`,
        `params=${params}`,
        `설명=${def.llmdesc}`
      ].join(' ');
    })
    .join('\n');
}

export const NODE_DEFINITION_PROMPT =
  buildNodeDefinitionPrompt();


// Stable reusable work definitions for the Pointer kernel, derived from the existing UI catalog.
// Version 1 is canonical. A custom revision receives its own version and remains reusable.
export function getPointerCatalog() {
  const definitions=GENERATABLE_NODE_TYPES.map(type=>{
    const ui=defaultNodeDef[type], tool=type==='file'||type==='createFile';
    const port=p=>({name:p.id,role:p.name,representation:'json',required:false,
      multiple:p.multiple!==false});
    return {definitionId:'builtin:'+type,version:1,purpose:ui.desc,
      executorKind:tool?'tool_task':'model_task',instruction:ui.llmdesc,
      inputs:ui.inputs.map(port),
      outputs:type==='createFile'?[{name:'artifact',role:'다운로드 파일',representation:'json',required:true}]:ui.outputs.map(port),
      requiredCapabilities:type==='file'?['file.read_local']:type==='createFile'?['artifact.create']:
        type==='judge'?['model_task','branch.exclusive']:['model_task'],
      presentation:{name:ui.name,iconKey:ui.iconKey,color:ui.color}};
  });
  return {definitions,capabilities:['chat','ir.applyPatch','run.start','function.save',
    'function.run','question.ask','model_task','file.read_local','artifact.create','branch.exclusive']};
}
export function withPointerCatalog(snapshot) {
  const builtins=getPointerCatalog().definitions;
  return {...snapshot,definitions:[...(snapshot.definitions||[]).filter(d=>
    !builtins.some(b=>b.definitionId===d.definitionId&&b.version===d.version)),...builtins]};
}
