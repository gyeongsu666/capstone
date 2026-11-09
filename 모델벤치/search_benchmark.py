"""Four entry points share the same sampling, ranking and timing implementation.

Run 01_yolo11n_siglip.py, 02_yolo11n_intel.py, 03_yolo26n_siglip.py or
04_yolo26n_intel.py. This module performs no inference when imported.
"""

import argparse
import csv
import hashlib
import json
import math
import platform
import shutil
import sys
import traceback
from datetime import datetime
from importlib.metadata import version
from pathlib import Path
from time import perf_counter
from urllib.request import urlopen
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
SIGLIP_ID = "google/siglip-so400m-patch14-384"
INTEL_ID = "person-reidentification-retail-0287"
INTEL_URL = (
    "https://storage.openvinotoolkit.org/repositories/open_model_zoo/"
    "2023.0/models_bin/1/person-reidentification-retail-0287/FP32/"
)
INTEL_HASHES = {
    "xml": "a8a6956dec193dfa0095319c5f0bfccd5b9eaaac4d30ddc12a79aa7a99f0dcf953aae7b76764239d383ff39f8f8a1477",
    "bin": "7e962ed07992edeff11eac8f6280ea5761d8ddfb699bcd3c79cfeac10773c5f4d4577ca4c048a7fa50977cdfc14a74ba",
}


def sha384(path):
    digest = hashlib.sha384()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_intel_model():
    folder = ROOT / "models" / INTEL_ID / "FP32"
    folder.mkdir(parents=True, exist_ok=True)
    for suffix, expected in INTEL_HASHES.items():
        path = folder / f"{INTEL_ID}.{suffix}"
        if path.is_file() and sha384(path) == expected:
            continue
        temporary = path.with_name(path.name + f".{uuid4().hex}.download")
        print(f"Downloading Intel model: {path.name}", flush=True)
        try:
            with urlopen(INTEL_URL + path.name, timeout=120) as response:
                with temporary.open("wb") as stream:
                    shutil.copyfileobj(response, stream)
            if sha384(temporary) != expected:
                raise RuntimeError(f"Intel model checksum mismatch: {path.name}")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return folder / f"{INTEL_ID}.xml"


def read_image(path, cv2, np):
    image = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Cannot read image: {path}")
    return image


def save_image(path, image, cv2):
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not ok:
        raise RuntimeError(f"Cannot encode image: {path}")
    encoded.tofile(str(path))


def normalize(vector, dimension, np):
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if (vector.shape != (dimension,) or not np.isfinite(vector).all()
            or not math.isfinite(norm) or norm <= 0):
        raise ValueError(f"Expected a finite nonzero {dimension}-dimensional vector")
    return vector / norm


class SiglipEncoder:
    dimension = 1152
    model_id = SIGLIP_ID
    preprocessing = "RGB; Hugging Face SiglipImageProcessor; pooler_output; L2 normalized"

    def __init__(self, device, torch, cv2, np):
        from transformers import AutoImageProcessor, SiglipVisionModel

        self.device = device
        self.torch, self.cv2, self.np = torch, cv2, np
        # Slow/PIL processing keeps preprocessing explicit and consistent on CPU/GPU.
        self.processor = AutoImageProcessor.from_pretrained(SIGLIP_ID, backend="pil")
        try:
            if sys.platform == "win32":
                from siglip_streaming import load_siglip_vision

                self.model = load_siglip_vision(SIGLIP_ID, device, torch, SiglipVisionModel)
                self.weight_loader = "vision_tensor_streaming_no_mmap"
            else:
                self.model = SiglipVisionModel.from_pretrained(SIGLIP_ID, dtype=torch.float32)
                self.weight_loader = "transformers_from_pretrained"
        except OSError as error:
            if getattr(error, "winerror", None) == 1455 or "1455" in str(error):
                raise RuntimeError(
                    "Windows could not allocate memory while loading SigLIP weights (error 1455). "
                    "Close unused memory-heavy programs, "
                    "then check Windows Virtual memory/page file settings and free disk space. "
                    "See the error 1455 section in README_실험.md. "
                    "Changing --interval does not reduce model-loading memory."
                ) from error
            raise
        self.model = self.model.to(device=device, dtype=torch.float32).eval()

    def embed(self, bgr):
        rgb = self.cv2.cvtColor(bgr, self.cv2.COLOR_BGR2RGB)
        inputs = self.processor(images=rgb, return_tensors="pt")
        inputs = {name: value.to(self.device) for name, value in inputs.items()}
        with self.torch.inference_mode():
            vector = self.model(**inputs).pooler_output[0].float().cpu().numpy().copy()
        return normalize(vector, self.dimension, self.np)


