"""대상 지정(SYS02-002): 기준 사진 업로드 또는 영상 속 인물(트랙렛) 선택. 기준 대상은 사건마다 하나."""
import json
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app.auth import AuthContext, ensure_case_open, load_case, require_user, utcnow
from app.case_view import query_out
from app.common import Idempotency, record_audit, request_fingerprint
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.media import abs_path, check_image, file_response, remove_quietly, store_upload
from app.models import Case, Decision, Tracklet, TrackletEmbedding, Video
from app.queue import new_task, publish
from app.routers.cases import invalidate_searches
from app.serializers import dump

router = APIRouter(tags=["대상 지정"])
MAX_PHOTO_BYTES = 20 * 1024 * 1024


def _guard_query_change(db: Session, case: Case, expected_query_version: int) -> None:
    ensure_case_open(case)
    if case.query_version != expected_query_version:
        raise ApiError(409, "QUERY_VERSION_CONFLICT", "다른 사람이 기준 대상을 먼저 바꿨어요. 다시 불러온 뒤 시도하세요.",
                       context={"case_id": case.id, "current_version": case.query_version})
    if case.query_status in ("queued", "running"):
        raise ApiError(409, "QUERY_UPDATE_IN_PROGRESS", "기준 사진의 특징을 뽑는 중이에요. 끝난 뒤 다시 시도하세요.")
    if db.scalar(select(func.count()).select_from(Decision).where(
            Decision.case_id == case.id, Decision.verdict == "confirmed", Decision.status == "active")):
        raise ApiError(409, "CONFIRMED_HISTORY_EXISTS", "확정한 장면이 있어 기준 대상을 바꿀 수 없어요. 관련 판단을 먼저 번복해 주세요.")


def _apply_new_query(db: Session, case: Case) -> None:
    """질의 버전 증가 → 이전 검색은 낡은 검색, 감시는 끈다(새 기준으로 다시 켜야 함)."""
    now = utcnow()
    case.query_version += 1
    case.query_updated_at = now
    case.query_error_code = None
    case.watch_enabled = False
    case.version, case.updated_at = case.version + 1, now
    invalidate_searches(db, case.id)


def _parse_bbox(raw: str | None, width: int, height: int) -> list[float] | None:
    if raw is None or raw.strip() == "":
        return None
    try:
        values = json.loads(raw) if raw.strip().startswith("[") else [float(v) for v in raw.split(",")]
        x, y, w, h = (float(v) for v in values)
    except (ValueError, TypeError):
        raise ApiError(422, "INVALID_PERSON_BBOX", "사람 영역은 [x, y, 너비, 높이] 숫자 네 개예요.") from None
    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > width or y + h > height:
        raise ApiError(422, "INVALID_PERSON_BBOX", "사람 영역이 사진 밖으로 나가요.")
    return [x, y, w, h]


