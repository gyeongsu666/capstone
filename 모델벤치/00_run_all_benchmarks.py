"""01, 02, 03, 04, 06을 순서대로 실행하고 report.html에 결과를 모읍니다."""

import argparse
import base64
import csv
import html
import json
import math
import mimetypes
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from time import perf_counter
from uuid import uuid4


ROOT = Path(__file__).resolve().parent

# ====================== 여기서 입력 사진과 설정을 바꾸세요 ======================
QUERY_IMAGE = ROOT / "person_10.png"  # 예: ROOT / "person_1.png"
VIDEO_PATH = ROOT / "video_1.mp4"
OUTPUT_ROOT = ROOT / "all_benchmark_results"
DEVICE = "auto"                     # "auto", "cpu", "0" (GPU)
SIGLIP_DEVICE = "auto"              # "auto"는 위 DEVICE를 따릅니다. Intel은 CPU.
INTERVAL = 1.0                      # 검사 간격(초), 0이면 전체 프레임
TOP_K = 5
CONF = 0.3
IOU = 0.7
IMGSZ = 640
MAX_DET = 300
# ============================================================================

EXPERIMENTS = (
    ("01_yolo11n_siglip.py", "YOLO11n + SigLIP"),
    ("02_yolo11n_intel.py", "YOLO11n + Intel Re-ID"),
    ("03_yolo26n_siglip.py", "YOLO26n + SigLIP"),
    ("04_yolo26n_intel.py", "YOLO26n + Intel Re-ID"),
    ("06_compare_reid_tracking.py", "YOLO26n + ONNX Re-ID"),
)

TIME_LABELS = {
    "import_seconds": "라이브러리 import (초)",
    "setup_seconds": "준비 전체 (초)",
    "model_load_including_download_seconds": "모델 로딩·다운로드 (초)",
    "warmup_seconds": "워밍업 (초)",
    "query_embedding_seconds": "기준 사진 벡터 추출 (초)",
    "video_decode_seconds": "영상 읽기 (초)",
    "yolo_detection_seconds": "YOLO 검출 (초)",
    "gallery_embedding_seconds": "영상 인물 벡터 추출 (초)",
    "cosine_similarity_seconds": "유사도 계산 (초)",
    "video_search_seconds": "영상 검색 전체 (초)",
    "export_seconds": "결과 저장 (초)",
    "end_to_end_seconds": "전체 실행 (초)",
    "mean_detection_ms_per_sampled_frame": "검사 프레임당 검출 (ms)",
    "mean_embedding_ms_per_person": "인물당 벡터 추출 (ms)",
    "sampled_frames_per_search_second": "초당 검사 프레임 수",
}
STATUS_LABELS = {
    "pending": "대기", "running": "실행 중", "complete": "완료",
    "complete_with_warnings": "완료·경고", "failed": "실패", "cancelled": "중단",
}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, default=QUERY_IMAGE)
    parser.add_argument("--video", type=Path, default=VIDEO_PATH)
    parser.add_argument("--output-root", type=Path, default=OUTPUT_ROOT)
    parser.add_argument("--device", default=DEVICE)
    parser.add_argument("--siglip-device", default=SIGLIP_DEVICE)
    parser.add_argument("--interval", type=float, default=INTERVAL)
    parser.add_argument("--top-k", type=int, default=TOP_K)
    parser.add_argument("--conf", type=float, default=CONF)
    parser.add_argument("--iou", type=float, default=IOU)
    parser.add_argument("--imgsz", type=int, default=IMGSZ)
    parser.add_argument("--max-det", type=int, default=MAX_DET)
    args = parser.parse_args(argv)
    if not math.isfinite(args.interval) or args.interval < 0:
        parser.error("--interval must be finite and >= 0")
    if not 0 < args.conf <= 1 or not 0 < args.iou <= 1:
        parser.error("--conf and --iou must be in (0, 1]")
    if args.top_k < 1 or args.imgsz < 32 or args.max_det < 1:
        parser.error("--top-k/--max-det must be >= 1; --imgsz must be >= 32")
    args.image, args.video = args.image.resolve(), args.video.resolve()
    for path in (args.image, args.video, ROOT / "yolo11n.pt", ROOT / "yolo26n.pt",
                 *(ROOT / filename for filename, _ in EXPERIMENTS)):
        if not path.is_file():
            parser.error(f"File not found: {path}")
    return args


