# mocks

- `browser.ts` — MSW 워커 (`VITE_USE_MOCK=true`일 때만 `main.tsx`에서 시작)
- `handlers/` — API 묶음별 핸들러
- `db/` — 가짜 DB + localStorage 저장 (3단계)
- `scenario/` — 초기 데이터 (`docs/mock-scenario.md`)
- `dev-panel/` — 개발 패널 (3단계)

`public/mockServiceWorker.js`는 `npx msw init`이 만든 파일이라 직접 고치지 않는다.
