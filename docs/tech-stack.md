# ReFind 기술스택 (최종)

- 상태: **최종 정리** (팀 피드백 반영: 백엔드 FastAPI 확정, 벡터 저장·검색 FAISS 확정, 로그인 1차 제외, 진행 상황 전달 단순화)

---

## 0. 전체 구성 한눈에 보기

| **구분** | **기술** | **역할** | **상태** |
| --- | --- | --- | --- |
| Frontend | React 18 + TypeScript (Vite) | 사용자 인터페이스, 결과 시각화 | 선정 |
| Backend | FastAPI | REST API 제공, 비동기 작업 등록, 서비스 로직 관리 | 선정 |
| Image Processing | OpenCV, ffprobe, ffmpeg | 프레임 추출·자르기, 영상 파일 정상 여부 검증, H.264 mp4 웹 스트리밍 변환 | 선정 |
| Database | PostgreSQL 17 + PostGIS | 사건·인물·카메라·검색 기록 저장 및 공간 데이터 연산 | 선정 |
| Vector Storage & Search | FAISS + Docker 볼륨 | 인물 특징 벡터 파일 저장(인덱싱) 및 코사인 유사도 고속 검색 | 선정 (FAISS 확정) |
| Cache / Queue | Redis 7 (+ Celery) | AI 영상 분석 및 경로 계산 작업 대기열, 작업 상태 임시 캐시 | 선정 |
| ORM / Migration | SQLAlchemy 2.0 + Alembic | Python 객체-DB 매핑, DB 스키마 형상 변경 이력 관리 | 선정 |
| Deployment | Docker Compose | 개발·시연 환경 통일 및 멀티 컨테이너 오케스트레이션 | 선정 |
| 진행 상황 전달 | REST 폴링 (주기 조회) | 2~3초 간격 작업 상태 조회 (`GET /api/tasks/{task_id}`) | 선정 (단순화) |
| 사용자 인증 / 로그인 | - | **1차 개발 범위 제외** (단일 관리자 데모 전제, 핵심 기능 완성 후 검토) | 후순위 |

---

### 처리 흐름

```text
[1. 영상 등록 및 사전 분석 (벡터 저장 / 인덱싱)]
React (영상 업로드)
   ↓
FastAPI (파일 수신, DB 기록, 변환/분석 작업 대기열 등록)
   ↓
worker (영상 ffmpeg 변환) → worker-gpu (AI 사전 분석)
   - OpenCV   : 프레임 추출·전처리
   - YOLO → BoT-SORT → Re-ID : 사람 검출, 추적, 대표 특징 벡터 추출
   - FAISS    : 대표 벡터를 FAISS 인덱스 파일에 추가 저장 (Docker 볼륨)
                (인덱스 번호 ↔ 트랙렛 ID 매핑은 PostgreSQL에 저장)

[2. 실종자 검색 및 동선 추적 (벡터 검색)]
React (실종자 사진 및 마지막 목격 정보 등록)
   ↓
FastAPI → worker-gpu (실종자 사진 질의 벡터 생성 → PostgreSQL 저장)
   ↓
worker (후보 검색 - default 큐)
   - NetworkX + PostGIS : 도보 이동 가능 시간·카메라 범위 필터링 (트랙렛 ID 선별)
   - FAISS              : 선별된 트랙렛 벡터를 대상으로 질의 벡터와 코사인 유사도 검색
   ↓
FastAPI (작업 완료 상태 갱신)
   ↑ (2~3초 간격 주기적 조회 - REST Polling)
React (유사도 순 후보 확인, 동선 지도 시각화)
```

---

## 1. 저장소

### 1.1 선정 기술

