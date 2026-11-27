# 프론트 → 백엔드 API 구현 요청서 — 확정안

- 작성일: 2026-11-18
- 기본 계약: 기존 OpenAPI 1.0.0-draft
- 목적: 기존 요청서의 질문·미정 사항을 프론트 정책으로 확정하고, 백엔드 구현에 필요한 추가·변경 사항을 전달한다.
- 상태: R1~R7을 OpenAPI 1.1.0(2026-11-27)에 반영했다. 프론트 구현에 맞춘 조회 권한(R8)도 함께 반영했다. 백엔드 구현은 아직이다.
- 검토 근거: 기존 backend-requests.md, 제공된 src 소스 및 src/api/generated/schema.d.ts. 원본 OpenAPI와 실제 백엔드 실행 결과는 검증 범위에 포함하지 않았다.

## 1. 공통 원칙

1. 이 문서에서 명시적으로 변경하는 사항 외에는 기존 OpenAPI의 경로, 메서드, 오류 구조, 타입, 권한, 버전 정책을 따른다.
2. 프론트와 MSW를 동일한 계약으로 변경한다. MSW만 통과한 것을 실제 서버 호환성 검증으로 간주하지 않는다.
3. 실시간 기능은 REST 폴링으로 구현한다. WebSocket은 이번 범위에서 제외한다.
4. 일반 JSON 좌표는 GeoJSON `[longitude, latitude]`를 사용한다. multipart 업로드는 OpenAPI에 정의된 개별 좌표 필드를 따른다.
5. 시각은 시간대를 포함한 RFC3339를 사용하며, 프론트는 한국 시간으로 표시한다.
6. ID는 OpenAPI의 타입을 유지한다. tracklet_id, decision_id, alert_id 등 큰 정수 문자열과 UUID를 숫자로 변환하지 않는다.
7. 수정 요청에는 해당 계약의 expected_version 계열 필드를 사용한다. 충돌 시 최신 값을 다시 조회하며, 사용자 확인 없이 자동으로 덮어쓰지 않는다.
8. 멱등키가 필요한 작업은 한 번의 논리적 작업에 하나의 키를 사용한다. 동일 작업의 네트워크 재시도에는 같은 키와 같은 본문을 사용한다. 입력을 변경한 새 작업에는 새 키를 사용한다.
9. 목록은 cursor 기반 ‘더 보기’로 구현한다. 전체 개수는 서버가 명시적으로 제공한 집계만 사용한다.
10. 이 문서에서 추가하는 보호된 API에도 기존 인증, 사건 접근 권한, 공통 오류 응답을 적용한다.

## 2. 추가·변경 요청

### R1. 사건의 실종자 정보·표시용 집계 추가

Case에 다음 필드를 추가한다. 사건 상세와 CasePage.items에 동일하게 제공한다.

```json
{
  "person_name": "김민준",
  "person_age": 8,
  "last_seen_place_name": "도림캠퍼스 정문",
  "summary": {
    "confirmed_count": 3,
    "pending_count": 4
  }
}
```

| 필드 | 생성 | 수정 | 규칙 |
| --- | --- | --- | --- |
| person_name | 필수 | 선택 | 앞뒤 공백 제거 후 1~50자 |
| person_age | 선택, 기본 null | 선택, null로 초기화 가능 | 정수 0~150 또는 null |
| last_seen_place_name | 선택, 기본 null | 선택, null로 초기화 가능 | 최대 200자, 공백만 입력하면 null |

입력 필드는 CaseCreateRequest와 CasePatch에도 추가한다. CasePatch는 기존 expected_version을 사용한다.

집계 정의:

- confirmed_count: verdict=confirmed, status=active, needs_reconfirmation=false인 판단 수. 트랙렛 및 출현 알림에서 생성된 판단을 모두 포함한다.
- pending_count: R6의 latest_search가 status=done이고 stale=false일 때, 해당 검색 결과 중 유효한 active 판단이 없는 후보 수다. confirmed/rejected/deferred 판단은 모두 판단 완료로 취급한다.
- 검색이 없거나 queued/running/failed/stale이면 pending_count=null이다. 타입은 integer | null이다. null은 후보 0개와 구분한다.
- 집계는 현재 사용자에게 접근 가능한 사건 데이터만 대상으로 한다.

