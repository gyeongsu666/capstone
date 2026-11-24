# 모델 코드 통합

서버의 트랙렛 DB 파이프라인과 Windows에서 사용한 최신 다섯 조합 벤치마크를 한 저장소에서 관리합니다. `모델벤치/search_benchmark.py`의 IntelEncoder를 벤치마크와 `scripts/tracklet_pipeline.py`가 함께 사용합니다.

| 목적 | 실행 파일 | 검색 결과의 단위 |
|---|---|---|
| 다섯 조합 비교 | `scripts/run_benchmarks.py` | 샘플링한 프레임별 최고 후보 장면 |
| 영상 사전분석 | `scripts/tracklet_pipeline.py analyze` | 전체 프레임의 ByteTrack ID |
| 분석 결과 DB 등록 | `scripts/tracklet_pipeline.py ingest` | 트랙렛과 ID별 평균 벡터 |
| 저장된 영상에서 사진 검색 | `scripts/tracklet_pipeline.py query` | 한 영상의 상위 5개 트랙 ID |

벤치마크에는 YOLO11n/YOLO26n × SigLIP/Intel의 네 조합과 YOLO26n + ONNX Re-ID 조합이 있습니다. 트랙렛 DB 검색은 YOLO26n + Intel만 사용합니다. 벡터 모델끼리 혼용하지 않습니다. 트랙 ID는 실제 사람의 전역 식별자가 아닙니다.

## 파일과 환경 준비

영상·가중치·NumPy 벡터·ONNX 가중치는 Git LFS로 관리합니다.

```text
git lfs install
git lfs pull
```

Ubuntu 서버의 Intel 환경은 `README_SERVER.md`의 `requirements-model.lock`을 사용합니다. Windows에서 새 가상환경을 만들고 다섯 조합과 DB 도구의 의존성을 설치하는 예시는 다음과 같습니다. 벤치마크 의존성 목록은 버전을 고정한 서버 잠금 파일과 별도로 관리합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-benchmark.txt "psycopg[binary]" pgvector
.\.venv\Scripts\python.exe scripts/run_benchmarks.py --image 모델벤치/person_10.png --device cpu
```

Linux에서 벤치마크는 `.venv/bin/python scripts/run_benchmarks.py --image 모델벤치/person_10.png --device cpu`로 실행합니다. 결과는 `모델벤치/all_benchmark_results/`의 새 실행 폴더에 저장합니다. GPU ONNX 검증에는 CUDA와 호환되는 `onnxruntime-gpu`가 필요하며 CPU용 `onnxruntime`과 함께 설치하지 않습니다.

Ubuntu 서버의 검증된 Intel 환경은 `README_SERVER.md`의 Python 3.12 및 `requirements-model.lock`을 따릅니다. 이 잠금 파일에는 Linux/CUDA 패키지가 포함돼 있으므로 Windows에 그대로 설치하지 않습니다.

Windows에서 새 환경을 만들 때는 저장소 루트에서 다음을 실행합니다. 기존 가상환경을 사용한다면 생성 단계는 생략합니다.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-benchmark.txt
.\.venv\Scripts\python.exe -m pip install "psycopg[binary]" pgvector
```

`requirements-benchmark.txt`는 선택 기능의 패키지 목록이며 버전 잠금 파일은 아닙니다. 기본 ONNX Runtime은 CPU용입니다. ONNX까지 GPU로 실행하려면 PyTorch와 CUDA 주 버전이 맞는 `onnxruntime-gpu` 환경을 별도로 구성하고, CPU용 `onnxruntime`과 동시에 설치하지 않습니다. 실행기는 요청한 CUDA provider를 사용할 수 없을 때 실패를 보고합니다.

## 다섯 모델 비교

저장소 루트에서 실행합니다. 입력 경로는 현재 작업 디렉터리 기준으로 지정합니다.

```powershell
.\.venv\Scripts\python.exe scripts/run_benchmarks.py --image 모델벤치/person_10.png --video 모델벤치/video_1.mp4 --device cpu
```

Linux에서는 같은 인자를 `.venv/bin/python scripts/run_benchmarks.py`에 전달합니다. 결과는 기본적으로 `모델벤치/all_benchmark_results/` 아래에 만들어집니다. `--output-root`로 다른 위치를 지정할 수 있습니다. 현재 통합 벤치마크의 기본 사진은 `person_10.png`, 01~04의 기본 사진은 `person_4.png`, ONNX 단독 실행과 서버 `run-model.sh`는 `person_3.png`입니다. 재현할 때는 `--image`로 명시하세요.

