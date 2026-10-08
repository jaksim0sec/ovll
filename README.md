# Ovll (오블)

**사용자와 AI가 작업을 이해하고 조정하며 재사용할 수 있는 범용 AI 작업 환경.**

Ovll은 모델의 능력을 불필요하게 제한하지 않고, 사용자의 목적과 작업 방식에 맞는 소통·동적 작업 구성·실행·함수화를 통해 총노동을 줄이는 것을 목표로 한다.

- [제품 가치와 방향성](docs/VISION.md)
- [기술·체계 설계와 현황](docs/architecture/README.md)
- [지침 라이브러리 개편 기준](instructions/README.md)
- [전체 문서 안내](docs/README.md)
- [진행 중인 기술 구조 논의 (#22)](https://github.com/jaksim0sec/ovll/issues/22)

## 현재 코드

| 위치 | 역할 |
| --- | --- |
| `server.js` | Express API 및 서버 진입점 |
| `backend/ai/` | 현재 모델 실행 |
| `backend/artifacts/` | 결과물 생성·저장·PDF |
| `backend/http/` | 서버 HTTP 보조 로직 |
| `front/` | 웹/PWA UI와 기존 브라우저 작업 실행기 |
| `mobile/` | Capacitor 모바일 셸 |
| `instructions/` | 지침 개편을 위한 현황·설계 (런타임 이관 전) |
| `test/` | Node 회귀 테스트 |
| `docs/archive/` | 과거 설계 기록 (현재 확정 설계 아님) |

현재 제품은 위 비전을 향해 재편하는 과정에 있다. 문서의 목표와 이미 구현된 기능을 구분한다.

## 실행 및 검증

```bash
npm ci
npm start
npm test
```
