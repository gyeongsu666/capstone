# 인물 검색: 모델 조합 비교

## 다섯 조합을 한 번에 실행하기 (01·02·03·04·06)

`00_run_all_benchmarks.py`를 실행하면 YOLO11n+SigLIP, YOLO11n+Intel,
YOLO26n+SigLIP, YOLO26n+Intel, YOLO26n+ONNX Re-ID 순서로 실행합니다.
각 실험은 별도 프로세스로 순차 실행하며, 종료 후 모델 메모리가 반환됩니다.

기준 사진은 **통합 코드 상단의 `QUERY_IMAGE` 한 곳만** 바꾸면 됩니다.
단독 실행 파일의 기본 사진과 관계없이 다섯 실험에 같은 사진을 전달합니다.

```python
QUERY_IMAGE = ROOT / "person_4.png"  # 원하는 사진으로 변경
VIDEO_PATH = ROOT / "video_1.mp4"
DEVICE = "auto"                     # GPU 사용 가능 시 GPU, 아니면 CPU
```

```powershell
cd D:\LEFT
.\.venv\Scripts\python.exe .\00_run_all_benchmarks.py

# 코드 수정 없이 사진 또는 장치를 지정할 수도 있습니다.
.\.venv\Scripts\python.exe .\00_run_all_benchmarks.py --image person_2.png --device 0
```

기본값은 1초 간격, Top 5, conf=0.3, iou=0.7, imgsz=640, max_det=300입니다.
코드 상단에서 사진·영상·저장 위치·장치·검사 간격·Top K·검출 설정을 바꿀 수 있습니다.
명령행 옵션이 코드 상단 설정보다 우선합니다. Intel 특징 추출은 항상 CPU이며,
SigLIP 장치는 `SIGLIP_DEVICE` 또는 `--siglip-device`로 별도 지정할 수 있습니다.
ONNX는 기존 06 코드의 모델·입력 크기·provider 검증을 그대로 사용합니다.

```text
all_benchmark_results/
  all_날짜_시간_식별자/
    report.html             다섯 모델의 전체 시간 비교·장치·검출 수·Top K 사진·상세 측정값
    summary.csv             다섯 실험을 행으로 모은 전체 수치 비교표 (Excel에서 열기 가능)
    runs/
      01_yolo11n_siglip/     콘솔 로그와 기존 형식의 원본 결과
      02_yolo11n_intel/
      03_yolo26n_siglip/
      04_yolo26n_intel/
      06_compare_reid_tracking/
```

**`report.html`을 브라우저로 열면 한 파일에서 비교할 수 있습니다.** 기준 사진과 결과 사진이
HTML 안에 포함되므로 이 파일 하나만 복사해서 볼 수 있습니다. 실험 하나가 끝날 때마다 보고서를
갱신하므로 실행 중 열어 두었다면 새로고침하세요. 하나가 실패해도 나머지 실험은 계속 실행하고,
실패 상태와 로그 내용을 보고서에 표시합니다. Ctrl+C로 중단하면 완료된 결과를 보존합니다.
실행할 때마다 새 폴더를 만들며 기존 결과는 덮어쓰지 않습니다.

첫 실행은 모델 다운로드가 포함될 수 있습니다. ONNX의 CUDA 환경이 맞지 않으면 해당 실험은
실패로 기록되며, CPU로 측정하려면 `--device cpu`를 지정하세요. 서로 다른 특징 모델의
유사도 숫자 크기만으로 정확도를 비교할 수 없으며, Top K는 서로 다른 사람이 아닌 후보 장면입니다.

## 기존 개별 실행

기본 영상은 이 폴더의 `video_1.mp4`입니다. 현재 개별 실행 기본 사진은 01·02·03·04의 경우 `person_4.png`, 06의 경우 `person_3.png`입니다. `--image`로 바꿀 수 있으며 통합 실행에서는 `QUERY_IMAGE`가 다섯 실험에 공통 적용됩니다. 사진은 검색할 인물 한 명을 중심으로 잘라서 준비하세요. 원본 입력 파일은 수정하지 않습니다.