| **구분** | **선정 기술** | **무엇을, 왜 쓰나** | **대안** | **관련 요구사항** |
| --- | --- | --- | --- | --- |
| 메타 DB | PostgreSQL 17 | **프로그램의 핵심 기록 보관함**<br>- 카메라, 도보 길, 트랙렛(사람 이동 단위), 사건, 판정·부재 기록을 11개 테이블에 저장<br>- 관계형 DB로 데이터 정합성과 외래키 연결 보장 | - | OPR-002 |
| **벡터 저장** | FAISS 인덱스 파일 (Docker 볼륨) | **특징 벡터 영구 저장 (인덱싱)**<br>- AI가 추출한 트랙렛 대표 벡터를 정규화하여 FAISS 인덱스 파일(`.index`)로 로컬 볼륨에 영구 저장<br>- 인덱스 내부 번호와 메타 DB의 트랙렛 ID 매핑 정보를 PostgreSQL에 기록 | pgvector, Qdrant | SYS02-002 OPR-002 |
| **벡터 검색** | FAISS 라이브러리 | **닮은 사람 고속 검색**<br>- 실종자 사진의 질의 벡터와 트랙렛 벡터 간 코사인 유사도(Inner Product) 검색<br>- 도보 시공간 조건으로 걸러진 트랙렛 ID를 대상으로 신속하게 유사 후보 선별 | pgvector, Qdrant | SYS02-002 SYS03-003 |
| 공간 데이터 | PostGIS | **PostgreSQL 공간 확장 기능**<br>- 카메라 좌표(Point), 위험 지역(Polygon), 현재 수색 범위 저장<br>- `ST_Intersects`를 통해 이동 범위와 위험 지역 중첩 판정 | Shapely 단독 | SYS01-001 SYS01-003 SYS04-002 |
| 도보 경로 계산 | NetworkX + Shapely | **정해진 시간 내 도달 범위 계산**<br>- 노드·간선은 DB에 보관, 연산 시 메모리 그래프로 로드하여 Dijkstra 최단 경로 산출<br>- 캠퍼스/단지 규모이므로 DB 내 라우팅 확장 없이 메모리 연산으로 충분 | pgRouting | SYS01-002 SYS03-002 SYS04-002 |
| DB 연결·변경 관리 | SQLAlchemy 2.0, Alembic, GeoAlchemy2 | **Python 코드로 DB 제어 및 스키마 버전 관리**<br>- SQLAlchemy: 테이블 모델 정의 및 쿼리 추상화<br>- GeoAlchemy2: 공간 컬럼(Point, Polygon) 매핑<br>- Alembic: 마이그레이션 이력을 Git으로 추적하여 팀원 간 스키마 통일 | 순수 SQL | OPR-002 |
| 파일 저장소 | Docker 볼륨(로컬 디스크) | **영상·이미지·인덱스 파일 보관**<br>- 원본 영상, H.264 mp4 웹 스트리밍 영상, 썸네일, FAISS 인덱스 파일 보관<br>- DB에는 파일 경로 및 메타데이터만 기록 | MinIO(S3 호환) | SYS01-004 SYS04-001 INT-004 |
| 작업 대기열·임시 저장 | Redis 7 | **비동기 작업 큐 및 캐시**<br>- Celery 작업 큐 브로커 역할 및 작업 상태 임시 캐싱 | RabbitMQ | OPR-004 INT-001 SYS05-003 |

### 1.2 데이터별 저장 위치

| **데이터** | **저장 위치** | **비고** |
| --- | --- | --- |
| 카메라 위치·방향·화각, 보조지점 | 메타 DB (PostgreSQL) | PostGIS Point |
| 도보 그래프 (구간 거리, 시간, 경로 좌표) | 메타 DB (PostgreSQL) | 노드/간선 테이블 |
| 위험 지역 | 메타 DB (PostgreSQL) | PostGIS Polygon |
| 영상 정보 (카메라, 녹화 시작 시각, 분석 상태) | 메타 DB (PostgreSQL) | - |
| 트랙렛 (등장·퇴장 시각, 궤적, 진입·이탈 방향) | 메타 DB (PostgreSQL) | - |
| **트랙렛 대표 임베딩 (Gallery 벡터)** | **FAISS 인덱스 파일 (Docker 볼륨)** | 인덱스 번호 ↔ 트랙렛 ID 매핑은 메타 DB에 저장 |
| **실종자 질의(Query) 벡터** | **메타 DB (PostgreSQL)** | 사건·사진 정보와 함께 저장 (비교 기준용) |
| 보행 속도 기준 (대상자 유형별) | 메타 DB (PostgreSQL) | 초기 기준 데이터 |
| 사건, 판정 기록, 부재 정보 | 메타 DB (PostgreSQL) | - |
| 원본 영상, 재생용 영상, 썸네일 | 파일 저장소 (Docker 볼륨) | DB에는 파일 경로만 저장 |
| 분석 작업 상태 및 진행률 | Redis | 임시 상태 데이터 (Task ID 기준) |

### 1.3 FAISS 벡터 저장 및 검색 운영 방안

1. **저장(인덱싱) 및 검색 주체 분리**:
   - **벡터 저장(추가)**: 영상 사전 분석을 수행하는 `worker-gpu`가 트랙렛 대표 벡터를 FAISS 인덱스 파일에 추가하고 디스크에 영구 저장합니다.
   - **벡터 검색**: 실종자 검색 시에는 GPU가 필요 없으므로 도보 경로 계산을 담당하는 일반 `worker` (CPU, default 큐)가 FAISS 인덱스를 메모리에 읽어와 코사인 유사도를 검색합니다.
