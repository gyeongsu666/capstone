"""기준 사진 특징 추출(CPU 워커, default 대기열): 사람 찾기 → 자르기 → Intel Re-ID 256차원 벡터."""
from uuid import UUID

from sqlalchemy import update

from app.analysis import AnalysisError, load_models
from app.auth import utcnow
from app.db import session_scope
from app.media import abs_path
from app.models import Case, Task


def pick_person(boxes: list[tuple[float, float, float, float]], bbox: list | None) -> tuple[int, int, int, int]:
    """사람 박스 고르기. bbox(원본 픽셀 [x, y, w, h])를 주면 그 영역, 아니면 검출이 정확히 한 명이어야 한다."""
    if bbox:
        x, y, w, h = bbox
        return int(x), int(y), int(x + w), int(y + h)
    if not boxes:
        raise AnalysisError("NO_PERSON_DETECTED", "사진에서 사람을 찾지 못했어요. 사람 부분을 지정해 다시 올려 주세요.")
    if len(boxes) > 1:
        raise AnalysisError("MULTIPLE_PERSONS", f"사진에 사람이 {len(boxes)}명 있어요. 찾을 사람의 영역을 지정해 주세요.")
    x1, y1, x2, y2 = boxes[0]
    return int(x1), int(y1), int(x2), int(y2)


def _finish(task_id: UUID, case_id: int, query_version: int, *, ok: bool, embedding=None, model_name=None,
            error: AnalysisError | None = None) -> None:
    now = utcnow()
    with session_scope() as db:
        case = db.get(Case, case_id)
        if case is None or case.query_version != query_version or case.query_task_id != task_id:
            # 그 사이 새 기준 대상이 들어왔다 → 이 결과는 버린다
            db.execute(update(Task).where(Task.id == task_id).values(
                status="failed", stage="failed", updated_at=now,
                error={"code": "QUERY_VERSION_CONFLICT", "message": "새 기준 대상으로 바뀌어 결과를 버렸어요.", "retryable": False}))
            return
        if ok:
            case.query_status, case.query_embedding, case.query_model_name, case.query_error_code = "ready", embedding, model_name, None
            db.execute(update(Task).where(Task.id == task_id).values(
                status="done", stage="done", progress=100, updated_at=now,
                result={"case_id": case_id, "query_version": query_version}))
        else:
            case.query_status, case.query_error_code = "failed", error.code
            db.execute(update(Task).where(Task.id == task_id).values(
                status="failed", stage="failed", updated_at=now,
                error={"code": error.code, "message": error.message, "retryable": error.retryable}))
        case.query_updated_at = now


def run_query_embedding(task_id: str, case_id: int, query_version: int) -> dict:
    tid = UUID(task_id)
    with session_scope() as db:
        case = db.get(Case, case_id)
        if case is None or case.query_task_id != tid:
            return {"skipped": True}
        case.query_status = "running"
        db.execute(update(Task).where(Task.id == tid).values(status="running", stage="analyzing", updated_at=utcnow()))
        photo, bbox = case.query_photo_path, case.query_person_bbox
    try:
        m = load_models()
        cv2, np = m["cv2"], m["np"]
        image = m["read_image"](abs_path(photo), cv2, np)
        boxes = []
        if not bbox:
            det = m["yolo"].predict(image, classes=[0], conf=.35, device="cpu", verbose=False)[0].boxes
            boxes = [tuple(b) for b in (det.xyxy.cpu().numpy() if det is not None else [])]
        h, w = image.shape[:2]
        x1, y1, x2, y2 = pick_person(boxes, bbox)
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
        if x2 - x1 < 8 or y2 - y1 < 8:
            raise AnalysisError("INVALID_PERSON_BBOX", "사람 영역이 너무 작아요.")
        vector = m["encoder"].embed(image[y1:y2, x1:x2])
        _finish(tid, case_id, query_version, ok=True, embedding=vector, model_name=m["encoder"].model_id)
        return {"case_id": case_id, "query_version": query_version}
    except AnalysisError as e:
        _finish(tid, case_id, query_version, ok=False, error=e)
        return {"failed": e.code}
    except Exception as e:
        _finish(tid, case_id, query_version, ok=False,
                error=AnalysisError("EMBEDDING_FAILED", f"특징을 뽑지 못했어요({type(e).__name__}).", retryable=True))
        raise
