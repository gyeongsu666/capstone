"""Search video_1.mp4 for person_1.png using YOLO26n + yolo26n-reid.onnx.

The filename is retained, but this is now a Top-5 photo search benchmark.
Defaults match the Intel search: imgsz=640, conf=0.3, interval=1 second, top_k=5.
The full reference image and unpadded person crops are encoded, as in Intel search.
No tracker, Intel model or full tracking video is run.
"""

import argparse
import csv
import json
import math
import platform
import sys
import traceback
from datetime import datetime
from importlib.metadata import version
from pathlib import Path
from time import perf_counter
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
MODEL_ID = "yolo26n-reid.onnx"
LABEL = "yolo26n_reid"
PREPROCESSING = "BGR to RGB; float32 /255; bilinear resize (align_corners=False); NCHW; L2 normalized"


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, default=ROOT / "video_1.mp4")
    parser.add_argument("--image", type=Path, default=ROOT / "person_3.png")
    parser.add_argument("--output-root", type=Path, default=ROOT / "yolo26n_reid_results")
    parser.add_argument("--reid-model", type=Path, default=ROOT / "models" / MODEL_ID)
    parser.add_argument("--reid-imgsz", type=int, default=448,
                        help="Fallback crop size for dynamic ONNX inputs; static model dimensions take priority")
    parser.add_argument("--device", default="auto", help="auto, cpu, 0, cuda:0")
    parser.add_argument("--interval", type=float, default=1.0, help="Sampling seconds; 0 = every frame")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--conf", type=float, default=0.3)
    parser.add_argument("--iou", type=float, default=0.7)
    parser.add_argument("--max-det", type=int, default=300)
    parser.add_argument("--max-seconds", type=float, default=0, help="0 = full video")
    args = parser.parse_args(argv)
    for path in (args.video, args.image, ROOT / "yolo26n.pt"):
        if not path.is_file():
            parser.error(f"File not found: {path}")
    if not math.isfinite(args.interval) or args.interval < 0:
        parser.error("--interval must be finite and >= 0")
    if not math.isfinite(args.max_seconds) or args.max_seconds < 0:
        parser.error("--max-seconds must be finite and >= 0")
    if not 0 < args.conf <= 1 or not 0 < args.iou <= 1:
        parser.error("--conf and --iou must be in (0, 1]")
    if args.reid_model.suffix.lower() != ".onnx":
        parser.error("--reid-model must be an ONNX embedding model")
    if not args.reid_model.is_file() and args.reid_model.name != MODEL_ID:
        parser.error(f"Custom Re-ID model not found: {args.reid_model}")
    if args.reid_imgsz < 1:
        parser.error("--reid-imgsz must be >= 1")
    if args.imgsz < 32 or args.top_k < 1 or args.max_det < 1:
        parser.error("--imgsz must be >= 32; --top-k and --max-det must be >= 1")
    return args


def require_provider(device, providers):
    required = "CUDAExecutionProvider" if device.startswith("cuda:") else "CPUExecutionProvider"
    if not providers or providers[0] != required:
        raise RuntimeError(
            f"Re-ID requested {device}, but ONNX Runtime providers are {providers}. "
            "CUDA requires a compatible onnxruntime-gpu installation and CUDA/cuDNN libraries. "
            "CPU fallback is not accepted for this benchmark; use --device cpu for an explicit CPU run."
        )


def require_cuda_major_match(torch_cuda, ort_cuda):
    """PyTorch's bundled DLLs cannot supply a different CUDA major ABI."""
    if torch_cuda and ort_cuda and str(torch_cuda).split('.')[0] != str(ort_cuda).split('.')[0]:
        raise RuntimeError(
            f"CUDA runtime mismatch: PyTorch uses CUDA {torch_cuda}, "
            f"but ONNX Runtime was built with CUDA {ort_cuda}. "
            "Their DLLs are not interchangeable. For this workspace's CUDA 12 PyTorch, "
            "remove both onnxruntime and onnxruntime-gpu, then install "
            "onnxruntime-gpu==1.21.1 in the same virtual environment. "
            "See README_실험.md. No CPU benchmark was run."
        )


