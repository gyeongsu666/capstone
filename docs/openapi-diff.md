# 프론트 명세 ↔ 백엔드 openapi.json 충돌 정리

- 비교 대상
  - 프론트: `docs/api-spec.md` (2026-11-16 기준, MSW 가짜 서버가 이 모양으로 동작)
  - 백엔드: `gyeongsu666/capstone` `docs` 브랜치 `docs/api/openapi.json` (커밋 `1309e01`, 1.0.0-draft, 엔드포인트 68개, 미구현)
- 작성일: 2026-11-16

## 1. 팀 결정이 필요한 것

화면 동작이 바뀌므로 먼저 정해야 한다.

| # | 항목 | 프론트 | openapi.json | 영향 |
| --- | --- | --- | --- | --- |
| 1 | 인증 | 로그인 응답 `access_token` → `Authorization: Bearer` | HttpOnly 세션 쿠키 `refind_session` + 변경 요청마다 `X-CSRF-Token` | 통신 계층, 로그인 상태 저장 방식 |
| 2 | 실시간 전달 | 폴링만(작업 2~3초, 출현 알림 2~3초) | `/ws` WebSocket 제안(분석 진행률, 출현 알림, 감시 상태) | 기술 스택 문서(11/5)는 "REST 폴링 확정"이라 서로 어긋남 |
| 3 | 사건 카드 값 | `case_no`, 실종자 이름·나이, 확정·대기 수(`summary`) | 없음. `title`, `appearance`, `person_type`만 있음 | 사이드바 사건 카드, 사건 목록 표 |
| 4 | 알림 숫자 | `GET /alerts/unread-count` | 없음 | 사이드바 알림 배지(모든 화면) |
| 5 | 번복 | 요청 본문 없음. 8초 되돌리기 알림에서 한 번 클릭 | `reason`(사유)과 `expected_version` 필수 | 되돌리기 알림 UX |
| 6 | 맡지 않은 사건 | 403 | 404 (역할 자체가 금지된 기능만 403) | 권한 없음 안내 화면 |
| 7 | 후보 검색 | 사건별 후보 대기열 하나 | 검색 실행(`search_id`) 단위. 후보 조회에 `search_id` 필요, `stale`이면 판단 불가 | 대기열, 재검색 흐름 |
| 8 | 기준 사진 | 여러 장 업로드·삭제, 장면에서 추가 | 사진 한 장 또는 트랙렛 하나 | 질의 바 |
| 9 | 설정값 | `confirm_request_threshold`, `filter_margin_minutes`, `out_of_filter_threshold` | 없음. 기본 숫자도 넣지 않음(D03) | 시스템 설정 폼, 후보 표시 |
| 10 | 현재 위치 재계산 | `POST /search-area/recalculate` | 없음 | 현재 위치 수색 화면 |
| 11 | 하이라이트 영상 | `highlight_url`(3~5초 반복) | 별도 API, 미구현이면 501 (D01) | 확인 영역 영상 자리 |

## 2. 모양이 다른 것

`src/api` 안에서 변환하면 되지만 양이 많다.

| 항목 | 프론트 | openapi.json |
| --- | --- | --- |
| 에러 응답 | `{ detail, code }` | `{ request_id, error: { code, message, fields, context, retryable } }` |
| 목록 | `?page&size` → `{ items, total, page, size }` | cursor → `{ items, next_cursor, has_more }` |
| ID | 문자열 | 정수(`user_id`, `case_id`, `node_id` …), 일부 문자열(`decision_id`, `tracklet_id`) |
| 상태값 | 대문자(`CONFIRMED`, `PENDING` …) | 소문자(`confirmed`, `queued` …), 값 자체도 다름 |
| 좌표 | `{ lat, lng }` | GeoJSON Point `[lng, lat]` |
| 동시 수정 | 없음 | `version` / `expected_case_version` 필드 |
| 첫 로그인 | 화면에서만 막음 | 서버가 `me`·`password`·`logout`만 허용 |
| 비밀번호 규칙 | (임시) 8자 이상, 영문+숫자 | 10~128자(제안) |
| 로그아웃·비밀번호 변경 | 204 | 200 + 본문 |

### 상태값 대응

| 뜻 | 프론트 | openapi.json |
| --- | --- | --- |
| 역할 | `ADMIN` / `USER` | `admin` / `user` |
| 판단 | `YES` / `NO` / `HOLD` / `REVERT` | `verdict: confirmed / rejected / deferred` + `status: active / reversed` |
| 사건 종료 | `FOUND` / `SEARCH_STOPPED` / `OTHER` | `close_outcome: found / unresolved / other` |
| 보행 속도 | `walk_speed_preset: ADULT / CHILD / ELDERLY` | `person_type: adult / child / elderly / other` |
| 작업 | `PENDING / PROGRESS / SUCCESS / FAILURE` | `queued / running / done / failed` + `stage` |
| 감시 | `ON / OFF` | `enabled` + `status: starting / watching / degraded / stopped / blocked / unknown` |
| 출현 알림 | `NEW / CONFIRMED / DISMISSED` | `pending / confirmed / rejected` + `level: high / mid` |
| 위험 지역 | `target_type: MISSING / CRIMINAL` | `kind: water / steep_slope / road / construction / other` + `severity` |
| 카메라 | `source: FIXED / CASE` | `kind: camera / waypoint`, 사건 영상은 `Video.scope: global / case` |