class IntelEncoder:
    dimension = 256
    model_id = INTEL_ID
    preprocessing = "BGR raw 0..255; FP32 NCHW 1x3x256x128; L2 normalized"
    device = "CPU"

    def __init__(self, cv2, np):
        import openvino as ov

        self.cv2, self.np = cv2, np
        self.compiled = ov.Core().compile_model(
            str(ensure_intel_model()), "CPU",
            {"INFERENCE_PRECISION_HINT": "f32", "PERFORMANCE_HINT": "LATENCY", "NUM_STREAMS": "1"},
        )
        self.request = self.compiled.create_infer_request()
        self.output = self.compiled.output(0)
        shape = tuple(map(int, self.compiled.input(0).shape))
        if shape != (1, 3, 256, 128):
            raise ValueError(f"Unexpected Intel model input: {shape}")

    def embed(self, bgr):
        # Open Model Zoo expects BGR in the original pixel range, not RGB or /255.
        image = self.cv2.resize(bgr, (128, 256))
        tensor = self.np.ascontiguousarray(
            image.transpose(2, 0, 1)[None], dtype=self.np.float32
        )
        vector = self.np.array(self.request.infer([tensor])[self.output], copy=True)
        return normalize(vector, self.dimension, self.np)


def parse_args(detector_name, encoder_name):
    parser = argparse.ArgumentParser(
        description=f"{detector_name} + {encoder_name}: rank-5 person image search"
    )
    parser.add_argument("--video", type=Path, default=ROOT / "video_1.mp4")
    parser.add_argument("--image", type=Path, default=ROOT / "person_3.png")
    parser.add_argument("--interval", type=float, default=1.0,
                        help="Sample interval in seconds; 0 means every frame (default: 1)")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--conf", type=float, default=0.3)
    parser.add_argument("--iou", type=float, default=0.7)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--max-det", type=int, default=300)
    parser.add_argument("--device", default="auto", help="YOLO device: auto, cpu, 0, cuda:0")
    parser.add_argument("--siglip-device", default="auto",
                        help="auto follows YOLO; alternatively cpu, 0, cuda:0")
    parser.add_argument("--output-root", type=Path, default=ROOT / "benchmark_results_2")
    args = parser.parse_args()
    if not math.isfinite(args.interval) or args.interval < 0:
        parser.error("--interval must be finite and >= 0")
    if not 0 <= args.conf <= 1 or not 0 <= args.iou <= 1:
        parser.error("--conf and --iou must be between 0 and 1")
    if args.top_k < 1 or args.imgsz < 32 or args.max_det < 1:
        parser.error("--top-k/--max-det must be >= 1 and --imgsz >= 32")
    for path in (args.video, args.image, ROOT / f"{detector_name}.pt"):
        if not path.is_file():
            parser.error(f"File not found: {path}")
    return args


def resolve_device(value, torch):
    if value == "auto":
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    if value == "cpu":
        return "cpu"
    candidate = f"cuda:{value}" if value.isdigit() else value
    device = torch.device(candidate)
    if device.type != "cuda" or not torch.cuda.is_available():
        raise ValueError(f"Unavailable device: {value}; use --device cpu")
    index = device.index if device.index is not None else 0
    if index >= torch.cuda.device_count():
        raise ValueError(f"CUDA device index does not exist: {index}")
    return f"cuda:{index}"


