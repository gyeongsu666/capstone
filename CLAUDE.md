# LEFT 프론트엔드

CCTV 기반 실종자 동선 추적 시스템(캡스톤디자인)의 웹 프론트엔드. 지금 단계는 **백엔드 없이 MSW 가짜 서버로 모든 화면을 동작시키는 테스트용 프론트**를 만드는 것이다. 백엔드(FastAPI)는 따로 개발 중이며, 나중에 MSW를 끄고 실제 서버에 연결한다.

## 먼저 읽을 문서

작업 전에 관련 문서를 읽는다. 문서와 이 파일이 다르면 **문서가 우선**이고, 문서끼리 다르면 아래 순서가 우선이다.
팀 공통 문서(API, 요구사항)는 **`docs` 브랜치**에 있다. 로컬에서는 `git fetch origin docs` 후 `git show origin/docs:<경로>`로 읽는다.

1. `docs/design.md` — 레이아웃, 색, 글꼴, 지도 표현, 공통 부품, 화면별 배치
2. API: `docs` 브랜치 `docs/api/openapi.json`(기본 계약. 이 저장소의 `openapi/openapi.json`은 타입 생성용 복사본) + `docs` 브랜치 `docs/api/frontend-api-requests.md`(추가 요청 R1~R7과 프론트 정책 확정안)
3. `docs/mock-scenario.md` — MSW 가짜 데이터와 시나리오, 개발 패널
4. `docs` 브랜치 `docs/requirements.md` — 기능 요구사항(SYS00~02 번호의 출처)
5. `docs/mockups/*.png` — 시안 두 장. 레이아웃 참고용. 색과 일부 배치는 `docs/design.md`의 "시안에서 바뀌는 점"을 따른다

## 기술 스택 (확정)

- Vite + React 18 + TypeScript(strict). React 19로 올리지 않는다.
- React Router 6, TanStack Query 5, Zustand, Ant Design 5
- react-kakao-maps-sdk (카카오맵)
- MSW 2 (가짜 서버)
- HTML5 `<video>` (영상 재생, 별도 라이브러리 없음)
- openapi-typescript: 백엔드 `openapi.json`으로 서버 타입 생성(`npm run gen:api`, TypeScript 6과 맞지 않아 설치하지 않고 npx로 실행). 통신은 직접 만든 `src/api/client.ts`(fetch) 사용
- 글꼴 Pretendard

## 명령어

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm run lint
```

환경 변수(`.env.local`, 저장소에 올리지 않음):

```bash
VITE_KAKAO_MAP_KEY=<카카오 JavaScript 키>
VITE_USE_MOCK=true          # true면 MSW 가짜 서버 사용
VITE_API_BASE_URL=/api
API_PROXY_TARGET=           # 실제 백엔드에 붙일 때만(예: http://localhost:8000). Vite proxy가 /api를 넘긴다
```

`.env.example`에는 키 값 없이 위 이름만 적어 커밋한다. 카카오 개발자 사이트에 `http://localhost:5173`이 도메인으로 등록돼 있어야 지도가 뜬다.

## 폴더 구조

```text
src/
  app/          라우터, Provider(QueryClient, Antd ConfigProvider), 레이아웃(사이드바·헤더), 라우트 가드
  pages/        화면 단위. login, cases, route-tracking, search-area, admin/camera-map, admin/videos, admin/settings
  components/   공통 부품(상태 배지, 후보 카드, 확인 영역, 장면 썸네일, 되돌리기 알림, 결정 기록 줄, 출현 알림, 사건 카드, 빈 화면 안내, 영상 재생기)
  map/          카카오맵 래퍼와 레이어(카메라, 도보 경로, 위험 지역, 동선, 현재 위치 범위, 범례, 레이어 토글)
  api/          서버 통신 전부: client, 서버 타입(server.ts, generated/), 변환(convert.ts, view/), 엔드포인트 함수, TanStack Query 훅
  mocks/        MSW: browser.ts, handlers/, db(가짜 DB + localStorage 저장, 내부 타입 legacyTypes.ts), scenario(초기 데이터), dev-panel
  stores/       Zustand(로그인 사용자·CSRF 토큰(메모리), 지금 보는 검색, 선택된 후보, 검토/지도 전환 등 화면 상태)
  theme/        Antd 테마 토큰, 상태 색, 지도 색
  utils/        시각·경과 시간·유사도 표시 함수 등
public/mock/    가짜 썸네일, 영상
```

