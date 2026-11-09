"""video_1.mp4를 YOLO11n과 YOLO26n으로 추적해 MP4 두 개를 저장합니다.

실행: python 05_make_tracking_videos.py
출력: tracking_videos/실행별_폴더/yolo11n_tracking.mp4, yolo26n_tracking.mp4

두 모델 모두 전체 프레임에서 사람을 검출하고 ByteTrack으로 ID를 연결합니다.
기존 검색 벤치마크 파일과 측정 결과는 읽거나 수정하지 않습니다.
"""

import argparse
import gc
import json
import math
import tempfile
from datetime import datetime
from pathlib import Path
from time import perf_counter
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
MODELS = ("yolo11n", "yolo26n")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, default=ROOT / "video_1.mp4")
    parser.add_argument("--output-root", type=Path, default=ROOT / "tracking_videos")
    parser.add_argument("--device", default="auto", help="auto, cpu, 0, cuda:0")
    parser.add_argument("--conf", type=float, default=0.1,
                        help="Keep weak detections for ByteTrack recovery (default: 0.1)")
    parser.add_argument("--iou", type=float, default=0.7)
    parser.add_argument("--imgsz", type=int, default=1280,
                        help="Larger detector input for small people (default: 1280)")
    parser.add_argument("--lost-seconds", type=float, default=3.0,
                        help="Keep lost track candidates this many seconds (default: 3)")
    args = parser.parse_args()
    if not args.video.is_file():
        parser.error(f"Video not found: {args.video}")
    for name in MODELS:
        if not (ROOT / f"{name}.pt").is_file():
            parser.error(f"Weights not found: {ROOT / (name + '.pt')}")
    if not 0 < args.conf <= 1 or not 0 < args.iou <= 1 or args.imgsz < 32:
        parser.error("--conf/--iou must be in (0, 1] and --imgsz must be >= 32")
    if not math.isfinite(args.lost_seconds) or args.lost_seconds <= 0:
        parser.error("--lost-seconds must be finite and > 0")
    return args


def tracker_settings(fps, lost_seconds):
    """Retain weak detections for recovery; start new IDs from stronger ones."""
    return {
        "tracker_type": "bytetrack",
        "track_high_thresh": 0.25,
        "track_low_thresh": 0.10,
        "new_track_thresh": 0.25,
        "track_buffer": max(1, round(fps * lost_seconds)),
        "match_thresh": 0.8,
        "fuse_score": True,
    }


def choose_device(value, torch):
    if value == "auto":
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    if value == "cpu":
        return "cpu"
    candidate = f"cuda:{value}" if value.isdigit() else value
    device = torch.device(candidate)
    index = 0 if device.index is None else device.index
    if (device.type != "cuda" or not torch.cuda.is_available()
            or index >= torch.cuda.device_count()):
        raise ValueError(f"Unavailable device: {value}. Use --device cpu if needed.")
    return f"cuda:{index}"