| 실행 파일 | 검출 | 특징 벡터 |
|---|---|---|
| `01_yolo11n_siglip.py` | YOLO11n | SigLIP SO400M, 1,152차원 |
| `02_yolo11n_intel.py` | YOLO11n | Intel Re-ID retail-0287, 256차원 |
| `03_yolo26n_siglip.py` | YOLO26n | SigLIP SO400M, 1,152차원 |
| `04_yolo26n_intel.py` | YOLO26n | Intel Re-ID retail-0287, 256차원 |

`search_benchmark.py`는 네 실행 파일이 함께 사용하는 공통 코드입니다. `siglip_streaming.py`는 Windows에서 SigLIP 가중치를 작은 단위로 읽는 보조 코드입니다. 두 파일 모두 실행 파일과 같은 폴더에 두세요.

## 실행

PowerShell에서 `D:\LEFT`로 이동한 뒤 아래 명령을 **하나씩** 실행하세요. IDE에서는 `.venv\Scripts\python.exe` 인터프리터를 선택하고 원하는 파일을 실행해도 됩니다.

```powershell
cd D:\LEFT
.\.venv\Scripts\python.exe .\01_yolo11n_siglip.py
.\.venv\Scripts\python.exe .\02_yolo11n_intel.py
.\.venv\Scripts\python.exe .\03_yolo26n_siglip.py
.\.venv\Scripts\python.exe .\04_yolo26n_intel.py
```

각 파일은 한 조합만 실행합니다. 기본값은 **약 1초 간격으로 프레임 검사, 사람 검출 임계값 0.3, YOLO 입력 크기 640, 상위 5개 장면**입니다. 프레임 간격은 `round(FPS × 1초)`이며 실제 적용 간격도 저장합니다. 모든 프레임은 순서대로 읽되 선택한 프레임에서만 검출·특징 추출합니다.

각 검사 프레임에서 가장 유사한 사람 한 명을 고르고, 그 장면들을 유사도순으로 정렬해 상위 5개를 반환합니다. **서로 다른 사람 5명을 찾는 의미는 아닙니다.** 같은 인물이 여러 시간대에 등장할 수 있습니다. 사용할 수 있는 장면이 5개보다 적으면 있는 만큼 저장하고 경고합니다.

옵션은 네 파일 모두 같습니다. 공정하게 비교하려면 네 조합에 같은 옵션을 적용하세요.

```powershell
# 0.5초 간격 검사
.\.venv\Scripts\python.exe .\01_yolo11n_siglip.py --interval 0.5

# 전체 프레임 검사: 실행 시간과 벡터 저장량이 증가합니다.
.\.venv\Scripts\python.exe .\01_yolo11n_siglip.py --interval 0

# CPU로 통일해 측정: 네 파일에 모두 --device cpu 적용
.\.venv\Scripts\python.exe .\01_yolo11n_siglip.py --device cpu

# YOLO는 GPU, SigLIP은 CPU로 측정
.\.venv\Scripts\python.exe .\01_yolo11n_siglip.py --device 0 --siglip-device cpu

# 전체 옵션 확인 (모델을 로딩하지 않습니다)
.\.venv\Scripts\python.exe .\01_yolo11n_siglip.py --help
```

기본 장치는 YOLO와 SigLIP은 CUDA 사용 가능 시 GPU, 아니면 CPU입니다. Intel Re-ID는 OpenVINO CPU로 실행합니다. 따라서 기본 결과는 **각 실행 장치를 포함한 파이프라인 비교**입니다. 특징 모델을 CPU에서 비교하려면 SigLIP 두 파일에 `--siglip-device cpu`를 사용하세요. 모든 특징 추출은 한 이미지씩 처리하며, PyTorch 모델은 FP32를 사용합니다. Intel도 추론 정밀도 힌트를 FP32로 지정하고 단일 스트림으로 실행합니다.