## 핵심 규칙

**API 계층**

- 서버 호출은 `src/api`에서만 한다. 컴포넌트와 페이지는 `src/api`의 훅만 쓴다. 명세가 바뀌어도 `src/api`만 고치면 되게 한다.
- 서버 타입은 `openapi/openapi.json`에서 생성한 `src/api/generated/schema.d.ts`(`npm run gen:api`)를 `src/api/server.ts`로 쓴다. 아직 openapi.json에 없는 R1~R7 필드는 `src/api/server.ts`에 덧붙이고, 백엔드가 반영하면 지운다.
- 화면은 서버 타입을 직접 쓰지 않는다. 서버 → 화면 변환은 `src/api/view/serverMappers.ts`, 공통 변환(ID·GeoJSON 좌표·cursor 목록)은 `src/api/convert.ts`에서만 한다. 화면 ID는 모두 문자열, 서버로 보낼 때만 정수로 바꾼다(큰 정수 문자열·UUID는 그대로).
- 목록은 cursor(`next_cursor`, `has_more`)로 "더 보기". 전체 개수는 서버가 집계로 준 것만 쓴다. 지도처럼 다 그려야 하는 목록은 `fetchAll`(끝까지 못 받으면 에러).
- 오래 걸리는 작업은 `202 + task_id` → `GET /api/tasks/{task_id}`를 2~3초 간격 폴링(TanStack Query `refetchInterval`). 작업이 끝나면 관련 쿼리를 무효화한다.
- 출현 알림(`/cases/{id}/alerts`, `/alerts/pending-count`), 감시 상태, 공동 판단도 폴링. WebSocket·SSE 쓰지 않는다.
- 인증: 세션 쿠키 `refind_session`(HttpOnly, 서버가 붙임) + 변경 요청마다 `X-CSRF-Token`(로그인·`/auth/me` 응답의 `csrf_token`, 메모리에만). 앱을 열 때 `/auth/me`로 로그인 상태 확인. POST에는 `Idempotency-Key`. 401 `UNAUTHENTICATED`/`SESSION_EXPIRED`면 로그인 화면, 403 `PASSWORD_CHANGE_REQUIRED`면 비밀번호 변경 화면. 맡지 않은 사건은 404로 오고 "사건을 찾을 수 없거나 접근 권한이 없습니다".
- 에러 응답은 `{ request_id, error: { code, message, fields, context, retryable } }`. 화면 처리는 `code` 기준(예: `ALREADY_DECIDED`면 "OO님이 먼저 판단했어요", `VERSION_CONFLICT`면 최신 값을 다시 받고 사용자가 다시 실행 — 자동으로 덮어쓰지 않는다).
- 수정 요청에는 응답의 `version`을 `expected_version`(사건 판단은 `expected_case_version`)으로 보낸다.

**MSW**

- `VITE_USE_MOCK=true`일 때만 켠다. 핸들러 주소와 응답 모양은 openapi.json(+ 확정안 R1~R7)과 정확히 같게.
- 가짜 서버도 권한·CSRF·버전·첫 로그인 제한을 검사한다(역할, 맡은 사건). 화면에서만 숨기지 않는다. 가짜 DB의 정수 ID는 숫자 문자열로 두고, 트랙렛·판단·영상 등은 `pubId`로 서버 모양 ID를 만든다.
- 모든 응답에 300~800ms 지연, 작업은 progress가 단계적으로 오른다. 실제 서버와 비슷한 조건에서 로딩·에러 화면이 만들어지게 한다.
- 시나리오, 계정, 개발 패널은 `docs/mock-scenario.md`대로.

**디자인**

- 강조색은 파랑 하나(Antd primary). 역할마다 색을 바꾸지 않는다. 상태 색은 확정=초록, 대기·재확인 필요=주황, 제외·번복=회색+취소선, 위험·실패·알림=빨강, 현재 위치 3단계=보라 진하기.
- 색만으로 구분하지 않는다. 지도는 모양·선 종류, 근거는 아이콘+글자를 함께 쓴다.
- 글자 12px 미만 금지. 시각 `15:02`, 유사도 `0.71`, 경과 "32분 경과". 숫자 열은 `tabular-nums`.
- 목록·표(후보 대기열, 결정 기록, 이용 기록, 계정)는 Antd `size="small"`.
- 1280px 이상 데스크톱, 크롬, 밝은 화면만. 반응형·다크 모드 만들지 않는다.

