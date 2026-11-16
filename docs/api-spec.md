# API 명세 (초안)

> 원본: claude.ai 문서의 "API 명세" 탭. 2026-11-16 기준.
> 프론트는 이 모양으로 MSW 가짜 서버를 만든다. 백엔드(FastAPI)는 이를 보고 껍데기 API를 만들며, 구현상 맞지 않는 부분은 백엔드가 고친다. **최종 기준은 FastAPI가 만드는 `/openapi.json`** 이다. 그것이 나오면 `openapi-typescript`로 타입을 생성해 이 문서 대신 쓴다.

## 전체 목록

API는 모두 58개. 우선순위 1은 로그인과 수색 흐름. 표의 주소는 `/api`를 뺀 것이고, `{id}`는 해당 묶음의 ID(예: case_id).

| 우선 | 묶음 | API | 권한 |
| --- | --- | --- | --- |
| 1 | 인증 | POST /auth/login · POST /auth/logout · GET /auth/me · POST /auth/password | 공개(로그인), 사용자 |
| 1 | 작업 | GET /tasks/{task_id} | 사용자 |
| 1 | 사건 | GET·POST /cases · GET·PATCH /cases/{id} · POST /cases/{id}/close | 사용자 |
| 1 | 대상·검색 | GET·PATCH /cases/{id}/query · POST /cases/{id}/query/images · POST .../query/images/from-scene · DELETE .../query/images/{image_id} · GET /cases/{id}/scenes · POST /cases/{id}/searches · GET /cases/{id}/candidates | 사용자 |
| 1 | 판단·동선 | POST·GET /cases/{id}/decisions · POST .../decisions/{decision_id}/revert · GET /cases/{id}/route · GET /scenes/{scene_id} | 사용자 |
| 1 | 지도 기본 | GET /cameras · GET /danger-zones · GET /settings | 사용자 |
| 2 | 현재 위치 | GET /cases/{id}/search-area · POST .../search-area/recalculate | 사용자 |
| 2 | 실시간 감시 | GET·PUT /cases/{id}/watch · GET /cases/{id}/alerts · GET /alerts/unread-count · POST .../alerts/{alert_id}/response | 사용자 |
| 2 | 사건 영상·담당 | GET·POST /cases/{id}/videos · PUT /cases/{id}/members · GET /users/brief | 사용자(담당 설정은 등록자·관리자) |
| 3 | 카메라 | POST /cameras · PATCH·DELETE /cameras/{id} | 관리자 |
| 3 | 도보 경로 | GET /walk-edges · POST /walk-edges/recalculate · PATCH /walk-edges/{id} | 관리자 |
| 3 | 위험 지역 | POST /danger-zones · PATCH·DELETE /danger-zones/{id} | 관리자 |
| 3 | 녹화 영상 | GET·POST /videos · POST /videos/{id}/retry | 관리자 |
| 3 | 설정 | PUT /settings | 관리자 |
| 3 | 계정 | GET·POST /users · PATCH /users/{id} · POST /users/{id}/reset-password | 관리자 |
| 3 | 이용 기록·보관 | GET /audit-logs · GET·PUT /retention · GET /retention/pending-deletions | 관리자 |

## 공통 규칙

| 항목 | 규칙 |
| --- | --- |
| 기본 주소 | 모든 API는 `/api`로 시작 |
| 인증 | 로그인으로 받은 토큰을 `Authorization: Bearer <토큰>` 헤더로 보냄. 일정 시간 미사용 시 만료(시간은 협의) |
| 필드 이름 | snake_case (예: `missing_at`) |
| 시각 | ISO 8601 + 한국 시간 (`2026-10-19T15:02:00+09:00`) |
| ID | 문자열(UUID 권장) |
| 좌표 | `LatLng` = `{ lat: number, lng: number }` |
| 영역 | GeoJSON Polygon 또는 MultiPolygon |
| 유사도 | 0~1 소수 |
| 목록 | `?page=1&size=20` → `{ items, total, page, size }` (이하 `Page<T>`) |
| 오래 걸리는 작업 | 결과 대신 `202` + `{ task_id }`를 바로 돌려줌. 프론트는 `GET /api/tasks/{task_id}`를 2~3초마다 조회 |
| 파일 업로드 | `multipart/form-data` |
| 파일 주소 | 응답의 `*_url` 필드. 영상은 Range 요청(구간 재생) 지원 |
| 이용 기록 | 검색·판단·영상 열람 등은 서버가 자동으로 남김. 별도 호출 없음 |
| 표기 | `string?` = null 가능, `T[]` = 배열, `선택` = 보내지 않아도 됨 |