def draw_tracks(frame, boxes, name, frame_count, fps, cv2, args):
    """Draw English labels without font downloads or editing the source video."""
    display = frame.copy()
    height, width = display.shape[:2]
    if boxes is not None:
        records = boxes.cpu().numpy()
        identities = records.id
        for index, (coords, confidence) in enumerate(zip(records.xyxy, records.conf)):
            x1, y1, x2, y2 = map(float, coords)
            x1, x2 = [max(0, min(width - 1, round(x))) for x in (x1, x2)]
            y1, y2 = [max(0, min(height - 1, round(y))) for y in (y1, y2)]
            if x2 <= x1 or y2 <= y1:
                continue
            if identities is None:
                color = (170, 170, 170)
                label = f"person {float(confidence):.2f}"
            else:
                identity = int(identities[index])
                color = tuple(int((identity * factor) % 200 + 55) for factor in (73, 37, 113))
                label = f"ID {identity}  {float(confidence):.2f}"
            cv2.rectangle(display, (x1, y1), (x2, y2), color, 2)
            cv2.putText(display, label, (x1, max(20, y1 - 7)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 4, cv2.LINE_AA)
            cv2.putText(display, label, (x1, max(20, y1 - 7)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
    header = (f"{name.upper()} | ByteTrack | {(frame_count - 1) / fps:.2f}s | frame {frame_count}"
              f" | {args.imgsz}px | conf {args.conf:.2f} | keep {args.lost_seconds:g}s")
    cv2.putText(display, header, (12, 28), cv2.FONT_HERSHEY_SIMPLEX,
                0.65, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(display, header, (12, 28), cv2.FONT_HERSHEY_SIMPLEX,
                0.65, (0, 255, 255), 2, cv2.LINE_AA)
    return display


def render_video(args, name, output_dir, device, cv2, torch, YOLO):
    final_path = output_dir / f"{name}_tracking.mp4"
    partial_path = output_dir / f"{name}_tracking.partial.mp4"
    if final_path.exists() or partial_path.exists():
        raise FileExistsError(f"Output already exists: {final_path}")
    started = perf_counter()
    model = writer = cap = temporary_config = None
    frame_count = 0
    print(f"\n=== {name.upper()} + ByteTrack ===", flush=True)
    try:
        cap = cv2.VideoCapture(str(args.video.resolve()))
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {args.video}")
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if not math.isfinite(fps) or fps <= 0:
            raise RuntimeError("Video has invalid FPS")
        settings = tracker_settings(fps, args.lost_seconds)
        # JSON is valid YAML. Close the file before Ultralytics reads it on Windows.
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".yaml",
                                         prefix="_bytetrack_", dir=output_dir,
                                         delete=False) as config_file:
            temporary_config = Path(config_file.name)
            json.dump(settings, config_file, indent=2)
        print(f"Lost track buffer: {settings['track_buffer']} frames "
              f"({args.lost_seconds:g}s at {fps:.3f} FPS)", flush=True)
        reported_frames = float(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        expected_frames = round(reported_frames) if math.isfinite(reported_frames) else 0
        ok, frame = cap.read()
        if not ok:
            raise RuntimeError("Video contains no readable frames")
        height, width = frame.shape[:2]
        # MP4 encoders usually need even dimensions. Pad at most one row/column.
        out_width, out_height = width + width % 2, height + height % 2
        writer = cv2.VideoWriter(str(partial_path), cv2.VideoWriter_fourcc(*"mp4v"),
                                 fps, (out_width, out_height))
        if not writer.isOpened():
            raise RuntimeError(f"Cannot create MP4: {partial_path}")
        model = YOLO(str(ROOT / f"{name}.pt"))
        while ok:
            if frame.shape[:2] != (height, width):
                raise RuntimeError("Source frame dimensions changed during decoding")
            # Feed every frame to one persistent tracker. A new YOLO instance is
            # created for each model so their tracking states are independent.
            result = model.track(
                frame, persist=True, tracker=str(temporary_config), classes=[0],
                conf=args.conf, iou=args.iou, imgsz=args.imgsz, max_det=300,
                device=device, half=False, augment=False, save=False,
                show=False, stream=False, verbose=False,
            )[0]
            frame_count += 1
            display = draw_tracks(frame, result.boxes, name, frame_count, fps, cv2, args)
            if (out_width, out_height) != (width, height):
                display = cv2.copyMakeBorder(display, 0, out_height - height,
                                              0, out_width - width, cv2.BORDER_CONSTANT,
                                              value=(0, 0, 0))
            writer.write(display)
            if frame_count == 1 or frame_count % max(1, round(fps * 5)) == 0:
                total = str(expected_frames) if expected_frames > 0 else "?"
                print(f"{name}: {frame_count}/{total} frames | "
                      f"elapsed {perf_counter() - started:.1f}s", flush=True)
            ok, frame = cap.read()
        writer.release()
        writer = None
        cap.release()
        cap = None
        if expected_frames > 0 and frame_count != expected_frames:
            raise RuntimeError(
                f"Source reports {expected_frames} frames, but only {frame_count} were decoded. "
                f"Incomplete video kept at {partial_path}"
            )
        # Check that the MP4 is readable and records every processed frame.
        probe = cv2.VideoCapture(str(partial_path))
        try:
            readable, _ = probe.read()
            saved_count = round(probe.get(cv2.CAP_PROP_FRAME_COUNT))
            if not readable or saved_count != frame_count:
                raise RuntimeError(
                    f"MP4 validation failed: expected {frame_count} frames, got {saved_count}"
                )
        finally:
            probe.release()
        partial_path.rename(final_path)
        print(f"Saved: {final_path}", flush=True)
        print(f"Tracking + rendering + validation: {perf_counter() - started:.2f}s "
              f"| {frame_count} frames | {fps:.3f} FPS playback", flush=True)
        return final_path
    finally:
        if writer is not None:
            writer.release()
        if cap is not None:
            cap.release()
        if temporary_config is not None:
            temporary_config.unlink(missing_ok=True)
        del model
        gc.collect()
        if device.startswith("cuda:"):
            torch.cuda.empty_cache()


def main():
    args = parse_args()
    import cv2
    import torch
    from ultralytics import YOLO

    device = choose_device(args.device, torch)
    stamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
    output_dir = args.output_root.resolve() / f"tracking_{stamp}_{uuid4().hex[:6]}"
    output_dir.mkdir(parents=True, exist_ok=False)
    print(f"Video: {args.video.resolve()}", flush=True)
    print(f"Device: {device}; tracker: ByteTrack; conf: {args.conf}; imgsz: {args.imgsz}; "
          f"lost track retention: {args.lost_seconds:g}s", flush=True)
    print(f"Output: {output_dir}", flush=True)
    print("Processing YOLO11n, then YOLO26n. Existing search benchmark results are unchanged.", flush=True)
    outputs = []
    try:
        for name in MODELS:
            outputs.append(render_video(args, name, output_dir, device, cv2, torch, YOLO))
    except BaseException:
        print(f"\nStopped before both videos completed. Inspect: {output_dir}", flush=True)
        print("Files ending .partial.mp4 are incomplete outputs.", flush=True)
        raise
    print("\n=== Both tracking videos completed ===", flush=True)
    for path in outputs:
        print(path, flush=True)


if __name__ == "__main__":
    main()
