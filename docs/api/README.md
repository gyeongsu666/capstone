# ReFind API 명세서 (초안 v0.1)

- 작성일: 2026-11-08

- 원본 `ReFind_API_명세서.md`를 장별로 나눈 폴더입니다. 내용은 원본과 같고, 파일마다 맨 위에 요약을 붙였습니다.

## 파일 구성

| 파일 | 원본 장 | 내용 |
|---|---|---|
| [01_공통규칙.md](01_공통규칙.md) | 1 | 주소, 데이터 형식, 응답·에러 형식, 상태 코드, 비동기 작업, 업로드 제한 |
| [02_공통API.md](02_공통API.md) | 2 | 서버 상태, 작업 상태 |
| [03_S1_카메라.md](03_S1_카메라.md) | 3 | 카메라 API 5개 |
| [04_S1_도보그래프.md](04_S1_도보그래프.md) | 4 | 노드·간선 API 7개 |
| [05_S1_위험지역_보행속도.md](05_S1_위험지역_보행속도.md) | 5 | 위험 지역 4개, 보행 속도 2개 |
| [06_S1_영상.md](06_S1_영상.md) | 6 | 영상 API 7개 |
| [07_S1_트랙렛.md](07_S1_트랙렛.md) | 7 | 트랙렛 API 3개 |
| [08_S2_사건.md](08_S2_사건.md) | 8 | 사건 API 5개 |
| [09_S3_검색_후보_판정.md](09_S3_검색_후보_판정.md) | 9 | 검색·후보·판정 API 7개 |
| [10_S4_S5_동선_수색범위_내보내기.md](10_S4_S5_동선_수색범위_내보내기.md) | 10 | 동선, 수색 범위, 내보내기 |
| [11_내부API_GPU서버.md](11_내부API_GPU서버.md) | 11 | 백엔드 → GPU 서버 API 4개 |

## 읽는 순서

1. 01 공통 규칙, 02 공통 API: 모든 API에 해당하는 약속
2. 03~07 (S1): 카메라, 도보 그래프, 위험 지역, 보행 속도, 영상, 트랙렛 준비
3. 08 (S2): 사건 등록
4. 09 (S3): 검색 → 후보 확인 → 판정
5. 10 (S4, S5): 동선, 수색 범위 확인
6. 11: 백엔드 서버와 GPU 서버 사이 내부 API

---

## 12. 엔드포인트 전체 목록

### 외부 API (45개)

| # | 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|---|
| 1 | GET | `/api/health` | 서버 상태 | 200 |
| 2 | GET | `/api/tasks/{task_id}` | 작업 상태 | 200 |
| 3 | GET | `/api/cameras` | 카메라 목록 | 200 |
| 4 | POST | `/api/cameras` | 카메라 등록 | 201 |
| 5 | GET | `/api/cameras/{camera_id}` | 카메라 상세 | 200 |
| 6 | PATCH | `/api/cameras/{camera_id}` | 카메라 보정 | 200 |
| 7 | DELETE | `/api/cameras/{camera_id}` | 카메라 삭제 | 204 |
| 8 | GET | `/api/walk-graph` | 도보 그래프 전체 | 200 |
| 9 | POST | `/api/walk-graph/nodes` | 노드 추가 | 201 |
| 10 | PATCH | `/api/walk-graph/nodes/{node_id}` | 노드 수정 | 200 |
| 11 | DELETE | `/api/walk-graph/nodes/{node_id}` | 노드 삭제 | 204 |
| 12 | POST | `/api/walk-graph/edges` | 간선 추가 | 201 |
| 13 | PATCH | `/api/walk-graph/edges/{edge_id}` | 간선 보정 | 200 |
| 14 | DELETE | `/api/walk-graph/edges/{edge_id}` | 간선 삭제 | 204 |
| 15 | GET | `/api/danger-zones` | 위험 지역 목록 | 200 |
| 16 | POST | `/api/danger-zones` | 위험 지역 등록 | 201 |
| 17 | PATCH | `/api/danger-zones/{zone_id}` | 위험 지역 수정 | 200 |
| 18 | DELETE | `/api/danger-zones/{zone_id}` | 위험 지역 삭제 | 204 |
| 19 | GET | `/api/walking-speeds` | 보행 속도 조회 | 200 |
| 20 | PUT | `/api/walking-speeds/{target_type}` | 보행 속도 설정 | 200 |
| 21 | POST | `/api/videos` | 영상 업로드 | 202 |
| 22 | GET | `/api/videos` | 영상 목록 | 200 |
| 23 | GET | `/api/videos/{video_id}` | 영상 정보 | 200 |
| 24 | PATCH | `/api/videos/{video_id}` | 시각 보정 | 200 |
| 25 | DELETE | `/api/videos/{video_id}` | 영상 삭제 | 204 |
| 26 | POST | `/api/videos/{video_id}/retry` | 분석 재시도 | 202 |
| 27 | GET | `/api/videos/{video_id}/stream` | 재생용 영상 | 200, 206 |
| 28 | GET | `/api/videos/{video_id}/tracklets` | 영상 속 인물 목록 | 200 |
| 29 | GET | `/api/tracklets/{tracklet_id}` | 트랙렛 상세 | 200 |
| 30 | GET | `/api/tracklets/{tracklet_id}/thumbnail` | 대표 이미지 | 200 |
| 31 | POST | `/api/cases` | 사건 등록 | 202 |
| 32 | GET | `/api/cases` | 사건 목록 | 200 |
| 33 | GET | `/api/cases/{case_id}` | 사건 정보 | 200 |
| 34 | PATCH | `/api/cases/{case_id}` | 사건 수정, 종결 | 200 |
| 35 | GET | `/api/cases/{case_id}/photo` | 등록 사진 | 200 |
| 36 | POST | `/api/cases/{case_id}/searches` | 검색 시작 | 202 |
| 37 | GET | `/api/cases/{case_id}/searches` | 검색 이력 | 200 |
| 38 | GET | `/api/cases/{case_id}/searches/{search_id}` | 검색 상세 | 200 |
| 39 | GET | `/api/cases/{case_id}/candidates` | 후보 목록 | 200 |
| 40 | POST | `/api/cases/{case_id}/decisions` | 판정 저장 | 201 |
| 41 | GET | `/api/cases/{case_id}/decisions` | 판정 이력 | 200 |
| 42 | DELETE | `/api/cases/{case_id}/decisions/{decision_id}` | 판정 취소 | 204 |
| 43 | GET | `/api/cases/{case_id}/route` | 동선 | 200 |
| 44 | GET | `/api/cases/{case_id}/search-area` | 수색 범위 | 200 |
| 45 | GET | `/api/cases/{case_id}/export` | 기록 내보내기 | 200 |

### 내부 API (4개)

| # | 메서드 | 경로 | 용도 | 성공 |
|---|---|---|---|---|
| 1 | GET | `/health` | GPU 서버 상태 | 200 |
| 2 | POST | `/jobs/video-analysis` | 영상 분석 요청 | 202 |
| 3 | POST | `/jobs/query-vector` | 사진 특징 추출 요청 | 202 |
| 4 | GET | `/jobs/{job_id}` | 작업 상태와 결과 | 200 |