### 데이터 모델

| 모델 | 프론트에만 있음 | openapi.json에만 있음 |
| --- | --- | --- |
| User | `id`, `name` | `user_id`, `display_name`, `updated_at`, `version` |
| Case | `case_no`, `missing_person{name, age, description}`, `missing_at`, `last_seen_place`, `members`, `summary` | `title`, `appearance`, `last_seen_at`, `last_seen_location`, `owner_id`, `assignees`, `query`, `search_conditions`, `watch_enabled` |
| Candidate | `scene`, `status`, `below_threshold`, `out_of_filter`, `reasons[{kind, text}]`, `travel_minutes`, `expected_minutes` | `tracklet`, `reason{reason_codes, summary, minimum_travel_time_s, available_time_s …}`, `decision`, `clip_start_s`, `clip_end_s` |
| 후보 목록 | `below_threshold_count` | `search`(검색 실행 정보) |
| Route | `pending`(다음 확인 대기 후보) | `segments`, `case_version` |
| SearchArea | `elapsed_minutes`, `levels[].level: HIGH/MID/LOW` | `as_of`, `walking_speed_mps`, `levels[].level`(정수), `max_travel_time_s`, `warnings` |
| Settings | 위 1-9의 세 값 | `alert_high_threshold`, `area_buffer_m`, `max_upload_bytes` |

## 3. 주소가 다른 것

| 프론트 | openapi.json |
| --- | --- |
| `GET·PATCH /cases/{id}/query` | `GET·PATCH /cases/{id}/search-conditions` |
| `POST /cases/{id}/query/images`, `.../from-scene`, `DELETE .../images/{image_id}` | `POST /cases/{id}/query/photo`, `POST /cases/{id}/query/tracklet` |
| `GET /cases/{id}/scenes?camera_id=` | `GET /videos/{video_id}/tracklets` |
| `POST /cases/{id}/decisions/{id}/revert` | `POST /cases/{id}/decisions/{id}/reverse` |
| `GET /scenes/{scene_id}` | `GET /cases/{id}/scenes/{scene_id}` |
| `POST /cases/{id}/alerts/{id}/response` | `POST /cases/{id}/alerts/{id}/decision` |
| `PUT /cases/{id}/members` | `GET·POST /cases/{id}/assignees`, `DELETE .../assignees/{user_id}` |
| `GET /users/brief` | `GET /users/directory` |
| `PATCH /users/{id}` (역할·비활성화) | `PATCH /users/{id}/role`, `POST /users/{id}/deactivate` |
| `POST /users/{id}/reset-password` | `POST /users/{id}/password-reset` |
| `GET /walk-edges`, `POST /walk-edges/recalculate`, `PATCH /walk-edges/{id}` | `GET /walk-graph`, `POST /walk-graph/recalculations`, `PATCH /walk-graph/{id}` |
| `POST /videos/{id}/retry` | `POST /videos/{id}/analysis` |
| `PUT /settings` | `PATCH /settings` |
| `GET·PUT /retention`, `GET /retention/pending-deletions` | `GET·PATCH /retention-policy`, `GET /deletion-candidates` |

openapi.json에만 있는 API: `GET /map`, `GET /cases/{id}/searches/{search_id}`, `GET /cases/{id}/alerts/{alert_id}`, `GET /videos/{id}`, `GET /tracklets/{id}`, 파일 제공 API 5개(기준 사진, 영상 스트림, 썸네일, 알림 스냅샷, 하이라이트).

## 4. 프론트에서 바뀌는 곳

- 통신·인증: `src/api/client.ts`, `src/api/auth.ts`, `src/stores/auth.ts` (1번 결정에 따라)
- 타입: `src/api/types.ts` 전체 (openapi-typescript로 생성 예정)
- MSW: `src/mocks/handlers/*`, `src/mocks/scenario`, `docs/mock-scenario.md`(403 테스트 → 404)
- 화면: 사건 카드·사건 목록(3번), 사이드바 알림 배지(4번), 되돌리기 알림(5번), 권한 안내(6번), 동선 추적 대기열·질의 바(7·8번)
- 공통 부품은 서버 타입 대신 화면용 타입을 받게 바꾸고, 서버 데이터 → 화면 데이터 변환은 `src/api`에서 한다.