첫 SigLIP 실행에서는 Hugging Face에서 모델을 다운로드할 수 있습니다. Intel 모델은 `models/`의 체크섬을 확인하고, 없거나 손상됐을 때 다운로드합니다. 다운로드·모델 로딩은 준비 시간에 포함됩니다. 모델이 캐시된 상태에서 재측정한 결과끼리 비교하세요. 준비 시간이 검색 속도에 섞이지 않도록 별도 기록합니다.

## 결과

매번 새 폴더를 만들기 때문에 이전 결과를 덮어쓰지 않습니다.

```text
benchmark_results/
  benchmark_summary.csv                 네 조합의 누적 비교표
  yolo11n_siglip_날짜_시간_식별자/
    settings.json                       입력 경로와 측정 조건
    timing.json                         시간, 개수, 장치, 라이브러리 버전, 경고
    top5.csv                            상위 5개 장면의 시간·좌표·유사도
    rank_01_time_...s.jpg                후보 박스를 표시한 전체 장면
    rank_01_time_...s_crop.jpg           박스·글자 없는 후보 사람 이미지
    ...                                 rank 02~05
    detections.csv                      모든 유효 검출과 벡터 행 번호
    query_vector.npy                    기준 사진의 정규화된 벡터
    gallery_vectors.npz                  모든 유효 검출의 정규화된 벡터와 메타데이터
```

`gallery_vectors.npz`에는 `vectors`, `frame_1based`, `seconds`, `boxes`, `confidence`, `similarities`, `query_vector`, `model_id`, `preprocessing`, `source_video`가 들어갑니다. `detections.csv`의 `vector_index`는 `vectors`의 0부터 시작하는 행 번호입니다. 후보 여부와 관계없이 **검사한 프레임에서 유효하게 검출한 모든 사람**의 벡터를 저장합니다. 벡터는 메모리에 모았다가 저장하므로 긴 영상의 전체 프레임 검사는 메모리 사용량이 커집니다.

```python
import numpy as np

data = np.load("benchmark_results/해당_실험_폴더/gallery_vectors.npz")
print(data["vectors"].shape)  # (검출 수, 1152) 또는 (검출 수, 256)
print(data["vectors"][0])     # 첫 번째 검출의 실제 벡터값
```

`timing.json`과 누적 비교표에는 다음을 기록합니다.

- 라이브러리 import, 준비 전체, 모델 로딩·다운로드, 워밍업
- 기준 사진 벡터 추출
- 영상 읽기, YOLO 검출, 영상 속 사람 벡터 추출, 코사인 유사도 계산
- 영상 검색 전체, 결과 저장, import부터 결과 저장까지 전체 시간
- 검사 프레임당 검출 시간, 사람 이미지당 벡터 추출 시간
- 검사한 프레임 수, 검출 수, 벡터 수·차원, 실행 장치

준비 전체에는 모델 로딩·워밍업·기준 사진 추출 시간이 포함됩니다. 영상 검색 전체에는 영상 읽기·검출·영상 벡터 추출·유사도 계산이 포함됩니다. 포함 관계에 있는 시간들을 다시 더하지 마세요. GPU 작업은 단계 경계에서 동기화해 측정합니다. 검출 시간에는 YOLO 전처리·추론·후처리·좌표의 CPU 전송이, 벡터 추출 시간에는 전처리·추론·CPU 전송·정규화가 포함됩니다. 전체 시간은 Python 인터프리터 시작과 마지막 시간 보고서·누적 비교표 쓰기를 제외합니다.

검색 결과를 눈으로 확인해 실제 대상인지 판단하세요. 정확도는 정답 표시 후 별도로 평가해야 합니다. **SigLIP과 Intel Re-ID의 유사도 숫자 크기만으로 정확도를 비교할 수 없습니다.** 검출기가 달라지면 사람 이미지의 개수와 영역도 달라지므로 전체 벡터 추출 시간과 이미지당 시간을 함께 확인하세요. 정답이 제공되지 않아 이 코드는 정확도·mAP·Rank-1 정확도를 계산하지 않습니다.