case_no는 추가하지 않는다. 화면은 case_id와 title을 사용한다.

### R2. 미처리 출현 알림 집계 API 추가

사용자별 읽음 상태를 관리하지 않으므로 기존 요청의 unread-count 대신 pending-count로 확정한다.

```http
GET /api/alerts/pending-count
```

```json
{
  "count": 2,
  "by_case": [
    { "case_id": 31, "count": 2 }
  ]
}
```

- 로그인 필수다.
- 진행 중인 사건의 status=pending 알림만 센다.
- 일반 사용자는 본인 소유 또는 배정된 사건, 관리자는 전체 진행 중 사건이 대상이다. 다른 사건 조회 API에도 동일한 사건 접근 정책을 적용한다.
- by_case에는 1개 이상인 사건만 포함한다.
- 미처리 수 내림차순, 동률이면 case_id 오름차순으로 정렬한다.
- count는 by_case의 count 합과 같아야 한다.
- 결과가 없으면 `{ "count": 0, "by_case": [] }`를 반환한다.
- 종료 사건은 집계에서 제외한다.
- 프론트는 2.5초마다 조회한다. 배지를 누르면 첫 번째 사건의 출현 알림 영역으로 이동한다.
- 이 API는 읽음 상태를 생성하거나 변경하지 않는다.

### R3. 판단 번복 사유를 선택 항목으로 변경

```http
POST /api/cases/{case_id}/decisions/{decision_id}/reverse
```

```json
{
  "expected_version": 3,
  "reason": "다른 인물로 확인됨"
}
```

- expected_version은 대상 Decision.version이며 필수다.
- reason은 생략 가능하다. null은 허용하지 않는다.
- 입력 시 앞뒤 공백 제거 후 1~500자여야 한다.
- 판단 직후 8초 Undo는 reason을 생략한다.
- 결정 기록 탭에서는 프론트가 번복 사유를 필수로 받는다.
- 8초는 Undo 알림 표시 시간이며, 서버의 번복 가능 시간 제한이 아니다.
- 번복 자체로 후보 재검색 작업을 자동 실행하지 않는다.
- 기존 DecisionReverseResponse의 decision, affected_scenes, invalidated_search_ids, case_version을 반환한다.
- 프론트는 무효화된 검색의 판단을 막고 재검색을 안내한다. affected_scenes는 재확인 필요로 표시한다.
- 번복 대상 판단에 따라 검색 무효화 범위가 다르다.

| 번복 대상 | 검색 무효화 | 후보 처리 |
| --- | --- | --- |
| confirmed(예) | 사건의 유효한 검색을 모두 무효화하고 invalidated_search_ids로 반환 | 이후 확정 장면은 재확인 필요, 재검색 후 다시 판단 |
| rejected(아니오) | 사건의 유효한 검색을 모두 무효화하고 invalidated_search_ids로 반환 | 유효한 재검색 결과에서 다시 판단. 기존 대기열에 임의로 삽입하지 않음 |
| deferred(보류) | **무효화하지 않음.** invalidated_search_ids는 빈 배열, 사건 버전만 증가 | 같은 검색 결과에서 decision=null인 후보로 돌아와 바로 다시 판단 가능 |

- 보류는 동선·기준점·감시 기준에 영향을 주지 않으므로 번복해도 검색 결과가 바뀌지 않는다.
- 한 트랙렛에 유효 판단은 하나이므로, 보류한 후보를 예/아니오로 판단할 때 프론트는 보류 판단을 번복(reason 생략)한 뒤 같은 search_id로 새 판단을 저장한다. 이때 번복 응답의 case_version을 새 판단의 expected_case_version으로 쓴다.
- 이 흐름으로 "보류는 대기열 맨 뒤로, 나중에 다시 판단" 동작을 재검색 없이 유지한다.

### R4. 세션 복원을 위해 GET /auth/me 응답 변경

```http
GET /api/auth/me
```

200 응답은 LoginResponse와 동일한 구조를 사용한다.

```jsonc
{
  "user": { /* 기존 User 전체 필드 */ },
  "csrf_token": "session-csrf-token",
  "expires_at": "2026-11-18T10:00:00Z"
}
```