def reid_input_size(shape, fallback, input_type):
    if input_type != "tensor(float)":
        raise ValueError("Re-ID ONNX must have float32 input to retain the Intel benchmark precision")
    if len(shape) != 4 or (isinstance(shape[0], int) and shape[0] != 1):
        raise ValueError("Re-ID ONNX must accept NCHW input with batch size 1 or dynamic batch")
    if isinstance(shape[1], int) and shape[1] != 3:
        raise ValueError("Re-ID ONNX must accept three RGB channels")
    height = shape[2] if isinstance(shape[2], int) and shape[2] > 0 else fallback
    width = shape[3] if isinstance(shape[3], int) and shape[3] > 0 else height
    return height, width


def retain_scene(scenes, candidate, frame, top_k):
    """Keep one candidate per frame and at most top_k scenes; ties retain earlier ones."""
    for i, existing in enumerate(scenes):
        if existing["frame_1based"] == candidate["frame_1based"]:
            if candidate["cosine_similarity"] <= existing["cosine_similarity"]:
                return
            del scenes[i]
            break
    if len(scenes) < top_k or candidate["cosine_similarity"] > scenes[-1]["cosine_similarity"]:
        scenes.append({**candidate, "frame": frame.copy()})
        scenes.sort(key=lambda item: item["cosine_similarity"], reverse=True)
        del scenes[top_k:]


class OnnxReIDEncoder:
    """Ultralytics ONNX appearance encoder, using Intel's exact unpadded crops.

    Preprocessing follows ultralytics.trackers.utils.reid.ReID._crops_to_tensor.
    We call ONNX Runtime directly to verify providers and avoid tracker crop padding.
    """

    def __init__(self, path, device, fallback_size, torch, np):
        import onnxruntime as ort
        try:
            from onnxruntime.capi.build_and_package_info import cuda_version as ort_cuda
        except ImportError:
            ort_cuda = None
        from ultralytics.utils.downloads import attempt_download_asset

        self.torch, self.np = torch, np
        if device.startswith("cuda:"):
            require_cuda_major_match(torch.version.cuda, ort_cuda)
            if callable(getattr(ort, "preload_dlls", None)):
                # Official ORT loader searches compatible PyTorch CUDA/cuDNN DLLs.
                ort.preload_dlls()
        path = path.resolve()
        if not path.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            print(f"Downloading official Re-ID encoder: {path.name}", flush=True)
            path = Path(attempt_download_asset(str(path))).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Re-ID ONNX was not downloaded: {path}")
        available = ort.get_available_providers()
        if device.startswith("cuda:"):
            if "CUDAExecutionProvider" not in available:
                require_provider(device, available)
            providers = [("CUDAExecutionProvider", {"device_id": int(device.split(":")[1])}),
                         "CPUExecutionProvider"]
        else:
            providers = ["CPUExecutionProvider"]
        self.session = ort.InferenceSession(str(path), providers=providers)
        require_provider(device, self.session.get_providers())
        # Do not silently switch the inference session to CPU on an execution error.
        self.session.disable_fallback()
        inputs, outputs = self.session.get_inputs(), self.session.get_outputs()
        if len(inputs) != 1 or len(outputs) != 1:
            raise ValueError("Re-ID ONNX must have one image input and one embedding output")
        self.input = inputs[0]
        self.output = outputs[0]
        self.input_size = reid_input_size(self.input.shape, fallback_size, self.input.type)
        self.dimension = None
        self.model_path = path
        self.runtime_version = ort.__version__
        self.metadata = {
            "model_path": str(path), "runtime": "onnxruntime", "runtime_version": ort.__version__,
            "runtime_build_cuda": ort_cuda, "torch_build_cuda": torch.version.cuda,
            "providers": self.session.get_providers(),
            "provider_options": self.session.get_provider_options(),
            "requested_device": device, "input_name": self.input.name,
            "input_shape": self.input.shape, "input_type": self.input.type,
            "input_height_width": list(self.input_size),
            "output_name": self.output.name, "output_shape": self.output.shape,
            "preprocessing": PREPROCESSING, "batch_size": 1,
            "cuda_note": "CUDA provider has priority; ORT may assign unsupported operators to CPU.",
        }

    def embed(self, bgr):
        if bgr.ndim != 3 or bgr.shape[2] != 3 or not bgr.size:
            raise ValueError("Re-ID expects a nonempty BGR person image")
        # Match the official ReID encoder: RGB, /255, bilinear without letterboxing.
        # No save_one_box padding/gain: use the supplied crop unchanged, as Intel does.
        tensor = self.torch.from_numpy(self.np.ascontiguousarray(bgr[..., ::-1]))
        tensor = tensor.permute(2, 0, 1).unsqueeze(0).float() / 255.0
        tensor = self.torch.nn.functional.interpolate(
            tensor, size=self.input_size, mode="bilinear", align_corners=False)
        result = self.session.run([self.output.name], {self.input.name: tensor.numpy()})[0]
        if result.ndim != 2 or result.shape[0] != 1:
            raise RuntimeError(f"Expected one embedding vector [1, D], got {result.shape}")
        vector = self.np.asarray(result[0], dtype=self.np.float32).copy()
        norm = float(self.np.linalg.norm(vector))
        if (not vector.size or not self.np.isfinite(vector).all()
                or not math.isfinite(norm) or norm <= 0):
            raise ValueError("Re-ID returned an invalid embedding vector")
        if self.dimension is None:
            self.dimension = len(vector)
        if len(vector) != self.dimension:
            raise RuntimeError("Query and gallery vector dimensions differ")
        return vector / norm


