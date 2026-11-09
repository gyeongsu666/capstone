# 인물 검색: 네 조합 비교

입력은 이 폴더의 `video_1.mp4`와 `person_1.png`입니다. 사진은 검색할 인물 한 명을 중심으로 잘라서 준비하세요. 원본 입력 파일은 수정하지 않습니다.

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