## 별도로 추적 영상 두 개 생성

VS Code 터미널에서 기존 `.venv`를 활성화한 뒤 실행하세요.

```powershell
python 05_make_tracking_videos.py
```

입력은 `video_1.mp4`이며 YOLO11n, YOLO26n 순서로 **전체 프레임**을 처리합니다. 두 모델 모두 ByteTrack으로 사람의 프레임 간 ID를 연결하고, 박스·ID·신뢰도·영상 시간·적용 설정을 표시한 무음 MP4를 저장합니다. GPU 사용 가능 시 GPU, 아니면 CPU로 실행합니다.

박스 누락과 ID 끊김을 줄이기 위해 추적 전용 기본값을 조정했습니다. 입력 크기는 **640에서 1280으로**, 검출 신뢰도 기준은 **0.3에서 0.1로** 변경했고, 사라진 추적 후보는 **3초** 동안 유지합니다. 30 FPS 영상에서는 90프레임입니다. IoU 0.7과 FP32는 유지합니다. 약한 검출은 기존 ID를 이어 붙일 때 활용하고, 새로운 ID는 신뢰도 0.25 이상에서 시작합니다. 해상도가 커져 처리 시간이 늘어날 수 있습니다.

이 변경은 `05_make_tracking_videos.py`에만 적용합니다. 검색 코드와 이전 성능지표는 기존 설정 그대로입니다. 추적 후보를 3초 유지한다는 것은 다시 검출됐을 때 연결을 시도한다는 의미이며, 보이지 않는 사람의 박스를 계속 그리거나 동일 ID를 보장한다는 뜻은 아닙니다.

```text
tracking_videos/
  tracking_날짜_시간_식별자/
    yolo11n_tracking.mp4
    yolo26n_tracking.mp4
```

실행할 때마다 새 폴더에 완성 영상 2개를 저장합니다. 원본 영상과 기존 `benchmark_results*` 및 비교표는 수정하지 않습니다. 추적·영상 생성 소요 시간은 콘솔에 따로 표시합니다. 처리 중에는 `.partial.mp4`로 저장하고 검증 후 완성 이름으로 바꾸므로, 실패하거나 중단하면 미완성 파일이 남을 수 있습니다. 추적 설정은 실행 중 임시 YAML로 전달하고 종료 시 삭제합니다.

이 영상은 전체 사람의 추적 ID를 보여주는 결과입니다. ID는 영상·모델 안에서의 지역 번호이며 두 모델 사이에서 같은 사람에게 같은 ID가 부여되는 것은 아닙니다. 가림이나 재등장으로 ID가 바뀔 수 있습니다. 기준 사진별 검색 순위와 특징 벡터는 기존 검색 실험 결과를 사용하세요. MP4 저장에 짝수 크기가 필요하면 오른쪽 또는 아래에 최대 1픽셀의 검은 여백을 붙입니다.

```powershell
# GPU를 명시해서 실행
python 05_make_tracking_videos.py --device 0

# CPU로 실행
python 05_make_tracking_videos.py --device cpu

# 설정을 명시해서 실행
python 05_make_tracking_videos.py --imgsz 1280 --conf 0.1 --lost-seconds 3

# 이전 추적 설정에 가깝게 비교
python 05_make_tracking_videos.py --imgsz 640 --conf 0.3 --lost-seconds 1
```