def write_csv(path, fields, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def run(detector_name, encoder_name, process_started=None):
    if process_started is None:
        process_started = perf_counter()
    args = parse_args(detector_name, encoder_name)
    print(f"\n=== {detector_name} + {encoder_name} ===", flush=True)
    print("Loading libraries and models...", flush=True)
    # Heavy imports are inside run so --help does not load models or ML libraries.
    import cv2
    import numpy as np
    import torch
    from ultralytics import YOLO

    import_seconds = perf_counter() - process_started
    setup_started = perf_counter()
    torch.manual_seed(0)
    np.random.seed(0)
    # Explicit FP32 for both YOLO models and SigLIP.
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
    yolo_device = resolve_device(args.device, torch)
    feature_device = (
        resolve_device(yolo_device if args.siglip_device == "auto" else args.siglip_device, torch)
        if encoder_name == "siglip" else "CPU"
    )
    cuda_devices = sorted({d for d in (yolo_device, feature_device) if d.startswith("cuda:")})

    def synchronize():
        for device in cuda_devices:
            torch.cuda.synchronize(device)

    label = f"{detector_name}_{encoder_name}"
    run_id = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
    output = args.output_root.resolve() / f"{label}_{run_id}_{uuid4().hex[:6]}"
    output.mkdir(parents=True)
    settings = {
        "combination": label,
        "source_video": str(args.video.resolve()),
        "query_image": str(args.image.resolve()),
        "source_video_bytes": args.video.stat().st_size,
        "query_sha384": sha384(args.image),
        "yolo_weights": str(ROOT / f"{detector_name}.pt"),
        "yolo_device": yolo_device, "feature_device": feature_device,
        "feature_model": SIGLIP_ID if encoder_name == "siglip" else INTEL_ID,
        "interval_requested_seconds": args.interval, "top_k": args.top_k,
        "confidence": args.conf, "iou": args.iou, "imgsz": args.imgsz,
        "max_det": args.max_det, "batch_size": 1, "torch_precision": "float32",
        "intel_precision_hint": "f32" if encoder_name == "intel" else None,
        "rank_unit": "best person detection per sampled frame; repeated identities allowed",
    }
    (output / "settings.json").write_text(
        json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    cap = None
    try:
        cap = cv2.VideoCapture(str(args.video.resolve()))
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {args.video}")
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if not math.isfinite(fps) or fps <= 0:
            raise RuntimeError("Invalid video FPS")
        expected_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        ok, first_frame = cap.read()
        if not ok:
            raise RuntimeError("Video contains no readable frames")
        height, width = first_frame.shape[:2]
        query_image = read_image(args.image, cv2, np)
        stride = 1 if args.interval == 0 else max(1, round(fps * args.interval))

        tick = perf_counter()
        detector = YOLO(str(ROOT / f"{detector_name}.pt"))
        encoder = (
            SiglipEncoder(feature_device, torch, cv2, np)
            if encoder_name == "siglip" else IntelEncoder(cv2, np)
        )
        synchronize()
        model_load_seconds = perf_counter() - tick

        def detect(frame):
            result = detector.predict(
                frame, classes=[0], conf=args.conf, iou=args.iou, imgsz=args.imgsz,
                max_det=args.max_det, device=yolo_device, half=False,
                augment=False, verbose=False, save=False,
            )[0]
            # Include the CPU transfer in the measured detection time.
            return result.boxes.xyxy.cpu().numpy(), result.boxes.conf.cpu().numpy()

        print(f"YOLO: {yolo_device}; features: {feature_device}; batch: 1", flush=True)
        print("Warming up (excluded from search timing)...", flush=True)
        tick = perf_counter()
        detect(first_frame)
        encoder.embed(query_image)
        synchronize()
        warmup_seconds = perf_counter() - tick
        tick = perf_counter()
        query = encoder.embed(query_image)
        synchronize()
        query_seconds = perf_counter() - tick
        # Reopen to guarantee the measured search starts from frame zero.
        cap.release()
        cap = cv2.VideoCapture(str(args.video.resolve()))
        if not cap.isOpened():
            raise RuntimeError("Cannot reopen video")
        setup_seconds = perf_counter() - setup_started

        vectors, detections, best_scenes = [], [], []
        decoded_frames = sampled_frames = raw_detections = invalid_boxes = 0
        decode_seconds = detection_seconds = embedding_seconds = similarity_seconds = 0.0
        search_started = perf_counter()
        print(f"Sampling every {stride} frames ({stride / fps:.3f}s); top {args.top_k}", flush=True)
        while True:
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
                # Both query and gallery are L2 normalized.
                score = float(np.clip(query @ vector, -1.0, 1.0))
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
            # One scene per sampled frame; no full-resolution frame is stored per detection.
            if frame_best is not None:
                if (len(best_scenes) < args.top_k or
                        frame_best["cosine_similarity"] > best_scenes[-1]["cosine_similarity"]):
                    best_scenes.append({**frame_best, "frame": frame.copy()})
                    best_scenes.sort(key=lambda item: item["cosine_similarity"], reverse=True)
                    del best_scenes[args.top_k:]
            if sampled_frames == 1 or sampled_frames % 10 == 0:
                best_text = "none" if frame_best is None else f"{frame_best['cosine_similarity']:.4f}"
                print(f"{seconds:8.2f}s | sampled={sampled_frames} | "
                      f"vectors={len(vectors)} | frame best={best_text}", flush=True)
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
        np.save(output / "query_vector.npy", query)
        np.savez_compressed(
            output / "gallery_vectors.npz",
            vectors=np.asarray(vectors, dtype=np.float32).reshape(-1, encoder.dimension),
            frame_1based=np.asarray([r["frame_1based"] for r in detections], dtype=np.int64),
            seconds=np.asarray([r["video_seconds"] for r in detections], dtype=np.float64),
            boxes=np.asarray([[r[k] for k in ("x1", "y1", "x2", "y2")] for r in detections],
                             dtype=np.int32).reshape(-1, 4),
            confidence=np.asarray([r["detection_confidence"] for r in detections], dtype=np.float32),
            similarities=np.asarray([r["cosine_similarity"] for r in detections], dtype=np.float32),
            model_id=encoder.model_id, preprocessing=encoder.preprocessing,
            source_video=str(args.video.resolve()), query_vector=query,
        )
        rank_rows = []
        for rank, item in enumerate(best_scenes, 1):
            raw_frame = item["frame"]
            x1, y1, x2, y2 = [item[k] for k in ("x1", "y1", "x2", "y2")]
            stem = f"rank_{rank:02d}_time_{item['video_seconds']:.3f}s"
            frame_name, crop_name = stem + ".jpg", stem + "_crop.jpg"
            save_image(output / crop_name, raw_frame[y1:y2, x1:x2], cv2)
            display = raw_frame.copy()
            cv2.rectangle(display, (x1, y1), (x2, y2), (0, 255, 0), 3)
            text = f"Rank {rank} | sim={item['cosine_similarity']:.4f} | {item['video_seconds']:.2f}s"
            cv2.putText(display, text, (max(5, x1), max(25, y1 - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2, cv2.LINE_AA)
            save_image(output / frame_name, display, cv2)
            rank_rows.append({**{k: item[k] for k in fields}, "rank": rank,
                              "scene_image": frame_name, "person_crop": crop_name})
        write_csv(output / f"top{args.top_k}.csv",
                  ["rank", *fields, "scene_image", "person_crop"], rank_rows)
        export_seconds = perf_counter() - export_started
        versions = {name: version(name) for name in ("torch", "ultralytics", "numpy", "opencv-python")}
        versions["transformers" if encoder_name == "siglip" else "openvino"] = version(
            "transformers" if encoder_name == "siglip" else "openvino"
        )
        warnings = []
        if expected_frames > 0 and decoded_frames != expected_frames:
            warnings.append(f"Container reports {expected_frames} frames; decoded {decoded_frames}. "
                            "Check for decode errors before comparing results.")
        if len(best_scenes) < args.top_k:
            warnings.append(f"Only {len(best_scenes)} usable sampled scenes; requested {args.top_k}.")
        feature_count = len(vectors)
        metrics = {
            "import_seconds": import_seconds,
            "setup_seconds": setup_seconds,
            "model_load_including_download_seconds": model_load_seconds,
            "warmup_seconds": warmup_seconds,
            "query_embedding_seconds": query_seconds,
            "video_decode_seconds": decode_seconds,
            "yolo_detection_seconds": detection_seconds,
            "gallery_embedding_seconds": embedding_seconds,
            "cosine_similarity_seconds": similarity_seconds,
            "video_search_seconds": search_seconds,
            "export_seconds": export_seconds,
            "end_to_end_seconds": perf_counter() - process_started,
            "mean_detection_ms_per_sampled_frame": detection_seconds / sampled_frames * 1000,
            "mean_embedding_ms_per_person": embedding_seconds / feature_count * 1000 if feature_count else None,
            "sampled_frames_per_search_second": sampled_frames / search_seconds,
        }
        counts = {
            "fps": fps, "width": width, "height": height,
            "container_frame_count": expected_frames, "decoded_frames": decoded_frames,
            "sampled_frames": sampled_frames, "stride_frames": stride,
            "effective_interval_seconds": stride / fps,
            "raw_person_detections": raw_detections, "invalid_boxes": invalid_boxes,
            "gallery_vectors": feature_count, "vector_dimension": encoder.dimension,
            "top_k_returned": len(best_scenes),
        }
        report = {
            "status": "complete" if not warnings else "complete_with_warnings",
            "settings": settings, "counts": counts, "times": metrics,
            "weight_loader": getattr(encoder, "weight_loader", "openvino_compile_model"),
            "hardware": {"platform": platform.platform(), "cpu": platform.processor(),
                         "cuda_devices": {d: torch.cuda.get_device_name(d) for d in cuda_devices}},
            "versions": {"python": sys.version, **versions}, "warnings": warnings,
            "timing_notes": [
                "model_load, warmup and query_embedding are INCLUDED in setup; do not sum twice.",
                "decode, detection, embedding and similarity are INCLUDED in video_search.",
                "end_to_end includes imports, setup, video search and result export; "
                "excludes final timing.json and benchmark_summary.csv writes and interpreter startup.",
                "Detection includes preprocess, inference, postprocess and CPU box transfer.",
                "Embedding includes color/resize/processor, inference, CPU transfer and L2 normalization.",
                "CUDA synchronized at measured stage boundaries; each crop uses batch size 1.",
                "Run all four sequentially with matching arguments and an idle machine.",
                "SigLIP uses --siglip-device; Intel uses CPU. These devices are reported explicitly.",
                "Cosine scores from different embedding models are not accuracy measurements.",
                "Ranks are scenes, not distinct identities. No tracking or identity deduplication.",
            ],
        }
        (output / "timing.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        # All runs append comparable rows. Run sequentially, not concurrently.
        summary_row = {
            "combination": label, "run_folder": str(output),
            "video": settings["source_video"], "video_bytes": settings["source_video_bytes"],
            "query_sha384": settings["query_sha384"], "yolo_device": yolo_device,
            "feature_device": feature_device, "interval_requested_seconds": args.interval,
            "confidence": args.conf, "iou": args.iou, "imgsz": args.imgsz,
            "max_det": args.max_det, "top_k_requested": args.top_k,
            **counts, **metrics,
            "top1_similarity": best_scenes[0]["cosine_similarity"] if best_scenes else "",
            "warnings": " | ".join(warnings),
        }
        summary = output.parent / "benchmark_summary.csv"
        has_header = summary.is_file() and summary.stat().st_size > 0
        with summary.open("a", newline="", encoding="utf-8-sig") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(summary_row))
            if not has_header:
                writer.writeheader()
            writer.writerow(summary_row)

        print(f"\n=== TOP {args.top_k} SCENES ===")
        for rank, item in enumerate(best_scenes, 1):
            print(f"Rank {rank}: {item['video_seconds']:.3f}s | similarity {item['cosine_similarity']:.4f}")
        print(f"\nQuery embedding:    {query_seconds:.4f}s")
        print(f"YOLO detection:     {detection_seconds:.3f}s")
        print(f"Gallery embeddings: {embedding_seconds:.3f}s ({feature_count} vectors)")
        print(f"Similarity:         {similarity_seconds:.6f}s")
        print(f"Video search:       {search_seconds:.3f}s")
        print(f"Setup / warmup:     {setup_seconds:.3f}s / {warmup_seconds:.3f}s (warmup is part of setup)")
        print(f"End to end:         {metrics['end_to_end_seconds']:.3f}s")
        print(f"Results: {output}")
        print(f"Comparison CSV: {summary}")
        for warning in warnings:
            print("WARNING:", warning)
        print("Candidates only. Cosine similarity is not an identity probability.")
    except BaseException:
        (output / "FAILED.txt").write_text(traceback.format_exc(), encoding="utf-8")
        print(f"Run did not complete. Details: {output / 'FAILED.txt'}", file=sys.stderr)
        raise
    finally:
        if cap is not None:
            cap.release()