사진 1~10과 ONNX 가중치, 최신 Word 보고서를 포함했습니다. 새로 생성하는 대용량 실험 결과는 이 통합 커밋에 복사하지 않았으며 원래 로컬 실험 폴더에 유지합니다. 기존 저장소의 실험 결과는 보존합니다.

## Windows에서 DB 파이프라인 실행

PostgreSQL에 PostGIS와 pgvector, 프로젝트 업무 스키마가 필요합니다. 저장소 루트의 Docker Compose는 `capstone` DB를 사용합니다. 새 DB에서는 다음으로 시작합니다.

```powershell
.\.venv\Scripts\python.exe scripts/init_db_env.py
docker compose up --build -d --wait
```

초기 SQL은 빈 볼륨에서만 자동 적용됩니다. 기존 DB는 필요한 마이그레이션을 별도로 적용합니다. 기존 `left_db`에는 이 저장소의 스키마가 자동으로 생기지 않습니다. 이번 통합은 기존 DB와 볼륨을 변경하지 않습니다.

접속 설정은 프로세스 환경변수, 저장소 루트 `.env`, 기본값 순서로 읽습니다. `DATABASE_URL`이 있으면 개별 연결 항목보다 우선하며 프로세스의 값이 `.env`의 같은 키보다 우선합니다. 기본 개별 값은 `127.0.0.1:5432`, DB·사용자 `capstone`입니다. 기존 DB에 연결하려면 `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` 또는 `DATABASE_URL`을 지정합니다. 자격증명은 Git에 올리지 않습니다.

```powershell
# 데모 영상의 촬영 기준시각과 가상 카메라 정보 사용
.\.venv\Scripts\python.exe scripts/tracklet_pipeline.py analyze --video 모델벤치/video_1.mp4 --device cpu --demo --recorded-start 2026-11-16T09:00:00+09:00
# analyze가 출력한 실제 폴더 경로를 사용
.\.venv\Scripts\python.exe scripts/tracklet_pipeline.py ingest runs/tracklets/tracklets_분석ID
# ingest가 출력한 실제 video_id를 사용
.\.venv\Scripts\python.exe scripts/tracklet_pipeline.py query --image 모델벤치/person_3.png --video-id 1
```

실제 영상은 `--demo`를 빼고 정확한 촬영 시작시각을 입력하며, ingest 시 등록된 카메라의 `--camera-id`를 지정합니다. Linux 전용 `scripts/local_db.py`는 Windows에서 사용하지 않습니다. Linux `search-person.sh`는 환경변수 `DATABASE_URL`이 있으면 그 DB로 연결하고, 없으면 기존 서버의 검증용 로컬 DB를 사용합니다.

분석 파일과 DB에는 절대 파일 경로가 있으므로 서버를 바꿀 때는 원본 영상·썸네일을 함께 옮기고 경로를 맞춰야 합니다. DB는 초별 썸네일 메타데이터와 트랙별 평균 벡터를 저장하며 초별 개별 벡터는 분석 폴더 `embeddings.npz`에 남깁니다.

## 현재 범위와 검증

통합은 기존 두 실행 흐름을 함께 제공하는 작업입니다. 멀티 영상·시간 범위 검색, 확인 버튼과 후속 검색, 앞뒤 5초 클립, 지도·실시간 감시는 이 통합에서 새로 구현하지 않았습니다. `design/멀티영상_인물검색_시퀀스.md`는 후속 서비스 설계안입니다. 장면 Top 5와 트랙 Top 5의 점수·속도를 같은 조건의 결과로 비교하지 않습니다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s 모델벤치/tests
.\.venv\Scripts\python.exe -m unittest discover -s tests
.\.venv\Scripts\python.exe scripts/run_benchmarks.py --help
.\.venv\Scripts\python.exe scripts/tracklet_pipeline.py --help
```

서버의 기존 DB 일치 검증 명령은 `README_SERVER.md`에 있습니다. 실제 DB 연결과 모델 추론에는 로컬 장비의 의존성·가중치·DB 준비가 별도로 필요합니다.