- 유효한 세션 쿠키로 사용자 및 CSRF 토큰을 복원한다.
- 조회 자체로 CSRF 토큰을 회전시키지 않는다. 다른 탭의 토큰을 무효화하지 않는다.
- 로그인·비밀번호 변경 등 기존 세션 회전 절차에서는 새 토큰을 반환한다.
- Cache-Control: no-store를 적용한다.
- 첫 로그인 비밀번호 변경 전에도 /me, 비밀번호 변경, 로그아웃은 허용한다.
- expires_at은 서버가 판단한 현재 세션 만료 시각이다. 프론트는 이 값만으로 세션 유효성을 보장하지 않으며 서버의 401을 최종 기준으로 사용한다.

### R5. 시간 조건 밖 후보의 고유사도 예외 기준 추가

SystemSettings와 SystemSettingsPatch에 out_of_filter_threshold를 추가한다.

- 타입: number | null
- 범위: 0~1
- 초기값: null
- PATCH 생략: 유지
- PATCH null: 시간 조건 밖 후보의 예외 허용 해제
- 변경 시 기존 expected_version을 사용한다.

모든 후보는 사건의 similarity_threshold 이상이어야 한다.

| time_feasible | 포함 규칙 |
| --- | --- |
| true | 기본 유사도 기준 이상이면 포함 |
| false | 예외 기준이 설정되어 있고 기본·예외 기준을 모두 충족할 때만 포함 |
| null | 기본 유사도 기준 이상이면 포함하고 수동 확인 대상으로 표시 |

시간 조건 불충족 후보의 포함 조건:

```text
out_of_filter_threshold != null
AND similarity >= max(similarity_threshold, out_of_filter_threshold)
```

사유 코드:

- time_feasible=false인 예외 포함 후보: TIME_REVIEW_REQUIRED
- time_feasible=null인 후보: MANUAL_REVIEW_REQUIRED
- 경로를 찾지 못해 판정 불가: ROUTE_UNKNOWN도 포함

사람 겹침·방향 불일치 전용 코드는 이번에 추가하지 않는다. 프론트는 reason.summary와 제공된 코드만 표시하며 근거를 자체 추정하지 않는다.

filter_margin_minutes와 confirm_request_threshold는 추가하지 않는다. 시간 조건은 최대 속도 기반 최소 이동 시간으로 판단한다. 이는 고정 여유 시간과 수학적으로 동일하다는 의미가 아니라, 최대 속도 기반 정책으로 단순화한다는 결정이다.

alert_high_threshold는 출현 알림 high/mid 분류용이며 이 설정과 별개다. out_of_filter_threshold는 후보 검색에 적용하고 출현 알림 생성 기준에는 적용하지 않는다.

### R6. 사건 응답에 최근 검색 정보 추가

새로고침 및 공동 담당자 화면에서 검색 실행 상태를 복원하기 위해 Case에 아래 필드를 추가한다.

```ts
latest_search: SearchRun | null
```

- 사건 상세와 CasePage.items에 제공한다.
- latest_search는 해당 사건에서 가장 최근에 생성된 검색이다. 완료된 검색 중 최신이라는 뜻이 아니다.
- 동시 생성 시에도 서버가 일관된 순서를 정해 하나를 선택한다.
- 검색이 없으면 null이다.
- 기준 대상·검색 조건·판단 변경 등에 따른 stale 상태를 조회 시 정확히 반영한다.
- 최근 검색이 실패하거나 무효여도 과거 검색으로 자동 대체하지 않는다.
- 프론트는 사건 진입 시 이 필드로 search_id와 작업 상태를 복원한다.
- 최신 검색이 queued/running이면 작업 상태를 조회하고, done 및 stale=false이면 해당 search_id로 후보를 조회한다.
- 이전 검색 결과를 표시하는 경우 ‘이전 검색 결과’로 구분한다. stale 검색은 판단할 수 없다.
- 공동 담당자가 새 검색을 생성하면 사건 재조회로 인지한다. 판단 중인 화면을 알림 없이 새 검색으로 교체하지 않고 새 검색 안내를 표시한다.

### R7. 녹화 영상 전체 현황 집계 API 추가

cursor 일부 페이지를 전체 통계로 오인하지 않도록 별도 집계 API를 제공한다.

```http
GET /api/videos/stats
```

