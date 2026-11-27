# 원격 서버 모델 실행

현재 시연 검증: **전체 프레임 추적 → ID별 초당 대표 썸네일 → PostgreSQL 트랙렛 저장 → 사진 Rank-5 검색·시각화**까지 완료했습니다. 바로 실행하는 방법은 아래 「트랙렛 DB 검색 시연」을 확인하세요.

프로젝트 루트의 Python 3.12 가상환경(`.venv`)에서 YOLO26n + Intel Re-ID retail-0287을 실행합니다. Intel Re-ID는 OpenVINO CPU를 사용하며 YOLO는 CUDA 사용 가능 시 GPU를 선택합니다.

```bash
cd /home/refind-ai/workspace/capstone
./run-model.sh
# 명시적으로 GPU 또는 CPU 선택
./run-model.sh --device 0
./run-model.sh --device cpu
# 입력 지정 (상대 경로는 프로젝트 루트 기준)
./run-model.sh --video 모델벤치/video_1.mp4 --image 모델벤치/person_1.png
./run-model.sh --help
```

기본 입력은 `모델벤치/video_1.mp4`, `모델벤치/person_3.png`입니다. 기본적으로 1초마다 검사하며 결과는 `runs/model/`의 실행별 폴더에 저장됩니다. 기존 벤치마크 결과는 덮어쓰지 않습니다. 실행은 영상 내 인물 검색 벤치마크이며 DB·Redis·API에 연결하지 않습니다.

## 환경 재구성

uv가 설치된 환경에서 다음 명령으로 같은 의존성을 설치할 수 있습니다.

```bash
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python requirements-model.lock
```

영상·가중치는 Git LFS 파일입니다. 새로 복제한 환경에서는 Git LFS 설치 후 `git lfs pull`이 필요합니다. 이 서버의 실행에 필요한 파일은 기존 서버 사본의 SHA-256과 LFS 포인터를 대조하여 복원했습니다. 과거 실험 결과 및 추가 영상의 LFS 파일은 모두 내려받은 상태는 아닙니다.

## 서버 검증 결과

샘플 기본 입력을 `--device 0`으로 실행해 정상 종료를 확인했습니다. RTX 5060에서 YOLO 검출, CPU에서 Intel Re-ID를 수행했고 596개의 256차원 유한·L2 정규화 벡터와 후보 이미지 5개를 저장했습니다. 1초 간격 검사에서 검색은 약 3.82초, 준비를 포함한 전체는 약 10.45초였습니다. 이는 해당 샘플의 실행 측정이며 실시간 다중 카메라 처리량이나 검색 정확도 평가는 아닙니다.

## PostgreSQL + PostGIS + pgvector

업무용 11개 테이블은 `db/001_schema.sql`에 정의되어 있습니다. `003_tracklet_samples.sql`은 초당 썸네일과 분석 메타데이터 컬럼을 추가합니다. `004_remove_benchmark.sql`은 폐기한 실험용 스키마를 제거하는 마이그레이션입니다. PostGIS의 `spatial_ref_sys`는 확장이 관리하므로 유지합니다.

Docker 권한이 있는 계정에서 새 DB는 다음으로 기동합니다.

```bash
python3 scripts/init_db_env.py
docker compose up --build -d --wait
```

초기화 SQL은 빈 볼륨 최초 기동 시에만 자동 적용합니다. 기존 DB에는 필요한 마이그레이션을 별도로 적용하며 볼륨을 삭제하지 않습니다. 현재 사용 중인 로컬 검증 DB의 접속과 모델 저장·검색 방법은 아래를 따르세요.

## 트랙렛 DB 검색 시연

### 현재 완료된 검증

`video_1.mp4`의 1,767프레임을 모두 YOLO26n + ByteTrack으로 추적했습니다. ID 500개, 썸네일 2,326개가 생성됐으며 `video_id=1`의 `videos → tracklets → tracklet_embeddings`에 저장했습니다. **500은 추적 구간 ID 수이며 실제 인원수가 아닙니다.** 추적 단절·ID 전환으로 같은 사람이 여러 트랙렛에 나타날 수 있습니다. Re-ID 유사도 검색 동작을 확인한 결과이며 정답 기반 정확도 검증은 아직 하지 않았습니다.

- 매 ID의 매 영상 초 구간 `[s, s+1)`에 나타난 박스 중 `신뢰도 × √픽셀 면적 × log(1+Laplacian 선명도)`가 가장 높은 인물 영역을 JPEG 썸네일로 선택합니다. 등장하지 않은 초에는 썸네일을 만들지 않습니다.
- **저장된 JPEG 자체**를 Intel Re-ID retail-0287에 넣어 256차원 L2 정규화 벡터를 추출합니다. 썸네일 벡터들을 ID별로 평균한 뒤 다시 정규화해 DB에 한 벡터씩 저장합니다.
- 모든 썸네일 경로·시각·박스·신뢰도는 `tracklets.thumbnail_samples`에 저장합니다. 대표 썸네일은 그중 품질 점수가 가장 높은 것입니다. 초별 개별 벡터는 분석 폴더의 `embeddings.npz`에도 남습니다.
- 사용자가 승인한 시연용 값: 녹화 기준 `2026-11-16T09:00:00+09:00`, 가상 위치 `(경도 127, 위도 37)`, 방향 0°, 화각 90°. `analysis_metadata.demo_metadata=true`, 카메라명 `DEMO`로 실제 카메라 정보와 구분했습니다. 진입·이탈 노드는 카메라 연결 정보가 없어 NULL입니다.
- 기본 검증 사진은 `person_3.png`입니다. 사진은 인물 한 명을 자른 이미지로 입력합니다. 질의 벡터는 파일에 저장하고, 검색 후보는 같은 모델의 **DB 벡터**에서 정확 코사인 검색으로 가져옵니다. 순위는 트랙렛별이며 상위 5개 트랙 ID를 반환합니다.