권한 표기:

- 공개: 로그인 없이 호출
- 사용자: 로그인한 모든 계정. 사건 관련 API는 사용자는 맡은 사건만, 관리자는 모든 사건
- 관리자: 관리자 역할만

에러 응답은 `{ "detail": "사람이 읽을 메시지", "code": "ALREADY_DECIDED" }`. 422는 FastAPI 기본 형식 그대로. 아래 공통 에러는 모든 API에 해당하며, API별로는 그 API에만 있는 에러를 적었다.

| 상태 | code | 뜻 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 로그인 안 함, 토큰 만료 → 프론트는 로그인 화면으로 |
| 403 | FORBIDDEN | 역할 부족, 맡지 않은 사건 |
| 404 | NOT_FOUND | 대상 없음 |
| 413 | FILE_TOO_LARGE | 파일 크기 초과 |
| 415 | UNSUPPORTED_FILE | 지원하지 않는 파일 형식 |
| 422 | (FastAPI 기본) | 필수 값 누락, 형식 오류 |
| 400 | CASE_CLOSED | 종료된 사건에 변경 요청 (사건 하위 API 공통) |

## 상태값 목록

정해진 값만 쓰는 필드는 Python Enum으로 정의한다(그래야 /openapi.json과 프론트 타입에 목록이 나온다).

| 이름 | 값 | 쓰이는 곳 |
| --- | --- | --- |
| Role | ADMIN · USER | 계정 역할 |
| CaseStatus | OPEN · CLOSED | 사건 상태 |
| CloseReason | FOUND · SEARCH_STOPPED · OTHER | 사건 종료 사유 |
| WalkSpeedPreset | ADULT · CHILD · ELDERLY | 보행 속도 프리셋 |
| TaskStatus | PENDING · PROGRESS · SUCCESS · FAILURE | 작업 상태 |
| TaskType | VIDEO_ANALYSIS · WALK_ROUTE_CALC · QUERY_EMBEDDING · CANDIDATE_SEARCH · SEARCH_AREA_CALC | 작업 종류 |
| VideoStatus | WAITING · PROCESSING · DONE · FAILED | 영상 분석 상태 |
| CameraSource | FIXED · CASE | 고정 CCTV / 사건 영상 |
| TargetType | MISSING · CRIMINAL | 위험 지역 대상 유형 |
| CandidateStatus | PENDING · CONFIRMED · REJECTED · HELD · NEEDS_RECHECK | 후보 상태(대기·확정·제외·보류·재확인 필요) |
| DecisionKind | YES · NO · HOLD · REVERT | 판단 기록 종류(REVERT = 번복) |
| ReasonKind | ROUTE_OK · TIME_SHORT · DIRECTION_MISMATCH · OUT_OF_FILTER · LOW_QUALITY · OVERLAP | 후보 판단 근거 |
| AreaLevel | HIGH · MID · LOW | 현재 위치 범위 3단계 |
| WatchStatus | ON · OFF | 실시간 감시 |
| AlertStatus | NEW · CONFIRMED · DISMISSED | 출현 알림 |
| QueryImageSource | UPLOAD · SCENE | 기준 사진 출처 |
| AuditAction | LOGIN · SEARCH · DECISION · REVERT · VIDEO_VIEW · VIDEO_UPLOAD · CASE_CREATE · CASE_CLOSE · ACCOUNT_CHANGE · SETTINGS_CHANGE · DATA_DELETE | 이용 기록 행동 |