관리자 전용이다. GET /api/videos와 동일한 전역 녹화 영상 모집단·접근 범위·lifecycle 기본 필터를 적용한다. case 전용 영상은 포함하지 않는다. 영상 목록의 추가 필터는 목록에만 적용하며 이 API에는 적용하지 않는다. 화면은 ‘전체 녹화 영상 현황’으로 명시한다.

```json
{
  "total": 12,
  "by_status": {
    "queued": 2,
    "running": 1,
    "done": 8,
    "failed": 1
  },
  "by_camera": [
    {
      "camera_id": 5,
      "total": 12,
      "by_status": {
        "queued": 2,
        "running": 1,
        "done": 8,
        "failed": 1
      }
    }
  ],
  "as_of": "2026-11-18T10:00:00Z"
}
```

- 집계 상태 queued/running/done/failed는 기존 영상 분석 상태를 위 네 범주로 대응한 집계 분류다. 기존 VideoAnalysis 타입 자체를 변경하는 요청은 아니다.
- 분석 시작 전·대기 상태는 queued, 분석 진행 중은 running, 성공은 done, 실패는 failed로 집계한다.
- total은 상태별 수의 합이다. by_camera의 total 합도 전체 total과 같아야 한다.
- 영상이 없는 카메라는 by_camera에서 생략한다.
- by_camera는 camera_id 오름차순이다.
- as_of는 집계 기준 시각이며, 한 응답의 전체·상태·카메라 집계는 동일한 기준 스냅샷을 사용한다.
- 실행 중 작업이 있으면 프론트는 2.5초 간격으로 갱신하고, 그 외에는 30초 간격 및 등록·재처리 직후 갱신한다.

## 3. 기존 API 채택 및 프론트 변경 결정

### 3.1 사건 등록·담당자·종료

- 생성 요청은 title, person_type, last_seen_at, last_seen_location 등 기존 CaseCreateRequest와 R1 필드를 사용한다.
- 생성 화면에 사건 제목 입력을 추가한다. 기본 제안은 ‘{실종자 이름} 실종’이며 사용자가 수정할 수 있다. 길이 등 검증은 기존 OpenAPI를 따른다.
- person_type과 나이를 자동으로 동일시하지 않는다. 유형은 별도 선택하며 other도 지원한다.
- 생성 후 담당자 배정은 기존 /assignees API로 처리한다. 생성 성공 후 배정 일부 실패 시 사건을 다시 생성하지 않고 실패한 배정만 재시도한다.
- 종료 요청은 기존 outcome, reason, found_at, expected_version 계약을 따른다.
- 기존 사건 번호 표시는 case_id와 title로 대체한다.

### 3.2 기준 대상

- 사진 한 장 또는 트랙렛 하나만 사용한다.
- 사진 업로드: POST /api/cases/{case_id}/query/photo. multipart photo 및 expected_query_version을 사용한다.
- 트랙렛 선택: 영상 조회 → GET /api/videos/{video_id}/tracklets → POST /api/cases/{case_id}/query/tracklet 순서다.
- 기존 다중 사진 추가·개별 삭제 UI는 제거하고 현재 기준 보기·교체 UI로 변경한다.
- 기준 대상을 비우는 별도 삭제 API는 이번에 요청하지 않는다.
- 특징 추출 완료 후 현재 기준·조건 버전을 다시 조회하고 검색을 실행한다.

### 3.3 후보 검색·판단

- 검색은 search_id 단위로 관리한다. 후보 캐시 키에도 search_id를 포함한다.
- 검색 방향은 forward를 기본으로 하고 backward 선택을 지원한다.
- max_candidates는 100으로 요청한다. 시간·카메라 필터를 설정했다면 기존 SearchRequest 필드로 전달한다.
- expected_query_version, expected_conditions_version을 필수 전송한다.
- 후보 조회에는 search_id, cursor, limit을 사용한다.
- 판단은 tracklet_id, search_id, verdict, expected_case_version을 전송한다.
- 화면의 예/아니오/보류는 confirmed/rejected/deferred로 변환한다.
- stale=true 또는 SEARCH_STALE이면 판단을 막고 재검색을 안내한다.
- ALREADY_DECIDED이면 결정 기록을 재조회하여 판단자를 표시한다.
- 기준 미만 후보 및 기준 미만 개수 UI는 제거한다.
- 유사도는 동일인 확률로 표현하지 않는다.