구현 참고: [Ultralytics 추적 API와 ByteTrack](https://docs.ultralytics.com/modes/track/).

## YOLO26n + 전용 ONNX Re-ID로 기준 사진 Top 5 검색

`06_compare_reid_tracking.py`는 **person_1.png를 기준으로 video_1.mp4에서 유사한 사람의 상위 5개 장면을 찾습니다.** 검출에는 `yolo26n.pt`, 벡터 추출에는 Ultralytics에서 제공하는 `yolo26n-reid.onnx`를 사용합니다. 이전 검출기 내부 특징 재사용 방식에서 별도 ONNX 외형 인코더로 변경했습니다. 파일 이름은 유지하지만 추적 코드는 아니며 Intel은 재실행하지 않습니다.

```powershell
# CUDA를 명시: YOLO 또는 ONNX에서 CUDA를 사용할 수 없으면 중단
python 06_compare_reid_tracking.py --device 0

# 다른 기준 사진으로 같은 실험
python 06_compare_reid_tracking.py --device 0 --image person_2.png
python 06_compare_reid_tracking.py --device 0 --image person_3.png

# 명시적으로 CPU 측정
python 06_compare_reid_tracking.py --device cpu
```

첫 실행 시 ONNX 파일이 없으면 Ultralytics 다운로드 기능으로 `models/yolo26n-reid.onnx`에 받습니다. 이미 받은 파일은 `--reid-model 경로.onnx`로 지정할 수 있습니다. CUDA 실험에는 호환되는 `onnxruntime-gpu`와 CUDA/cuDNN 라이브러리가 필요합니다. PyTorch에서 CUDA가 동작하더라도 ONNX CUDA 지원은 별도로 확인해야 합니다. 실행 시 실제 ONNX provider와 입력 크기를 출력하고, 설정 파일에 provider 목록과 옵션을 저장합니다. CUDA 요청 시 CPU provider만 선택된 실행은 중단합니다. CUDA provider가 활성화되어도 지원하지 않는 일부 연산은 ONNX Runtime이 CPU에 배치할 수 있습니다.

Intel 검색과 같은 조건은 다음과 같습니다.

- YOLO26n 검출 크기 640, 신뢰도 0.3, IoU 0.7, 최대 300개, FP32, 배치 1. 검출 인자는 `search_benchmark.py`와 동일하게 전달합니다.
- 기본 1초 간격 검사, 프레임 번호·시간 산출, 좌표 내림/올림·경계 제한과 패딩 없는 사람 크롭.
- **기준 사진 전체를 그대로 인코딩**합니다. 기준 사진에서 사람을 다시 검출하거나 일부를 선택하지 않습니다. 검색할 사람 중심의 사진을 사용하세요.
- L2 정규화 후 코사인 유사도 계산, 프레임별 최고 후보 한 명을 모아 상위 5개 장면 저장. 같은 사람이 여러 시간대에 포함될 수 있습니다.

특징 모델에는 각각의 입력 규격을 적용합니다. ONNX Re-ID는 공식 Ultralytics 인코더와 같은 RGB, 0~1, bilinear resize(`align_corners=False`), NCHW 입력을 사용합니다. 입력 크기는 ONNX의 고정 크기를 우선하며 동적 크기일 때만 `--reid-imgsz` 기본값 448을 사용합니다. Intel은 기존 BGR·0~255·256×128 규격을 유지합니다. 크롭의 원본 픽셀은 동일하게 사용하되 모델별 전처리 크기와 색상 규격은 다릅니다. 비교 정밀도를 유지하기 위해 ONNX FP16 입력 및 고정 배치 2 이상 모델은 거부합니다.

```text
yolo26n_reid_results/
  benchmark_summary.csv               새 ONNX 검색 실험 누적 요약
  yolo26n_reid_날짜_시간_식별자/
    top5.csv                          상위 5개 시간·좌표·유사도
    rank_01_time_...s.jpg              후보를 표시한 전체 장면
    rank_01_time_...s_crop.jpg          후보 사람 원본 이미지, 2~5위도 저장
    query_vector.npy                  기준 사진 정규화 벡터
    gallery_vectors.npz                모든 유효 검출의 벡터
    detections.csv                    벡터 행 번호·프레임·시간·좌표·유사도
    query_encoding.json               기준 사진 전체 사용 여부·차원
    settings.json                     입력·설정·모델 해시·ONNX provider
    timing.json                       단계별 시간·차원·환경·경고
    summary.csv                       해당 실행 요약 한 행
```

벡터 차원은 실제 ONNX 출력에서 확인합니다. `vectors`의 행은 `detections.csv`의 `vector_index`에 대응합니다. 이전 `yolo26n_native_reid_results`와 Intel 측정 결과는 그대로 보존합니다.

시간은 이제 **검출**과 **별도 Re-ID 인코딩**을 분리합니다. `gallery_embedding_seconds`에는 크롭 전처리, ONNX 추론, CPU/GPU 전송, L2 정규화를 포함합니다. `query_embedding_seconds`는 기준 사진 전체 인코딩 시간입니다. 준비·모델 다운로드 및 로딩·워밍업을 별도 기록하며, 준비 시간에는 그 구성요소가 이미 포함되므로 중복 합산하지 않습니다. `video_search_seconds`에는 디코딩·검출·인코딩·유사도 계산을 포함하며 결과 이미지 저장 시간은 제외합니다.

Intel은 OpenVINO CPU, 새 실험은 지정한 ONNX 실행 장치이므로 속도는 모델·런타임·장치 조합의 결과입니다. 기존 Intel과 같은 사진·영상·검사 간격을 사용하고, 두 실행의 `detections.csv`에서 검출 개수·프레임·좌표가 같은지도 확인하세요. 유사도 점수 크기 자체를 정확도로 비교하지 말고 상위 5개 정답 여부를 평가하세요. `--interval 0`은 전체 프레임, `--max-seconds 10`은 앞 10초만 검사하므로 기본 실험과 비교할 때 조건을 맞춰야 합니다.

공식 참고: [Ultralytics Re-ID ONNX 인코더 안내](https://docs.ultralytics.com/modes/track/#enabling-re-identification-reid). 공식 인코더는 추적기의 외형 비교 분기에 제공되며, 여기서는 그 벡터를 사진 검색의 코사인 유사도 비교에 사용합니다.

## ONNX CUDA DLL 오류: cublasLt64_13.dll 누락

현재 가상환경의 PyTorch는 `2.14.1+cu126`(CUDA 12.6)이고 기존 `onnxruntime-gpu 1.31.1`은 CUDA 13.0 빌드입니다. 따라서 PyTorch에 포함된 CUDA 12 DLL로 `cublasLt64_13.dll` 의존성을 충족할 수 없습니다. 코드의 CPU 전환 방지 검사로 검색 전에 중단됩니다. ONNX 파일 다운로드 실패나 VRAM 부족 오류와는 다릅니다.

VS Code에서 실행 중인 실험을 종료하고 해당 `.venv`를 활성화한 터미널에서 아래 순서로 실행하세요. CPU/GPU ONNX 패키지는 같은 `onnxruntime` 모듈을 제공하므로 둘 다 제거한 다음 CUDA 12 계열의 GPU 패키지만 설치합니다. Python 3.13 Windows 휠이 제공되는 1.21.1을 지정합니다.

```powershell
python -m pip uninstall -y onnxruntime onnxruntime-gpu
python -m pip install --no-cache-dir "onnxruntime-gpu==1.21.1"
python 06_compare_reid_tracking.py --device 0
```

`06`은 CUDA 빌드 버전을 기록하고, 알려진 CUDA 주 버전 충돌을 먼저 검사하며, ONNX Runtime의 `preload_dlls()`로 호환되는 PyTorch CUDA/cuDNN DLL을 로딩합니다. 주 버전 일치는 최소 조건이며 실제 세션의 CUDA provider 활성화도 별도로 검사합니다. `get_available_providers()`에 CUDA가 표시되는 것만으로는 DLL 로딩 성공을 확인할 수 없습니다. 성공 시 콘솔의 `Re-ID:` provider 목록 첫 항목이 `CUDAExecutionProvider`인지 확인하세요. DLL 파일을 다른 이름으로 복사하거나 바꾸지 마세요. 이 패키지 교체는 모델 가중치와 기존 벤치마크 결과를 변경하지 않습니다.

참고: [ONNX Runtime과 PyTorch의 CUDA/cuDNN 호환 및 DLL 로딩](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#compatibility-with-pytorch), [1.21.1 Windows/Python 3.13 배포 파일](https://pypi.org/project/onnxruntime-gpu/1.21.1/#files).

## Windows 오류 1455: 페이징 파일이 너무 작습니다

`safe_open`에서 오류 1455가 나면 가중치 파일을 여는 단계에서 Windows가 필요한 메모리를 할당하지 못한 것입니다. GPU를 사용하도록 설정해도 모델 파일을 읽을 때 시스템 메모리가 필요합니다. GPU 메모리 부족 오류인 `CUDA out of memory`와는 발생 지점이 다릅니다.

Windows에서는 `siglip_streaming.py`로 이미지 모델에 필요한 가중치만 하나씩 읽어 지정된 장치에 복사합니다. 전체 이미지·텍스트 체크포인트를 `safe_open`으로 열거나 메모리 매핑하지 않습니다. GPU를 선택했다면 모델을 GPU에 직접 생성해 완전한 CPU 모델을 함께 유지하는 것도 피합니다. 필요한 이미지 가중치가 모두 채워졌는지와 모양·바이트 수를 검사한 뒤에만 검색을 시작합니다. 모델과 FP32 실험 조건은 유지하며, 로딩 방식은 `timing.json`의 `weight_loader`에 기록합니다.

이 수정은 파일을 여는 단계의 메모리 부담을 줄이지만, 모델 자체를 담을 GPU/시스템 메모리는 여전히 필요합니다. 실제 GPU 추론 중 `CUDA out of memory`가 발생한다면 별도의 GPU 메모리 문제입니다. Windows 오류 1455가 계속되면 다음을 확인하세요.

1. 다른 실험 프로세스와 사용하지 않는 메모리 사용량이 큰 프로그램을 종료한 뒤 다시 실행하세요.
2. 작업 관리자 → 성능 → 메모리에서 **커밋됨**의 현재 사용량과 한도를 확인하세요. 한도는 RAM과 페이징 파일의 영향을 받습니다.
3. Windows 검색에서 **고급 시스템 설정 보기** → 고급 → 성능의 **설정** → 고급 → 가상 메모리의 **변경**으로 이동하세요. 페이징 파일을 꺼뒀거나 작게 제한했다면 **모든 드라이브에 대한 페이징 파일 크기 자동 관리**를 사용하고, 해당 드라이브의 여유 공간도 확인하세요. Windows에서 요구하면 재시작하세요. 이미 자동 관리 중인데 오류가 지속되면 현재 커밋 사용량·한도와 여유 공간을 확인한 뒤 크기를 조정해야 합니다.
4. 다시 `python 01_yolo11n_siglip.py`를 실행하세요.

`--interval` 변경은 모델 로딩 메모리를 줄이지 않습니다. FP16 변경은 실험 정밀도 조건을 바꾸므로 이 오류 수정에서 자동 적용하지 않습니다. 운영체제의 가상 메모리 설정은 코드가 변경하지 않습니다.

참고: [Microsoft의 페이징 파일·커밋 한도 설명](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/introduction-to-the-page-file), [Transformers 모델 로딩](https://huggingface.co/docs/transformers/main/en/models).

## 사용 API 참고

- [Ultralytics Predict](https://docs.ultralytics.com/modes/predict/)
- [Hugging Face SigLIP](https://huggingface.co/docs/transformers/model_doc/siglip) 및 [SO400M 모델 설정](https://huggingface.co/google/siglip-so400m-patch14-384/blob/main/config.json)
- [Intel person-reidentification-retail-0287](https://docs.openvino.ai/2023.3/omz_models_model_person_reidentification_retail_0287.html)