def main(process_started=None):
    if process_started is None:
        process_started = perf_counter()
    args = parse_args()
    print("\n=== YOLO26n + yolo26n-reid.onnx | reference-photo Top-5 search ===", flush=True)
    import cv2
    import numpy as np
    import torch
    from ultralytics import YOLO
    # Shared I/O and device helpers only; importing this module does not run or
    # initialize any Intel/SigLIP model or use its CLI defaults.
    from search_benchmark import read_image, resolve_device, save_image, sha384, write_csv

    import_seconds = perf_counter() - process_started
    setup_started = perf_counter()
    torch.manual_seed(0)
    np.random.seed(0)
    device = resolve_device(args.device, torch)
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False

    def synchronize():
        if device.startswith("cuda:"):
            torch.cuda.synchronize(device)

    stamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
    output = args.output_root.resolve() / f"{LABEL}_{stamp}_{uuid4().hex[:6]}"
    output.mkdir(parents=True)
    settings = {
        "combination": LABEL, "source_video": str(args.video.resolve()),
        "query_image": str(args.image.resolve()), "query_sha384": sha384(args.image),
        "source_video_bytes": args.video.stat().st_size,
        "yolo_weights": str(ROOT / "yolo26n.pt"), "feature_model": MODEL_ID,
        "yolo_device": device, "feature_device": device,
        "interval_requested_seconds": args.interval, "top_k": args.top_k,
        "confidence": args.conf, "iou": args.iou,
        "imgsz": args.imgsz, "max_det": args.max_det,
        "detector_postprocess": "Ultralytics default, identical to search_benchmark.py",
        "torch_precision": "float32", "batch_size": 1,
        "max_seconds": args.max_seconds, "detection_includes_native_features": False,
        "reid_model_requested": str(args.reid_model.resolve()),
        "query_encoding": "full supplied photo, without person detection, as in Intel search",
        "rank_unit": "best person detection per sampled frame; repeated identities allowed",
    }
    (output / "settings.json").write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
    cap = None
    try:
        cap = cv2.VideoCapture(str(args.video.resolve()))
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {args.video}")
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if not math.isfinite(fps) or fps <= 0:
            raise RuntimeError("Invalid source FPS")
        expected_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        ok, first = cap.read()
        if not ok:
            raise RuntimeError("Video contains no readable frames")
        height, width = first.shape[:2]
        query_image = read_image(args.image, cv2, np)
        stride = 1 if args.interval == 0 else max(1, round(fps * args.interval))
        frame_limit = math.ceil(args.max_seconds * fps) if args.max_seconds else None
        tick = perf_counter()
        model = YOLO(str(ROOT / "yolo26n.pt"))
        encoder = OnnxReIDEncoder(args.reid_model, device, args.reid_imgsz, torch, np)
        synchronize()
        model_load_seconds = perf_counter() - tick
        settings["feature_model"] = encoder.model_path.name
        settings["feature_model_sha384"] = sha384(encoder.model_path)
        settings["yolo_weights_sha384"] = sha384(ROOT / "yolo26n.pt")
        settings["reid_backend"] = encoder.metadata
        (output / "settings.json").write_text(
            json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
        def detect(frame):
            # Intentionally match the original Intel search's detector arguments.
            result = model.predict(
                frame, classes=[0], conf=args.conf, iou=args.iou, imgsz=args.imgsz,
                max_det=args.max_det, device=device, half=False, augment=False,
                verbose=False, save=False,
            )[0]
            return result.boxes.xyxy.cpu().numpy(), result.boxes.conf.cpu().numpy()

        print(f"Reference: {args.image.resolve()} | video: {args.video.resolve()}", flush=True)
        print(f"YOLO: {device}; Re-ID: {encoder.metadata['providers']}; FP32; batch 1", flush=True)
        print(f"Re-ID input size: {encoder.input_size}; warming up...", flush=True)
        tick = perf_counter()
        detect(first)
        encoder.embed(query_image)
        synchronize()
        warmup_seconds = perf_counter() - tick
        tick = perf_counter()
        query_vector = encoder.embed(query_image)
        synchronize()
        query_seconds = perf_counter() - tick
        query_info = {"encoding": settings["query_encoding"], "image_shape": list(query_image.shape),
                      "vector_dimension": encoder.dimension}
        (output / "query_encoding.json").write_text(json.dumps(query_info, indent=2), encoding="utf-8")
        cap.release()
        cap = cv2.VideoCapture(str(args.video.resolve()))
        if not cap.isOpened():
            raise RuntimeError("Cannot reopen source video")
        setup_seconds = perf_counter() - setup_started
        vectors, detections, best_scenes = [], [], []
        decoded_frames = sampled_frames = raw_detections = invalid_boxes = 0
        decode_seconds = detection_seconds = embedding_seconds = similarity_seconds = 0.0
        search_started = perf_counter()
        print(f"Sampling every {stride} frames ({stride / fps:.3f}s); top {args.top_k}", flush=True)
        while frame_limit is None or decoded_frames < frame_limit:
            tick = perf_counter()
            ok, frame = cap.read()
            decode_seconds += perf_counter() - tick
            if not ok:
                break
            index = decoded_frames
            decoded_frames += 1
            if index % stride:
                continue
            sampled_frames += 1
            seconds = index / fps
            frame_height, frame_width = frame.shape[:2]
            synchronize()
            tick = perf_counter()
            boxes, confidences = detect(frame)
            synchronize()
            detection_seconds += perf_counter() - tick
            raw_detections += len(boxes)
            frame_best = None
            for coords, confidence in zip(boxes, confidences):
                x1, y1 = math.floor(float(coords[0])), math.floor(float(coords[1]))
                x2, y2 = math.ceil(float(coords[2])), math.ceil(float(coords[3]))
                x1, x2 = max(0, min(frame_width, x1)), max(0, min(frame_width, x2))
                y1, y2 = max(0, min(frame_height, y1)), max(0, min(frame_height, y2))
                if x2 <= x1 or y2 <= y1:
                    invalid_boxes += 1
                    continue
                synchronize()
                tick = perf_counter()
                vector = encoder.embed(frame[y1:y2, x1:x2])
                synchronize()
                embedding_seconds += perf_counter() - tick
                tick = perf_counter()
                score = float(np.clip(query_vector @ vector, -1.0, 1.0))
                similarity_seconds += perf_counter() - tick
                item = {
                    "vector_index": len(vectors), "frame_1based": index + 1,
                    "video_seconds": seconds, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "detection_confidence": float(confidence), "cosine_similarity": score,
                }
                vectors.append(vector)
                detections.append(item)
                if frame_best is None or score > frame_best["cosine_similarity"]:
                    frame_best = item
            if frame_best is not None:
                retain_scene(best_scenes, frame_best, frame, args.top_k)
            if sampled_frames == 1 or sampled_frames % 10 == 0:
                best = "none" if frame_best is None else f"{frame_best['cosine_similarity']:.4f}"
                print(f"{seconds:.2f}s | sampled={sampled_frames} | vectors={len(vectors)} | best={best}", flush=True)
        cap.release()
        cap = None
        synchronize()
        search_seconds = perf_counter() - search_started
        if decoded_frames == 0:
            raise RuntimeError("No frames decoded during search")
        export_started = perf_counter()
        fields = ["vector_index", "frame_1based", "video_seconds", "x1", "y1", "x2", "y2",
                  "detection_confidence", "cosine_similarity"]
        write_csv(output / "detections.csv", fields, detections)
        np.save(output / "query_vector.npy", query_vector)
        np.savez_compressed(
            output / "gallery_vectors.npz",
            vectors=np.asarray(vectors, dtype=np.float32).reshape(-1, encoder.dimension),
            frame_1based=np.asarray([r["frame_1based"] for r in detections], dtype=np.int64),
            seconds=np.asarray([r["video_seconds"] for r in detections], dtype=np.float64),
            boxes=np.asarray([[r[k] for k in ("x1", "y1", "x2", "y2")] for r in detections], dtype=np.int32).reshape(-1, 4),
            confidence=np.asarray([r["detection_confidence"] for r in detections], dtype=np.float32),
            similarities=np.asarray([r["cosine_similarity"] for r in detections], dtype=np.float32),
            query_vector=query_vector, model_id=settings["feature_model"],
            preprocessing=PREPROCESSING,
            source_video=str(args.video.resolve()),
        )
        rank_rows = []
        for rank, item in enumerate(best_scenes, 1):
            frame = item["frame"]
            x1, y1, x2, y2 = [item[k] for k in ("x1", "y1", "x2", "y2")]
            stem = f"rank_{rank:02d}_time_{item['video_seconds']:.3f}s"
            scene_name, crop_name = stem + ".jpg", stem + "_crop.jpg"
            save_image(output / crop_name, frame[y1:y2, x1:x2], cv2)
            display = frame.copy()
            cv2.rectangle(display, (x1, y1), (x2, y2), (0, 255, 0), 3)
            label = f"Rank {rank} | sim={item['cosine_similarity']:.4f} | {item['video_seconds']:.2f}s"
            cv2.putText(display, label, (max(5, x1), max(25, y1 - 10)), cv2.FONT_HERSHEY_SIMPLEX,
                        0.65, (0, 255, 0), 2, cv2.LINE_AA)
            save_image(output / scene_name, display, cv2)
            rank_rows.append({**{k: item[k] for k in fields}, "rank": rank,
                              "scene_image": scene_name, "person_crop": crop_name})
        write_csv(output / f"top{args.top_k}.csv", ["rank", *fields, "scene_image", "person_crop"], rank_rows)
        export_seconds = perf_counter() - export_started
        warnings = []
        target_frames = min(expected_frames, frame_limit) if frame_limit is not None else expected_frames
        if expected_frames > 0 and decoded_frames != target_frames:
            warnings.append(f"Expected {target_frames} readable frames; decoded {decoded_frames}")
        if len(best_scenes) < args.top_k:
            warnings.append(f"Only {len(best_scenes)} usable scenes; requested {args.top_k}")
        count = len(vectors)
        counts = {
            "fps": fps, "width": width, "height": height, "container_frame_count": expected_frames,
            "decoded_frames": decoded_frames, "sampled_frames": sampled_frames, "stride_frames": stride,
            "effective_interval_seconds": stride / fps, "raw_person_detections": raw_detections,
            "invalid_boxes": invalid_boxes, "gallery_vectors": count,
            "vector_dimension": encoder.dimension, "top_k_returned": len(best_scenes),
        }
        timings = {
            "import_seconds": import_seconds, "setup_seconds": setup_seconds,
            "model_load_including_download_seconds": model_load_seconds, "warmup_seconds": warmup_seconds,
            "query_embedding_seconds": query_seconds, "video_decode_seconds": decode_seconds,
            "yolo_detection_seconds": detection_seconds, "gallery_embedding_seconds": embedding_seconds,
            "cosine_similarity_seconds": similarity_seconds, "video_search_seconds": search_seconds,
            "export_seconds": export_seconds, "end_to_end_seconds": perf_counter() - process_started,
            "mean_detection_ms_per_sampled_frame": detection_seconds / sampled_frames * 1000,
            "mean_embedding_ms_per_person": embedding_seconds / count * 1000 if count else None,
            "sampled_frames_per_search_second": sampled_frames / search_seconds,
        }
        report = {
            "status": "complete" if not warnings else "complete_with_warnings",
            "settings": settings, "counts": counts, "times": timings, "query_encoding": query_info,
            "hardware": {"platform": platform.platform(), "cpu": platform.processor(),
                         "cuda_devices": {device: torch.cuda.get_device_name(device)} if device.startswith("cuda:") else {}},
            "versions": {"python": platform.python_version(), "torch": torch.__version__,
                         "ultralytics": version("ultralytics"), "numpy": version("numpy"),
                         "onnxruntime": encoder.runtime_version},
            "warnings": warnings,
            "timing_notes": [
                "gallery_embedding_seconds includes crop preprocessing, ONNX inference, "
                "CPU/GPU transfers and L2 normalization, as in the Intel measurement scope.",
                "query_embedding_seconds encodes the full supplied photo, with no query detection.",
                "setup includes model loading/download, predictor setup, warmup and query extraction; "
                "do not add these component times twice.",
                "Search includes video decoding, person detection, crop encoding and cosine similarity.",
                "end_to_end excludes interpreter startup and final timing/summary report writes.",
                "One scene per sampled frame, not distinct identities. No tracking or Intel model is run.",
                "Photo/video, detector settings, frame sampling and unpadded crop bounds must match Intel. "
                "Each encoder keeps its own expected resize and color preprocessing.",
                "Intel uses OpenVINO CPU; this run uses the recorded ONNX provider. "
                "Speed measures the complete model/runtime/device combination, not architecture alone.",
            ],
        }
        (output / "timing.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        summary_row = {
            "combination": LABEL, "run_folder": str(output), "video": settings["source_video"],
            "video_bytes": settings["source_video_bytes"], "query_sha384": settings["query_sha384"],
            "yolo_device": device, "feature_device": device, "interval_requested_seconds": args.interval,
            "confidence": args.conf, "iou": args.iou, "imgsz": args.imgsz, "max_det": args.max_det,
            "top_k_requested": args.top_k, **counts, **timings,
            "top1_similarity": best_scenes[0]["cosine_similarity"] if best_scenes else "",
            "warnings": " | ".join(warnings),
        }
        write_csv(output / "summary.csv", list(summary_row), [summary_row])
        summary_path = output.parent / "benchmark_summary.csv"
        has_header = summary_path.is_file() and summary_path.stat().st_size > 0
        with summary_path.open("a", newline="", encoding="utf-8-sig") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(summary_row))
            if not has_header:
                writer.writeheader()
            writer.writerow(summary_row)
        print(f"\n=== TOP {args.top_k} SCENES ===")
        for rank, item in enumerate(best_scenes, 1):
            print(f"Rank {rank}: {item['video_seconds']:.3f}s | similarity {item['cosine_similarity']:.4f}")
        print(f"Query embedding: {query_seconds:.4f}s")
        print(f"YOLO detection: {detection_seconds:.3f}s")
        print(f"Re-ID preprocessing + inference + transfers + normalization: {embedding_seconds:.3f}s")
        print(f"Similarity: {similarity_seconds:.6f}s | video search: {search_seconds:.3f}s")
        print(f"End to end: {timings['end_to_end_seconds']:.3f}s | vectors: {count} x {encoder.dimension}")
        print(f"Results: {output}\nComparison summary: {summary_path}")
        for warning in warnings:
            print("WARNING:", warning)
    except BaseException:
        (output / "FAILED.txt").write_text(traceback.format_exc(), encoding="utf-8")
        print(f"Run failed; details: {output / 'FAILED.txt'}", file=sys.stderr)
        raise
    finally:
        if cap is not None:
            cap.release()


if __name__ == "__main__":
    main(perf_counter())