### 3.4 결정 기록 표시

- Decision의 status, reversed_at, reversed_by, reversal_reason으로 번복 이력을 표현한다.
- 기록 목록의 필수 표시는 판단 시각, 판단자, 관측 시각, 판단, 출처, 번복 상태다.
- 목록의 장면 썸네일·카메라 코드는 필수에서 제외한다. 이를 위한 백엔드 응답 확장은 요청하지 않는다.
- 상세 열기 시 tracklet 출처는 트랙렛/사건 장면 API, alert 출처는 사건 알림 상세 API를 사용한다.
- 번복된 기록도 삭제하지 않는다.

### 3.5 현재 위치 범위

- search-area/recalculate는 사용하지 않는다. GET /api/cases/{case_id}/search-area를 새로 조회한다.
- basis_decision_id가 있으면 서버가 선택한 유효한 확정 판단을 기준으로 하고, 없으면 사건의 last_seen_location 및 last_seen_at을 기준으로 한다.
- 확정 판단이 없다는 이유만으로 범위 조회를 막지 않는다. 위치 기준이 구성되지 않았거나 경로 계산이 불가능한 경우는 기존 ORIGIN_MISSING, ROUTE_UNAVAILABLE 오류를 사용한다.
- elapsed 시간은 max(0, as_of - basis_observed_at)으로 표시한다.
- level 1/2/3은 높음/중간/낮음으로 표시한다.
- as_of와 새로고침 버튼을 표시하며 새로고침 시 GET을 재호출한다.
- 계산 경고와 위험 지역 겹침·우선 수색 영역은 서버 응답을 사용한다.

### 3.6 감시·출현 알림

- 감시 변경은 enabled와 expected_case_version을 사용한다.
- starting, watching, degraded, stopped, blocked, unknown을 각각 구분해 표시한다.
- 알림 판단은 POST /api/cases/{case_id}/alerts/{alert_id}/decision을 사용한다.
- decision=confirmed/rejected 및 expected_version을 전송한다.
- 기본 알림 목록은 pending만 조회한다. cursor로 다음 페이지를 불러온다.
- 폴링 시 첫 페이지를 다시 조회하고 alert_id로 병합·중복 제거한다. 새 알림을 확인한 시점에는 기존 다음 페이지 cursor를 폐기하고 목록 페이지 체인을 다시 구성한다.
- 알림 판단 후 알림·집계·사건·동선·검색 유효성을 다시 조회한다.

### 3.7 영상 등록·재생

- 전역 녹화 영상 등록은 file, camera_id, recorded_start_at을 사용한다.
- 사건 영상 등록은 file, longitude, latitude, direction_deg, recorded_start_at, camera_name을 사용한다.
- 계약에 없는 사건 영상 fov_deg 입력은 제거한다.
- 분석 재처리는 POST /api/videos/{video_id}/analysis를 사용한다.
- 파일명 필드는 추가 요청하지 않는다. 영상 목록은 video_id와 카메라 이름으로 표시한다.
- camera_code는 추가 요청하지 않는다. 제공되는 카메라 이름과 ID를 사용한다.
- media.highlight_status=ready이고 highlight_url이 존재할 때만 하이라이트를 재생한다.
- 그 외에는 playback_url의 clip_start_s~clip_end_s 구간을 재생한다.
- 원본 영상 위 박스는 trajectory의 픽셀 좌표를 source_width_px/source_height_px로 정규화하고 실제 영상 표시 영역에 맞춘다.
- trajectory.offset_s는 원본 영상 시작 기준 초로 해석한다. 하이라이트가 별도 시간축을 쓰는 경우 프론트는 하이라이트 위에 trajectory 박스를 추가로 그리지 않는다. 원본 fallback에서만 trajectory 박스를 표시한다.

### 3.8 지도·관리자 설정·계정·보관

