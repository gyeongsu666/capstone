"""통합 실행 흐름은 작은 가짜 작업을 실제 subprocess로 실행해 검증합니다."""

import base64
import contextlib
import csv
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("all_benchmarks", ROOT / "00_run_all_benchmarks.py")
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)

WORKER = '''
import argparse, csv, json, sys
from pathlib import Path
p = argparse.ArgumentParser()
for key in ("image", "video", "output-root", "device", "siglip-device", "interval",
            "top-k", "conf", "iou", "imgsz", "max-det"):
    p.add_argument("--" + key)
a = p.parse_args()
out = Path(a.output_root)
(out / "received.json").write_text(json.dumps(vars(a)), encoding="utf-8")
if Path(__file__).name.startswith("02"):
    print("intentional failure <test>")
    sys.exit(7)
folder = out / "result"
folder.mkdir()
report = {"status": "complete", "settings": {"top_k": int(a.top_k),
          "yolo_device": "cpu", "feature_device": "cpu"},
          "times": {"video_search_seconds": 1.25, "end_to_end_seconds": 2.5},
          "counts": {"gallery_vectors": 3, "vector_dimension": 256}, "warnings": []}
(folder / "timing.json").write_text(json.dumps(report), encoding="utf-8")
(folder / "scene.png").write_bytes(Path(a.image).read_bytes())
with (folder / f"top{a.top_k}.csv").open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=["rank", "video_seconds", "cosine_similarity", "detection_confidence",
                                    "scene_image", "person_crop"])
    w.writeheader()
    w.writerow(dict(rank=1, video_seconds=3, cosine_similarity=0.75, detection_confidence=0.9,
                    scene_image="scene.png", person_crop="scene.png"))
print("finished")
'''


class RunAllTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.image = self.root / "기준 & 사진.png"
        self.image.write_bytes(base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII="))
        self.video = self.root / "영상.mp4"
        self.video.write_bytes(b"fixture")
        self.args = suite.parse_args(["--image", str(self.image), "--video", str(self.video),
                                      "--output-root", str(self.root / "results"),
                                      "--device", "cpu", "--siglip-device", "cpu", "--top-k", "2"])

    def test_five_processes_failure_continues_and_report_is_self_contained(self):
        for script, _ in suite.EXPERIMENTS:
            (self.root / script).write_text(WORKER, encoding="utf-8")
        with patch.object(suite, "ROOT", self.root), contextlib.redirect_stdout(io.StringIO()):
            session, records = suite.run_suite(self.args)
        self.assertEqual([r["status"] for r in records],
                         ["complete", "failed", "complete", "complete", "complete"])
        for record in records:
            received = json.loads((session / "runs" / Path(record["script"]).stem /
                                   "received.json").read_text(encoding="utf-8"))
            self.assertEqual(received["image"], str(self.image))
            self.assertEqual(received["video"], str(self.video))
            self.assertEqual(received["top_k"], "2")
            self.assertEqual(received["interval"], "1.0")
            self.assertEqual(received["device"], "cpu")
            self.assertEqual(received["siglip_device"], "cpu" if "siglip" in record["script"] else None)
        with (session / "summary.csv").open(encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[1]["video_search_seconds"], "")
        self.assertEqual(rows[4]["video_search_seconds"], "1.25")
        self.assertEqual(rows[4]["top1_similarity"], "0.75")
        page = (session / "report.html").read_text(encoding="utf-8")
        self.assertEqual(page.count("data:image/png;base64,"), 9)
        self.assertNotIn('src="http', page)
        self.assertIn("intentional failure &lt;test&gt;", page)
        self.assertIn("기준 &amp; 사진.png", page)
        self.assertIn("YOLO26n + ONNX Re-ID", page)

    def test_interrupt_preserves_partial_report_and_cancels_remaining(self):
        with patch.object(suite, "run_child", side_effect=KeyboardInterrupt) as child:
            with contextlib.redirect_stdout(io.StringIO()):
                session, records = suite.run_suite(self.args)
        self.assertEqual(child.call_count, 1)
        self.assertTrue(all(r["status"] == "cancelled" for r in records))
        self.assertTrue((session / "report.html").is_file())

    def test_zero_exit_without_output_is_not_reported_as_success(self):
        with self.assertRaisesRegex(RuntimeError, "timing.json"):
            suite.collect_result(self.root, 0)


if __name__ == "__main__":
    unittest.main()
