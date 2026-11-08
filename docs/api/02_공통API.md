> 원본: `ReFind_API_명세서.md` 149~188줄 · [목차로](README.md) · 공통 규칙은 [01_공통규칙.md](01_공통규칙.md)

## 이 문서에서 다루는 것

- 화면 기능과 상관없이 쓰는 API 2개
- `GET /api/health`: DB, Redis, GPU 서버 연결 상태. 하나라도 실패하면 `degraded`
- `GET /api/tasks/{task_id}`: 비동기 작업의 진행 상태(`PENDING`, `PROGRESS`, `SUCCESS`, `FAILURE`)와 진행률
- 작업이 끝나면 `resource`에 적힌 리소스를 다시 조회한다

---

## 2. 공통 API

### 2.1 `GET /api/health` 서버 상태

```json
200 OK
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "gpu_server": "ok"
}
```

- 연결 실패 항목은 `"error"`로 표시한다. 하나라도 실패하면 `status`는 `"degraded"`.

### 2.2 `GET /api/tasks/{task_id}` 작업 상태

```json
200 OK
{
  "task_id": "6f1c2a9e-3b7d-4c1a-9f0e-2d8b7a1c5e44",
  "type": "video_analysis",
  "status": "PROGRESS",
  "progress": 45,
  "resource": { "type": "video", "id": 12 },
  "error": null,
  "updated_at": "2026-11-08T14:31:10+09:00"
}
```

| 필드 | 값 |
|---|---|
| `type` | `video_analysis`, `query_vector`, `search`, `recalculation` |
| `status` | `PENDING`, `PROGRESS`, `SUCCESS`, `FAILURE` |
| `progress` | 0~100 (알 수 없으면 `null`) |
| `resource` | 작업이 끝나면 조회할 리소스 |
| `error` | 실패 시 `{"code", "message"}` |

- 존재하지 않거나 만료된 `task_id`도 Celery는 `PENDING`으로 답할 수 있다. 오래 `PENDING`이면 `resource`의 상태를 조회한다.