- 지도는 기존 /map 또는 개별 cursor 목록 API를 사용한다. 일부 페이지만으로 전체 지도 데이터를 표시했다고 간주하지 않는다.
- 위험 지역은 kind와 severity를 사용한다. target_type은 제거한다.
- 도보 경로는 /walk-graph와 /walk-graph/recalculations를 사용한다.
- 시스템 설정은 PATCH /settings를 사용한다. 일반 속도·최대 속도, alert_high_threshold, 기존 범위 설정 및 R5를 반영한다.
- SETTINGS_NOT_CONFIGURED이면 관리자가 설정해야 한다는 안내를 표시한다. 임의의 운영 기본값으로 우회하지 않는다.
- 계정 선택은 /users/directory를 사용한다.
- 역할 변경은 /users/{user_id}/role, 비활성화는 /users/{user_id}/deactivate, 비밀번호 초기화는 /users/{user_id}/password-reset을 사용한다.
- 비활성화 복구 UI와 API는 제공하지 않는다.
- 데이터 보관은 /retention-policy 및 /deletion-candidates를 사용한다. 기간 설정·삭제 예정 조회만 제공하며 이번 범위에서 자동 삭제를 실행하지 않는다.

## 4. 인증·개발 환경 정책

- 프론트 개발 주소는 http://localhost:5173이다.
- 개발 요청은 Vite proxy로 /api를 백엔드에 전달한다. 백엔드 주소는 Vite 환경 설정으로 주입하고 소스에 고정하지 않는다.
- 개발 환경에서 서버는 Origin http://localhost:5173을 허용한다. 프록시는 해당 Origin을 임의의 다른 값으로 바꾸지 않는다.
- HTTP 로컬 개발 환경의 세션 쿠키는 Secure=false, HttpOnly=true, SameSite=Lax, Path=/로 발급하고 Domain은 지정하지 않는다.
- 운영 HTTPS 환경에서는 Secure=true를 사용한다. 개발 예외를 운영에 적용하지 않는다.
- CSRF 토큰은 메모리에만 보관한다. localStorage에 저장하지 않는다.
- MSW는 실제 HttpOnly·Secure·프록시 동작 검증을 대신하지 않는다. 쿠키 보안 속성은 실서버에서 별도로 확인한다.

## 5. 폴링 및 오류 처리

| 대상 | 기본 간격 | 종료·예외 |
| --- | --- | --- |
| 작업 /tasks/{id} | 2.5초 | done/failed에서 종료 |
| 분석 중 영상 /videos/{id} | 2.5초 | 완료·실패 시 주기 조회 종료 |
| 감시 상태 /cases/{id}/watch | 5초 | 사건 화면 진입 중 조회 |
| 출현 알림 /cases/{id}/alerts | 2.5초 | 해당 사건 화면 진입 중 조회 |
| 미처리 집계 /alerts/pending-count | 2.5초 | 로그인 상태에서 조회 |
| 공동 판단·사건 상태 | 5초 | 해당 사건 화면 진입 중 조회 |

- 숨겨진 탭에서는 주기 폴링을 중지하고 다시 활성화되면 재조회한다. 세션 만료 또는 로그아웃 시 보호된 폴링을 중지한다.
- 401 UNAUTHENTICATED/SESSION_EXPIRED는 로그인 화면으로 이동한다. 세션 만료 문구를 구분한다.
- 403 PASSWORD_CHANGE_REQUIRED는 비밀번호 변경 화면으로 이동한다.
- 접근할 수 없는 사건은 404로 처리하고 ‘사건을 찾을 수 없거나 접근 권한이 없습니다’를 표시한다.
- 409는 ALREADY_DECIDED, SEARCH_STALE, VERSION_CONFLICT, QUERY_VERSION_CONFLICT, CASE_CLOSED, DECISION_ALREADY_REVERSED, ALERT_ALREADY_DECIDED, ORIGIN_MISSING, ROUTE_UNAVAILABLE, SETTINGS_NOT_CONFIGURED, LAST_ADMIN_PROTECTED, ACTIVE_CASE_OWNER 등 기존 code로 구분한다.
- 버전 충돌은 최신 상태를 조회한 뒤 사용자가 다시 실행하도록 한다. 실패한 변경을 자동으로 덮어쓰지 않는다.
- 네트워크 장애·서버 오류에는 제한된 재시도와 지수 백오프를 적용한다. 변경 요청의 재전송에는 멱등성 계약을 준수한다.

## 6. 프론트·MSW 수정 범위

