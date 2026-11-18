# 프론트 → 백엔드 API 요청서

- 기준: `docs` 브랜치 `docs/api/openapi.json` (1.0.0-draft, 커밋 `83fe054`)
- 작성: 프론트, 2026-11-18
- 검증: openapi.json의 68개 API와 스키마를 요구사항(SYS00~02), 프론트 화면과 하나씩 대조함
- 차이 전체 목록: `docs/openapi-diff.md`

## 기본 원칙

1. 프론트는 **openapi.json을 기준으로 맞춘다.** 주소, 에러 모양, cursor 목록, 소문자 상태값, GeoJSON, `version`/`expected_version`, `Idempotency-Key`를 모두 백엔드 방식대로 쓴다.
2. 화면에 꼭 필요한데 서버에 없는 값만 아래 "요청" 항목으로 추가를 부탁한다.
3. 실시간 전달은 REST 폴링으로 한다(11/5 기술 스택 문서). **`/ws`는 이번 범위에서 빼고**, 폴링용 조회 API를 쓴다.
   - 작업 진행: `/tasks/{id}`
   - 영상 분석: `/videos/{id}`
   - 감시 상태: `/cases/{id}/watch`
   - 출현 알림: `/cases/{id}/alerts`

## 1. 요청 (스키마 변경)

### R1. 사건에 실종자 이름·나이, 장소 이름, 확정·대기 수 추가

사건 카드(사이드바), 사건 목록 표, 사건 상세에 필요하다(SYS02-001: 실종자 이름·나이, 마지막 확인 장소). `Case`의 목록 `CasePage.items`와 상세 둘 다에 추가한다.

```jsonc
{
  "person_name": "김민준",                  // string, 1~50자
  "person_age": 8,                          // integer | null (모르면 null)
  "last_seen_place_name": "도림캠퍼스 정문",  // string | null, 사람이 적는 장소 이름
  "summary": {
    "confirmed_count": 3,                   // 유효한 판단 수: active이고 재확인이 필요 없는 confirmed
    "pending_count": 4                      // 최신 검색(stale 아님)에서 아직 판단하지 않은 후보 수
  }
}
```

- `CaseCreateRequest`, `CasePatch`에 `person_name`, `person_age`, `last_seen_place_name`을 추가한다.
- `case_no`는 요청하지 않는다. 화면은 `case_id`와 `title`을 쓴다.

### R2. `GET /api/alerts/unread-count` 추가

사이드바 알림 배지(모든 화면)에 쓴다.

- 배지를 누르면 알림이 있는 사건으로 이동하므로 사건별 개수도 필요하다.
- cursor 목록에는 total이 없어 다른 방법으로는 셀 수 없다.

```jsonc
// 200
{ "count": 2, "by_case": [{ "case_id": 31, "count": 2 }] }
```

- 권한은 로그인 사용자다. 맡은 사건(관리자는 전체)의 `status=pending` 알림만 센다.
- 사용자별 "읽음" 상태는 필요 없다.
- 프론트가 2~3초마다 폴링하므로 가벼워야 한다.

### R3. 번복 `reason`을 선택 항목으로

`POST /api/cases/{case_id}/decisions/{decision_id}/reverse`의 `DecisionReverseRequest.required`에서 `reason`을 뺀다. `expected_version`은 필수 그대로 둔다.

- 판단 직후 8초 되돌리기 알림은 사유 없이 보낸다.
- 결정 기록 탭에서 번복할 때는 사유를 받아 보낸다.

### R4. `GET /api/auth/me` 응답에 `csrf_token` 추가

로그인 응답에만 `csrf_token`이 있어서, 새로고침하면 프론트가 토큰을 잃는다. 그러면 모든 변경 요청이 `CSRF_INVALID`로 막힌다.

- `/me` 200 응답을 `{ "user": User, "csrf_token": string, "expires_at": string }`로 바꾼다. `LoginResponse`와 같은 모양이다.
- 프론트는 앱을 시작할 때 `/me`를 부르고, 성공하면 로그인 상태로 판단한다.