## 공통 데이터 모델

```text
User
  id                    string
  username              string
  name                  string
  role                  Role
  active                boolean
  must_change_password  boolean          첫 로그인·초기화 후 true
  created_at            datetime

UserBrief
  id                    string
  name                  string

Case
  id                    string
  case_no               string           예: "2026-031"
  status                CaseStatus
  missing_person        { name: string, age: int, description: string }
  missing_at            datetime
  last_seen_place       { name: string, location: LatLng }
  walk_speed_preset     WalkSpeedPreset
  created_by            UserBrief
  members               UserBrief[]
  created_at            datetime
  closed_at             datetime?
  close_reason          CloseReason?
  summary               { confirmed_count: int, pending_count: int,
                          last_seen_at: datetime?, last_seen_camera_code: string? }

Camera
  id                    string
  code                  string           지도 라벨, 예: "C5"
  name                  string           예: "OO초등학교 후문"
  location              LatLng
  direction_deg         number           0~360, 북쪽=0
  fov_deg               number           화각
  source                CameraSource
  case_id               string?          source=CASE일 때만
  video_count           int
  analyzed              boolean          분석 완료 영상이 하나 이상

Scene                                     트랙렛 하나 = 장면 하나
  id                    string
  camera_id             string
  camera_code           string
  video_id              string
  start_at              datetime
  end_at                datetime
  start_sec             number           영상 안에서 시작 위치(초)
  end_sec               number
  thumbnail_url         string
  highlight_url         string           3~5초 하이라이트 영상
  video_url             string           원본 재생용(Range 지원)
  bbox                  { x, y, w, h }?  대표 프레임 인물 박스(0~1 비율)

Candidate
  id                    string
  scene                 Scene
  similarity            number
  status                CandidateStatus
  below_threshold       boolean          유사도 기준 미만
  out_of_filter         boolean          자동 필터 밖이지만 유사도가 높아 올라온 후보
  reasons               { kind: ReasonKind, text: string }[]   예: "이동 시간 7분 맞음"
  travel_minutes        number?          직전 확정 장면에서 걸린 시간
  expected_minutes      number?          도보 기준 예상 시간

Decision
  id                    string
  candidate_id          string
  scene                 { camera_code: string, start_at: datetime, thumbnail_url: string }
  kind                  DecisionKind
  target_decision_id    string?          kind=REVERT일 때 번복한 기록
  reverted              boolean          이 기록이 번복됐는지
  decided_by            UserBrief
  decided_at            datetime

Task
  task_id               string
  type                  TaskType
  status                TaskStatus
  progress              int              0~100
  result                object?          작업별 결과
  error                 string?
```

## 인증·계정·작업 상태

### POST /api/auth/login

로그인 · 권한: 공개 · SYS00-001

```text
요청   username  string  필수
       password  string  필수
응답 200
       access_token  string
       token_type    "bearer"
       expires_in    int     초
       user          User    must_change_password=true면 비밀번호 변경 화면으로
에러   401 INVALID_CREDENTIALS  아이디·비밀번호 틀림
       403 ACCOUNT_DISABLED     비활성화된 계정
```

### POST /api/auth/logout

로그아웃 · 권한: 사용자 · SYS00-001

```text
요청   없음
응답 204
```

### GET /api/auth/me

내 정보 · 권한: 사용자 · SYS00-002

```text
응답 200  User   프론트는 role로 메뉴를 나눔
```

### POST /api/auth/password

비밀번호 변경(첫 로그인 포함) · 권한: 사용자 · SYS01-007

```text
요청   current_password  string  필수
       new_password      string  필수
응답 204
에러   400 WRONG_PASSWORD   현재 비밀번호 틀림
       400 WEAK_PASSWORD    규칙 미달(규칙은 협의)
```

