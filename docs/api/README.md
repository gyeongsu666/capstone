# ReFind API 명세서 (OpenAPI 초안)

- 작성일: 2026-11-16
- 명세 파일: [openapi.json](openapi.json) (OpenAPI 3.1.0, 버전 1.0.0-draft)
- 상태: 계약 초안. 서버 구현과 실제 API 테스트는 아직 하지 않았습니다.
- 이전 장별 MD 11개(초안 v0.1)는 이 파일로 대체했습니다.

## 보는 방법

- [Swagger Editor](https://editor.swagger.io)에서 `File > Import file`로 `openapi.json`을 열면 화면으로 볼 수 있습니다.

## 파일 안의 추가 정보

| 키 | 내용 |
|---|---|
| `x-websocket` | 실시간 감시·분석 진행률 WebSocket 계약 |
| `x-internal-contracts` | 백엔드와 GPU 워커 사이 큐 메시지 계약 |
| `x-error-code-catalog`, `x-task-error-codes` | 에러 코드 목록 |
| `x-feature-coverage` | 기능 요구사항과 API 연결표 |
| `x-pending-decisions` | 팀 확정이 필요한 항목 (D01~D07) |
| `x-review-findings` | 기존 문서와 충돌한 부분과 처리 방식 |

## 엔드포인트 전체 목록 (68개)

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
| GET | `/api/cameras` | 카메라·보조지점 목록 | 200 |
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
| GET | `/api/danger-zones` | 위험 지역 목록 | 200 |
| POST | `/api/danger-zones` | 위험 지역 등록 | 201 |
| PATCH | `/api/danger-zones/{zone_id}` | 위험 지역 수정 | 200 |
| DELETE | `/api/danger-zones/{zone_id}` | 위험 지역 삭제 | 200 |

### 관리자·녹화 영상

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/videos` | 녹화 영상 목록·분석 상태·진행률 | 200 |
| POST | `/api/videos` | 녹화 영상 업로드·분석 접수 | 202 |
| POST | `/api/videos/{video_id}/analysis` | 실패한 영상 분석 재처리 | 202, 200 |

### 관리자·설정

| 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|
| GET | `/api/settings` | 시스템 설정 조회 | 200 |
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