### R5. 시스템 설정에 `out_of_filter_threshold` 추가

`SystemSettings` / `SystemSettingsPatch`에 추가한다(SYS02-003 "범위 밖이라도 유사도가 매우 높으면 확인 요청으로 올림").

| 필드 | 타입 | 뜻 |
| --- | --- | --- |
| `out_of_filter_threshold` | number 0~1 \| null | 시간상 도달이 어려운 후보(`time_feasible=false`)라도 유사도가 이 값 이상이면 후보 목록에 넣는다 |

- 이렇게 올라온 후보는 `reason.time_feasible=false`, `reason_codes`에 `TIME_REVIEW_REQUIRED`로 구분하는 것으로 이해했다. 맞는지 확인 부탁(3장 Q2).
- **요청하지 않는 값**
  - `filter_margin_minutes`(필터 여유 시간): `WalkingSpeedPreset.max_speed_mps`로 최소 이동 시간을 계산하면 같은 역할을 한다.
  - `confirm_request_threshold`(확인 요청 기준): 화면은 유사도 기준 이상인 후보를 모두 사람이 확인하므로 따로 쓰이지 않는다. `alert_high_threshold`(출현 알림 high/mid 구분)와는 다른 값이다.

## 2. 백엔드 방식 채택 (변경 요청 없음, 공유용)

| 항목 | 프론트 처리 |
| --- | --- |
| 인증 | 세션 쿠키 `refind_session` + 변경 요청마다 `X-CSRF-Token`. 토큰은 메모리에만 둔다 |
| 401 | `UNAUTHENTICATED`, `SESSION_EXPIRED`면 로그인 화면으로 보낸다. `SESSION_EXPIRED`면 "오래 사용하지 않아 로그아웃됐어요"를 띄운다 |
| 첫 로그인 | `User.must_change_password`나 `PASSWORD_CHANGE_REQUIRED`(403)를 받으면 비밀번호 변경 화면으로 보낸다 |
| 비밀번호 규칙 | 10~128자, 현재 비밀번호와 같으면 안 됨 |
| 맡지 않은 사건 | 404. 문구는 "사건을 찾을 수 없거나 접근 권한이 없습니다" |
| 후보 검색 | `search_id` 단위로 동작한다. `stale=true`이거나 `SEARCH_STALE`이면 "다시 검색 필요"를 보여 주고 판단을 막는다 |
| 번복 후 | `invalidated_search_ids`에 현재 검색이 있으면 재검색을 안내한다. 아니오를 번복한 후보는 재검색하면 다시 나온다. `affected_scenes`는 '재확인 필요'로 표시한다 |
| 먼저 판단함 | 409 `ALREADY_DECIDED`면 결정 기록을 다시 불러와 판단자(`decided_by`)를 "OO님이 먼저 판단했어요"로 보여 준다 |
| 기준 사진 | 사진 한 장(`query/photo`) 또는 트랙렛 하나(`query/tracklet`). 장면에서 고를 때는 카메라의 영상 → `GET /videos/{id}/tracklets` |
| 현재 위치 범위 | 재계산 API 없이 `GET .../search-area`(조회할 때 계산)를 쓴다. 화면에는 `as_of`와 새로고침 버튼을 둔다 |
| 범위 단계 | `level` 1/2/3을 높음/중간/낮음으로 표시한다. 경과 시간은 `as_of − basis_observed_at`으로 계산한다 |
| 하이라이트 | `media.highlight_status`가 `ready`일 때만 `highlight_url`을 재생한다. 그 밖에는 `playback_url` + `clip_start_s`~`clip_end_s` 구간을 재생하고, `trajectory`로 박스를 그린다 |
| 위험 지역 | `kind` + `severity`를 쓴다. 프론트의 `target_type`(실종자/범죄자)은 없앤다 |
| 계정 | 비활성화는 되돌릴 수 없다고 안내한다. 프론트의 "다시 쓰기" 버튼은 없앤다(D06) |
| 대기열 | 유사도 기준 이상 후보만 보여 준다. "기준 미만 N개" 표시는 없앤다 |
| 설정 미입력 | `SETTINGS_NOT_CONFIGURED`(409)면 "관리자가 시스템 설정을 먼저 입력해야 해요"를 띄운다(D03) |
| 409 | `code`로 나눠 처리한다. `ALREADY_DECIDED`, `SEARCH_STALE`, `VERSION_CONFLICT`, `QUERY_VERSION_CONFLICT`, `CASE_CLOSED`, `DECISION_ALREADY_REVERSED`, `ALERT_ALREADY_DECIDED`, `ORIGIN_MISSING`, `ROUTE_UNAVAILABLE`, `SETTINGS_NOT_CONFIGURED`, `LAST_ADMIN_PROTECTED`, `ACTIVE_CASE_OWNER` |
| 동시 수정 | 응답의 `version`을 기억했다가 수정할 때 `expected_version`으로 보낸다 |
| 중복 요청 | `Idempotency-Key`가 필요한 POST에는 요청마다 UUID를 만들어 보낸다. 같은 요청을 다시 보낼 때만 같은 키를 쓴다 |
| 목록 | cursor(`next_cursor`, `has_more`). 화면은 "더 보기"로 바꾼다 |
| ID·좌표·시각 | ID는 정수(일부 문자열), 좌표는 GeoJSON `[lng, lat]`이다. 시각은 시간대가 붙은 RFC3339로 받고, 화면에는 한국 시간으로 표시한다. 변환은 프론트 `src/api`에서 한다 |
| 데이터 보관 | 기간 설정과 삭제 예정 목록만 보여 준다. 자동 삭제는 하지 않는다(D02) |