### GET /api/users

계정 목록 · 권한: 관리자 · SYS01-007

```text
쿼리   role    Role     선택
       active  boolean  선택
       q       string   선택  이름·아이디 검색
       page, size
응답 200  Page<User>
```

### POST /api/users

계정 생성 · 권한: 관리자 · SYS01-007

```text
요청   username  string  필수
       name      string  필수
       role      Role    필수
응답 201
       user           User
       temp_password  string   이 응답에서만 한 번 보여줌
에러   409 USERNAME_TAKEN
```

### PATCH /api/users/{user_id}

역할 변경·비활성화 · 권한: 관리자 · SYS01-007

```text
요청   name    string   선택
       role    Role     선택
       active  boolean  선택
응답 200  User
에러   400 LAST_ADMIN  마지막 관리자를 강등·비활성화하려 함
```

### POST /api/users/{user_id}/reset-password

비밀번호 초기화 · 권한: 관리자 · SYS01-007

```text
요청   없음
응답 200  temp_password  string   해당 계정은 must_change_password=true
```

### GET /api/users/brief

담당자 선택용 계정 검색 · 권한: 사용자 · SYS02-012

```text
쿼리   q  string  선택  이름 검색
응답 200  UserBrief[]   활성 계정만
```

### GET /api/tasks/{task_id}

작업 상태 조회(폴링) · 권한: 사용자 · 공통

```text
응답 200  Task
```

## 사건·담당자

### GET /api/cases

사건 목록 · 권한: 사용자(맡은 사건만) · SYS02-001

```text
쿼리   status  CaseStatus  선택  기본 OPEN
       q       string      선택  사건 번호·실종자 이름 검색
       page, size
응답 200  Page<Case>
```

### POST /api/cases

사건 등록 · 권한: 사용자 · SYS02-001

```text
요청   missing_person     { name, age, description }  필수
       missing_at         datetime                    필수
       last_seen_place    { name, location: LatLng }  필수
       walk_speed_preset  WalkSpeedPreset             필수
       member_ids         string[]                    선택  공동 담당자(등록자는 자동 포함)
응답 201  Case
```

### GET /api/cases/{case_id}

사건 상세(사이드바 사건 카드) · 권한: 사용자 · SYS02-001

```text
응답 200  Case
```

### PATCH /api/cases/{case_id}

사건 정보 수정 · 권한: 사용자 · SYS02-001

```text
요청   missing_person, missing_at, last_seen_place, walk_speed_preset   모두 선택
응답 200  Case
에러   400 CASE_CLOSED
```

### POST /api/cases/{case_id}/close

사건 종료(실시간 감시 자동 해제, 이후 읽기 전용) · 권한: 사용자 · SYS02-011

```text
요청   reason  CloseReason  필수
       note    string       선택
응답 200  Case
에러   409 ALREADY_CLOSED
```

### PUT /api/cases/{case_id}/members

공동 담당자 설정(추가·제거를 한 번에) · 권한: 사건 등록자 또는 관리자 · SYS02-012

```text
요청   member_ids  string[]  필수  바뀐 뒤의 전체 담당자 목록
응답 200  UserBrief[]
에러   400 CREATOR_REQUIRED  사건 등록자는 빼낼 수 없음
       400 CASE_CLOSED
```

## 대상 지정·검색 조건·후보 검색

검색 조건(기준 사진, 시간 범위, 유사도 기준)은 사건마다 하나. 유사도 기준은 관리자 기본값으로 시작해 사건마다 바꿀 수 있다.

```text
SearchQuery
  images             { id, image_url, source: QueryImageSource, ready: boolean }[]
                     ready = 특징 추출 완료
  time_from          datetime          기본: 실종 시각
  time_to            datetime?         null = 현재까지
  threshold          number            이 사건의 유사도 기준
  threshold_default  number            관리자 기본값(비교 표시용)
```

### GET /api/cases/{case_id}/query