@router.post("/api/cases/{case_id}/query/photo", status_code=202, response_model=S.QueryAccepted, summary="기준 사진 업로드·특징 추출")
def set_query_photo(
    case_id: int,
    request: Request,
    photo: UploadFile = File(...),
    expected_query_version: int = Form(..., ge=0),
    person_bbox: str | None = Form(None),
    auth: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    case = load_case(db, auth, case_id, for_update=True)
    _guard_query_change(db, case, expected_query_version)
    stored = store_upload(photo, f"queries/{case.id}/{uuid4().hex}.upload", MAX_PHOTO_BYTES)
    try:
        ext, width, height = check_image(abs_path(stored.rel))
        bbox = _parse_bbox(person_bbox, width, height)
    except ApiError:
        remove_quietly(stored.rel)
        raise
    fp = request_fingerprint({"v": expected_query_version, "bbox": bbox}, files=[stored.sha256])
    idem = Idempotency.begin(db, request, auth.user, f"set_query_photo:{case.id}", fp)
    if idem.replay:
        remove_quietly(stored.rel)
        return idem.replay
    _apply_new_query(db, case)
    final = f"queries/{case.id}/{case.query_version}{ext}"
    abs_path(stored.rel).replace(abs_path(final))
    task = new_task(db, "query_embedding", created_by=auth.user.id, case_id=case.id)
    case.query_source, case.query_photo_path, case.query_person_bbox = "photo", final, bbox
    case.query_tracklet_id, case.query_embedding, case.query_model_name = None, None, None
    case.query_status, case.query_task_id = "queued", task.id
    record_audit(db, request, auth.user, "QUERY_PHOTO_SET", "case", case.id, case_id=case.id, changed_fields=["query"])
    out = dump(S.QueryAccepted, {"case_id": case.id, "query_version": case.query_version, "task_id": task.id,
                                 "status": "queued", "status_url": f"/api/tasks/{task.id}"})
    response = idem.complete(202, out)
    db.commit()
    publish(db, task, {"case_id": case.id, "query_version": case.query_version})
    return response


@router.get("/api/cases/{case_id}/query/photo", tags=["파일 제공"], summary="기준 사진(화면용 JPEG)")
def get_query_photo(case_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    """원본은 그대로 두고, 메타데이터를 지운 화면용 JPEG를 만들어 준다."""
    case = load_case(db, auth, case_id)
    if not case.query_photo_path:
        raise ApiError(404, "MEDIA_NOT_FOUND", "기준 사진이 없어요.")
    view = f"queries/{case.id}/{case.query_version}.view.jpg"
    target = abs_path(view)
    if not target.is_file():
        from PIL import Image, ImageOps

        src = abs_path(case.query_photo_path)
        if not src.is_file():
            raise ApiError(404, "MEDIA_NOT_FOUND", "기준 사진 파일이 없어요.")
        with Image.open(src) as im:
            ImageOps.exif_transpose(im).convert("RGB").save(target, "JPEG", quality=90)
    return file_response(view, "image/jpeg")


@router.post("/api/cases/{case_id}/query/tracklet", response_model=S.QueryTarget, summary="영상 트랙렛을 기준 대상으로 선택")
def set_query_tracklet(case_id: int, body: S.TrackletQueryRequest, request: Request,
                       auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    """권한 있는 분석 완료 영상의 트랙렛 벡터를 그대로 복사한다(작업 없이 바로 ready)."""
    data = body.model_dump(mode="json")
    case = load_case(db, auth, case_id, for_update=True)
    _guard_query_change(db, case, data["expected_query_version"])
    tid = str(data["tracklet_id"])
    tracklet = db.get(Tracklet, int(tid)) if tid.isdigit() and len(tid) <= 19 else None
    video = db.get(Video, tracklet.video_id) if tracklet else None
    # 사건 전용 영상은 그 사건에서만 쓴다
    if video is None or (video.case_id is not None and video.case_id != case.id):
        raise ApiError(404, "RESOURCE_NOT_FOUND", "장면을 찾을 수 없어요.")
    if video.lifecycle != "active":
        raise ApiError(409, "MEDIA_DELETE_PENDING", "삭제 예정인 영상이에요.")
    if video.status != "done":
        raise ApiError(409, "VIDEO_NOT_READY", "영상 분석이 아직 끝나지 않았어요.")
    model = get_settings().reid_model_name
    embeddings = db.scalars(select(TrackletEmbedding).where(TrackletEmbedding.tracklet_id == tracklet.id)).all()
    if not embeddings:
        raise ApiError(409, "NO_QUERY_VECTOR", "이 장면에는 특징 벡터가 없어요.")
    match = next((e for e in embeddings if e.model_name == model), None)
    if match is None:
        raise ApiError(409, "MODEL_MISMATCH", "검색 모델과 다른 모델로 만든 벡터예요.")
    _apply_new_query(db, case)
    case.query_source, case.query_tracklet_id, case.query_photo_path, case.query_person_bbox = "tracklet", tracklet.id, None, None
    case.query_embedding, case.query_model_name = match.embedding, match.model_name
    case.query_status, case.query_task_id = "ready", None
    record_audit(db, request, auth.user, "QUERY_TRACKLET_SET", "case", case.id, case_id=case.id, changed_fields=["query"])
    db.commit()
    db.refresh(case)
    return JSONResponse(dump(S.QueryTarget, query_out(case)))