## 3. 확인 부탁

1. **개발 환경 출처**
   - 프론트 개발 서버는 `http://localhost:5173`이고, Vite proxy로 `/api` → 백엔드로 보낸다. 브라우저 입장에서 같은 출처다.
   - 백엔드 개발 주소와 포트를 알려 주세요.
   - 개발 중에는 쿠키 `Secure`와 Origin 검사가 `http://localhost:5173`을 허용하는지 알려 주세요.
2. **범위 밖 후보 (R5)**
   - 검색이 `time_feasible=false`인 트랙렛을 결과에서 아예 빼는지, `TIME_REVIEW_REQUIRED`로 표시해서 포함하는지 알려 주세요.
   - 빼는 방식이라면 `out_of_filter_threshold` 이상인 트랙렛만 포함해 주세요.
3. **판단 근거 코드**
   - 요구사항 SYS02-004는 확인이 필요한 이유로 "사람 겹침"과 "필터 밖 출현"을 들고, SYS02-003은 "방향 불일치"를 든다.
   - 지금 `reason_codes`에는 이 셋에 해당하는 코드가 없다.
   - 모델이 판단할 수 있다면 `OVERLAP`, `DIRECTION_MISMATCH` 추가를 검토해 주세요. 어렵다면 프론트는 `reason.summary` 문장을 그대로 보여 준다.
4. **R1 `pending_count`**: 계산 비용이 크면 대안을 알려 주세요.

## 4. 프론트가 같이 고친 문서 (2026-11-18)

- `docs/requirements.md`
  - SYS01-003: 대상 유형(실종자/범죄자) 구분 → 종류·위험도 구분
  - SYS01-006: 확인 요청 기준과 필터 여유 시간 삭제, 보행 속도에 최대 속도와 출현 알림 높음 기준 추가
  - SYS01-009: 자동 삭제 → 삭제 예정 조회
  - SYS02-003: 필터 여유를 최대 보행 속도로 대신함
- `docs/design.md`: 대기열 "기준 미만은 접되 개수는 표시" 삭제
- `docs/api-spec.md`: openapi.json으로 대체됐다고 머리말에 표시
- 프론트 화면(MSW 기준)은 API 전환 작업 때 함께 바꾼다