def build_command(args, script, output):
    command = [sys.executable, "-u", str(ROOT / script)]
    for key in ("video", "image", "interval", "top_k", "conf", "iou", "imgsz", "max_det", "device"):
        command.extend(["--" + key.replace("_", "-"), str(getattr(args, key))])
    command.extend(["--output-root", str(output)])
    if "siglip" in script:
        command.extend(["--siglip-device", args.siglip_device])
    return command


def run_child(command, log_path):
    """별도 프로세스로 순차 실행해 각 모델 실행 후 메모리를 반환합니다."""
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    with log_path.open("w", encoding="utf-8") as log:
        with subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                              errors="replace") as process:
            try:
                for line in process.stdout:
                    log.write(line)
                    log.flush()
                    print(line, end="", flush=True)
                return process.wait()
            except BaseException:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                raise


def collect_result(output, returncode):
    if returncode != 0:
        raise RuntimeError(f"실행 파일 종료 코드: {returncode}")
    reports = list(output.glob("*/timing.json"))
    if len(reports) != 1:
        raise RuntimeError(f"timing.json이 1개 필요하지만 {len(reports)}개 발견되었습니다.")
    folder = reports[0].parent
    report = json.loads(reports[0].read_text(encoding="utf-8"))
    if report["status"] not in ("complete", "complete_with_warnings"):
        raise RuntimeError(f"실험이 완료되지 않았습니다: {report['status']}")
    with (folder / f"top{report['settings']['top_k']}.csv").open(
            encoding="utf-8-sig", newline="") as stream:
        ranks = list(csv.DictReader(stream))
    return {"status": report["status"], "report": report, "ranks": ranks,
            "run_folder": str(folder)}


def esc(value):
    return html.escape(str(value), quote=True)


def fmt(value):
    if value is None or value == "":
        return "—"
    if isinstance(value, float):
        return f"{value:.6f}"
    return esc(value)


def embedded_image(path, alt):
    path = Path(path)
    if not path.is_file():
        return f"<p>이미지 없음: {esc(path.name)}</p>"
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f'<img loading="lazy" src="data:{mime};base64,{encoded}" alt="{esc(alt)}">'


def comparison_table(records, metrics):
    headings = "".join(f"<th>{esc(r['name'])}</th>" for r in records)
    rows = []
    for label, section, key in metrics:
        cells = "".join(f"<td>{fmt(r.get('report', {}).get(section, {}).get(key))}</td>"
                        for r in records)
        rows.append(f"<tr><th>{esc(label)}</th>{cells}</tr>")
    return f'<div class="scroll"><table><tr><th>항목</th>{headings}</tr>{"".join(rows)}</table></div>'


