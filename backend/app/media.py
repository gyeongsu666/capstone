"""미디어 파일: 업로드 저장, ffprobe 검사, 사진 검사, 파일 응답.

DB에는 MEDIA_ROOT 기준 상대 경로만 저장한다(서버를 옮겨도 경로가 깨지지 않게).
폴더: videos/<video_id>/source.<ext>, videos/<video_id>/playback.mp4, tracklets/<video_id>/...,
      queries/<case_id>/<query_version>.<ext>, alerts/<case_id>/<alert_id>.jpg
"""
import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile
from fastapi.responses import FileResponse

from app.config import get_settings
from app.errors import ApiError

VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv"}
VIDEO_FORMATS = {"mov,mp4,m4a,3gp,3g2,mj2", "avi", "matroska,webm"}
IMAGE_FORMATS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}
CHUNK = 1024 * 1024


def media_root() -> Path:
    return Path(get_settings().media_root).resolve()


def abs_path(rel: str) -> Path:
    """상대 경로 → 절대 경로. MEDIA_ROOT 밖으로 나가는 경로는 거절한다."""
    root = media_root()
    p = (root / rel).resolve()
    if root not in p.parents and p != root:
        raise ApiError(404, "MEDIA_NOT_FOUND", "파일을 찾을 수 없어요.")
    return p


def rel_path(p: Path) -> str:
    return p.resolve().relative_to(media_root()).as_posix()


@dataclass
class StoredFile:
    rel: str
    sha256: str
    size: int


def store_upload(upload: UploadFile, rel_target: str, max_bytes: int | None) -> StoredFile:
    """업로드를 조금씩 읽어 저장하며 SHA-256을 구한다. 크기를 넘으면 지우고 413."""
    target = abs_path(rel_target)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise ApiError(503, "STORAGE_UNAVAILABLE", "파일 저장소에 쓸 수 없어요.", retryable=True) from e
    tmp = target.with_name(target.name + ".part")
    digest, size = hashlib.sha256(), 0
    try:
        with tmp.open("wb") as out:
            while chunk := upload.file.read(CHUNK):
                size += len(chunk)
                if max_bytes is not None and size > max_bytes:
                    raise ApiError(413, "FILE_TOO_LARGE", f"파일이 너무 커요(최대 {max_bytes:,}바이트).")
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise ApiError(422, "VALIDATION_ERROR", "빈 파일이에요.", fields=[{"field": "file", "code": "empty", "message": "빈 파일"}])
        tmp.replace(target)
    except OSError as e:
        raise ApiError(503, "STORAGE_CAPACITY_EXCEEDED" if e.errno == 28 else "STORAGE_UNAVAILABLE",
                       "파일을 저장하지 못했어요.", retryable=True) from e
    finally:
        tmp.unlink(missing_ok=True)
    return StoredFile(rel=rel_path(target), sha256=digest.hexdigest(), size=size)


def remove_quietly(rel: str | None) -> None:
    if not rel:
        return
    try:
        p = abs_path(rel)
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)
    except Exception:
        pass


@dataclass
class VideoProbe:
    duration_s: float
    fps: float
    width: int
    height: int
    format_name: str


def probe_video(path: Path) -> VideoProbe:
    """ffprobe로 실제 컨테이너·길이·fps·크기를 확인한다(확장자만 믿지 않는다)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-select_streams", "v:0", str(path)],
            capture_output=True, timeout=60, check=True,
        ).stdout
        info = json.loads(out)
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError) as e:
        raise ApiError(422, "VIDEO_PROBE_FAILED", "영상을 읽지 못했어요. 파일이 손상됐는지 확인해 주세요.") from e
    fmt = info.get("format", {}).get("format_name", "")
    if fmt not in VIDEO_FORMATS:
        raise ApiError(422, "UNSUPPORTED_VIDEO_FORMAT", "지원하지 않는 영상 형식이에요(mp4·mov·avi·mkv).")
    streams = info.get("streams") or []
    if not streams:
        raise ApiError(422, "VIDEO_PROBE_FAILED", "영상 트랙이 없어요.")
    s = streams[0]
    try:
        num, den = (s.get("avg_frame_rate") or s.get("r_frame_rate") or "0/1").split("/")
        fps = float(num) / float(den or 1)
        duration = float(info["format"].get("duration") or s.get("duration"))
        width, height = int(s["width"]), int(s["height"])
    except (KeyError, ValueError, TypeError, ZeroDivisionError) as e:
        raise ApiError(422, "VIDEO_PROBE_FAILED", "영상 길이·fps를 확인하지 못했어요.") from e
    if fps <= 0 or duration <= 0:
        raise ApiError(422, "VIDEO_PROBE_FAILED", "영상 길이·fps가 올바르지 않아요.")
    return VideoProbe(duration_s=duration, fps=fps, width=width, height=height, format_name=fmt)


def check_image(path: Path) -> tuple[str, int, int]:
    """JPEG·PNG·WebP인지 실제로 열어 본다. (확장자, 너비, 높이)."""
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            fmt, (w, h) = im.format, im.size
    except (UnidentifiedImageError, OSError, SyntaxError) as e:
        raise ApiError(422, "INVALID_IMAGE", "사진을 열 수 없어요(JPEG·PNG·WebP).") from e
    if fmt not in IMAGE_FORMATS:
        raise ApiError(422, "INVALID_IMAGE", "JPEG·PNG·WebP 사진만 올릴 수 있어요.")
    if w < 16 or h < 16:
        raise ApiError(422, "INVALID_IMAGE", "사진이 너무 작아요.")
    return IMAGE_FORMATS[fmt], w, h


def file_response(rel: str | None, media_type: str, *, download_name: str | None = None) -> FileResponse:
    """인증·소속 검사를 마친 뒤 호출한다. Range 요청(구간 재생)은 Starlette가 처리한다."""
    if not rel:
        raise ApiError(404, "MEDIA_NOT_FOUND", "파일을 찾을 수 없어요.")
    p = abs_path(rel)
    if not p.is_file():
        raise ApiError(404, "MEDIA_NOT_FOUND", "파일을 찾을 수 없어요.")
    return FileResponse(p, media_type=media_type, filename=download_name,
                        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})
