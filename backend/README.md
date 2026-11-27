# LEFT 백엔드

FastAPI + PostgreSQL(PostGIS, pgvector) + Redis + Celery. API 계약은 docs 브랜치 `docs/api/openapi.json`(1.1.0)이다.

## 구성

| 서비스 | 역할 | 이미지 |
|---|---|---|
| db | PostgreSQL 18 + PostGIS 3.6 + pgvector | `infra/db/Dockerfile` |
| redis | Celery 작업 대기열, 작업 진행 임시 저장 | redis:7.4-alpine |
| api | REST API(`/api/...`), 문서 `/api/docs` | `backend/Dockerfile` |
| worker-cpu | default 대기열: 사진 질의 특징 추출(OpenVINO), 후보 검색, 도보 경로, 영상 변환 | `backend/Dockerfile` + `requirements-cpu-worker.txt` |
| worker-gpu | analysis 대기열: 영상 사전 분석(YOLO26n + ByteTrack + Intel Re-ID) | `backend/Dockerfile.gpu`(requirements-model.lock) |

- DB와 Redis는 서버 안(127.0.0.1)에서만 열린다. API도 기본은 127.0.0.1이고, 밖에 열 때 `.env`의 `API_BIND`를 바꾼다.
- 영상·썸네일·스냅샷은 `MEDIA_ROOT_HOST`(기본 `./data/media`)에 두고, DB에는 이 폴더 기준 **상대 경로**만 저장한다.
- 모델 가중치(`모델벤치/yolo26n.pt`, `모델벤치/models/...`)는 워커에 마운트한다. Git LFS로 받아 둬야 한다.

## 서버에서 처음 실행

```bash
git switch backend && git pull
git lfs pull --include="모델벤치/*.pt,모델벤치/models/**"
scripts/left.sh gpu-check            # 컨테이너에서 GPU가 보이는지(NVIDIA Container Toolkit 필요)
scripts/left.sh init                 # .env 생성(비밀값 자동, 화면에 출력 안 함)
# 카카오 REST 키는 .env의 KAKAO_REST_API_KEY=에 직접 적는다
scripts/left.sh up                   # 빌드 후 전체 실행
scripts/left.sh migrate              # 스키마 생성(Alembic)
scripts/left.sh create-admin admin 관리자   # 임시 비밀번호를 한 번만 출력
scripts/left.sh seed-demo-settings   # 시연용 임시 설정값(팀 확정값 아님)
scripts/left.sh check                # /api/health + CPU·GPU 워커 왕복
```

1단계 완료 기준: `/api/health`가 200(db·redis ok, postgis·vector 확장 확인), `check`에서 두 워커가 응답하고 GPU 워커의 `cuda.available`이 true.

## DB 스키마(20개 테이블)

`backend/app/models.py`가 기준이고, 초기 마이그레이션 SQL은 `tools/dump_schema_sql.py`로 만든다(`alembic/versions/0001_initial.sql`). 모델 브랜치의 `db/001·003·004 SQL`은 이 스키마로 대체됐다(기록용으로 남김).

| 묶음 | 테이블 | 비고 |
|---|---|---|
| 계정 | users, sessions | 역할 user/admin, 비활성화, 첫 로그인 비밀번호 변경. 세션 토큰은 해시로만 저장 |
| 지도 | nodes, cameras, route_edges, hazard_zones | 사건 전용 카메라는 nodes.scope='case'. 도보 구간에 우회 의심·보정 계수. 위험 지역 kind·severity |
| 영상 | videos, tracklets, tracklet_embeddings | 분석 단계·진행률·보관 상태. 트랙렛 궤적은 `[offset_s, x, y, w, h]` |
| 수색 | cases, case_assignees, search_runs, search_candidates, decisions, watch_alerts | 질의·조건 버전, 검색 스냅샷과 stale 판정, 예/아니오/보류 + 번복(지우지 않음), 트랙렛당 유효 판단 1개 |
| 운영 | tasks, idempotency_keys, audit_logs, system_settings, retention_policy | 202 작업 상태, 멱등 키(24시간), 이용 기록, 한 줄짜리 설정 두 개 |

모델 브랜치 스키마에서 바뀐 점:

- decisions: `confirmed/absent` → `confirmed/rejected/deferred` + `status(active/reversed)`, 번복 정보, 재확인 필요, 의존 판단, 버전
- cases: 사건을 먼저 만들고 기준 대상을 나중에 정하도록 질의 칸을 선택 항목으로, 상태 `open/closed` + 종료 결과, `person_type`에 other
- hazard_zones: kind 값을 API와 맞추고 severity·description 추가
- 모든 수정 대상에 `version`(낙관적 잠금)

## 공통 규칙(3단계)

| 규칙 | 위치 | 내용 |
|---|---|---|
| 인증 | `app/auth.py` | 쿠키 `refind_session`(HttpOnly, SameSite=Lax, 서버에 해시만 저장). 60분 안 쓰면 401 `SESSION_EXPIRED`, 최대 12시간 |
| CSRF·Origin | `app/auth.py` | GET 외 요청은 `X-CSRF-Token` + 허용 Origin(`ALLOWED_ORIGINS`), 틀리면 403 `CSRF_INVALID` |
| 첫 로그인 | `app/auth.py` | `must_change_password`면 `/auth/me·password·logout`만, 나머지 403 `PASSWORD_CHANGE_REQUIRED` |
| 권한 | `app/auth.py` | `require_user`, `require_admin`, `load_case`(맡지 않은 사건은 404), `ensure_case_open`(409 `CASE_CLOSED`) |
| 버전 | `app/common.py` | `check_version` → 409 `VERSION_CONFLICT` + `context.current_version` |
| 목록 | `app/common.py` | `keyset_page`: 정렬 키 + ID keyset, 서명된 불투명 cursor(필터가 바뀌면 거절), limit 기본 30·최대 100 |
| 멱등 키 | `app/common.py` | `Idempotency.begin/complete`: 같은 사용자·작업·키·본문이면 저장한 응답 재전송, 본문이 다르면 409 `IDEMPOTENCY_KEY_REUSED`, 24시간 보관 |
| 이용 기록 | `app/common.py` | `record_audit`(같은 트랜잭션), `record_audit_detached`(로그인 실패 등 롤백돼도 남길 것) |
| 로그인 제한 | `app/common.py` | 같은 IP·아이디 15분 10회 실패 → 429 `RATE_LIMITED` + `Retry-After` |
| 응답 모양 | `app/schemas_gen.py` | `openapi/openapi.json`(docs 브랜치 복사본)에서 생성. `tools/gen_schemas.sh`로 다시 만든다 |

구현한 API: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password`, `GET /api/tasks/{task_id}`.

## 개발(로컬)

```bash
# DB 없는 테스트(아무 Python 3.12+)
py -3.13 -m venv .venv && .venv/Scripts/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
# 실제 PostgreSQL 테스트: pgserver(내장 PostgreSQL + pgvector)가 3.11 휠만 있어 3.11 가상환경을 쓴다
py -3.11 -m venv .venv311 && .venv311/Scripts/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd backend && ../.venv311/Scripts/python -m pytest
```

- pgserver에는 PostGIS가 없어서 테스트 DB는 geography 칸을 bytea로 바꿔 만든다(`tests/conftest.py`). 좌표 계산 테스트는 서버 DB로 돌린다: `TEST_DATABASE_URL=postgresql+psycopg://... pytest`
- pgserver가 없으면 DB 테스트(`@pytest.mark.db`)는 건너뛴다.