def write_results(session, args, records, query_html):
    # Excel에서도 열 수 있는 전체 수치 비교표. 실패/대기 실험도 행을 유지합니다.
    summary_rows = []
    for record in records:
        report = record.get("report", {})
        settings = report.get("settings", {})
        summary_rows.append({
            "experiment": record["name"], "script": record["script"],
            "status": record["status"], "query_image": str(args.image),
            "source_video": str(args.video),
            "yolo_device": settings.get("yolo_device", ""),
            "feature_device": settings.get("feature_device", ""),
            "interval_requested_seconds": args.interval, "top_k_requested": args.top_k,
            "confidence": args.conf, "iou": args.iou, "imgsz": args.imgsz, "max_det": args.max_det,
            **report.get("counts", {}), **report.get("times", {}),
            "top1_similarity": record.get("ranks", [{}])[0].get("cosine_similarity", "")
            if record.get("ranks") else "",
            "process_wall_seconds": record.get("process_wall_seconds", ""),
            "warnings": " | ".join(report.get("warnings", [])),
            "error": record.get("error", ""), "run_folder": record.get("run_folder", ""),
        })
    fields = list(dict.fromkeys(key for row in summary_rows for key in row))
    with (session / "summary.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(summary_rows)

    statuses = "".join(f"<li>{esc(r['name'])}: <strong>{STATUS_LABELS[r['status']]}</strong></li>"
                       for r in records)
    metrics = [("검출 장치", "settings", "yolo_device"),
               ("특징 추출 장치", "settings", "feature_device"),
               ("검사 프레임 수", "counts", "sampled_frames"),
               ("디코딩 프레임 수", "counts", "decoded_frames"),
               ("실제 검사 간격 (초)", "counts", "effective_interval_seconds"),
               ("유효 인물 벡터 수", "counts", "gallery_vectors"),
               ("벡터 차원", "counts", "vector_dimension"),
               ("반환 장면 수", "counts", "top_k_returned")]
    tables = comparison_table(records, metrics)
    tables += comparison_table(records, [(label, "times", key) for key, label in TIME_LABELS.items()])
    sections = []
    for record in records:
        content = f"<h2>{esc(record['name'])} · {STATUS_LABELS[record['status']]}</h2>"
        if record.get("error"):
            content += f"<pre class='error'>{esc(record['error'])}</pre>"
        if record.get("report"):
            report = record["report"]
            for warning in report.get("warnings", []):
                content += f"<p class='error'>{esc(warning)}</p>"
            cards = []
            for rank in record["ranks"]:
                folder = Path(record["run_folder"])
                cards.append(
                    f"<article><h3>Rank {esc(rank['rank'])}</h3>"
                    f"<p>영상 {float(rank['video_seconds']):.3f}초 · "
                    f"유사도 {float(rank['cosine_similarity']):.6f} · "
                    f"검출 신뢰도 {float(rank['detection_confidence']):.4f}</p>"
                    + embedded_image(folder / rank["scene_image"], "후보 장면")
                    + '<div class="crop">' + embedded_image(folder / rank["person_crop"], "후보 인물")
                    + "</div></article>")
            content += f'<div class="cards">{"".join(cards)}</div>' if cards else "<p>검색 후보 없음</p>"
            content += "<details><summary>전체 측정값·설정·장치 정보</summary><pre>"
            content += esc(json.dumps(report, indent=2, ensure_ascii=False)) + "</pre></details>"
        content += f"<p>실행 파일: {esc(record['script'])} · 로그: runs/{esc(Path(record['script']).stem)}/console.log</p>"
        sections.append(f"<section>{content}</section>")
    page = f"""<!doctype html>
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>인물 검색 · 다섯 모델 비교</title>
<style>
body{{font-family:Segoe UI,Malgun Gothic,sans-serif;margin:0;background:#f3f5f9;color:#192434}}
main{{max-width:1600px;margin:auto;padding:28px}}section,.panel{{background:white;padding:24px;margin:20px 0;border-radius:12px}}
h1{{margin-top:0}}p{{line-height:1.7;overflow-wrap:anywhere}}table{{border-collapse:collapse;width:100%;font-size:14px}}
th,td{{border:1px solid #dbe1e9;padding:10px;text-align:right;white-space:nowrap}}th{{background:#edf2f8}}th:first-child{{text-align:left}}
.scroll{{overflow:auto;margin:20px 0}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px}}
article{{border:1px solid #dbe1e9;border-radius:8px;padding:12px}}img{{max-width:100%;height:auto}}.crop img{{max-height:220px;width:auto}}
.query img{{max-height:280px;width:auto}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}}.error{{color:#a52b20}}
details{{margin-top:20px}}summary{{cursor:pointer}}li{{margin:8px 0}}
</style><main>
<h1>인물 검색 · 다섯 모델 비교</h1>
<p>실행: {esc(session.name)} · 보고서 갱신: {esc(datetime.now().astimezone().isoformat(timespec='seconds'))}</p>
<div class="panel"><h2>공통 입력</h2><div class="query">{query_html}</div>
<p>기준 사진: {esc(args.image)}<br>영상: {esc(args.video)}<br>
검사 간격: {args.interval}초 (0: 전체 프레임) · Top {args.top_k} · conf={args.conf} · iou={args.iou} ·
imgsz={args.imgsz} · max_det={args.max_det} · 요청 장치={esc(args.device)} · SigLIP 장치={esc(args.siglip_device)}</p>
<ul>{statuses}</ul></div>
<section><h2>성능 비교</h2><p>준비 전체에는 모델 로딩·워밍업·기준 사진 추출이 포함됩니다.
영상 검색 전체에는 영상 읽기·검출·벡터 추출·유사도 계산이 포함됩니다. 포함된 시간을 중복 합산하지 마세요.
Intel은 CPU를 사용하며 실제 실행 장치는 아래에 표시합니다. 모델·런타임·장치를 포함한 처리 시간 비교입니다.</p>
{tables}<p>서로 다른 특징 모델의 유사도 크기만으로 정확도를 비교할 수 없습니다.
순위는 프레임별 후보 장면이며 같은 인물이 여러 번 포함될 수 있습니다. 정확도 평가는 정답 확인이 필요합니다.</p></section>
{"".join(sections)}
<p>사진은 이 HTML에 포함되어 있어 report.html 파일 하나만 복사해도 볼 수 있습니다.
전체 수치 비교표는 summary.csv, 원본 벡터·이미지·로그는 runs 폴더에 있습니다.</p></main></html>"""
    temporary = session / "report.html.tmp"
    temporary.write_text(page, encoding="utf-8")
    temporary.replace(session / "report.html")


def run_suite(args):
    stamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S_%f")
    session = args.output_root.resolve() / f"all_{stamp}_{uuid4().hex[:6]}"
    session.mkdir(parents=True)
    records = [{"script": script, "name": name, "status": "pending"}
               for script, name in EXPERIMENTS]
    query_html = embedded_image(args.image, "기준 사진")
    write_results(session, args, records, query_html)
    print(f"통합 보고서: {session / 'report.html'}", flush=True)
    interrupted = False
    for index, record in enumerate(records, 1):
        output = session / "runs" / Path(record["script"]).stem
        output.mkdir(parents=True)
        record["status"] = "running"
        write_results(session, args, records, query_html)
        print(f"\n===== [{index}/{len(records)}] {record['name']} =====", flush=True)
        started = perf_counter()
        try:
            code = run_child(build_command(args, record["script"], output), output / "console.log")
            record.update(collect_result(output, code))
        except KeyboardInterrupt:
            record.update(status="cancelled", error="사용자가 실행을 중단했습니다.")
            for remaining in records[index:]:
                remaining["status"] = "cancelled"
            interrupted = True
        except Exception as error:
            record.update(status="failed", error=f"{type(error).__name__}: {error}")
            log = output / "console.log"
            if log.is_file():
                record["error"] += "\n\n" + log.read_text(encoding="utf-8", errors="replace")[-6000:]
            print(f"실패: {record['error'].splitlines()[0]} — 로그: {log}", flush=True)
        finally:
            record["process_wall_seconds"] = perf_counter() - started
            write_results(session, args, records, query_html)
        if interrupted:
            break
    print(f"\n통합 보고서: {session / 'report.html'}\n수치 비교표: {session / 'summary.csv'}", flush=True)
    return session, records


def main():
    _, records = run_suite(parse_args())
    if any(record["status"] == "cancelled" for record in records):
        return 130
    return int(any(record["status"] == "failed" for record in records))


if __name__ == "__main__":
    sys.exit(main())