| 영역 | 주요 파일 | 변경 |
| --- | --- | --- |
| 계약·변환 | api/generated/schema.d.ts, api/server.ts, api/types.ts, api/convert.ts, api/view/* | 타입 재생성, 임시 확장 제거, ID·좌표·cursor·상태 변환 |
| 사건 | api/cases.ts, pages/cases/*, CaseCard, Sidebar | R1, R6, 제목·ID, 담당자 별도 배정, 종료 버전 |
| 검색·판단 | api/tracking.ts, api/queryKeys.ts, stores/tracking.ts, pages/route-tracking/* | 단일 기준, search_id, 버전, stale 차단, 후보 페이지 |
| 결정 기록 | DecisionLog, UndoToast, stores/undoToast.ts | reason, reverse 응답, 기록 상태 표시 |
| 범위·알림 | api/search.ts, pages/search-area/*, LiveAlertCard | GET 새로고침, 감시 상태, 알림 판단·집계 |
| 영상 | api/admin.ts, api/common.ts, pages/admin/videos/*, VideoPlayer | 등록 필드, 분석 상태, 집계, 재생·박스 |
| 지도·설정 | api/map.ts, pages/admin/camera-map/*, SystemSettingsTab | GeoJSON, walk-graph, kind/severity, 설정 PATCH |
| 계정·보관 | AccountsTab, RetentionTab, AuditTab | 새 경로, 복구 제거, cursor, 사건 표시 |
| MSW | mocks/handlers/*, mocks/db/*, mocks/scenario/* | 새 계약·검색 실행·버전·멱등성·충돌 시나리오 |

## 7. 완료 기준

백엔드는 본 문서의 추가·변경 사항을 OpenAPI에 반영한다. 프론트는 갱신된 계약으로 타입을 재생성하고 MSW 및 화면을 변경한다.

최소 검증 항목:

- [ ] R1~R7의 요청·응답·권한·null 의미가 OpenAPI에 반영됨
- [ ] 로그인 후 새로고침 및 다중 탭에서 CSRF 변경 요청 성공
- [ ] 큰 문자열 ID가 정밀도 손실 없이 왕복
- [ ] cursor 다음 페이지의 중복·누락 방지
- [ ] 새로고침 후 latest_search 및 작업 상태 복원
- [ ] stale 검색으로 판단 불가
- [ ] 공동 담당자의 선행 판단·버전 충돌 처리
- [ ] Undo와 기록 탭 번복의 사유·버전 처리
- [ ] 번복 후 검색 무효화·재확인 상태 반영
- [ ] 보류 번복은 검색을 무효화하지 않고, 같은 search_id에서 다시 판단 가능
- [ ] 동일 멱등키 재전송으로 작업이 중복 생성되지 않음
- [ ] 동일 멱등키·다른 본문은 기존 충돌 계약대로 거부
- [ ] R5의 true/false/null 및 두 임계값 경계 테스트
- [ ] 범위 계산의 사건 최초 위치 fallback 및 계산 오류 처리
- [ ] 영상 통계가 일부 cursor 페이지와 무관하게 전체 모집단을 집계
- [ ] 하이라이트 미준비 상태에서 원본 clip·trajectory 표시 정상
- [ ] 비활성화 복구 UI 제거 및 자동 삭제 미실행
- [ ] 실제 서버에서 쿠키·Origin·프록시 동작 확인

## 8. 기존 요청서 대비 변경 요약

- R1 pending_count를 integer | null로 확정하고 보류·무효 검색의 의미를 정의했다.
- R2 경로를 unread-count에서 pending-count로 변경했다.
- R3 사유 선택, 빈 값 검증, 8초의 의미, 재검색 정책을 확정했다. 보류 번복은 검색을 무효화하지 않는다(2026-11-24).
- R4 /me의 토큰 복원·다중 탭 정책을 확정했다.
- R5 두 임계값의 관계, null과 판정 불가 처리, 알림과의 적용 범위를 확정했다.
- R6 latest_search를 추가해 새로고침·공동 담당자 검색 복원을 지원한다.
- R7 전역 영상 집계를 추가해 부분 페이지 통계를 전체처럼 표시하지 않는다.
- 파일명·카메라 코드·결정 기록 썸네일 확장은 요청하지 않고 화면을 대체한다.
- 기준 사진 삭제·다중 사진·계정 복구·WebSocket·자동 삭제는 이번 범위에서 제외한다.