검색 조건 조회(질의 바) · 권한: 사용자 · SYS02-002, 003

```text
응답 200  SearchQuery
```

### PATCH /api/cases/{case_id}/query

검색 조건 수정 · 권한: 사용자 · SYS02-003

```text
요청   threshold  number    선택  0~1
       time_from  datetime  선택
       time_to    datetime? 선택
응답 200  SearchQuery
```

### POST /api/cases/{case_id}/query/images

기준 사진 업로드(특징 추출 작업 시작) · 권한: 사용자 · SYS02-002

```text
요청   multipart  file  이미지(jpg, png)  필수
응답 202
       task_id  string      type=QUERY_EMBEDDING
       image    { id, image_url, source, ready=false }
에러   400 NO_PERSON_DETECTED  사진에서 사람을 찾지 못함(작업 결과 에러로 와도 됨)
```

### GET /api/cases/{case_id}/scenes

영상 속 인물 고르기용 장면 목록 · 권한: 사용자 · SYS02-002

```text
쿼리   camera_id  string    필수
       from, to   datetime  선택
       page, size
응답 200  Page<Scene>
```

### POST /api/cases/{case_id}/query/images/from-scene

장면 속 인물을 기준으로 추가 · 권한: 사용자 · SYS02-002

```text
요청   scene_id  string  필수
응답 202  task_id, image   (위와 같음, source=SCENE)
```

### DELETE /api/cases/{case_id}/query/images/{image_id}

기준 사진 삭제 · 권한: 사용자 · SYS02-002

```text
응답 204
```

### POST /api/cases/{case_id}/searches

후보 검색 실행 · 권한: 사용자 · SYS02-003

```text
요청   anchor_candidate_id  string?  선택  기준점. 없으면 마지막 확정 장면, 그것도 없으면 마지막 확인 장소
응답 202  task_id   type=CANDIDATE_SEARCH. 완료 후 후보 목록을 다시 조회
에러   400 NO_QUERY_IMAGE   특징 추출이 끝난 기준 사진이 없음
       409 SEARCH_RUNNING   이 사건의 검색이 이미 진행 중(detail에 task_id)
```

### GET /api/cases/{case_id}/candidates

후보 대기열 · 권한: 사용자 · SYS02-003, 004

```text
쿼리   status                   CandidateStatus  선택  기본 PENDING
       include_below_threshold  boolean          선택  기본 false
       page, size
응답 200
       items                  Candidate[]   유사도 높은 순, 보류(HELD)는 맨 뒤
       total                  int
       below_threshold_count  int           기준 미만 개수(접힌 줄에 표시)
       page, size
```

## 판단·결정 기록·번복·동선

판단과 번복은 모두 결정 기록에 쌓이고 지워지지 않는다. 번복은 원래 기록을 `reverted=true`로 바꾸고 `kind=REVERT` 기록을 새로 추가한다.

### POST /api/cases/{case_id}/decisions

예/아니오/보류 저장 · 권한: 사용자 · SYS02-004

```text
요청   candidate_id  string           필수
       kind          YES | NO | HOLD  필수
응답 201
       decision   Decision
       candidate  Candidate     바뀐 상태(YES→CONFIRMED, NO→REJECTED, HOLD→HELD)
       task_id    string?       YES일 때: 확정 장면 기준 재검색·범위 재계산 작업
에러   409 ALREADY_DECIDED  공동 담당자가 먼저 판단함(detail에 판단자 이름·결과)
       400 CASE_CLOSED
```

### GET /api/cases/{case_id}/decisions

결정 기록(최신순) · 권한: 사용자 · SYS02-004, 010

```text
쿼리   page, size
응답 200  Page<Decision>
```

### POST /api/cases/{case_id}/decisions/{decision_id}/revert

판단 번복(되돌리기 알림, 결정 기록 탭 모두 이 API) · 권한: 사용자 · SYS02-010

