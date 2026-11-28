# LEFT

CCTV 영상에서 실종자 후보를 찾고, 담당자의 확인을 바탕으로 이동 경로와 수색 범위를 정리하는 캡스톤 디자인 프로젝트입니다.

## 서비스 흐름

| 단계 | 담당자와 입력 | 처리와 결과 |
| --- | --- | --- |
| 1. 수색 환경 준비 | 관리자가 카메라 위치, 도보 경로, 위험 지역, 녹화 영상을 등록 | 영상에서 사람을 검출·추적하고 인물 특징을 저장 |
| 2. 사건과 대상 등록 | 수색 담당자가 사건과 사진 또는 영상 속 인물을 등록 | 검색 기준 인물과 마지막 목격 정보를 설정 |
| 3. 후보 검색과 확인 | 시스템이 이동 가능한 카메라·시간대의 후보를 찾고 담당자가 예·아니오·보류로 판단 | 확인 기록을 남기고 확정된 장면을 기준으로 후속 검색 |
| 4. 동선과 수색 범위 확인 | 담당자가 확정 장면을 검토 | 타임라인, 지도 경로, 현재 위치 범위와 위험 지역 겹침을 확인 |
| 5. 출현 감시 | 담당자가 감시를 시작하고 알림을 확인 | 새 출현 후보를 확인한 결과를 동선에 반영 |

시공간 조건으로 검색 대상을 좁히고, 유사도 결과를 사람이 확인하는 흐름을 중심으로 설계했습니다. 상세 권한, 예외, 상태 변화는 [기능 요구사항](https://github.com/gyeongsu666/capstone/blob/docs/docs/requirements.md)과 [API 명세](https://github.com/gyeongsu666/capstone/blob/docs/docs/api/README.md)를 참고하세요.

## 저장소 구성과 현재 상태

이 저장소는 브랜치별로 작업을 관리합니다. GitHub 기본 브랜치인 `main`에는 프로젝트 소개가 있으며, 실행 코드는 아래 브랜치에 있습니다.

| 브랜치 | 내용 | 확인할 문서 |
| --- | --- | --- |
| [frontend](https://github.com/gyeongsu666/capstone/tree/frontend) | React 화면과 MSW 기반 시연 데이터. 백엔드와의 실제 연결은 아직 완료되지 않음 | [프론트엔드 실행 안내](https://github.com/gyeongsu666/capstone/blob/frontend/README.md) |
| [backend](https://github.com/gyeongsu666/capstone/tree/backend) | FastAPI, 데이터베이스, 작업 큐, 영상 분석·검색·감시 코드 | [백엔드 실행 안내](https://github.com/gyeongsu666/capstone/blob/backend/backend/README.md), [서버 검증 기록](https://github.com/gyeongsu666/capstone/blob/backend/README_SERVER.md) |
| [model](https://github.com/gyeongsu666/capstone/tree/model) | 영상 분석과 인물 재식별 벤치마크 | [모델 실행 안내](https://github.com/gyeongsu666/capstone/blob/model/README_MODEL.md) |
| [docs](https://github.com/gyeongsu666/capstone/tree/docs) | 요구사항, 기술 문서, OpenAPI 명세 | [문서 폴더](https://github.com/gyeongsu666/capstone/tree/docs/docs) |

프론트엔드의 지도·경로·현재 위치 범위와 알림은 MSW 시나리오 데이터로 시연할 수 있습니다. 이 화면의 결과를 실제 CCTV 분석 결과나 실시간 현장 검증 결과로 해석하지 않아야 합니다. 백엔드 코드와 프론트엔드 화면의 통합 동작은 별도 확인이 필요합니다.

## 기술 구성

| 영역 | 현재 브랜치에서 확인한 기술 |
| --- | --- |
| 프론트엔드 | React 18, TypeScript, Vite, React Router, Ant Design, TanStack Query, Zustand, MSW |
| 백엔드와 작업 처리 | FastAPI, Celery, Redis |
| 영상 분석·재식별 | YOLO26n, ByteTrack, Intel person-reidentification-retail-0287, OpenVINO |
| 데이터베이스 | PostgreSQL, PostGIS, pgvector |
| 지도 | 카카오맵 JavaScript SDK |
| 실행 환경 | Docker Compose, Python 모델 실행 환경 |

기술 문서의 일부 초기 선정안과 현재 코드가 다릅니다. 예를 들어 [기술 스택 문서](https://github.com/gyeongsu666/capstone/blob/docs/docs/tech-stack.md)는 FAISS를 설명하지만, 현재 `backend` 브랜치는 pgvector 기반 검색을 안내합니다. 도보 경로 제공 방식도 [백엔드 안내](https://github.com/gyeongsu666/capstone/blob/backend/backend/README.md)에 팀 확정이 필요한 항목으로 기록돼 있습니다.

## 프론트엔드 시연

Node.js 22.12 이상 또는 20.19 이상과 카카오 JavaScript 키가 필요합니다. 카카오 개발자 설정에서 `http://localhost:5173`을 JavaScript SDK 도메인으로 등록해야 지도가 표시됩니다.

```bash
git clone -b frontend https://github.com/gyeongsu666/capstone.git
cd capstone
npm install
```

`.env.example`을 복사해 `.env.local`을 만들고 카카오 키와 MSW 사용 설정을 입력합니다. 이 파일은 저장소에 올리지 않습니다.

```dotenv
VITE_KAKAO_MAP_KEY=카카오_JavaScript_키
VITE_USE_MOCK=true
VITE_API_BASE_URL=/api
```

```bash
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다. 시연 계정, 화면별 둘러보기, 지도 데이터의 범위는 [프론트엔드 README](https://github.com/gyeongsu666/capstone/blob/frontend/README.md)에 있습니다.

## 백엔드와 모델

백엔드는 PostgreSQL·Redis·API·CPU/GPU 작업자를 포함하는 Docker Compose 구성입니다. 모델 가중치와 영상 등 대용량 파일은 Git LFS를 사용합니다. 서버 준비와 실행 순서는 [백엔드 README](https://github.com/gyeongsu666/capstone/blob/backend/backend/README.md), 영상 분석·DB 검색 방법은 [서버 README](https://github.com/gyeongsu666/capstone/blob/backend/README_SERVER.md), 모델 비교 방법은 [모델 README](https://github.com/gyeongsu666/capstone/blob/model/README_MODEL.md)를 따르세요.

서버 README에는 단일 샘플 영상을 분석해 트랙렛과 특징 벡터를 DB에 저장하고 사진으로 상위 5개 트랙렛을 조회한 검증 결과가 있습니다. 트랙렛 ID는 실제 인원수나 카메라 간 동일인 식별 결과를 뜻하지 않습니다. 정답 데이터에 기반한 검색 정확도와 다중 카메라 처리 성능은 아직 검증 결과로 제시되지 않았습니다.

## 관련 문서

- [기능 요구사항](https://github.com/gyeongsu666/capstone/blob/docs/docs/requirements.md)
- [OpenAPI 명세](https://github.com/gyeongsu666/capstone/blob/docs/docs/api/openapi.json)
- [프론트엔드 API 요청서](https://github.com/gyeongsu666/capstone/blob/docs/docs/api/frontend-api-requests.md)
- [모델·서버 검증 기록](https://github.com/gyeongsu666/capstone/blob/backend/README_SERVER.md)

## 팀원

| 이름 | GitHub |
| --- | --- |
| 김경수 | [@gyeongsu666](https://github.com/gyeongsu666) |
| 이현강 | - |
| 전수빈 | - |