### 다른 사진 넣기

```bash
cd /home/refind-ai/workspace/capstone
# 로컬 검증 DB가 꺼져 있을 때
.venv/bin/python scripts/local_db.py start
# 이미 저장한 video_id=1에서 검색: 인물만 잘라낸 사진
./search-person.sh --image 모델벤치/person_3.png --video-id 1
./search-person.sh --image /절대경로/내사진.jpg --video-id 1
# 사람이 포함된 전체 사진: 여러 명이면 가장 큰 사람부터 0, 1, ... 지정
./search-person.sh --image /절대경로/전체사진.jpg --video-id 1 --detect-person --person-index 0
```

각 검색은 `runs/search/query_*/`에 `rank5.html`, `rank5.png`, `results.json`, `query.jpg`, `query_vector.npy`를 생성합니다. HTML은 이미지가 내장된 단일 파일이므로 로컬로 내려받아 브라우저에서 열 수 있습니다. PNG에서도 질의 사진, Rank, 추적 ID, 유사도, 영상 내 등장 초를 함께 볼 수 있습니다. 유사도는 동일인 확률이 아닙니다.

현재 검증 보고서:

- `runs/search/query_2c2793a4a1ff/rank5.html`
- `runs/search/query_2c2793a4a1ff/rank5.png`

### 영상 분석부터 다시 실행

```bash
.venv/bin/python scripts/tracklet_pipeline.py analyze \
  --video 모델벤치/video_1.mp4 --device 0 --demo \
  --recorded-start 2026-11-16T09:00:00+09:00
# 위 명령이 출력한 분석 폴더를 등록 (영상 분석 재실행 없이 재등록 가능)
.venv/bin/python scripts/local_db.py run .venv/bin/python \
  scripts/tracklet_pipeline.py ingest runs/tracklets/tracklets_분석ID
# ingest가 출력한 video_id를 검색에 지정
./search-person.sh --image 모델벤치/person_3.png --video-id 1
```

현재 저장된 분석 폴더는 `runs/tracklets/tracklets_30d2440934ed`입니다. 같은 분석 폴더의 중복 등록은 기존 video_id를 반환하며, 다른 분석 실행은 새 영상 레코드로 저장합니다. 실제 데이터는 `--demo`를 빼고 정확한 녹화 시각을 입력한 다음, 등록된 실제 카메라의 `--camera-id`로 ingest해야 합니다. 재분석 시 기존 확인 기록을 자동 삭제하지 않습니다.

### 검증용 PostgreSQL과 Docker 차이

Docker 소켓 권한이 없어 이번 검증에는 **프로젝트 내부 사용자 소유 PostgreSQL 18.6 + PostGIS 3.6.2 + pgvector 0.8.1**을 사용했습니다. Ubuntu 패키지를 `.runtime/pg-root`에 풀어 실행했으며 시스템 패키지 설치·권한 변경·시스템 서비스 등록은 하지 않았습니다. 이 방식의 확장 경로 설정은 [PostgreSQL 공식 문서](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-EXTENSION-CONTROL-PATH)를 따릅니다.

DB 데이터는 `.runtime/pgdata`에 유지됩니다. **이 디렉터리는 캐시가 아니라 DB 데이터이므로 삭제하지 마세요.** `runs/tracklets`의 썸네일·분석 파일도 DB가 참조하므로 보존해야 합니다. DB는 권한 0700인 `.runtime/pgsocket`과 서버 내부 주소 `127.0.0.1:55432`를 사용합니다. pgAdmin은 SSH 터널로 연결합니다. 재부팅 후에는 `start`로 다시 실행합니다.

```bash
.venv/bin/python scripts/local_db.py status
.venv/bin/python scripts/local_db.py stop
.venv/bin/python scripts/local_db.py start
# 같은 Ubuntu 26.04 환경에 처음 구성할 때만 (시스템 패키지를 설치하지 않음)
.venv/bin/python scripts/setup_local_db.py
```

Docker의 PostgreSQL 17 구성은 별도로 남아 있으며 아직 빌드·기동 검증하지 못했습니다. Docker로 옮길 때는 데이터 덤프/복원을 포함한 별도 이전 작업이 필요합니다. `tracklet_pipeline.py ingest/query`는 `DATABASE_URL`을 지정하면 다른 PostgreSQL에도 연결할 수 있습니다. `search-person.sh`는 현재 로컬 검증 DB를 사용하도록 만든 실행기입니다.

이미 초기화한 Docker DB에는 `003_tracklet_samples.sql`을 별도 마이그레이션으로 적용해야 합니다. 새 Docker 볼륨은 남아 있는 SQL을 번호순으로 자동 적용합니다. 추가된 컬럼은 `videos.analysis_key/analysis_metadata`, `tracklets.thumbnail_samples`이며 업무 테이블은 11개를 유지합니다.

### 재현 가능한 검증

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_tracklet_pipeline.py'
.venv/bin/python scripts/local_db.py run .venv/bin/python scripts/verify_tracklet_db.py \
  runs/tracklets/tracklets_30d2440934ed --video-id 1 \
  --query-output runs/search/query_2c2793a4a1ff
```

검증 완료: 입력 검사 6개, PostGIS 거리 연산·pgvector 확장, 동일 결과 재등록, 500개 DB 벡터와 실제 썸네일 평균의 일치, 2,326개 ID/초 썸네일 메타데이터 일치, DB Rank-5와 독립 NumPy 코사인 검색의 일치.