```text
요청   없음
응답 201
       revert    Decision                  kind=REVERT
       affected  { candidate_id, status }[]
                 YES 번복: 대상 후보는 PENDING, 그 뒤 확정 장면은 NEEDS_RECHECK
                 NO·HOLD 번복: 대상 후보는 PENDING(대기열 복귀)
       task_id   string?                   YES 번복: 직전 확정 장면 기준 재검색 작업
에러   409 ALREADY_REVERTED
       400 NOT_REVERTIBLE   REVERT 기록은 다시 번복할 수 없음
       400 CASE_CLOSED
```

### GET /api/cases/{case_id}/route

확정 동선(타임라인 + 지도 경로) · 권한: 사용자 · SYS02-005

```text
응답 200
       scenes   { order: int, candidate_id, scene: Scene,
                  status: CONFIRMED | NEEDS_RECHECK,
                  confirmed_by: UserBrief, confirmed_at: datetime }[]   시간순
       path     LatLng[]      확정 장면을 잇는 도보 경로 좌표
       pending  Candidate?    지금 확인 대기 중인 다음 구간 후보(점선 표시용)
```

### GET /api/scenes/{scene_id}

장면 상세(영상 재생기) · 권한: 사용자(맡은 사건에서 나온 장면) · SYS02-005

```text
응답 200
       scene  Scene
       track  { t: number, x, y, w, h }[]   재생 중 인물 박스(초 단위, 0~1 비율). 없으면 빈 배열
```

## 현재 위치·실시간 감시·사건 영상

### GET /api/cases/{case_id}/search-area

현재 위치 범위(마지막 계산 결과) · 권한: 사용자 · SYS02-006

```text
응답 200
       computed_at      datetime
       base_scene       Scene              마지막 목격 장면
       elapsed_minutes  number             계산 시점 기준 경과 시간
       levels           { level: AreaLevel, area: GeoJSON }[]   길을 따라 퍼진 영역
       danger_overlaps  { zone_id, name, level: AreaLevel }[]
       priority_zones   { rank: int, name, area: GeoJSON, reason: string }[]
에러   400 NO_CONFIRMED_SCENE   확정 장면이 없음
```

### POST /api/cases/{case_id}/search-area/recalculate

현재 시각 기준으로 다시 계산 · 권한: 사용자 · SYS02-006

```text
요청   없음
응답 202  task_id   type=SEARCH_AREA_CALC. 프론트는 화면을 열 때와 몇 분마다 호출
에러   400 NO_CONFIRMED_SCENE
```

### GET /api/cases/{case_id}/watch

실시간 감시 상태 · 권한: 사용자 · SYS02-007

```text
응답 200
       status        WatchStatus
       started_at    datetime?
       started_by    UserBrief?
       camera_count  int          감시 중인 카메라 수
```

### PUT /api/cases/{case_id}/watch

실시간 감시 시작·중지 · 권한: 사용자 · SYS02-007

```text
요청   status  WatchStatus  필수
응답 200  (위 GET과 같음)
에러   400 NO_CONFIRMED_SCENE   감시에 쓸 확정 특징이 없음
       400 CASE_CLOSED
```

### GET /api/cases/{case_id}/alerts

출현 알림 조회(2~3초 폴링) · 권한: 사용자 · SYS02-008

```text
쿼리   since   datetime     선택  이 시각 이후 생긴 것만
       status  AlertStatus  선택
응답 200  { id, scene: Scene, similarity, status: AlertStatus,
            created_at, responded_by: UserBrief? }[]   최신순
```

### GET /api/alerts/unread-count

사이드바 알림 숫자(모든 화면에서 폴링) · 권한: 사용자 · SYS02-008

```text
응답 200
       count    int                       내가 맡은 사건의 NEW 알림 수
       by_case  { case_id, count }[]
```

### POST /api/cases/{case_id}/alerts/{alert_id}/response

알림에 예/아니오 응답 · 권한: 사용자 · SYS02-008

