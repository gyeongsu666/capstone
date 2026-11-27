# LEFT API 명세서 (OpenAPI)

- 작성일: 2026-11-16, 1.1.0 갱신: 2026-11-27
- 명세 파일: [openapi.json](openapi.json) (OpenAPI 3.1.0, 버전 1.1.0)
- 상태: 백엔드 구현 기준으로 확정한 계약입니다. 서버 구현과 실제 API 테스트는 아직 하지 않았습니다.
- 이전 장별 MD 11개(초안 v0.1)는 이 파일로 대체했습니다.
- 프론트 추가·변경 요청(R1~R7)과 프론트 정책: [frontend-api-requests.md](frontend-api-requests.md)
- 기능 요구사항(SYS00~02): [../requirements.md](../requirements.md)

## 1.1.0 변경 사항

1.0.0-draft에 프론트 요청서 확정안(R1~R7)을 반영하고, 프론트 구현에 맞춰 조회 권한(R8)과 실시간 전달 방식을 정했습니다. 변경 내역은 `openapi.json`의 `x-changelog`에도 있습니다.

| 번호 | 변경 | 위치 |
|---|---|---|
| R1 | 사건에 실종자 이름·나이, 마지막 목격 장소 이름, 확정·대기 수(`summary`) 추가 | `Case`, `CaseCreateRequest`, `CasePatch`, `CaseSummary` |
| R2 | 미처리 출현 알림 집계 API 추가 | `GET /api/alerts/pending-count` |
| R3 | 번복 사유를 선택 항목으로 변경(1~500자), 보류 번복은 검색을 무효화하지 않음 | `DecisionReverseRequest` |
| R4 | `/auth/me`가 `LoginResponse`(사용자 + CSRF 토큰 + 만료 시각)를 반환 | `GET /api/auth/me` |
| R5 | 시간 조건 밖 후보의 예외 기준 `out_of_filter_threshold` 추가, 후보 포함 규칙 명시 | `SystemSettings`, `CandidateReason` |
| R6 | 사건에 가장 최근 검색(`latest_search`) 추가 | `Case` |
| R7 | 녹화 영상 전체 현황 집계 API 추가 | `GET /api/videos/stats` |
| R8 | 시스템 설정·카메라·위험 지역 목록을 사용자도 조회(수정은 관리자만) | `GET /api/settings`, `/api/cameras`, `/api/danger-zones` |
| - | WebSocket 제외, REST 폴링으로 확정 | `x-websocket.status=excluded` |

## 문서 간 차이 정리

팀 문서끼리 다르게 적힌 부분은 아래처럼 정했습니다. 기준 순서는 프론트 구현 > 프론트 요청서 > 이 명세 > 기술 스택 문서입니다.

| 항목 | 다르게 적힌 곳 | 결정 |
|---|---|---|
| 실시간 전달 | 1.0.0-draft와 데이터 흐름 문서는 WebSocket, 프론트·요청서·기술 스택 문서는 폴링 | REST 폴링 |
| 로그인 | 기술 스택 문서는 1차 제외, 이 명세·프론트·기능 요구사항(SYS00)은 포함 | 세션 쿠키 + CSRF + 역할(관리자·사용자) |
| 벡터 검색 | 기술 스택 문서는 FAISS, 모델 브랜치 DB는 pgvector | PostgreSQL pgvector |
| 판단 종류 | 모델 브랜치 DB는 확정·부재, 이 명세·프론트는 예·아니오·보류 + 번복 | 예·아니오·보류 + 번복(DB 스키마를 맞춰 고침) |
| 후보 시간 조건 | 기능 요구사항은 필터 여유 시간·확인 요청 기준, 요청서는 최대 보행 속도 기준 | 최대 보행 속도 기반 최소 이동 시간 + `out_of_filter_threshold`(R5) |
| 이전 API 초안 | 기능 명세 아티팩트의 "API 명세" 탭(58개, Bearer 토큰, page/size) | 사용하지 않음. 이 명세로 대체 |

## 보는 방법

