"""녹화 영상(SYS01-004·005), 사건 영상(SYS02-009), 영상·트랙렛 조회와 파일 제공."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app.auth import AuthContext, ensure_case_open, load_case, require_admin, require_user, utcnow
from app.common import (
    CursorParam,
    Idempotency,
    LimitParam,
    SortKey,
    keyset_page,
    record_audit,
    request_fingerprint,
    scope_of,
)
from app.db import get_db
from app.errors import ApiError
from app.geo import point_ewkt
from app.media import VIDEO_EXTS, abs_path, file_response, probe_video, remove_quietly, store_upload
from app.models import Camera, Decision, Node, RetentionPolicy, SystemSettings, Tracklet, Video
from app.queue import new_task, publish
from app.serializers import dump
from app.video_view import (
    check_video_access,
    ensure_video_ready,
    load_video_out,
    media_out,
    tracklet_out,
    tracklet_select,
    trajectory_out,
    video_out,
    video_rows,
)

router = APIRouter()
MAX_FUTURE = timedelta(minutes=5)


# ---------------------------------------------------------------- 업로드 공통
def _check_recorded_start(value: datetime) -> None:
    if value.tzinfo is None:
        raise ApiError(422, "INVALID_RECORDED_START_AT", "녹화 시작 시각에는 시간대가 있어야 해요.")
    if value > datetime.now(timezone.utc) + MAX_FUTURE:
        raise ApiError(422, "INVALID_RECORDED_START_AT", "녹화 시작 시각이 지금보다 늦을 수 없어요.")


def _receive_file(db: Session, file: UploadFile) -> tuple:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in VIDEO_EXTS:
        raise ApiError(422, "UNSUPPORTED_VIDEO_FORMAT", "지원하지 않는 영상 형식이에요(mp4·mov·avi·mkv).")
    limit = db.get(SystemSettings, 1).max_upload_bytes
    stored = store_upload(file, f"uploads/{uuid4().hex}{ext}", limit)
    return stored, ext


def _overlap_warnings(db: Session, camera_id: int, start: datetime, duration_s: float, exclude: int | None = None) -> list[dict]:
    """같은 카메라 녹화 시간이 겹치면 경고만 한다(거절하지 않음)."""
    end = start + timedelta(seconds=duration_s)
    stmt = select(Video.id).where(
        Video.camera_id == camera_id, Video.lifecycle == "active", Video.duration_s.is_not(None),
        Video.recorded_start_at < end,
        Video.recorded_start_at + func.make_interval(0, 0, 0, 0, 0, 0, Video.duration_s) > start,
    )
    if exclude:
        stmt = stmt.where(Video.id != exclude)
    ids = list(db.scalars(stmt).all())
    if not ids:
        return []
    return [{"code": "RECORDING_OVERLAP", "message": "같은 카메라에 녹화 시간이 겹치는 영상이 있어요.", "related_video_ids": ids}]


def _create_video(db: Session, request: Request, auth: AuthContext, *, camera_id: int, case_id: int | None,
                  recorded_start_at: datetime, stored, ext: str, idem: Idempotency, audit_action: str):
    try:
        probe = probe_video(abs_path(stored.rel))
    except ApiError:
        remove_quietly(stored.rel)
        raise
    warnings = _overlap_warnings(db, camera_id, recorded_start_at, probe.duration_s)
    days = db.get(RetentionPolicy, 1).video_retention_days
    video = Video(camera_id=camera_id, case_id=case_id, uploaded_by=auth.user.id, file_path=stored.rel,
                  file_sha256=stored.sha256, size_bytes=stored.size, recorded_start_at=recorded_start_at,
                  duration_s=probe.duration_s, fps=probe.fps, width_px=probe.width, height_px=probe.height,
                  warnings=warnings, attempt_seq=1,
                  retain_until=utcnow() + timedelta(days=days) if days and case_id is None else None)
    db.add(video)
    db.flush()
    task = new_task(db, "video_analysis", created_by=auth.user.id, case_id=case_id, video_id=video.id)
    video.task_id = task.id
    final = abs_path(f"videos/{video.id}/source{ext}")
    final.parent.mkdir(parents=True, exist_ok=True)
    abs_path(stored.rel).replace(final)
    video.file_path = f"videos/{video.id}/source{ext}"
    record_audit(db, request, auth.user, audit_action, "video", video.id, case_id=case_id)
    out = dump(S.VideoAccepted, {"video_id": video.id, "task_id": task.id, "status": "queued", "progress": 0,
                                 "status_url": f"/api/tasks/{task.id}", "warnings": warnings})
    response = idem.complete(202, out)
    db.commit()
    publish(db, task, {"video_id": video.id})
    return response


# ---------------------------------------------------------------- 전역 녹화 영상
@router.post("/api/videos", status_code=202, response_model=S.VideoAccepted, tags=["관리자·녹화 영상"], summary="녹화 영상 업로드·분석 접수")
def upload_recorded_video(
    request: Request,
    file: UploadFile = File(...),
    camera_id: int = Form(..., ge=1),
    recorded_start_at: datetime = Form(...),
    auth: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """전역 카메라만. 원본 저장 → DB 확정 → 큐에는 video_id만 보낸다."""
    _check_recorded_start(recorded_start_at)
    node = db.get(Node, camera_id)
    if node is None or node.kind != "camera" or db.get(Camera, camera_id) is None:
        raise ApiError(422, "CAMERA_NOT_FOUND", "카메라를 찾을 수 없어요.", fields=[{"field": "camera_id", "code": "unknown", "message": "없는 카메라"}])
    if node.scope != "global":
        raise ApiError(409, "CASE_CAMERA_NOT_ALLOWED", "사건 전용 카메라는 사건 영상 추가로 올려 주세요.")
    stored, ext = _receive_file(db, file)
    fp = request_fingerprint({"camera_id": camera_id, "recorded_start_at": recorded_start_at.isoformat()}, files=[stored.sha256])
    idem = Idempotency.begin(db, request, auth.user, "upload_recorded_video", fp)
    if idem.replay:
        remove_quietly(stored.rel)
        return idem.replay
    return _create_video(db, request, auth, camera_id=camera_id, case_id=None, recorded_start_at=recorded_start_at,
                         stored=stored, ext=ext, idem=idem, audit_action="VIDEO_UPLOAD")


def _video_filters(stmt, *, camera_id=None, status=None, recorded_from=None, recorded_to=None):
    if camera_id:
        stmt = stmt.where(Video.camera_id == camera_id)
    if status:
        stmt = stmt.where(Video.status == status)
    if recorded_from:
        stmt = stmt.where(Video.recorded_start_at >= recorded_from)
    if recorded_to:
        stmt = stmt.where(Video.recorded_start_at <= recorded_to)
    return stmt


def _video_page(db: Session, stmt, *, limit: int, cursor: str | None, scope: str) -> dict:
    page = keyset_page(db, stmt, [SortKey(Video.created_at), SortKey(Video.id)], limit=limit, cursor=cursor,
                       scope=scope, key_of=lambda v: (v.created_at, v.id))
    ids = [v.id for v in page.rows]
    rows = {r[0].id: r for r in video_rows(db, select(Video).where(Video.id.in_(ids)))} if ids else {}
    return dump(S.VideoPage, {"items": [video_out(*rows[i]) for i in ids], "next_cursor": page.next_cursor, "has_more": page.has_more})


@router.get("/api/videos", response_model=S.VideoPage, tags=["관리자·녹화 영상"], summary="녹화 영상 목록·분석 상태·진행률")
def list_videos(
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    camera_id: int | None = Query(None, ge=1),
    status: str | None = Query(None, pattern="^(queued|running|done|failed)$"),
    recorded_from: datetime | None = None,
    recorded_to: datetime | None = None,
    scope: str = Query("global", pattern="^(global|case|all)$"),
    case_id: int | None = Query(None, ge=1),
    _: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(Video).where(Video.lifecycle == "active")
    if scope == "global":
        stmt = stmt.where(Video.case_id.is_(None))
    elif scope == "case":
        stmt = stmt.where(Video.case_id.is_not(None))
    if case_id:
        stmt = stmt.where(Video.case_id == case_id)
    stmt = _video_filters(stmt, camera_id=camera_id, status=status, recorded_from=recorded_from, recorded_to=recorded_to)
    return _video_page(db, stmt, limit=limit, cursor=cursor,
                       scope=scope_of("videos", c=camera_id, s=status, f=recorded_from, t=recorded_to, sc=scope, k=case_id))


@router.get("/api/videos/stats", response_model=S.VideoStats, tags=["관리자·녹화 영상"], summary="녹화 영상 전체 현황 집계")
def video_stats(_: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    """R7: 전역 녹화 영상 전체(사건 전용 제외, 삭제 예정 제외). 한 쿼리라서 같은 스냅샷이다."""
    rows = db.execute(select(Video.camera_id, Video.status, func.count(), func.now())
                      .where(Video.case_id.is_(None), Video.lifecycle == "active")
                      .group_by(Video.camera_id, Video.status)).all()
    zero = lambda: {"queued": 0, "running": 0, "done": 0, "failed": 0}  # noqa: E731
    total, by_camera, as_of = zero(), {}, datetime.now(timezone.utc)
    for camera_id, status, n, now in rows:
        as_of = now
        total[status] += n
        by_camera.setdefault(camera_id, zero())[status] += n
    return dump(S.VideoStats, {
        "total": sum(total.values()), "by_status": total, "as_of": as_of,
        "by_camera": [{"camera_id": cid, "total": sum(c.values()), "by_status": c} for cid, c in sorted(by_camera.items())],
    })


@router.get("/api/videos/{video_id}", response_model=S.Video, tags=["영상 조회"], summary="영상 상세·분석 현황·재생 주소")
def get_video(video_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    check_video_access(db, auth, db.get(Video, video_id))
    return dump(S.Video, load_video_out(db, video_id))


@router.post("/api/videos/{video_id}/analysis", status_code=202, response_model=S.VideoAccepted, tags=["관리자·녹화 영상"], summary="실패한 영상 분석 재처리")
def retry_analysis(video_id: int, body: S.VideoRetryRequest, request: Request, auth: AuthContext = Depends(require_admin),
                   db: Session = Depends(get_db)):
    """실패한 영상만 새 task_id로 다시 접수한다. 원본과 video_id는 그대로, 미완성 결과는 지운다."""
    idem = Idempotency.begin(db, request, auth.user, f"retry_analysis:{video_id}", request_fingerprint(body.model_dump(mode="json")))
    if idem.replay:
        return idem.replay
    video = db.scalar(select(Video).where(Video.id == video_id).with_for_update())
    if video is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "영상을 찾을 수 없어요.")
    if video.lifecycle != "active":
        raise ApiError(409, "MEDIA_DELETE_PENDING", "삭제 예정인 영상이에요.")
    if video.status == "done":
        raise ApiError(409, "ANALYSIS_ALREADY_DONE", "이미 분석이 끝난 영상이에요.")
    if video.status != "failed":
        raise ApiError(409, "QUERY_UPDATE_IN_PROGRESS", "분석 중인 영상이에요.")
    tracklet_ids = select(Tracklet.id).where(Tracklet.video_id == video.id)
    if db.scalar(select(func.count()).select_from(Decision).where(Decision.tracklet_id.in_(tracklet_ids))):
        raise ApiError(409, "RESULT_REFERENCED", "판단 기록이 있는 분석 결과라 다시 분석할 수 없어요.")
    db.execute(delete(Tracklet).where(Tracklet.video_id == video.id))
    task = new_task(db, "video_analysis", created_by=auth.user.id, case_id=video.case_id, video_id=video.id,
                    seq=video.attempt_seq + 1)
    video.task_id, video.attempt_seq = task.id, video.attempt_seq + 1
    video.status, video.stage, video.progress = "queued", "queued", 0
    video.processed_samples, video.total_samples, video.skipped_samples = 0, None, 0
    video.error_code = video.error_message = None
    video.updated_at = utcnow()
    record_audit(db, request, auth.user, "VIDEO_REANALYZE", "video", video.id, case_id=video.case_id)
    out = dump(S.VideoAccepted, {"video_id": video.id, "task_id": task.id, "status": "queued", "progress": 0,
                                 "status_url": f"/api/tasks/{task.id}", "warnings": video.warnings})
    response = idem.complete(202, out)
    db.commit()
    publish(db, task, {"video_id": video.id})
    return response


@router.get("/api/videos/{video_id}/tracklets", response_model=S.TrackletPage, tags=["영상 조회"], summary="영상 속 인물 선택용 트랙렛 목록")
def list_video_tracklets(video_id: int, cursor: str | None = CursorParam, limit: int = LimitParam,
                         auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    video = check_video_access(db, auth, db.get(Video, video_id))
    ensure_video_ready(video)
    stmt = tracklet_select().where(Tracklet.video_id == video_id)
    page = keyset_page(db, stmt, [SortKey(Tracklet.start_at, False), SortKey(Tracklet.id, False)], limit=limit, cursor=cursor,
                       scalars=False, scope=scope_of("tracklets", v=video_id), key_of=lambda r: (r[0].start_at, r[0].id))
    return dump(S.TrackletPage, {"items": [tracklet_out(*r) for r in page.rows], "next_cursor": page.next_cursor, "has_more": page.has_more})


def _load_tracklet(db: Session, auth: AuthContext, tracklet_id: str):
    if not tracklet_id.isdigit() or len(tracklet_id) > 19:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "장면을 찾을 수 없어요.")
    row = db.execute(tracklet_select().where(Tracklet.id == int(tracklet_id))).first()
    if row is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "장면을 찾을 수 없어요.")
    video = check_video_access(db, auth, db.get(Video, row[0].video_id))
    return row, video


@router.get("/api/tracklets/{tracklet_id}", response_model=S.TrackletScene, tags=["영상 조회"], summary="트랙렛 장면 상세")
def get_tracklet_scene(tracklet_id: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    (t, camera_name, model), video = _load_tracklet(db, auth, tracklet_id)
    ensure_video_ready(video)
    return dump(S.TrackletScene, {
        "tracklet": tracklet_out(t, camera_name, model), "media": media_out(video, t.start_at, t.end_at),
        "trajectory": trajectory_out(t.trajectory), "source_width_px": video.width_px or 1, "source_height_px": video.height_px or 1,
    })


@router.get("/api/tracklets/{tracklet_id}/thumbnail", tags=["파일 제공"], summary="트랙렛 썸네일")
def get_tracklet_thumbnail(tracklet_id: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    (t, _, _), video = _load_tracklet(db, auth, tracklet_id)
    if video.lifecycle != "active":
        raise ApiError(409, "MEDIA_DELETE_PENDING", "삭제 예정인 영상이에요.")
    return file_response(t.thumbnail_path, "image/jpeg")


@router.get("/api/tracklets/{tracklet_id}/highlight", tags=["파일 제공"], summary="인물 강조 하이라이트 MP4")
def get_tracklet_highlight(tracklet_id: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    """하이라이트 영상은 만들지 않는다(D01). 화면은 원본 구간 + trajectory 박스로 강조한다."""
    _load_tracklet(db, auth, tracklet_id)
    raise ApiError(501, "FEATURE_NOT_IMPLEMENTED", "하이라이트 영상은 제공하지 않아요. 원본 구간 재생을 써 주세요.")


@router.get("/api/videos/{video_id}/stream", tags=["파일 제공"], summary="원본과 시간 대응하는 재생용 MP4")
def stream_video(video_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    video = check_video_access(db, auth, db.get(Video, video_id))
    if video.lifecycle != "active":
        raise ApiError(409, "MEDIA_DELETE_PENDING", "삭제 예정인 영상이에요.")
    if not video.playback_path:
        raise ApiError(409, "VIDEO_NOT_READY", "재생용 영상을 만드는 중이에요.")
    return file_response(video.playback_path, "video/mp4")


# ---------------------------------------------------------------- 사건 영상
@router.post("/api/cases/{case_id}/videos", status_code=202, response_model=S.VideoAccepted, tags=["사건 영상"], summary="사건 영상 추가·위치·방향·녹화 시각")
def upload_case_video(
    case_id: int,
    request: Request,
    file: UploadFile = File(...),
    longitude: float = Form(..., ge=-180, le=180),
    latitude: float = Form(..., ge=-90, le=90),
    direction_deg: float = Form(..., ge=0, lt=360),
    recorded_start_at: datetime = Form(...),
    camera_name: str = Form(..., min_length=1, max_length=100),
    auth: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    """사설 CCTV·블랙박스 등. 같은 트랜잭션에서 사건 전용 카메라 노드와 영상을 만든다(다른 사건·전역 지도·감시에서 제외)."""
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    _check_recorded_start(recorded_start_at)
    if not db.scalar(select(func.count()).select_from(Node).where(Node.scope == "global")):
        raise ApiError(409, "NO_MAP_NODES", "지도에 카메라·보조지점이 없어 도보 경로를 계산할 수 없어요.")
    stored, ext = _receive_file(db, file)
    fields = {"longitude": longitude, "latitude": latitude, "direction_deg": direction_deg,
              "recorded_start_at": recorded_start_at.isoformat(), "camera_name": camera_name.strip()}
    idem = Idempotency.begin(db, request, auth.user, f"upload_case_video:{case_id}", request_fingerprint(fields, files=[stored.sha256]))
    if idem.replay:
        remove_quietly(stored.rel)
        return idem.replay
    node = Node(kind="camera", name=camera_name.strip(), scope="case", case_id=case.id,
                location=point_ewkt({"type": "Point", "coordinates": [longitude, latitude]}))
    db.add(node)
    db.flush()
    db.add(Camera(node_id=node.id, heading_deg=direction_deg, fov_deg=90.0, edge_node_map={}))  # 화각 입력은 받지 않는다(요청서 3.7)
    db.flush()
    walk = new_task(db, "walk_graph_recalculation", created_by=auth.user.id, case_id=case.id)
    response = _create_video(db, request, auth, camera_id=node.id, case_id=case.id, recorded_start_at=recorded_start_at,
                             stored=stored, ext=ext, idem=idem, audit_action="CASE_VIDEO_UPLOAD")
    publish(db, walk, {"node_ids": [node.id], "include_manual": False})
    return response


@router.get("/api/cases/{case_id}/videos", response_model=S.VideoPage, tags=["사건 영상"], summary="사건에 추가한 영상 목록")
def list_case_videos(case_id: int, cursor: str | None = CursorParam, limit: int = LimitParam,
                     status: str | None = Query(None, pattern="^(queued|running|done|failed)$"),
                     auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    load_case(db, auth, case_id)
    stmt = _video_filters(select(Video).where(Video.case_id == case_id), status=status)
    return _video_page(db, stmt, limit=limit, cursor=cursor, scope=scope_of("case_videos", c=case_id, s=status))