```text
요청   kind  YES | NO  필수
응답 200
       alert     알림(바뀐 status)
       decision  Decision?   YES면 확정 기록이 함께 생김
       task_id   string?     YES면 동선·범위 재계산 작업
에러   409 ALREADY_RESPONDED  다른 담당자가 먼저 응답함
```

### GET /api/cases/{case_id}/videos

사건 영상 목록 · 권한: 사용자 · SYS02-009

```text
응답 200  { video: Video, camera: Camera }[]
```

### POST /api/cases/{case_id}/videos

사건 영상 추가(사설 CCTV, 블랙박스 등) · 권한: 사용자 · SYS02-009

```text
요청   multipart
       file           영상 파일        필수
       name           string           필수  예: "OO편의점 앞"
       lat, lng       number           필수
       direction_deg  number           필수
       fov_deg        number           선택
       recorded_at    datetime         필수  녹화 시작 시각
응답 202
       video    Video
       camera   Camera     source=CASE, 이 사건에서만 보임
       task_id  string     변환·분석·도보 경로 계산 작업
에러   400 CASE_CLOSED
```

## 카메라·도보 경로·위험 지역

### GET /api/cameras

카메라 목록(모든 지도) · 권한: 사용자 · SYS01-001

```text
쿼리   case_id  string  선택  넣으면 그 사건의 사건 영상 카메라도 포함
응답 200  Camera[]
```

### POST /api/cameras

카메라 등록 · 권한: 관리자 · SYS01-001

```text
요청   code           string  필수  예: "C5"
       name           string  필수
       location       LatLng  필수
       direction_deg  number  필수
       fov_deg        number  필수
응답 201  Camera   등록 후 도보 경로 자동 계산은 백엔드가 정함
에러   409 CODE_TAKEN
```

### PATCH /api/cameras/{camera_id}

카메라 수정 · 권한: 관리자 · SYS01-001

```text
요청   code, name, location, direction_deg, fov_deg   모두 선택
응답 200  Camera
에러   409 CODE_TAKEN
```

### DELETE /api/cameras/{camera_id}

카메라 삭제 · 권한: 관리자 · SYS01-001

```text
응답 204
에러   409 CAMERA_HAS_VIDEOS   등록된 영상이 있어 삭제 불가
```

### GET /api/walk-edges

도보 구간 목록 · 권한: 관리자 · SYS01-002

```text
쿼리   detour_only  boolean  선택  우회 의심 구간만
응답 200  WalkEdge[]

WalkEdge
  id                    string
  from_camera_id        string
  to_camera_id          string
  api_distance_m        number     카카오 도보 API 결과
  api_minutes           number
  corrected_distance_m  number?    관리자 보정값(null = 보정 없음)
  corrected_minutes     number?
  detour_suspected      boolean    우회가 심해 샛길 가능성 있음
  path                  LatLng[]
```

### POST /api/walk-edges/recalculate

도보 경로 다시 계산 · 권한: 관리자 · SYS01-002

```text
요청   없음
응답 202  task_id   type=WALK_ROUTE_CALC
에러   409 TASK_RUNNING
```

### PATCH /api/walk-edges/{edge_id}

구간 보정값 수정 · 권한: 관리자 · SYS01-002

```text
요청   corrected_distance_m  number?  선택  null이면 보정 해제
       corrected_minutes     number?  선택
응답 200  WalkEdge
```

### GET /api/danger-zones

위험 지역 목록(모든 지도) · 권한: 사용자 · SYS01-003

```text
응답 200  { id, name, target_type: TargetType, area: GeoJSON }[]
```

### POST /api/danger-zones

위험 지역 등록 · 권한: 관리자 · SYS01-003

```text
요청   name         string      필수
       target_type  TargetType  필수
       area         GeoJSON     필수  다각형(원은 다각형으로 변환해 보냄)
응답 201  위험 지역
```

### PATCH /api/danger-zones/{zone_id}

위험 지역 수정 · 권한: 관리자 · SYS01-003