**동작 규칙** (자주 틀리는 것)

- 후보는 검색(`search_id`) 단위. 기준 대상·유사도 기준이 바뀌거나 확정·예/아니오 번복이 생기면 그 검색은 낡고(stale) 판단할 수 없다 → "다시 검색" 안내. "예"를 누르면 그 장면 기준으로 다음 구간을 바로 검색한다.
- 판단은 예 / 아니오 / 보류, 단축키 Y / N. 보류는 대기열 맨 뒤로, 동선에 영향 없음. 보류한 후보를 판단할 때는 보류를 번복(사유 없음)한 뒤 같은 검색에서 새로 저장한다(보류 번복은 검색을 낡게 하지 않음, 요청서 R3).
- 모든 판단은 결정 기록에 남고 지우지 않는다. 번복은 원래 줄을 취소선으로 두고 번복 줄(사유 포함)을 붙인다.
- 판단 직후 8초 되돌리기 알림(한 번에 하나, 사유 없이 번복). 8초 뒤에도 결정 기록 탭에서 번복 가능(사유 필수).
- "예" 번복 → 그 뒤 확정 장면은 '재확인 필요'. "아니오" 번복 → 다시 검색하면 후보로 돌아온다.
- 후보 검색·장면 확인·경로 확인은 **동선 추적 한 화면**. 사건 등록만 별도. 검토/지도 전환으로 큰 지도를 본다.
- 유사도 기준은 관리자 기본값으로 시작해 사건마다 바꿀 수 있다.
- 지도에 직접 그려서 검색 범위를 정하는 기능은 넣지 않는다.
- 현재 위치 범위는 길을 따라 퍼진 모양으로 그린다. 동심원 금지.
- 사건 영상 추가는 사용자도 할 수 있다(맡은 사건만).
- 로그인·역할별 메뉴는 1차에 포함한다. 관리자는 관리자 메뉴 + 수색 메뉴, 사용자는 수색 메뉴만.

**하지 말 것**

- `.env.local`과 카카오 키 커밋
- 실제 CCTV 영상, 인터넷에서 받은 사람 사진 사용
- `src/api` 밖에서 fetch 호출
- 문서에 없는 API를 마음대로 추가. 필요하면 먼저 사용자에게 묻고, 추가했다면 `docs` 브랜치 `docs/api/frontend-api-requests.md`에도 반영 제안

## 작업 순서

한 단계씩 진행하고, 단계마다 화면을 띄워 확인한 뒤 다음으로 넘어간다.

- 화면 1~9단계(세팅 → 관리자 화면)와 백엔드 openapi.json 기준 API 전환 1~8단계는 끝났다(가짜 서버 기준).
- openapi 1.1.0(R1~R8 반영)으로 타입을 다시 만들고 `src/api/server.ts`의 덧붙임을 지웠다(2026-11-28).
- 실제 서버 연결: 로컬 백엔드(`capstone-backend/backend/tools/dev_local.py`)에 붙여 주요 화면을 확인했다. 실행은 `npx vite --mode realapi`(`.env.realapi.local`: `VITE_USE_MOCK=false`, `API_PROXY_TARGET=http://127.0.0.1:8000`). GPU 서버 배포본 연결은 아직이다.

## 진행 보고

완료를 보고할 때 **"가짜 서버 기준 완료"**와 **"실제 서버 연결 완료"**를 구분한다. 지금은 로컬 실제 서버 연결까지 확인했고, GPU 서버 배포본 연결은 남았다.

## 아직 정해지지 않은 것

- 보행 속도(평소·최대)·유사도 기본값·출현 알림 높음 기준·범위 밖 기준·현재 위치 3단계 비율의 실제 숫자(MSW는 `docs/mock-scenario.md`의 임시값 사용)
- 세션 만료 시간(가짜 서버 60분), 비밀번호 규칙(openapi.json 제안 10~128자)
- 검색이 낡는(stale) 정확한 조건, 감시 시작 조건 — 가짜 서버는 위 "동작 규칙"대로 해석했다
- 백엔드가 명세를 바꿀 수 있음. 새 `openapi.json`이 오면 차이를 정리해 사용자에게 먼저 보여준다
