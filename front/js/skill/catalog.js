/** Local presentation catalog adapted from main ed2fcdd. Not an execution schema.
 * SERVER INTEGRATION: replace through a validated catalog provider when defined.
 */
const catalog = [
  {
    "id": "start",
    "name": "시작하기",
    "description": "AI 작업을 시작하는 기준점입니다.",
    "icon": "play",
    "color": "#10B981",
    "inputs": [],
    "outputs": [
      {
        "id": "out",
        "label": "실행 방향",
        "type": "any",
        "multiple": true
      }
    ],
    "fields": []
  },
  {
    "id": "research",
    "name": "조사하기",
    "description": "찾아볼 내용을 자연스럽게 요청합니다.",
    "icon": "globe",
    "color": "#4F8EF7",
    "inputs": [
      {
        "id": "in",
        "label": "연결",
        "type": "any",
        "multiple": true
      }
    ],
    "outputs": [
      {
        "id": "result",
        "label": "결과",
        "type": "research",
        "multiple": true
      }
    ],
    "fields": [
      {
        "id": "request",
        "label": "요청사항",
        "placeholder": "예: 최근 3년 생성형 AI 시장 흐름과 주요 기업을 조사해줘",
        "default": "",
        "maxLength": 1800
      }
    ]
  },
  {
    "id": "organize",
    "name": "정리하기",
    "description": "자료를 원하는 모습으로 정리합니다.",
    "icon": "notebook",
    "color": "#E9A63A",
    "inputs": [
      {
        "id": "in",
        "label": "데이터",
        "type": "any",
        "multiple": true
      }
    ],
    "outputs": [
      {
        "id": "result",
        "label": "결과",
        "type": "structured",
        "multiple": true
      }
    ],
    "fields": [
      {
        "id": "request",
        "label": "요청사항",
        "placeholder": "예: 핵심 수치와 기업별 특징을 비교하기 쉽게 정리해줘",
        "default": "",
        "maxLength": 1800
      }
    ]
  },
  {
    "id": "judge",
    "name": "평가하기",
    "description": "자료를 원하는 기준으로 판단합니다.",
    "icon": "scales",
    "color": "#8B6BE8",
    "inputs": [
      {
        "id": "true",
        "label": "참 자료",
        "type": "any",
        "multiple": true
      },
      {
        "id": "false",
        "label": "거짓 자료",
        "type": "any",
        "multiple": true
      }
    ],
    "outputs": [
      {
        "id": "true",
        "label": "참 출구",
        "type": "decision",
        "multiple": true
      },
      {
        "id": "false",
        "label": "거짓 출구",
        "type": "decision",
        "multiple": true
      }
    ],
    "fields": [
      {
        "id": "request",
        "label": "요청사항",
        "placeholder": "예: 신뢰할 만한 근거가 충분한지 판단해줘",
        "default": "",
        "maxLength": 1800
      }
    ]
  },
  {
    "id": "write",
    "name": "작성하기",
    "description": "원하는 결과물을 자연어로 작성 요청합니다.",
    "icon": "pen",
    "color": "#D96F83",
    "inputs": [
      {
        "id": "in",
        "label": "자료",
        "type": "any",
        "multiple": true
      }
    ],
    "outputs": [
      {
        "id": "result",
        "label": "결과",
        "type": "document",
        "multiple": true
      }
    ],
    "fields": [
      {
        "id": "request",
        "label": "요청사항",
        "placeholder": "예: 고등학생도 이해하기 쉽게 5문단 정도의 보고서로 써줘",
        "default": "",
        "maxLength": 1800
      }
    ]
  },
  {
    "id": "file",
    "name": "파일 추가하기",
    "description": "작업에 사용할 파일을 추가합니다.",
    "icon": "folder",
    "color": "#718096",
    "inputs": [],
    "outputs": [
      {
        "id": "file",
        "label": "전달",
        "type": "file",
        "multiple": true
      }
    ],
    "fields": []
  },
  {
    "id": "createFile",
    "name": "생성하기",
    "description": "원하는 파일 결과를 자연스럽게 요청합니다.",
    "icon": "sparkle",
    "color": "#0EA5A4",
    "inputs": [
      {
        "id": "in",
        "label": "대상",
        "type": "any",
        "multiple": true
      }
    ],
    "outputs": [],
    "fields": [
      {
        "id": "request",
        "label": "요청사항",
        "placeholder": "예: 결과를 AI시장보고서.pdf 파일로 만들어줘",
        "default": "",
        "maxLength": 1200
      }
    ]
  }
];
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const skills=freeze(catalog);
export const getSkill=id=>skills.find(skill=>skill.id===id);