```text
요청   name, target_type, area   모두 선택
응답 200  위험 지역
```

### DELETE /api/danger-zones/{zone_id}

위험 지역 삭제 · 권한: 관리자 · SYS01-003

```text
응답 204
```

## 녹화 영상·설정·이용 기록·데이터 보관

```text
Video
  id             string
  camera_id      string
  camera_code    string
  file_name      string
  recorded_at    datetime     녹화 시작 시각
  duration_sec   number?      변환 전에는 null
  status         VideoStatus
  progress       int          0~100
  error_message  string?      FAILED일 때
  task_id        string?      진행 중인 분석 작업
  case_id        string?      사건 영상이면 사건 ID
  uploaded_at    datetime
```

### GET /api/videos

녹화 영상 목록·분석 현황 · 권한: 관리자 · SYS01-004, 005

```text
쿼리   status     VideoStatus  선택
       camera_id  string       선택
       page, size
응답 200
       items, total, page, size   Video[] (FAILED가 먼저, 그다음 최신순)
       summary  { waiting, processing, done, failed }   상단 숫자 카드용
```

### POST /api/videos

고정 CCTV 영상 업로드(변환·분석 작업 시작) · 권한: 관리자 · SYS01-004, 005

```text
요청   multipart
       camera_id    string    필수  source=FIXED 카메라
       file         영상 파일  필수
       recorded_at  datetime  필수
응답 202
       video    Video
       task_id  string    type=VIDEO_ANALYSIS
에러   404 CAMERA_NOT_FOUND
       400 INVALID_VIDEO   ffprobe 검사 실패(작업 결과 에러로 와도 됨)
```

### POST /api/videos/{video_id}/retry

실패한 분석 재처리 · 권한: 관리자 · SYS01-005

```text
요청   없음
응답 202  task_id
에러   409 NOT_FAILED   FAILED 상태가 아님
```

### GET /api/settings

시스템 설정 조회 · 권한: 사용자(사건 등록·질의 바에서 기본값 필요) · SYS01-006

```text
응답 200
       walk_speed_mps                { ADULT, CHILD, ELDERLY }  최대 보행 속도(m/s)
       similarity_threshold_default  number    유사도 기준 기본값
       confirm_request_threshold     number    이 값 이하면 확인 요청
       filter_margin_minutes         number    도보 시간에 더할 여유
       out_of_filter_threshold       number    필터 밖이어도 이 값 이상이면 후보로 올림
       area_level_bounds             { high: number, mid: number }   3단계 구분 기준(단위는 팀 논의)
       updated_at                    datetime
       updated_by                    UserBrief
```

### PUT /api/settings

시스템 설정 수정 · 권한: 관리자 · SYS01-006

```text
요청   위 GET 응답에서 updated_at, updated_by를 뺀 모든 필드   필수
응답 200  (GET과 같음)
```

### GET /api/audit-logs

이용 기록 조회 · 권한: 관리자 · SYS01-008

```text
쿼리   from, to  datetime     선택
       user_id   string       선택
       case_id   string       선택
       action    AuditAction  선택
       page, size
응답 200  Page<{ id, at: datetime, user: UserBrief, action: AuditAction,
                 case_id: string?, case_no: string?, detail: string }>   최신순
```

### GET /api/retention

보관 기간 조회 · 권한: 관리자 · SYS01-009

```text
응답 200
       closed_case_days  int   종료 사건의 썸네일·특징 벡터·확인 기록 보관 일수
       raw_video_days    int   녹화 영상 원본 보관 일수
```

### PUT /api/retention

보관 기간 수정 · 권한: 관리자 · SYS01-009

```text
요청   closed_case_days, raw_video_days   필수
응답 200  (GET과 같음)
```

### GET /api/retention/pending-deletions

삭제 예정 목록 · 권한: 관리자 · SYS01-009

```text
쿼리   page, size
응답 200  Page<{ target_type: "CASE" | "VIDEO", target_id, label: string, delete_at: datetime }>
```
