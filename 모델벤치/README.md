# 모델 벤치마크

YOLO11n·YOLO26n과 SigLIP SO400M·Intel Re-ID의 네 조합, YOLO26n+ONNX Re-ID를 포함한 다섯 조합으로 영상 속 인물 검색을 비교한 코드와 실험 결과입니다.

## 파일 구성

| 파일 및 폴더 | 내용 |
|---|---|
| `00_run_all_benchmarks.py` | 01·02·03·04·06 순차 실행, 사진을 포함한 통합 HTML 보고서·CSV 비교표 |
| `01_yolo11n_siglip.py` | YOLO11n + SigLIP 검색 |
| `02_yolo11n_intel.py` | YOLO11n + Intel Re-ID 검색 |
| `03_yolo26n_siglip.py` | YOLO26n + SigLIP 검색 |
| `04_yolo26n_intel.py` | YOLO26n + Intel Re-ID 검색 |
| `05_make_tracking_videos.py` | 두 검출 모델의 ByteTrack 추적 영상 생성 |
| `06_compare_reid_tracking.py` | YOLO26n + yolo26n-reid.onnx로 기준 사진 Top 5 검색·벡터·시간 측정 |
| `search_benchmark.py`, `siglip_streaming.py` | 공통 검색·시간 측정 및 Windows SigLIP 가중치 로딩 |
| `benchmark_results`, `benchmark_results_1`, `benchmark_results_2` | 기준 사진 3장의 검색 결과·벡터·시간 기록 |
| `tracking_videos` | 생성된 추적 영상 |
| `models`, `yolo11n.pt`, `yolo26n.pt` | 실험용 가중치 |
| `tests` | 가중치 파일 읽기와 기준 사진·검색 순위 로직 테스트 |

자세한 실행 방법과 결과 해석은 [실험 안내](README_실험.md)를 확인하세요. 성능 비교 보고서는 이 폴더의 Word 파일에 있습니다.

다섯 조합을 한 번에 실행하려면 `00_run_all_benchmarks.py` 상단의 `QUERY_IMAGE`를 바꾸고 아래 명령을 실행하세요.

```powershell
.\.venv\Scripts\python.exe .\00_run_all_benchmarks.py
```

결과는 `all_benchmark_results/all_날짜_시간_식별자/report.html`에서 함께 확인할 수 있습니다.

## 큰 파일 받기

영상, 가중치, NumPy 벡터 파일은 **Git LFS**로 관리합니다. 저장소를 받은 뒤 Git LFS를 설치한 환경에서 실행하세요.

```powershell
git lfs install
git lfs pull
```

가상환경과 캐시, 문서 검토용 임시 파일은 저장소에서 제외했습니다. 검색 실험은 1초 간격 프레임을 사용하고, 별도의 추적 영상 생성은 전체 프레임을 사용합니다. 두 작업의 처리 시간을 같은 지표로 해석하지 않도록 주의하세요.