- [Swagger Editor](https://editor.swagger.io)에서 `File > Import file`로 `openapi.json`을 열면 화면으로 볼 수 있습니다.

## 파일 안의 추가 정보

| 키 | 내용 |
|---|---|
| `x-websocket` | 1.1.0에서 제외한 WebSocket 설계(기록용) |
| `x-changelog` | 버전별 변경 내역 |
| `x-internal-contracts` | 백엔드와 GPU 워커 사이 큐 메시지 계약 |
| `x-error-code-catalog`, `x-task-error-codes` | 에러 코드 목록 |
| `x-feature-coverage` | 기능 요구사항과 API 연결표 |
| `x-pending-decisions` | 팀 확정이 필요한 항목 (D01~D07) |
| `x-review-findings` | 기존 문서와 충돌한 부분과 처리 방식 |

## 엔드포인트 전체 목록 (70개)

### 공통

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| POST | `/api/auth/login` | 로그인 | 200 |
| POST | `/api/auth/logout` | 로그아웃 | 200 |
| GET | `/api/auth/me` | 내 정보·역할 조회 | 200 |
| POST | `/api/auth/password` | 비밀번호 변경·최초 로그인 변경 | 200 |
| GET | `/api/tasks/{task_id}` | 작업 상태 조회 | 200 |

### 보조 조회

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/users/directory` | 공동 담당 추가용 계정 검색 | 200 |
| GET | `/api/map` | 수색 화면 지도 조회 | 200 |

### 사건

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/cases` | 사건 목록 | 200 |
| POST | `/api/cases` | 사건 등록 | 201 |
| GET | `/api/cases/{case_id}` | 사건 상세 | 200 |
| PATCH | `/api/cases/{case_id}` | 사건 수정 | 200 |
| POST | `/api/cases/{case_id}/close` | 사건 종료·사유 저장 | 200 |

### 공동 담당

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/cases/{case_id}/assignees` | 사건 담당자 목록 | 200 |
| POST | `/api/cases/{case_id}/assignees` | 공동 담당자 추가 | 201 |
| DELETE | `/api/cases/{case_id}/assignees/{user_id}` | 공동 담당자 제거 | 200 |

### 대상 지정

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| POST | `/api/cases/{case_id}/query/photo` | 기준 사진 업로드·특징 추출 | 202 |
| POST | `/api/cases/{case_id}/query/tracklet` | 영상 트랙렛을 기준 대상으로 선택 | 200 |

### 검색 조건

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/cases/{case_id}/search-conditions` | 사건별 검색 조건 조회 | 200 |
| PATCH | `/api/cases/{case_id}/search-conditions` | 사건별 유사도 기준 수정 | 200 |

### 후보 검색

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| POST | `/api/cases/{case_id}/searches` | 후보 검색 실행 | 201, 202 |
| GET | `/api/cases/{case_id}/searches/{search_id}` | 검색 실행 상태·스냅샷 조회 | 200 |
| GET | `/api/cases/{case_id}/candidates` | 검색 후보 목록·판단 근거 | 200 |

### 판단

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| POST | `/api/cases/{case_id}/decisions` | 후보 예·아니오·보류 판정 저장 | 201 |
| GET | `/api/cases/{case_id}/decisions` | 판정 기록 조회 | 200 |
| POST | `/api/cases/{case_id}/decisions/{decision_id}/reverse` | 판정 번복·영향받은 장면 목록 | 200 |

### 동선·범위

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/cases/{case_id}/route` | 확정 목격 동선 조회 | 200 |
| GET | `/api/cases/{case_id}/scenes/{scene_id}` | 장면 상세·강조/원본 대응 구간 | 200 |
| GET | `/api/cases/{case_id}/search-area` | 현재 위치 3단계 범위·위험 중첩·우선 구역 | 200 |

### 실시간 감시

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/cases/{case_id}/watch` | 실시간 감시 상태 | 200 |
| PUT | `/api/cases/{case_id}/watch` | 실시간 감시 시작·중지 | 200 |
| GET | `/api/cases/{case_id}/alerts` | 출현 알림 목록 | 200 |
| GET | `/api/cases/{case_id}/alerts/{alert_id}` | 출현 알림 상세·현재 판정 | 200 |
| POST | `/api/cases/{case_id}/alerts/{alert_id}/decision` | 출현 알림 예·아니오 응답 | 200 |
| GET | `/api/alerts/pending-count` | 미처리 출현 알림 집계(R2) | 200 |

### 사건 영상

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| POST | `/api/cases/{case_id}/videos` | 사건 영상 추가·위치·방향·녹화 시각 | 202 |
| GET | `/api/cases/{case_id}/videos` | 사건에 추가한 영상 목록 | 200 |

### 영상 조회

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/videos/{video_id}` | 영상 상세·분석 현황·재생 주소 | 200 |
| GET | `/api/videos/{video_id}/tracklets` | 영상 속 인물 선택용 트랙렛 목록 | 200 |
| GET | `/api/tracklets/{tracklet_id}` | 트랙렛 장면 상세 | 200 |

### 관리자·카메라

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/cameras` | 카메라·보조지점 목록(사용자도 조회, R8) | 200 |
| POST | `/api/cameras` | 카메라·보조지점 등록 | 201 |
| PATCH | `/api/cameras/{node_id}` | 카메라·보조지점 수정 | 200 |
| DELETE | `/api/cameras/{node_id}` | 카메라·보조지점 삭제 | 200 |

### 관리자·도보 경로

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/walk-graph` | 도보 경로 구간·우회 의심 조회 | 200 |
| POST | `/api/walk-graph/recalculations` | 도보 경로 다시 계산 | 202 |
| PATCH | `/api/walk-graph/{edge_id}` | 도보 구간 보정값 수정 | 200 |

### 관리자·위험 지역

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/danger-zones` | 위험 지역 목록(사용자도 조회, R8) | 200 |
| POST | `/api/danger-zones` | 위험 지역 등록 | 201 |
| PATCH | `/api/danger-zones/{zone_id}` | 위험 지역 수정 | 200 |
| DELETE | `/api/danger-zones/{zone_id}` | 위험 지역 삭제 | 200 |

### 관리자·녹화 영상

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/videos` | 녹화 영상 목록·분석 상태·진행률 | 200 |
| GET | `/api/videos/stats` | 녹화 영상 전체 현황 집계(R7) | 200 |
| POST | `/api/videos` | 녹화 영상 업로드·분석 접수 | 202 |
| POST | `/api/videos/{video_id}/analysis` | 실패한 영상 분석 재처리 | 202, 200 |

### 관리자·설정

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/settings` | 시스템 설정 조회(사용자도 조회, R8) | 200 |
| PATCH | `/api/settings` | 시스템 설정 수정 | 200 |

### 관리자·계정

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/users` | 계정 목록 | 200 |
| POST | `/api/users` | 계정 생성·임시 비밀번호 발급 | 201 |
| PATCH | `/api/users/{user_id}/role` | 계정 역할 변경 | 200 |
| POST | `/api/users/{user_id}/deactivate` | 계정 비활성화 | 200 |
| POST | `/api/users/{user_id}/password-reset` | 계정 비밀번호 초기화 | 200 |

### 관리자·이용 기록

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/audit-logs` | 이용 기록 조회·필터 | 200 |

### 관리자·데이터 보관

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/retention-policy` | 데이터 보관 기간 조회 | 200 |
| PATCH | `/api/retention-policy` | 데이터 보관 기간 수정 | 200 |
| GET | `/api/deletion-candidates` | 삭제 예정·보호 대상 목록 | 200 |

### 파일 제공

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/cases/{case_id}/query/photo` | 기준 사진 조회 | 200 |
| GET | `/api/videos/{video_id}/stream` | 원본과 시간 대응하는 재생용 MP4 | 200, 206 |
| GET | `/api/tracklets/{tracklet_id}/thumbnail` | 트랙렛 썸네일 | 200 |
| GET | `/api/cases/{case_id}/alerts/{alert_id}/snapshot` | 출현 알림 스냅샷 | 200 |
| GET | `/api/tracklets/{tracklet_id}/highlight` | 인물 강조 하이라이트 MP4 | 200, 206 |