2. **시공간 필터링 결합 방식**:
   - FAISS 전체를 단순 검색하지 않고, PostgreSQL/PostGIS에서 "도보로 도달 가능한 카메라와 시간대"에 속한 트랙렛 ID들을 먼저 추출한 뒤, 해당 ID들의 벡터만을 대상으로 FAISS 유사도 검색을 수행합니다.
3. **인덱스 종류 및 백업**:
   - 초기 데이터 규모에서는 정확 탐색 방식인 `IndexFlatIP`(정규화 내적 = 코사인 유사도)를 기본으로 사용합니다.
   - 백업 시에는 PostgreSQL 덤프 파일(`pg_dump`)과 FAISS 인덱스 파일(`.index`)을 함께 백업해야 데이터 정합성이 유지됩니다.

---

## 2. 프론트엔드

### 2.1 선정 기술

| **구분** | **선정 기술** | **적용 방식 및 선정 이유** | **대안** | **관련 요구사항** |
| --- | --- | --- | --- | --- |
| 빌드·언어 | Vite + React 18 + TypeScript | 빠른 개발 서버 및 정적 타입 안정성 확보 | Create React App | INT-001 |
| 라우팅 | React Router 6 | 화면별 URL 라우팅 및 페이지 전환 | - | INT-001 |
| 서버 상태 | TanStack Query 5 | API 응답 캐싱, `refetchInterval`을 활용한 2~3초 간격 작업 상태 폴링 | SWR | SYS04-004 |
| UI 상태 | Zustand | 선택 사건, 활성화된 후보 카드, 지도 상호작용 등 전역 상태 관리 | Redux Toolkit | - |
| UI 컴포넌트 | Ant Design 5 | 테이블, 폼, 파일 업로드, 슬라이더, 모달 등 관제 UI 구성 | MUI | INT-001 |
| 지도 | react-kakao-maps-sdk | 카메라 마커, 화각 부채꼴, 도보 경로 Polyline, 위험 구역 폴리곤 시각화 | react-leaflet | SYS01-001 SYS04-001 |
| 타임라인 | 1차: 시간순 목록 카드 → 2차: vis-timeline | 시간순 후보 장면 나열 및 클릭 시 해당 영상 위치 재생 | 직접 구현 | SYS04-001 |
| 영상 재생 | HTML5 video | HTTP Range 요청을 활용해 트랙렛 등장 시각부터 즉시 탐색/재생 | - | SYS04-001 |
| API 타입 | openapi-typescript | FastAPI의 OpenAPI 문서로부터 TypeScript 인터페이스 자동 추출 | 수동 작성 | INT-001 |

---

## 3. 백엔드

### 3.1 선정 기술

| **구분** | **기술** | **적용 방식** | **상태** | **관련 요구사항** |
| --- | --- | --- | --- | --- |
| 웹 프레임워크 | FastAPI | 비동기 지원, 고성능 REST API 및 Swagger 문서 자동화 | 확정 | OPR-001 |
| 입력 검증·API 문서 | Pydantic + OpenAPI | 요청 파라미터 유효성 검증 및 API 문서 자동 생성 | 확정 | INT-001 |
| 사용자 인증 / 로그인 | - | **1차 개발 범위 제외** (단일 사용자 데모 전제) | 후순위 | SEC-001 |
| 영상 업로드 처리 | FastAPI 업로드 + 백그라운드 변환 | 업로드 파일 수신 후 워커에 변환 위임, ffprobe로 검증 | 확정 | SYS01-004 INT-004 |
| 비동기 작업 | Celery + Redis | analysis 큐(GPU: 사전 분석) / default 큐(CPU: 변환, 경로, 검색) 분리 | 확정 | OPR-004 OPR-005 |
| 진행률·완료 확인 | REST 폴링 (주기 조회) | `GET /api/tasks/{task_id}`로 상태(`PENDING`, `PROGRESS`, `SUCCESS`) 확인 | 확정 (단순화) | INT-001 SYS05-003 |
| 외부 API 연동 | 카카오맵 SDK 등 | 주소-좌표 변환 및 지도 타일 연동 (API 키는 `.env`로 관리) | 확정 | INT-003 CON-003 |
| 결과 재계산 | Celery default 큐 | 사용자 판정(동일인 확정 등) 후 도보 경로 및 수색 구역 재계산 | 확정 | SYS04-004 DATA-001 |

