> 원본: `ReFind_API_명세서.md` 882~957줄 · [목차로](README.md) · 공통 규칙은 [01_공통규칙.md](01_공통규칙.md)

## 이 문서에서 다루는 것

- 백엔드 서버(FastAPI)가 GPU 서버를 호출하는 API 4개. 브라우저는 직접 호출하지 않는다
- GPU 서버 상태, 영상 분석 요청, 사진 특징 추출 요청, 작업 상태와 결과 조회
- 분석 요청은 `202`와 `job_id`를 받고, `GET /jobs/{job_id}`로 결과(트랙렛, 특징 벡터)를 받는다
- GPU 서버 오류는 백엔드가 `502 gpu_server_error`로 바꿔 기록한다
- 원본 기준으로 외부 API보다 이른 초안이며, 결과 형식은 AI 파트와 맞춰 확정한다

---

## 11. 내부 API (백엔드 서버 → GPU 서버)

- 기본 주소: 환경변수 `GPU_SERVER_URL` (백엔드가 설정, 1.1 참고)
- 호출 방향: 백엔드 서버(FastAPI)가 GPU 서버를 호출한다. 브라우저는 직접 호출하지 않는다.
- 에러 형식은 1.5와 같다. 백엔드 서버는 GPU 서버 오류를 받으면 `502 gpu_server_error`로 바꿔 기록한다.
- 이 장은 외부 API보다 더 이른 초안이다. 결과 형식은 AI 파트와 맞춰 확정한다.

### 11.1 `GET /health` GPU 서버 상태

```json
200 OK
{
  "status": "online",
  "gpu_available": true,
  "device": "NVIDIA ...",
  "model_version": "reid-v1",
  "running_jobs": 1
}
```

- 현재 GPU 서버 코드의 `GET /`를 이 경로로 옮긴다.

### 11.2 `POST /jobs/video-analysis` 영상 분석 요청

- 요청: `multipart/form-data`

| 필드 | 필수 | 설명 |
|---|---|---|
| `file` | O | 재생용으로 변환한 mp4 |
| `video_id` | O | 백엔드 서버의 영상 ID (결과 연결용) |
| `sample_fps` | X | 프레임 샘플링 간격, 기본은 GPU 서버 설정값 |

```json
202 Accepted
{ "job_id": "gpu-7f3e...", "status_url": "/jobs/gpu-7f3e..." }
```

- 에러: `400 invalid_file`, `413 file_too_large`, `422 validation_error`

### 11.3 `POST /jobs/query-vector` 사진 특징 추출 요청

- 요청: `multipart/form-data`, 필드 `photo`(필수), `case_id`(필수), `bbox`(선택)
- 응답: `202`, `{"job_id", "status_url"}`
- 에러: `400 invalid_file`, `422 validation_error`

### 11.4 `GET /jobs/{job_id}` 작업 상태와 결과

```json
200 OK (영상 분석 완료)
{
  "job_id": "gpu-7f3e...",
  "type": "video_analysis",
  "status": "SUCCESS",
  "progress": 100,
  "model_version": "reid-v1",
  "result": {
    "video_id": 12,
    "tracklets": [
      {
        "track_no": 297,
        "start_offset_sec": 125.0,
        "end_offset_sec": 138.0,
        "entry_direction_deg": 270,
        "exit_direction_deg": 90,
        "thumbnail_base64": "...",
        "vector": [0.012, -0.034, ...]
      }
    ]
  },
  "error": null
}
```

- `query_vector` 작업의 `result`: `{"case_id", "vector": [...]}`
- 벡터 차원은 Re-ID 모델이 확정된 뒤 정한다. 백엔드 서버는 `model_version`이 다른 벡터를 섞어 비교하지 않는다.
- 에러: `404 not_found`