### 3.2 항목별 정리 및 단순화 방안

| **번호** | **항목** | **결정** | **무엇을, 왜 쓰나** |
| --- | --- | --- | --- |
| 3 | 진행률·완료 알림 | **REST 주기 조회 (폴링)** | 복잡한 실시간 연결(SSE/WebSocket) 대신 프론트엔드가 2~3초 간격으로 Task 상태를 확인하여 구현 단순화. |
| 4 | 로그인·인증 | **1차 개발 제외 (후순위)** | 핵심 AI 분석 및 동선 추적 파이프라인 개발에 집중. 데모 단계에서는 별도 로그인 없이 전체 기능 접근. |
| 8 | 서버 데이터 관리 | **TanStack Query** | REST API 응답 캐싱 및 `refetchInterval` 옵션으로 간편한 폴링 구현. |
| 9 | 화면 내부 상태 | **Zustand** | 후보 카드 선택 시 지도 위치 표시와 비디오 재생이 동기화되도록 전역 상태 공유. |
| 12 | 타임라인 | **1차: 시간순 목록 → 2차: vis-timeline** | 1차에서는 단순 시간순 카드로 빠르게 기능을 완성하고, 추후 필요 시 인터랙티브 타임라인 라이브러리 도입. |
| 13 | 영상 파일 전달 | **FastAPI 직접 전달 또는 nginx 정적 서빙** | 로그인이 제외되어 권한 검사가 단순화되었으므로, Range 요청(탐색 재생)을 지원하는 방식으로 파일 서빙. |

---

## 4. AI 파이프라인

**※ 이 장의 AI 모델은 현재 테스트 및 검증 진행 중입니다.**

### 4.1 후보 및 테스트 대상 기술

| **구분** | **테스트 대상** | **역할 및 테스트 내용** | **비교 후보** | **상태** | **관련 요구사항** |
| --- | --- | --- | --- | --- | --- |
| 사람 검출 | Ultralytics YOLO11n | 영상 내 인물 바운딩 박스 검출 (경량 모델 우선 시험) | YOLO26n | 테스트 중 | SYS02-001 PER-004 |
| 카메라 내 추적 | BoT-SORT | 움직임 및 외형 기반 동일 카메라 내 인물 트랙렛 유지 | - | 테스트 중 | SYS02-001 |
| Re-ID 모델 | SigLIP SO400M | 인물 이미지를 임베딩 벡터로 변환 (1,152차원) | OSNet, person-reid-retail | 테스트 중 | PER-001 TEST-002 |
| 트랙렛 대표 벡터 | NumPy, PyTorch | 트랙렛 내에서 가림이 적고 선명한 프레임 선별 후 대표 벡터 추출 | - | 테스트 중 | SYS02-002 |
| 추론 런타임 | PyTorch + CUDA | NVIDIA GPU 가속 추론 | OpenVINO | 테스트 중 | PER-002 |
| 영상 디코딩·검증 | OpenCV, ffprobe | 프레임 디코딩, 인물 영역 Crop, 메타데이터 검증 | - | 사용 | INT-004 REL-001 |
| 입력 방식 | 녹화 영상 | 실시간 RTSP 대신 녹화 영상 배치 분석에 집중 | - | 확정 | SYS05-001 OPR-006 |
| 성능 측정 | Rank-1 · mAP | 테스트 데이터셋 기준 모델 간 검색 정확도 및 추론 속도 비교 | - | 테스트 기준 | PER-001 TEST-002 |

---

## 5. 인프라

### 5.1 컨테이너 구성 (Docker Compose)

| **서비스** | **역할** | **기반 이미지** | **GPU** |
| --- | --- | --- | --- |
| web | React 빌드 파일 정적 서빙, 리버스 프록시 | nginx (빌드: node:22) | - |
| api | FastAPI REST API 서버, 작업 등록, 상태 응답 | python:3.11-slim (ffmpeg 설치) | - |
| worker-gpu | 사전 분석 (YOLO 검출, BoT-SORT 추적, Re-ID 특징 추출, **FAISS 인덱싱/저장**) | pytorch/pytorch (CUDA) | **사용** |
| worker | 영상 ffmpeg 변환, 도보 경로 계산, **FAISS 코사인 유사도 검색** (default 큐) | python:3.11-slim (ffmpeg 설치) | - |
| db | 사건/카메라/트랙렛 메타데이터 및 PostGIS 공간 데이터 저장 | postgis/postgis:17 | - |
| redis | Celery 작업 큐 브로커, 작업 상태 캐시 | redis:7 | - |
